/**
 * The alert engine: what the system tells the manager, and in what order.
 *
 * Runs over the day's documents and produces a ranked list. Every alert
 * carries a severity (how wrong) and a rupee impact (how much), because a
 * manager with ten minutes needs both — a 40% variance on cardamom and a 4%
 * variance on chicken are not the same problem.
 *
 * Keys are deterministic, so re-running the engine over the same day updates
 * existing alerts instead of stacking duplicates, and a manager's
 * acknowledgement survives the next recalculation.
 */
import type {
  Alert, AlertKind, Category, Dish, GoodsReceipt, ID, Item, Movement,
  PurchaseOrder, Recipe, SalesDay, Severity, Stocktake, Supplier,
} from './types'
import { buildContext, costRecipe } from './costing'
import { computeVariance } from './variance'
import { reorderAlerts, balances } from './stock'
import { addDays } from './dates'
import { round, toBase } from './units'

export interface AlertInput {
  date: string
  items: Item[]
  categories: Category[]
  dishes: Dish[]
  recipes: Recipe[]
  suppliers: Supplier[]
  movements: Movement[]
  stocktakes: Stocktake[]
  receipts: GoodsReceipt[]
  purchaseOrders: PurchaseOrder[]
  sales: SalesDay[]
}

const SEVERITY_RANK: Record<Exclude<Severity, 'OK'>, number> = { CRITICAL: 3, HIGH: 2, WATCH: 1 }

/** Priority-then-impact, which is how the inbox is ordered. */
export function alertPriority(a: Pick<Alert, 'severity' | 'impact'>): number {
  return SEVERITY_RANK[a.severity] * 1_000_000 + Math.abs(a.impact)
}

export function sortAlerts<T extends Pick<Alert, 'severity' | 'impact'>>(list: T[]): T[] {
  return [...list].sort((a, b) => alertPriority(b) - alertPriority(a))
}

function bySeverityValue(value: number, watch: number, high: number, critical: number): Exclude<Severity, 'OK'> {
  const v = Math.abs(value)
  if (v >= critical) return 'CRITICAL'
  if (v >= high) return 'HIGH'
  return v >= watch ? 'WATCH' : 'WATCH'
}

export function computeAlerts(input: AlertInput): Alert[] {
  const {
    date, items, categories, dishes, recipes, suppliers, movements,
    stocktakes, receipts, purchaseOrders, sales,
  } = input
  const itemById = new Map(items.map((i) => [i.id, i]))
  const supplierById = new Map(suppliers.map((s) => [s.id, s]))
  const ctx = buildContext(items, recipes)
  const now = `${date}T23:59:00.000Z`
  const out: Alert[] = []
  const push = (a: Omit<Alert, 'id' | 'status' | 'createdAt'>) => {
    out.push({ ...a, id: `alt_${a.key}`, status: 'OPEN', createdAt: now })
  }

  /* ---------- 1. Count vs system vs sales ---------- */
  // Which dishes drove each ingredient today — so the alert can say "sold 763
  // biryanis" rather than just "chicken is short".
  const todaysSales = sales.filter((s) => s.date === date && s.status === 'POSTED')
  const soldByDish = new Map<ID, number>()
  for (const day of todaysSales) {
    for (const l of day.lines) soldByDish.set(l.dishId, (soldByDish.get(l.dishId) ?? 0) + l.qty)
  }
  const driversByItem = new Map<ID, { dish: string; qty: number; use: number }[]>()
  for (const dish of dishes) {
    const qty = soldByDish.get(dish.id) ?? 0
    if (!qty) continue
    for (const line of costRecipe(ctx, 'DISH', dish.id, qty, { explode: true })) {
      const list = driversByItem.get(line.itemId) ?? []
      list.push({ dish: dish.name, qty, use: line.qty })
      driversByItem.set(line.itemId, list)
    }
  }

  for (const take of stocktakes.filter((s) => s.date === date && s.status === 'POSTED')) {
    const history = stocktakes
      .filter((s) => s.locationId === take.locationId && s.date < take.date)
      .map((s) => ({ date: s.date, rows: new Map<ID, number>() }))
    const rows = computeVariance({ items, categories, movements, stocktake: take, history })
    for (const r of rows) {
      if (r.severity === 'OK') continue
      const item = itemById.get(r.itemId)
      if (!item) continue
      const drivers = (driversByItem.get(r.itemId) ?? []).sort((a, b) => b.use - a.use).slice(0, 2)
      const because = drivers.length
        ? ` Sold ${drivers.map((d) => `${d.qty} × ${d.dish}`).join(', ')}.`
        : ''
      const short = r.varianceQty < 0
      push({
        key: `variance:${take.id}:${r.itemId}`,
        date, kind: 'VARIANCE', severity: r.severity, itemId: r.itemId,
        refType: 'STOCKTAKE', refId: take.id,
        title: `${item.name} ${short ? 'short' : 'over'} by ${fmt(Math.abs(r.varianceQty), item.baseUnit)} (${Math.abs(r.variancePct).toFixed(1)}%)`,
        detail: `Expected ${fmt(r.expectedClosing, item.baseUnit)} after recipe usage of ${fmt(r.theoretical, item.baseUnit)}; counted ${fmt(r.actualClosing, item.baseUnit)}.${because}${r.avgVariancePct !== null ? ` Usually ${r.avgVariancePct.toFixed(1)}%.` : ''}`,
        impact: round(Math.abs(r.varianceValue), 0),
      })
    }
  }

  /* ---------- 2. Receiving discrepancies ---------- */
  for (const grn of receipts.filter((g) => g.date === date && g.status === 'POSTED')) {
    const supplier = supplierById.get(grn.supplierId)?.name ?? 'supplier'
    for (const l of grn.lines) {
      const item = itemById.get(l.itemId)
      if (!item) continue
      const missing = Math.max(l.orderedQty - l.receivedQty, 0)
      const damaged = Math.max(l.damagedQty, 0)
      if (missing <= 0 && damaged <= 0) continue
      const value = (missing + damaged) * l.rate
      const parts = []
      if (missing > 0) parts.push(`${fmtPU(missing, l.unit)} short`)
      if (damaged > 0) parts.push(`${fmtPU(damaged, l.unit)} damaged`)
      push({
        key: `grn:${grn.id}:${l.id}`,
        date, kind: 'RECEIPT_ISSUE',
        severity: bySeverityValue(value, 0, 1500, 5000),
        itemId: l.itemId, refType: 'GRN', refId: grn.id,
        title: `${item.name} from ${supplier}: ${parts.join(', ')}`,
        detail: `Ordered ${fmtPU(l.orderedQty, l.unit)}, received ${fmtPU(l.receivedQty, l.unit)}${damaged ? `, ${fmtPU(damaged, l.unit)} refused` : ''}.${l.issue ? ` Reason: ${issueLabel(l.issue)}.` : ''}${l.note ? ` "${l.note}"` : ''} Chase a credit note or a replacement delivery.`,
        impact: round(value, 0),
      })
    }
  }

  /* ---------- 3. Orders that have not turned up ---------- */
  for (const po of purchaseOrders) {
    if (po.status !== 'SENT') continue
    if (po.expectedDate >= date) continue
    const value = po.lines.reduce((s, l) => s + l.qty * l.rate, 0)
    const daysLate = Math.max(1, Math.round((Date.parse(date) - Date.parse(po.expectedDate)) / 86400000))
    push({
      key: `po:${po.id}:overdue`,
      date, kind: 'PO_OVERDUE',
      severity: daysLate >= 2 ? 'HIGH' : 'WATCH',
      refType: 'PO', refId: po.id,
      title: `${po.poNo} from ${supplierById.get(po.supplierId)?.name ?? 'supplier'} is ${daysLate} day${daysLate > 1 ? 's' : ''} late`,
      detail: `${po.lines.length} lines worth ${money(value)} were expected on ${po.expectedDate}. Nothing has been received against it.`,
      impact: round(value, 0),
    })
  }

  /* ---------- 4. Running out ---------- */
  const bal = balances(movements)
  const onHand = new Map<ID, number>()
  for (const b of bal.values()) onHand.set(b.itemId, (onHand.get(b.itemId) ?? 0) + b.qty)
  const since = addDays(date, -29)
  const usage = new Map<ID, number>()
  for (const m of movements) {
    if (m.date < since || m.date > date) continue
    if (m.type !== 'CONSUMPTION' && m.type !== 'PRODUCTION_OUT') continue
    usage.set(m.itemId, (usage.get(m.itemId) ?? 0) + Math.abs(m.qty) / 30)
  }
  const low = reorderAlerts(items, onHand, usage, (item) =>
    item.defaultSupplierId ? supplierById.get(item.defaultSupplierId)?.leadTimeDays ?? 2 : 1)
  for (const a of low) {
    const item = itemById.get(a.itemId)
    if (!item) continue
    // Already on order? Then it is the vendor's problem, not a stock alert.
    const onOrder = purchaseOrders.some((po) =>
      (po.status === 'SENT' || po.status === 'PARTIAL') && po.lines.some((l) => l.itemId === a.itemId))
    if (onOrder && a.severity !== 'CRITICAL') continue
    push({
      key: `low:${a.itemId}:${date}`,
      date, kind: 'LOW_STOCK',
      severity: a.severity === 'CRITICAL' ? 'CRITICAL' : a.severity === 'LOW' ? 'HIGH' : 'WATCH',
      itemId: a.itemId,
      title: `${item.name} runs out in ${a.daysLeft === null ? '—' : `${a.daysLeft.toFixed(1)} days`}${onOrder ? ' (on order)' : ''}`,
      detail: `${fmt(a.onHand, item.baseUnit)} on hand, using ${fmt(a.dailyUsage, item.baseUnit)} a day, ${a.leadTimeDays}-day lead time. Suggest ordering ${fmt(a.suggestedOrderQty, item.baseUnit)}.`,
      impact: round(a.dailyUsage * a.leadTimeDays * item.avgCost, 0),
    })
  }

  /* ---------- 5. Price jumps on today's receipts ---------- */
  for (const grn of receipts.filter((g) => g.date === date && g.status === 'POSTED')) {
    for (const l of grn.lines) {
      const item = itemById.get(l.itemId)
      if (!item || !l.receivedQty) continue
      const perBase = l.rate / (toBase(item, 1, l.unit) || 1)
      // Compare against the average, which the receipt itself has not yet moved much.
      const ref = item.avgCost
      if (ref <= 0) continue
      const jump = (perBase - ref) / ref
      if (jump < 0.15) continue
      const extra = (perBase - ref) * toBase(item, l.receivedQty - l.damagedQty, l.unit)
      push({
        key: `price:${grn.id}:${l.id}`,
        date, kind: 'PRICE_JUMP',
        severity: jump >= 0.3 ? 'HIGH' : 'WATCH',
        itemId: l.itemId, refType: 'GRN', refId: grn.id,
        title: `${item.name} came in ${Math.round(jump * 100)}% above the usual rate`,
        detail: `${money(l.rate)}/${l.unit} against an average of ${money(ref * item.purchaseConversion)}/${item.purchaseUnit}. Check the unit on the bill, or renegotiate.`,
        impact: round(extra, 0),
      })
    }
  }

  /* ---------- 6. Negative stock — a document is missing somewhere ---------- */
  for (const b of bal.values()) {
    if (b.qty >= -0.5) continue
    const item = itemById.get(b.itemId)
    if (!item) continue
    push({
      key: `neg:${b.itemId}:${b.locationId}:${date}`,
      date, kind: 'NEGATIVE_STOCK', severity: 'HIGH', itemId: b.itemId,
      title: `${item.name} shows ${fmt(b.qty, item.baseUnit)} — stock cannot be negative`,
      detail: 'Something was used or issued that was never received. Either a delivery was not entered, or an issue was recorded from the wrong location.',
      impact: round(Math.abs(b.qty) * item.avgCost, 0),
    })
  }

  /* ---------- 7. Day traded but nobody counted ---------- */
  if (todaysSales.length && !stocktakes.some((s) => s.date === date && s.locationId === 'loc_kitchen')) {
    const revenue = todaysSales.reduce((s, d) => s + d.lines.reduce((t, l) => t + l.grossAmount, 0), 0)
    push({
      key: `count-missing:${date}`,
      date, kind: 'COUNT_MISSING', severity: 'WATCH',
      title: 'The kitchen has not been counted today',
      detail: `${money(revenue)} of sales are posted but there is no physical count to check them against. Until there is, tonight's variance is unknown.`,
      impact: 0,
    })
  }

  return sortAlerts(out)
}

/**
 * Merge freshly computed alerts into what is already stored. An alert the
 * manager has acknowledged or resolved keeps that status; everything else is
 * refreshed. Alerts that no longer apply (stock topped up, PO received) are
 * closed rather than deleted, so the history survives.
 */
export function mergeAlerts(existing: Alert[], fresh: Alert[], date: string): Alert[] {
  const byKey = new Map(existing.map((a) => [a.key, a]))
  const freshKeys = new Set(fresh.map((a) => a.key))
  const out: Alert[] = []

  for (const f of fresh) {
    const prev = byKey.get(f.key)
    out.push(prev ? { ...f, id: prev.id, status: prev.status, createdAt: prev.createdAt, actedBy: prev.actedBy, actedAt: prev.actedAt, note: prev.note } : f)
  }
  for (const a of existing) {
    if (freshKeys.has(a.key)) continue
    // Live conditions (low stock, overdue, negative, not counted) describe the
    // present; when they stop being computed they have cleared themselves.
    // Everything else — a variance, a short delivery — is a record of what
    // happened on its day and must survive every later recalculation.
    // The engine recomputes every live condition for `date`, so a live alert
    // for that same date that came back absent has cleared — "not counted
    // today" must close the moment the count arrives, not tomorrow.
    const live = a.kind === 'LOW_STOCK' || a.kind === 'PO_OVERDUE' || a.kind === 'NEGATIVE_STOCK' || a.kind === 'COUNT_MISSING'
    if (live && a.status === 'OPEN' && a.date <= date) {
      out.push({ ...a, status: 'RESOLVED', actedAt: `${date}T23:59:00.000Z`, note: a.note ?? 'Cleared on its own' })
    } else {
      out.push(a)
    }
  }
  return out
}

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  VARIANCE: 'Count mismatch',
  RECEIPT_ISSUE: 'Delivery problem',
  PO_OVERDUE: 'Order late',
  LOW_STOCK: 'Running out',
  PRICE_JUMP: 'Price jump',
  NEGATIVE_STOCK: 'Negative stock',
  COUNT_MISSING: 'Not counted',
  WASTAGE_HIGH: 'High wastage',
}

export function issueLabel(issue: string): string {
  return ({
    SHORT_SUPPLIED: 'short supplied', DAMAGED_IN_TRANSIT: 'damaged in transit',
    QUALITY_REJECTED: 'quality rejected', WRONG_ITEM: 'wrong item sent',
    EXPIRED: 'expired on arrival', EXCESS_SUPPLIED: 'excess supplied', OTHER: 'other',
  } as Record<string, string>)[issue] ?? issue
}

/* Local formatters — the core stays free of the UI's format module. */
function fmt(qty: number, unit: string): string {
  const a = Math.abs(qty)
  if (unit === 'g') return a >= 1000 ? `${(qty / 1000).toFixed(2)} kg` : `${Math.round(qty)} g`
  if (unit === 'ml') return a >= 1000 ? `${(qty / 1000).toFixed(2)} L` : `${Math.round(qty)} ml`
  return `${Math.round(qty * 10) / 10} pc`
}
function fmtPU(qty: number, unit: string): string {
  return `${Math.round(qty * 100) / 100} ${unit}`
}
function money(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}
