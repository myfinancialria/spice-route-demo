/**
 * Deterministic trading-history generator.
 *
 * Produces four months of purchases, store issues, prep production, sales,
 * wastage and stocktakes that reconcile against each other, so every report in
 * the app is reading real arithmetic rather than decorative numbers.
 *
 * The interesting part is that it deliberately builds in the failure a
 * restaurant actually has: the kitchen draws slightly more than the recipes
 * call for, some sections worse than others, and that gap only becomes visible
 * at the weekly physical count.
 */
import type {
  Alert, Category, DayClose, Dish, GoodsReceipt, GRNLine, ID, Issue, Item,
  Movement, ProductionRun, PurchaseBill, PurchaseOrder, Recipe, ReceiptIssue,
  SalesDay, SalesLine, Section, Staff, StockLocation, Stocktake, Supplier,
  Wastage, WastageReason,
} from '../types'
import { computeAlerts, mergeAlerts } from '../alerts'
import { buildContext, costRecipe, prepUnitCost, recipeKey, theoreticalConsumption } from '../costing'
import { addDays, diffDays, dow, rangeDays } from '../dates'
import { newAvgCost } from '../stock'
import { round } from '../units'
import masters from './masters.json'

export interface SeedData {
  categories: Category[]
  sections: Section[]
  locations: StockLocation[]
  staff: Staff[]
  suppliers: Supplier[]
  items: Item[]
  dishes: Dish[]
  recipes: Recipe[]
  bills: PurchaseBill[]
  purchaseOrders: PurchaseOrder[]
  receipts: GoodsReceipt[]
  alerts: Alert[]
  issues: Issue[]
  production: ProductionRun[]
  wastage: Wastage[]
  sales: SalesDay[]
  stocktakes: Stocktake[]
  dayCloses: DayClose[]
  movements: Movement[]
}

/** Small deterministic PRNG so the same demo data appears on every machine. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Relative popularity of each dish; the mix drifts over the period. */
const DISH_WEIGHT: Record<string, number> = {
  'Chicken Biryani': 13, 'Mutton Biryani': 4.5, 'Veg Biryani': 4,
  'Butter Chicken': 8.5, 'Paneer Butter Masala': 7, 'Dal Makhani': 6,
  'Fish Curry': 2.6, 'Chicken 65': 5.5, 'Jeera Rice': 4.5,
  'Butter Naan': 12, 'Tandoori Roti': 8, 'Gulab Jamun (2 pc)': 3.4,
  'Paneer Tikka': 4.2, 'Chicken Tikka': 4.6, 'Veg Manchurian': 2.6,
  'Chilli Chicken': 3.4, 'Gobi 65': 2.2, 'Kadai Paneer': 3.4,
  'Chicken Chettinad': 3.1, 'Palak Paneer': 2.8, 'Prawn Masala': 1.5,
  'Garlic Naan': 6.5, 'Veg Pulao': 2.4, 'Gajar Halwa': 1.9,
  'Masala Chai': 6.5, 'Fresh Lime Soda': 5.5,
}

/** Covers by weekday — Friday to Sunday carry the week. */
const DOW_FACTOR = [1.22, 0.74, 0.78, 0.84, 0.92, 1.18, 1.32]

/**
 * Discipline by kitchen section: how much more than the recipe actually
 * leaves the shelf. Tandoor over-portions protein, the wok station spills oil,
 * pastry is tight because everything is weighed.
 */
const SECTION_SLIP: Record<string, number> = {
  sec_tandoor: 0.075, sec_curry: 0.042, sec_biryani: 0.055,
  sec_bread: 0.028, sec_wok: 0.088, sec_pastry: 0.015,
}

/** Purchase price path per item over the period, as a multiplier on day 0. */
function priceFactor(sku: string, dayIndex: number, total: number, rnd: () => number): number {
  const t = total > 0 ? dayIndex / total : 0
  let trend = 1
  // The headline story: chicken climbs through the period and drags every
  // chicken dish's food cost with it.
  if (sku === 'CHK-001') trend = 1 + 0.16 * t
  else if (sku === 'MUT-001') trend = 1 + 0.09 * t
  else if (sku === 'PNR-001') trend = 1 + 0.07 * t
  else if (sku === 'OIL-001') trend = 1 + 0.05 * t
  else if (sku === 'VEG-002') trend = 1 + 0.55 * Math.max(0, Math.sin((t - 0.45) * Math.PI * 1.6)) // tomato spike
  else if (sku === 'VEG-001') trend = 1 + 0.22 * Math.max(0, Math.sin((t - 0.2) * Math.PI * 1.2))
  else if (sku === 'PRW-001') trend = 1 + 0.11 * t
  else trend = 1 + 0.03 * t
  return trend * (0.985 + rnd() * 0.03)
}

const WASTE_REASONS: WastageReason[] = ['SPOILAGE', 'EXPIRY', 'BURNT', 'SPILLAGE', 'STAFF_MEAL', 'CUSTOMER_RETURN']

export function generateSeed(today: string, months = 4): SeedData {
  const categories = masters.categories as unknown as Category[]
  const sections = masters.sections as unknown as Section[]
  const locations = masters.locations as unknown as StockLocation[]
  const staff = masters.staff as unknown as Staff[]
  const suppliers = masters.suppliers as unknown as Supplier[]
  const items = (masters.items as unknown as Item[]).map((i) => ({ ...i }))
  const dishes = masters.dishes as unknown as Dish[]
  const recipes = masters.recipes as unknown as Recipe[]

  const itemById = new Map(items.map((i) => [i.id, i]))
  const itemBySku = new Map(items.map((i) => [i.sku, i]))
  const dishById = new Map(dishes.map((d) => [d.id, d]))
  const ctx = buildContext(items, recipes)

  // Prep items are costed from their own recipe, not bought, so seed their
  // opening cost before anything else reads it.
  for (const item of items) {
    if (item.isPrep) {
      const c = prepUnitCost(ctx, item)
      item.avgCost = round(c, 6)
      item.lastPurchaseCost = item.avgCost
    }
  }

  const start = addDays(today, -(months * 30) + 1)
  const days = rangeDays(start, today)
  const totalDays = days.length

  const movements: Movement[] = []
  const bills: PurchaseBill[] = []
  const purchaseOrders: PurchaseOrder[] = []
  const receipts: GoodsReceipt[] = []
  const issues: Issue[] = []
  const production: ProductionRun[] = []
  const wastage: Wastage[] = []
  const sales: SalesDay[] = []
  const stocktakes: Stocktake[] = []
  const dayCloses: DayClose[] = []

  let seq = 0
  const mid = () => `mv_${++seq}`

  /** Live balance per item+location, kept in step with the ledger. */
  const bal = new Map<string, number>()
  const bkey = (itemId: ID, locId: ID) => `${itemId}|${locId}`
  const getBal = (itemId: ID, locId: ID) => bal.get(bkey(itemId, locId)) ?? 0

  function post(m: Omit<Movement, 'id' | 'value'>): void {
    const value = round(m.qty * m.rate, 4)
    movements.push({ ...m, id: mid(), value })
    const k = bkey(m.itemId, m.locationId)
    bal.set(k, round((bal.get(k) ?? 0) + m.qty, 4))
  }

  // Day-0 purchase rate per item. The price path is a multiplier on this,
  // never on the previous day's rate — compounding a 3% drift daily for four
  // months would put onions at thirty times their real price.
  const basePurchaseRate = new Map<ID, number>()
  for (const item of items) {
    basePurchaseRate.set(item.id, round(item.avgCost * item.purchaseConversion, 4))
  }

  const chefBySection = new Map<ID, Staff>()
  for (const s of staff) {
    if (!s.sectionId || (s.role !== 'CHEF' && s.role !== 'HEAD_CHEF')) continue
    const cur = chefBySection.get(s.sectionId)
    if (!cur || s.role === 'HEAD_CHEF') chefBySection.set(s.sectionId, s)
  }
  const storeKeeper = staff.find((s) => s.role === 'STORE')!
  const manager = staff.find((s) => s.role === 'MANAGER')!
  const buyer = staff.find((s) => s.role === 'PURCHASE') ?? manager

  /* ---------------- opening balances ---------------- */
  const openRnd = mulberry32(hash('opening'))
  for (const item of items) {
    if (item.isPrep) continue
    const loc = item.defaultLocationId
    const qty = round(Math.max(item.parLevel * (0.55 + openRnd() * 0.4), item.reorderLevel * 1.5), 2)
    if (qty <= 0) continue
    post({
      date: start, ts: `${start}T07:00:00.000Z`, itemId: item.id, locationId: loc,
      qty, type: 'OPENING', rate: item.avgCost, refType: 'OPENING', refId: 'opening',
      staffId: storeKeeper.id, note: 'Opening balance',
    })
  }

  /* ---------------- per-day simulation ---------------- */
  const dishWeights = dishes.map((d) => ({ dish: d, w: DISH_WEIGHT[d.name] ?? 2 }))
  const totalWeight = dishWeights.reduce((s, d) => s + d.w, 0)

  // Supplier delivery pattern: perishables daily, staples twice a week.
  const supplierDays: Record<string, (d: number) => boolean> = {
    sup_1: () => true,
    sup_2: () => true,
    sup_3: () => true,
    sup_5: (d) => d % 2 === 0,
    sup_4: (d) => d % 3 === 0,
    sup_6: (d) => d % 14 === 0,
    sup_bev: (d) => d % 7 === 0,
  }

  /**
   * Extra quantity the kitchen physically used beyond what the recipes call
   * for, accumulated since each location's last physical count. This is the
   * whole point of the exercise: the ledger never sees it, so it only surfaces
   * when someone actually counts the shelf.
   */
  const leakSinceCount = new Map<ID, number>()

  let poNo = 3000
  let grnNo = 5000
  let issueNo = 1
  let prodNo = 1
  let wasteNo = 1
  let takeNo = 1

  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const date = days[dayIndex]
    const isToday = date === today
    const rnd = mulberry32(hash(`day:${date}`))
    const priceRnd = mulberry32(hash(`price:${date}`))

    /* --- 1. demand --- */
    const growth = 1 + 0.11 * (dayIndex / Math.max(totalDays - 1, 1))
    const covers = Math.round(
      168 * DOW_FACTOR[dow(date)] * growth * (0.9 + rnd() * 0.2),
    )
    const plates = Math.round(covers * (2.45 + rnd() * 0.3))

    // Dish mix drifts: biryani gains share, older starters lose it.
    const drift = dayIndex / Math.max(totalDays - 1, 1)
    const sold: { dish: Dish; qty: number }[] = []
    for (const { dish, w } of dishWeights) {
      let weight = w
      if (dish.name.includes('Biryani')) weight *= 1 + 0.18 * drift
      if (dish.name === 'Chicken 65') weight *= 1 - 0.2 * drift
      if (dish.name === 'Fish Curry') weight *= 1 - 0.25 * drift
      if (dish.name === 'Chicken Tikka') weight *= 1 + 0.3 * drift
      const share = weight / totalWeight
      const qty = Math.max(0, Math.round(plates * share * (0.82 + rnd() * 0.36)))
      if (qty > 0) sold.push({ dish, qty })
    }
    // The last day of the window is still trading, so only part of it is in.
    const dayFraction = isToday ? 0.58 : 1
    if (isToday) for (const s of sold) s.qty = Math.max(1, Math.round(s.qty * dayFraction))

    /* --- 2. purchases in the morning --- */
    const horizon = 3
    const forwardNeed = new Map<ID, number>()
    for (const { dish, qty } of sold) {
      for (const line of costRecipe(ctx, 'DISH', dish.id, qty * horizon, { explode: true })) {
        forwardNeed.set(line.itemId, (forwardNeed.get(line.itemId) ?? 0) + line.qty)
      }
    }

    for (const supplier of suppliers) {
      const pattern = supplierDays[supplier.id]
      if (!pattern || !pattern(dayIndex)) continue
      const supplyItems = items.filter((i) => i.defaultSupplierId === supplier.id && !i.isPrep)
      const poLines: PurchaseOrder['lines'] = []
      for (const item of supplyItems) {
        const onHand = getBal(item.id, item.defaultLocationId) + getBal(item.id, 'loc_kitchen')
        const need = forwardNeed.get(item.id) ?? 0
        const target = Math.max(item.parLevel, need * 1.15)
        if (onHand >= target * 0.85) continue
        const gapBase = target - onHand
        const packs = Math.max(1, Math.ceil(gapBase / item.purchaseConversion))
        const baseRate = basePurchaseRate.get(item.id) ?? item.avgCost * item.purchaseConversion
        const rate = round(baseRate * priceFactor(item.sku, dayIndex, totalDays, priceRnd), 2)
        poLines.push({
          id: `pol_${poNo + 1}_${poLines.length}`, itemId: item.id, qty: packs,
          unit: item.purchaseUnit, rate: rate > 0 ? rate : round(item.avgCost * item.purchaseConversion, 2),
          acceptedBase: 0,
        })
      }
      if (!poLines.length) continue

      // The purchase manager raised this the evening before delivery.
      poNo++
      const orderedOn = addDays(date, -Math.max(1, supplier.leadTimeDays))
      const po: PurchaseOrder = {
        id: `po_${poNo}`, poNo: `PO-${poNo}`, supplierId: supplier.id,
        date: orderedOn, expectedDate: date, lines: poLines, status: 'SENT',
        createdBy: buyer.id, sentAt: `${orderedOn}T18:10:00.000Z`,
        createdAt: `${orderedOn}T18:00:00.000Z`,
      }

      // The store manager checks the delivery. Most lines are fine; some are
      // short, a few are refused — the vendor's scores decide how often.
      const shortChance = (100 - supplier.deliveryScore) / 100 * 0.6
      const damageChance = (100 - supplier.qualityScore) / 100 * 0.5
      grnNo++
      const grnLines: GRNLine[] = poLines.map((pl, i) => {
        const item = itemById.get(pl.itemId)!
        let received = pl.qty
        let damaged = 0
        let issue: ReceiptIssue | undefined
        const roll = rnd()
        if (roll < shortChance) {
          received = Math.max(0, round(pl.qty * (0.6 + rnd() * 0.3), 2))
          issue = rnd() < 0.8 ? 'SHORT_SUPPLIED' : 'WRONG_ITEM'
        } else if (roll < shortChance + damageChance) {
          damaged = round(pl.qty * (0.05 + rnd() * 0.2), 2)
          issue = item.shelfLifeDays && item.shelfLifeDays <= 3 && rnd() < 0.5 ? 'QUALITY_REJECTED' : 'DAMAGED_IN_TRANSIT'
        }
        return {
          id: `grl_${grnNo}_${i}`, itemId: pl.itemId, orderedQty: pl.qty,
          receivedQty: received, damagedQty: damaged, unit: pl.unit, rate: pl.rate,
          taxPct: item.gstPct, issue,
          batchNo: item.trackBatches ? `${item.sku}-${date.replace(/-/g, '')}` : undefined,
          expiryDate: item.shelfLifeDays ? addDays(date, item.shelfLifeDays) : undefined,
        }
      })
      const grn: GoodsReceipt = {
        id: `grn_${grnNo}`, grnNo: `GRN-${grnNo}`, poId: po.id, supplierId: supplier.id,
        date, locationId: supplyItems[0]?.defaultLocationId ?? 'loc_store',
        lines: grnLines, invoiceNo: `${supplier.code}/${grnNo}`,
        attachmentName: dayIndex % 5 === 0 ? undefined : `${supplier.name.split(' ')[0]}-${grnNo}.pdf`,
        entryMode: 'PO', status: 'POSTED', receivedBy: storeKeeper.id,
        createdAt: `${date}T08:35:00.000Z`,
      }
      // Today's deliveries are still on their way — leave the POs open so the
      // store manager has something to receive. Yesterday's seafood never
      // turned up at all, so the manager has a genuinely late order to chase.
      if (isToday || (dayIndex === totalDays - 2 && supplier.id === 'sup_5')) {
        purchaseOrders.push(po)
        continue
      }
      receipts.push(grn)

      let complete = true
      for (const [i, line] of grn.lines.entries()) {
        const item = itemById.get(line.itemId)!
        const accepted = Math.max(line.receivedQty - line.damagedQty, 0)
        const qtyBase = accepted * item.purchaseConversion
        po.lines[i].acceptedBase = round(qtyBase, 4)
        if (qtyBase < line.orderedQty * item.purchaseConversion * 0.95) complete = false
        if (qtyBase <= 0) continue
        const rateBase = line.rate / item.purchaseConversion
        const loc = item.defaultLocationId
        item.avgCost = newAvgCost(getBal(item.id, loc), item.avgCost, qtyBase, rateBase)
        item.lastPurchaseCost = round(rateBase, 6)
        post({
          date, ts: `${date}T08:40:00.000Z`, itemId: item.id, locationId: loc,
          qty: qtyBase, type: 'RECEIPT', rate: round(rateBase, 6),
          refType: 'GRN', refId: grn.id, staffId: storeKeeper.id, batchNo: line.batchNo,
        })
      }
      // A short delivery is closed on receipt: the vendor does not send the
      // rest, the shortfall is chased as a credit note, and the order is done.
      void complete
      po.status = 'RECEIVED'
      purchaseOrders.push(po)
    }

    /* --- 3. prep production --- */
    // What the day's menu needs of each prep item, made in whole batches.
    const prepNeed = new Map<ID, number>()
    for (const { dish, qty } of sold) {
      for (const line of costRecipe(ctx, 'DISH', dish.id, qty, { explode: false })) {
        const item = itemById.get(line.itemId)
        if (item?.isPrep) prepNeed.set(item.id, (prepNeed.get(item.id) ?? 0) + line.qty)
      }
    }
    for (const [prepId, needed] of prepNeed) {
      const item = itemById.get(prepId)!
      const recipe = ctx.recipes.get(recipeKey('PREP', prepId))
      if (!recipe) continue
      const onHand = getBal(prepId, 'loc_kitchen')
      if (onHand >= needed * 1.05) continue
      // Make enough to cover the prep's own shelf life, not just today.
      const coverDays = Math.max(1, Math.min(item.shelfLifeDays ?? 2, 3))
      const shortfall = needed * (1.08 * coverDays) - onHand
      const batches = Math.max(1, Math.ceil(shortfall / recipe.yieldQty))
      const produced = batches * recipe.yieldQty
      const chef = chefBySection.get('sec_curry')!

      // Ingredients for a prep batch are pulled straight from the store.
      let batchCost = 0
      for (const line of costRecipe(ctx, 'PREP', prepId, produced, { explode: false })) {
        const comp = itemById.get(line.itemId)!
        const from = getBal(comp.id, 'loc_kitchen') >= line.qty ? 'loc_kitchen' : comp.defaultLocationId
        if (from !== 'loc_kitchen') {
          post({
            date, ts: `${date}T09:10:00.000Z`, itemId: comp.id, locationId: from,
            qty: -line.qty, type: 'TRANSFER_OUT', rate: comp.avgCost,
            refType: 'PRODUCTION', refId: `prod_${prodNo}`, staffId: chef.id,
          })
          post({
            date, ts: `${date}T09:11:00.000Z`, itemId: comp.id, locationId: 'loc_kitchen',
            qty: line.qty, type: 'TRANSFER_IN', rate: comp.avgCost,
            refType: 'PRODUCTION', refId: `prod_${prodNo}`, staffId: chef.id,
          })
        }
        post({
          date, ts: `${date}T09:20:00.000Z`, itemId: comp.id, locationId: 'loc_kitchen',
          qty: -line.qty, type: 'PRODUCTION_OUT', rate: comp.avgCost,
          refType: 'PRODUCTION', refId: `prod_${prodNo}`, staffId: chef.id,
        })
        batchCost += line.qty * comp.avgCost
      }
      const unitCost = produced > 0 ? round(batchCost / produced, 6) : item.avgCost
      item.avgCost = newAvgCost(getBal(prepId, 'loc_kitchen'), item.avgCost, produced, unitCost)
      post({
        date, ts: `${date}T09:30:00.000Z`, itemId: prepId, locationId: 'loc_kitchen',
        qty: produced, type: 'PRODUCTION_IN', rate: unitCost,
        refType: 'PRODUCTION', refId: `prod_${prodNo}`, staffId: chef.id,
      })
      production.push({
        id: `prod_${prodNo}`, ref: `PRD-${String(prodNo).padStart(5, '0')}`, date,
        itemId: prepId, recipeId: recipe.id, batches, qtyProduced: round(produced, 2),
        locationId: 'loc_kitchen', byStaffId: chef.id, status: 'POSTED',
        createdAt: `${date}T09:30:00.000Z`,
      })
      prodNo++
    }

    /* --- 4. store issues to the kitchen --- */
    // The kitchen draws what the recipes need, plus its section's slip.
    const theoretical = theoreticalConsumption(ctx, sold.map((s) => ({ dishId: s.dish.id, qty: s.qty })))
    const slipByItem = new Map<ID, number>()
    for (const { dish, qty } of sold) {
      const slip = SECTION_SLIP[dish.sectionId ?? ''] ?? 0.04
      for (const line of costRecipe(ctx, 'DISH', dish.id, qty, { explode: false })) {
        const cur = slipByItem.get(line.itemId) ?? 0
        slipByItem.set(line.itemId, cur + line.qty * slip)
      }
    }

    for (const [itemId, extra] of slipByItem) {
      leakSinceCount.set(itemId, (leakSinceCount.get(itemId) ?? 0) + extra)
    }

    const issueLines: Issue['lines'] = []
    for (const [itemId, need] of theoretical) {
      const item = itemById.get(itemId)
      if (!item || item.isPrep) continue
      const onHandKitchen = getBal(itemId, 'loc_kitchen')
      // Draw enough to cover what will really be used — recipe plus the
      // section's slip — plus a working buffer. A kitchen that drew only the
      // recipe quantity would run out mid-service every single day.
      const slipFrac = need.qty > 0 ? (slipByItem.get(itemId) ?? 0) / need.qty : 0
      // Roughly a day and a half of mise en place, sized on what will really
      // be used rather than on the recipe alone.
      const want = need.qty * (1 + slipFrac) * (1.45 + rnd() * 0.2)
      if (onHandKitchen >= want) continue
      const qty = round(Math.max(want - onHandKitchen, 0), 2)
      if (qty <= 0) continue
      const from = item.defaultLocationId
      const available = getBal(itemId, from)
      const moved = round(Math.min(qty, Math.max(available, 0)), 2)
      if (moved <= 0) continue
      issueLines.push({ id: `il_${issueNo}_${issueLines.length}`, itemId, qty: moved, unit: item.baseUnit, qtyBase: moved })
      const chef = chefBySection.get('sec_curry')!
      post({
        date, ts: `${date}T10:00:00.000Z`, itemId, locationId: from, qty: -moved,
        type: 'TRANSFER_OUT', rate: item.avgCost, refType: 'ISSUE', refId: `iss_${issueNo}`, staffId: chef.id,
      })
      post({
        date, ts: `${date}T10:01:00.000Z`, itemId, locationId: 'loc_kitchen', qty: moved,
        type: 'TRANSFER_IN', rate: item.avgCost, refType: 'ISSUE', refId: `iss_${issueNo}`, staffId: chef.id,
      })
    }
    if (issueLines.length) {
      issues.push({
        id: `iss_${issueNo}`, ref: `ISS-${String(issueNo).padStart(5, '0')}`, date,
        fromLocationId: 'loc_store', toLocationId: 'loc_kitchen', lines: issueLines,
        requestedBy: chefBySection.get('sec_curry')!.id, status: 'POSTED',
        createdAt: `${date}T10:05:00.000Z`,
      })
      issueNo++
    }

    /* --- 5. sales --- */
    const channels: { channel: SalesDay['channel']; share: number }[] = [
      { channel: 'DINE_IN', share: 0.62 }, { channel: 'TAKEAWAY', share: 0.16 },
      { channel: 'DELIVERY', share: 0.09 }, { channel: 'AGGREGATOR', share: 0.13 },
    ]
    for (const { channel, share } of channels) {
      const lines: SalesLine[] = []
      for (const { dish, qty } of sold) {
        const q = Math.round(qty * share)
        if (q <= 0) continue
        const gross = q * dish.price
        // Aggregators discount hardest; dine-in barely at all.
        const discRate = channel === 'AGGREGATOR' ? 0.12 + rnd() * 0.06
          : channel === 'DELIVERY' ? 0.04 + rnd() * 0.03 : rnd() * 0.02
        lines.push({
          id: `sl_${date}_${channel}_${dish.id}`, dishId: dish.id, qty: q,
          grossAmount: round(gross, 2), discount: round(gross * discRate, 2),
          chefId: dish.sectionId ? chefBySection.get(dish.sectionId)?.id ?? null : null,
        })
      }
      if (!lines.length) continue
      sales.push({
        id: `sal_${date}_${channel}`, date, channel, lines,
        // Covers track the same partial day as the plates, or average spend
        // on the current day would read far below normal.
        covers: Math.max(1, Math.round(covers * share * dayFraction)), status: 'POSTED', source: 'SEED',
        createdAt: `${date}T23:30:00.000Z`,
      })
    }

    /* --- 6. consumption against recipes --- */
    for (const [itemId, need] of theoretical) {
      const item = itemById.get(itemId)
      if (!item) continue
      const qty = round(need.qty, 3)
      if (qty <= 0) continue
      post({
        date, ts: `${date}T23:40:00.000Z`, itemId, locationId: 'loc_kitchen', qty: -qty,
        type: 'CONSUMPTION', rate: item.avgCost, refType: 'SALES', refId: `sal_${date}`, staffId: null,
      })
    }

    /* --- 7. wastage --- */
    const wasteCount = rnd() < 0.75 ? 1 + Math.floor(rnd() * 3) : 0
    for (let w = 0; w < wasteCount; w++) {
      const pool = items.filter((i) => getBal(i.id, 'loc_kitchen') > 0)
      if (!pool.length) break
      const item = pool[Math.floor(rnd() * pool.length)]
      const onHand = getBal(item.id, 'loc_kitchen')
      const qty = round(Math.min(onHand * (0.01 + rnd() * 0.04), onHand), 2)
      if (qty <= 0) continue
      const reason = WASTE_REASONS[Math.floor(rnd() * WASTE_REASONS.length)]
      const chefs = [...chefBySection.values()]
      const chef = chefs[Math.floor(rnd() * chefs.length)]
      wastage.push({
        id: `wst_${wasteNo}`, ref: `WST-${String(wasteNo).padStart(5, '0')}`, date,
        itemId: item.id, locationId: 'loc_kitchen', qtyBase: qty, reason,
        byStaffId: chef.id, createdAt: `${date}T22:00:00.000Z`,
      })
      post({
        date, ts: `${date}T22:00:00.000Z`, itemId: item.id, locationId: 'loc_kitchen',
        qty: -qty, type: 'WASTAGE', rate: item.avgCost, refType: 'WASTAGE',
        refId: `wst_${wasteNo}`, staffId: chef.id, note: reason,
      })
      wasteNo++
    }

    /* --- 8. weekly physical count --- */
    // Sunday close. The count reveals the slip that has quietly built up.
    if (!isToday && dow(date) === 0 && dayIndex > 3) {
      for (const locId of ['loc_kitchen', 'loc_store'] as const) {
        const lines: Stocktake['lines'] = []
        for (const item of items) {
          const sys = getBal(item.id, locId)
          if (Math.abs(sys) < 0.01) continue
          // The kitchen carries the accumulated over-draw. The store loses far
          // less — a little evaporation, a little miscounting.
          const accrued = locId === 'loc_kitchen' ? leakSinceCount.get(item.id) ?? 0 : 0
          const leak = locId === 'loc_kitchen'
            // Cannot lose more than is on the shelf; the rest shows up next week.
            ? Math.min(accrued, sys * 0.95) + sys * 0.003 * rnd()
            : sys * 0.002 * rnd()
          const counted = round(Math.max(sys - leak, 0), 2)
          if (locId === 'loc_kitchen') {
            leakSinceCount.set(item.id, Math.max(accrued - leak, 0))
          }
          lines.push({
            id: `stl_${takeNo}_${lines.length}`, itemId: item.id,
            countedQtyBase: counted, systemQtyBase: round(sys, 2),
          })
          const diff = round(counted - sys, 3)
          if (Math.abs(diff) > 0.001) {
            post({
              date, ts: `${date}T23:55:00.000Z`, itemId: item.id, locationId: locId,
              qty: diff, type: 'ADJUSTMENT', rate: item.avgCost, refType: 'STOCKTAKE',
              refId: `stk_${takeNo}`, staffId: storeKeeper.id, note: 'Stocktake adjustment',
            })
          }
        }
        stocktakes.push({
          id: `stk_${takeNo}`, ref: `STK-${String(takeNo).padStart(4, '0')}`, date,
          locationId: locId, lines, countedBy: storeKeeper.id, status: 'POSTED',
          createdAt: `${date}T23:55:00.000Z`,
        })
        takeNo++
      }
    }

    dayCloses.push({
      id: `dc_${date}`, date, status: isToday ? 'OPEN' : 'CLOSED',
      salesPosted: !isToday, consumptionPosted: !isToday,
      stocktakeIds: stocktakes.filter((s) => s.date === date).map((s) => s.id),
      closedBy: isToday ? null : manager.id,
      closedAt: isToday ? undefined : `${date}T23:59:00.000Z`,
    })
  }

  /* ---------------- alerts for the last week ---------------- */
  // The manager has been through most of them; the newest are still open.
  let alerts: Alert[] = []
  for (let back = 7; back >= 0; back--) {
    const d = addDays(today, -back)
    const fresh = computeAlerts({
      date: d, items, categories, dishes, recipes, suppliers, movements,
      stocktakes, receipts, purchaseOrders, sales,
    })
    alerts = mergeAlerts(alerts, fresh, d)
    if (back >= 2) {
      const r = mulberry32(hash(`ack:${d}`))
      for (const a of alerts) {
        if (a.date !== d || a.status !== 'OPEN') continue
        const roll = r()
        if (roll < 0.55) {
          a.status = 'RESOLVED'; a.actedBy = manager.id; a.actedAt = `${addDays(d, 1)}T10:30:00.000Z`
          a.note = a.kind === 'VARIANCE' ? 'Spoke to the section; portion scoop replaced' : a.kind === 'RECEIPT_ISSUE' ? 'Credit note requested' : undefined
        } else if (roll < 0.8) {
          a.status = 'ACKNOWLEDGED'; a.actedBy = manager.id; a.actedAt = `${addDays(d, 1)}T09:15:00.000Z`
        }
      }
    }
  }

  return {
    categories, sections, locations, staff, suppliers, items, dishes, recipes,
    bills, purchaseOrders, receipts, alerts, issues, production, wastage, sales,
    stocktakes, dayCloses, movements,
  }
}

export const seedMeta = {
  restaurant: 'Spice Route Kitchen',
  city: 'Bengaluru',
  currency: '₹',
}
