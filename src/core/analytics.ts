import type {
  ChefScorecard, Dish, DishCosting, ID, Item, Movement, SalesDay, Section,
  Staff, Wastage,
} from './types'
import { type CostingContext, costDish } from './costing'
import { monthKey, rangeDays } from './dates'
import { round } from './units'

/* ------------------------------------------------------------------ */
/* Sales aggregation                                                   */
/* ------------------------------------------------------------------ */

export interface DishPerformance {
  dishId: ID
  name: string
  categoryId: ID
  qty: number
  revenue: number
  discount: number
  netRevenue: number
  foodCost: number
  contribution: number
  contributionPerPlate: number
  foodCostPct: number
  contributionPct: number
  share: number
  rank: number
  /** Menu-engineering quadrant. */
  classification: 'STAR' | 'PLOUGHHORSE' | 'PUZZLE' | 'DOG'
}

export interface SalesTotals {
  revenue: number
  discount: number
  netRevenue: number
  dishes: number
  covers: number
  foodCost: number
  contribution: number
  foodCostPct: number
  avgSpend: number
}

export function filterSales(sales: SalesDay[], from: string, to: string): SalesDay[] {
  return sales.filter((s) => s.status === 'POSTED' && s.date >= from && s.date <= to)
}

export function soldByDish(sales: SalesDay[]): Map<ID, { qty: number; gross: number; discount: number }> {
  const out = new Map<ID, { qty: number; gross: number; discount: number }>()
  for (const day of sales) {
    for (const line of day.lines) {
      const cur = out.get(line.dishId) ?? { qty: 0, gross: 0, discount: 0 }
      cur.qty += line.qty
      cur.gross += line.grossAmount
      cur.discount += line.discount
      out.set(line.dishId, cur)
    }
  }
  return out
}

/**
 * Menu engineering. Popularity is measured against an even split of the menu
 * (the classic 70%-of-average rule); profitability against the weighted mean
 * contribution per plate. Everything else is derived from those two axes.
 */
export function dishPerformance(
  ctx: CostingContext,
  dishes: Dish[],
  sales: SalesDay[],
): { rows: DishPerformance[]; totals: SalesTotals; avgContribution: number; popularityThreshold: number } {
  const sold = soldByDish(sales)
  const costings = new Map<ID, DishCosting>(dishes.map((d) => [d.id, costDish(ctx, d, true)]))
  const totalQty = [...sold.values()].reduce((s, v) => s + v.qty, 0)
  const dishCount = dishes.filter((d) => d.active).length || 1
  const popularityThreshold = (totalQty / dishCount) * 0.7

  let totalContribution = 0
  const rows: DishPerformance[] = []
  for (const dish of dishes) {
    const s = sold.get(dish.id)
    if (!s) continue
    const c = costingsGet(costings, dish, ctx)
    const netRevenue = round((s.gross - s.discount) / (1 + (dish.gstPct || 0) / 100), 2)
    const foodCost = round(c.foodCost * s.qty, 2)
    const variable = round((c.packagingCost + c.otherVariableCost) * s.qty, 2)
    const contribution = round(netRevenue - foodCost - variable, 2)
    totalContribution += contribution
    rows.push({
      dishId: dish.id,
      name: dish.name,
      categoryId: dish.categoryId,
      qty: s.qty,
      revenue: round(s.gross, 2),
      discount: round(s.discount, 2),
      netRevenue,
      foodCost,
      contribution,
      contributionPerPlate: s.qty ? round(contribution / s.qty, 2) : 0,
      foodCostPct: netRevenue ? round((foodCost / netRevenue) * 100, 1) : 0,
      contributionPct: netRevenue ? round((contribution / netRevenue) * 100, 1) : 0,
      share: 0,
      rank: 0,
      classification: 'DOG',
    })
  }

  const avgContribution = rows.length
    ? round(rows.reduce((s, r) => s + r.contribution, 0) / Math.max(totalQty, 1), 2)
    : 0

  rows.sort((a, b) => b.revenue - a.revenue)
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0) || 1
  rows.forEach((r, i) => {
    r.rank = i + 1
    r.share = round((r.revenue / totalRevenue) * 100, 1)
    const popular = r.qty >= popularityThreshold
    const profitable = r.contributionPerPlate >= avgContribution
    r.classification = popular && profitable ? 'STAR'
      : popular && !profitable ? 'PLOUGHHORSE'
      : !popular && profitable ? 'PUZZLE' : 'DOG'
  })

  const covers = sales.reduce((s, d) => s + d.covers, 0)
  const revenue = round(rows.reduce((s, r) => s + r.revenue, 0), 2)
  const discount = round(rows.reduce((s, r) => s + r.discount, 0), 2)
  const netRevenue = round(rows.reduce((s, r) => s + r.netRevenue, 0), 2)
  const foodCost = round(rows.reduce((s, r) => s + r.foodCost, 0), 2)
  const totals: SalesTotals = {
    revenue, discount, netRevenue,
    dishes: totalQty,
    covers,
    foodCost,
    contribution: round(totalContribution, 2),
    foodCostPct: netRevenue ? round((foodCost / netRevenue) * 100, 1) : 0,
    avgSpend: covers ? round(revenue / covers, 0) : 0,
  }
  return { rows, totals, avgContribution, popularityThreshold }
}

function costingsGet(map: Map<ID, DishCosting>, dish: Dish, ctx: CostingContext): DishCosting {
  let c = map.get(dish.id)
  if (!c) { c = costDish(ctx, dish, true); map.set(dish.id, c) }
  return c
}

/* ------------------------------------------------------------------ */
/* Chef profitability                                                  */
/* ------------------------------------------------------------------ */

export interface ChefInput {
  ctx: CostingContext
  dishes: Dish[]
  sales: SalesDay[]
  staff: Staff[]
  sections: Section[]
  wastage: Wastage[]
  items: Item[]
  /** Actual (counted) leakage value for the period, attributed by section. */
  varianceBySection?: Map<ID, number>
  days: number
}

/**
 * Chef P&L.
 *
 * Revenue is attributed to the chef credited on the sales line, falling back
 * to the section that owns the dish. Cost is the recipe cost of what they
 * produced. Variance leakage and wastage attach to the section, so a chef who
 * sells well but over-portions does not look good by accident. Labour is
 * pro-rated from monthly cost so contribution is a real bottom line.
 */
export function chefScorecards(input: ChefInput): ChefScorecard[] {
  const { ctx, dishes, sales, staff, sections, wastage, items, varianceBySection, days } = input
  const itemCost = new Map(items.map((i) => [i.id, i.avgCost]))
  const dishMap = new Map(dishes.map((d) => [d.id, d]))
  const sectionMap = new Map(sections.map((s) => [s.id, s]))
  const chefs = staff.filter((s) => s.active && (s.role === 'CHEF' || s.role === 'HEAD_CHEF'))
  const bySection = new Map<ID, Staff[]>()
  for (const c of chefs) {
    if (!c.sectionId) continue
    const list = bySection.get(c.sectionId) ?? []
    list.push(c)
    bySection.set(c.sectionId, list)
  }

  const acc = new Map<ID, ChefScorecard>()
  for (const chef of chefs) {
    acc.set(chef.id, {
      chefId: chef.id,
      name: chef.name,
      role: chef.role,
      sectionName: chef.sectionId ? sectionMap.get(chef.sectionId)?.name ?? '—' : '—',
      dishesSold: 0, revenue: 0, theoreticalFoodCost: 0, actualFoodCost: 0,
      varianceLeak: 0, wastage: 0, packagingCost: 0, contribution: 0,
      contributionPct: 0, theoreticalFoodCostPct: 0, actualFoodCostPct: 0,
      labourCost: round((chef.monthlyCost / 30) * days, 0),
      netContribution: 0, contributionPerHour: 0, efficiencyIndex: 0, rank: 0,
    })
  }

  for (const day of sales) {
    for (const line of day.lines) {
      const dish = dishMap.get(line.dishId)
      if (!dish) continue
      const chefId = line.chefId ?? defaultChefFor(dish, bySection)
      const card = chefId ? acc.get(chefId) : undefined
      if (!card) continue
      const c = costDish(ctx, dish, true)
      const net = (line.grossAmount - line.discount) / (1 + (dish.gstPct || 0) / 100)
      card.dishesSold += line.qty
      card.revenue += net
      card.theoreticalFoodCost += c.foodCost * line.qty
      card.packagingCost += (c.packagingCost + c.otherVariableCost) * line.qty
    }
  }

  // Wastage and counted leakage land on the section that caused them.
  for (const w of wastage) {
    const card = w.byStaffId ? acc.get(w.byStaffId) : undefined
    if (!card) continue
    card.wastage += Math.abs(w.qtyBase) * (itemCost.get(w.itemId) ?? 0)
  }

  if (varianceBySection) {
    for (const [sectionId, leak] of varianceBySection) {
      const members = bySection.get(sectionId) ?? []
      if (!members.length) continue
      const share = leak / members.length
      for (const m of members) {
        const card = acc.get(m.id)
        if (card) card.varianceLeak += share
      }
    }
  }

  const out = [...acc.values()]
  for (const card of out) {
    card.revenue = round(card.revenue, 0)
    card.theoreticalFoodCost = round(card.theoreticalFoodCost, 0)
    card.varianceLeak = round(Math.abs(card.varianceLeak), 0)
    card.wastage = round(card.wastage, 0)
    card.packagingCost = round(card.packagingCost, 0)
    card.actualFoodCost = round(card.theoreticalFoodCost + card.varianceLeak + card.wastage, 0)
    card.contribution = round(card.revenue - card.actualFoodCost - card.packagingCost, 0)
    card.netContribution = round(card.contribution - card.labourCost, 0)
    card.theoreticalFoodCostPct = card.revenue ? round((card.theoreticalFoodCost / card.revenue) * 100, 1) : 0
    card.actualFoodCostPct = card.revenue ? round((card.actualFoodCost / card.revenue) * 100, 1) : 0
    card.contributionPct = card.revenue ? round((card.contribution / card.revenue) * 100, 1) : 0
    const chef = chefs.find((c) => c.id === card.chefId)
    const hours = (chef?.shiftHours ?? 9) * days
    card.contributionPerHour = hours ? round(card.netContribution / hours, 0) : 0
  }

  // Efficiency index blends margin quality with control discipline, so the
  // chef with the biggest station cannot top the table on volume alone.
  const bestCPH = Math.max(...out.map((c) => c.contributionPerHour), 1)
  for (const card of out) {
    const marginScore = Math.min(card.contributionPct / 70, 1) * 50
    const controlScore = card.revenue
      ? Math.max(0, 1 - (card.varianceLeak + card.wastage) / (card.revenue * 0.03)) * 30
      : 0
    const outputScore = (card.contributionPerHour / bestCPH) * 20
    card.efficiencyIndex = round(marginScore + controlScore + outputScore, 1)
  }

  out.sort((a, b) => b.efficiencyIndex - a.efficiencyIndex)
  out.forEach((c, i) => { c.rank = i + 1 })
  return out
}

function defaultChefFor(dish: Dish, bySection: Map<ID, Staff[]>): ID | null {
  if (!dish.sectionId) return null
  const members = bySection.get(dish.sectionId)
  if (!members?.length) return null
  // Head chef of the section carries it when the POS did not name anyone.
  const head = members.find((m) => m.role === 'HEAD_CHEF')
  return (head ?? members[0]).id
}

/* ------------------------------------------------------------------ */
/* P&L and trends                                                      */
/* ------------------------------------------------------------------ */

export interface PnLPeriod {
  key: string
  label: string
  days: number
  revenue: number
  discount: number
  netRevenue: number
  theoreticalFoodCost: number
  /** What the same plates would cost at today's prices — for like-for-like. */
  foodCostAtCurrentPrices: number
  actualFoodCost: number
  wastage: number
  variance: number
  packaging: number
  labour: number
  grossProfit: number
  contribution: number
  foodCostPct: number
  actualFoodCostPct: number
  contributionPct: number
  covers: number
  dishes: number
}

export interface PnLInput {
  ctx: CostingContext
  dishes: Dish[]
  sales: SalesDay[]
  movements: Movement[]
  items: Item[]
  staff: Staff[]
  from: string
  to: string
  groupBy: 'day' | 'month'
}

export function pnlSeries(input: PnLInput): PnLPeriod[] {
  const { ctx, dishes, sales, movements, items, staff, from, to, groupBy } = input
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const dishMap = new Map(dishes.map((d) => [d.id, d]))
  const bucket = (d: string) => (groupBy === 'month' ? monthKey(d) : d)

  const periods = new Map<string, PnLPeriod>()
  const ensure = (key: string): PnLPeriod => {
    let p = periods.get(key)
    if (!p) {
      p = {
        key, label: key, days: 0, revenue: 0, discount: 0, netRevenue: 0,
        theoreticalFoodCost: 0, foodCostAtCurrentPrices: 0, actualFoodCost: 0, wastage: 0, variance: 0,
        packaging: 0, labour: 0, grossProfit: 0, contribution: 0,
        foodCostPct: 0, actualFoodCostPct: 0, contributionPct: 0, covers: 0, dishes: 0,
      }
      periods.set(key, p)
    }
    return p
  }

  const seenDates = new Map<string, Set<string>>()
  for (const day of sales) {
    if (day.status !== 'POSTED' || day.date < from || day.date > to) continue
    const p = ensure(bucket(day.date))
    const set = seenDates.get(p.key) ?? new Set<string>()
    set.add(day.date)
    seenDates.set(p.key, set)
    p.covers += day.covers
    for (const line of day.lines) {
      const dish = dishMap.get(line.dishId)
      if (!dish) continue
      const c = costDish(ctx, dish, true)
      p.revenue += line.grossAmount
      p.discount += line.discount
      p.netRevenue += (line.grossAmount - line.discount) / (1 + (dish.gstPct || 0) / 100)
      p.foodCostAtCurrentPrices += c.foodCost * line.qty
      p.packaging += (c.packagingCost + c.otherVariableCost) * line.qty
      p.dishes += line.qty
    }
  }

  // Costs come off the ledger, not off today's recipe cost, because every
  // movement was valued at the rate that applied on the day it happened.
  // Re-costing four months of history at today's chicken price would hide the
  // very drift this report exists to show.
  for (const m of movements) {
    if (m.date < from || m.date > to) continue
    const key = bucket(m.date)
    if (!periods.has(key)) continue
    const p = ensure(key)
    if (!itemMap.has(m.itemId)) continue
    switch (m.type) {
      // Prep items are consumed at their own built-up cost, so counting
      // PRODUCTION_OUT as well would charge the same onions twice.
      case 'CONSUMPTION': p.theoreticalFoodCost += Math.abs(m.value); break
      case 'WASTAGE': p.wastage += Math.abs(m.value); break
      case 'ADJUSTMENT': p.variance += -m.value; break
      default: break
    }
  }

  const monthlyLabour = staff.filter((s) => s.active).reduce((s, x) => s + x.monthlyCost, 0)

  const out = [...periods.values()]
  for (const p of out) {
    p.days = seenDates.get(p.key)?.size ?? 1
    p.labour = round((monthlyLabour / 30) * p.days, 0)
    p.revenue = round(p.revenue, 2)
    p.discount = round(p.discount, 2)
    p.netRevenue = round(p.netRevenue, 2)
    p.foodCostAtCurrentPrices = round(p.foodCostAtCurrentPrices, 2)
    // Fall back to recipe costing for a period with sales but no ledger yet.
    p.theoreticalFoodCost = round(p.theoreticalFoodCost || p.foodCostAtCurrentPrices, 2)
    p.variance = round(p.variance, 2)
    p.wastage = round(p.wastage, 2)
    p.packaging = round(p.packaging, 2)
    p.actualFoodCost = round(p.theoreticalFoodCost + p.wastage + p.variance, 2)
    p.grossProfit = round(p.netRevenue - p.actualFoodCost, 2)
    p.contribution = round(p.grossProfit - p.packaging, 2)
    p.foodCostPct = p.netRevenue ? round((p.theoreticalFoodCost / p.netRevenue) * 100, 1) : 0
    p.actualFoodCostPct = p.netRevenue ? round((p.actualFoodCost / p.netRevenue) * 100, 1) : 0
    p.contributionPct = p.netRevenue ? round((p.contribution / p.netRevenue) * 100, 1) : 0
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

/** Mean and spread of a series, for "how far is today from normal". */
export function stats(values: number[]): { mean: number; sd: number; min: number; max: number } {
  if (!values.length) return { mean: 0, sd: 0, min: 0, max: 0 }
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
  return { mean: round(mean, 2), sd: round(sd, 2), min: Math.min(...values), max: Math.max(...values) }
}

export function zScore(value: number, mean: number, sd: number): number {
  if (!sd) return 0
  return round((value - mean) / sd, 2)
}

/** Same-weekday average, which predicts a restaurant far better than a flat mean. */
export function dowForecast(series: { date: string; value: number }[], targetDate: string): number {
  const target = new Date(targetDate).getDay()
  const same = series.filter((s) => new Date(s.date).getDay() === target).slice(-6)
  if (!same.length) return 0
  return round(same.reduce((s, v) => s + v.value, 0) / same.length, 1)
}

export function seriesForRange(
  sales: SalesDay[],
  from: string,
  to: string,
  pick: (d: SalesDay) => number,
): { date: string; value: number }[] {
  const byDate = new Map<string, number>()
  for (const d of sales) {
    if (d.status !== 'POSTED' || d.date < from || d.date > to) continue
    byDate.set(d.date, (byDate.get(d.date) ?? 0) + pick(d))
  }
  return rangeDays(from, to).map((date) => ({ date, value: round(byDate.get(date) ?? 0, 2) }))
}
