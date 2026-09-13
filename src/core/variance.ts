import type { Category, ID, Item, Movement, Severity, Stocktake, VarianceRow } from './types'
import { flows } from './stock'
import { round } from './units'

/** Default tolerance bands by category, overridable per category master. */
export const DEFAULT_TOLERANCE = 2.5

export function severityFor(variancePct: number, varianceValue: number, tolerance: number): Severity {
  const abs = Math.abs(variancePct)
  const val = Math.abs(varianceValue)
  // A tiny percentage on an expensive item still matters, and vice versa.
  if (abs >= tolerance * 3 && val >= 250) return 'CRITICAL'
  if (abs >= tolerance * 2 || val >= 1500) return 'HIGH'
  if (abs >= tolerance || val >= 400) return 'WATCH'
  return 'OK'
}

export interface VarianceInput {
  items: Item[]
  categories: Category[]
  movements: Movement[]
  stocktake: Stocktake
  /** Prior stocktakes at the same location, for the trailing average. */
  history?: { date: string; rows: Map<ID, number> }[]
}

/**
 * Compare what the recipes and documents say should be on the shelf against
 * what was physically counted.
 *
 *   expected = opening + received + transfers in − transfers out
 *              − theoretical consumption − recorded wastage
 *   variance = counted − expected
 *
 * A negative variance is stock that left without a document behind it:
 * over-portioning, unrecorded waste, or theft.
 */
export function computeVariance(input: VarianceInput): VarianceRow[] {
  const { items, categories, movements, stocktake, history = [] } = input
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const tolerance = new Map(
    categories.map((c) => [c.id, c.varianceTolerancePct ?? DEFAULT_TOLERANCE]),
  )

  // Everything since the previous count at this location is the period. The
  // adjustment this very count posts is excluded, or expected would equal
  // counted by construction and every variance would read zero.
  const from = previousCountDate(history, stocktake.date) ?? stocktake.date
  const ledger = movements.filter(
    (m) => !(m.refType === 'STOCKTAKE' && m.refId === stocktake.id),
  )
  const flow = flows(ledger, from, stocktake.date, stocktake.locationId)

  const rows: VarianceRow[] = []
  for (const line of stocktake.lines) {
    const item = itemMap.get(line.itemId)
    if (!item) continue
    const f = flow.get(line.itemId) ?? {
      opening: 0, received: 0, transferredIn: 0, transferredOut: 0,
      consumed: 0, produced: 0, wastage: 0, adjusted: 0, closing: 0,
    }
    // Adjustments from the previous count are real ledger movements: leave
    // them out and this week's variance silently re-reports last week's gap.
    const expected = f.opening + f.received + f.transferredIn + f.produced + f.adjusted
      - f.transferredOut - f.consumed - f.wastage
    const actual = line.countedQtyBase
    const varianceQty = round(actual - expected, 3)
    // Percentage is against throughput, not closing stock — closing can be
    // near zero, which would make every rounding error look catastrophic.
    const throughput = Math.max(f.consumed + f.transferredOut + f.wastage, Math.abs(expected), 1)
    const variancePct = round((varianceQty / throughput) * 100, 2)
    const varianceValue = round(varianceQty * item.avgCost, 2)
    const tol = tolerance.get(item.categoryId) ?? DEFAULT_TOLERANCE

    const past = trailingVariancePct(history, item.id)
    rows.push({
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      categoryId: item.categoryId,
      baseUnit: item.baseUnit,
      opening: round(f.opening, 2),
      received: round(f.received, 2),
      transferredIn: round(f.transferredIn, 2),
      transferredOut: round(f.transferredOut, 2),
      theoretical: round(f.consumed, 2),
      wastage: round(f.wastage, 2),
      expectedClosing: round(expected, 2),
      actualClosing: round(actual, 2),
      varianceQty,
      variancePct,
      varianceValue,
      unitCost: item.avgCost,
      severity: severityFor(variancePct, varianceValue, tol),
      avgVariancePct: past,
      deviation: past === null ? null : round(variancePct - past, 2),
    })
  }
  return rows.sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue))
}

function previousCountDate(
  history: { date: string; rows: Map<ID, number> }[],
  before: string,
): string | null {
  const prior = history.map((h) => h.date).filter((d) => d < before).sort()
  return prior.length ? prior[prior.length - 1] : null
}

function trailingVariancePct(
  history: { date: string; rows: Map<ID, number> }[],
  itemId: ID,
): number | null {
  const vals = history.map((h) => h.rows.get(itemId)).filter((v): v is number => v !== undefined)
  if (vals.length < 2) return null
  return round(vals.reduce((s, v) => s + v, 0) / vals.length, 2)
}

export interface VarianceSummary {
  totalLeak: number
  negativeLeak: number
  positiveLeak: number
  critical: number
  high: number
  watch: number
  ok: number
  itemsCounted: number
  worst: VarianceRow[]
}

export function summarise(rows: VarianceRow[]): VarianceSummary {
  const neg = rows.filter((r) => r.varianceValue < 0)
  const pos = rows.filter((r) => r.varianceValue > 0)
  return {
    totalLeak: round(rows.reduce((s, r) => s + r.varianceValue, 0), 2),
    negativeLeak: round(neg.reduce((s, r) => s + r.varianceValue, 0), 2),
    positiveLeak: round(pos.reduce((s, r) => s + r.varianceValue, 0), 2),
    critical: rows.filter((r) => r.severity === 'CRITICAL').length,
    high: rows.filter((r) => r.severity === 'HIGH').length,
    watch: rows.filter((r) => r.severity === 'WATCH').length,
    ok: rows.filter((r) => r.severity === 'OK').length,
    itemsCounted: rows.length,
    worst: rows.filter((r) => r.severity !== 'OK').slice(0, 8),
  }
}

/**
 * Project a period's counted leakage to a month, so a manager can see what a
 * daily 2% slip is actually worth over a month of trading.
 */
export function monthlyLeakProjection(leakPerDay: number, tradingDays = 30): number {
  return round(leakPerDay * tradingDays, 0)
}
