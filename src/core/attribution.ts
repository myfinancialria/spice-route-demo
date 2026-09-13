import type { Dish, ID } from './types'
import { type CostingContext, costRecipe } from './costing'

/**
 * Spread counted leakage across the kitchen sections that actually cook with
 * each ingredient, weighted by how much of it their dishes consume.
 *
 * Without this, a chef could be charged for an ingredient their station never
 * touches — which is the fastest way to make a scorecard get ignored.
 */
export function varianceBySection(
  ctx: CostingContext,
  dishes: Dish[],
  rows: { itemId: ID; varianceValue: number }[],
): Map<ID, number> {
  const out = new Map<ID, number>()
  if (!rows.length) return out

  const usage = new Map<ID, Map<ID, number>>()
  for (const dish of dishes) {
    if (!dish.sectionId) continue
    for (const line of costRecipe(ctx, 'DISH', dish.id, 1, { explode: true })) {
      let m = usage.get(line.itemId)
      if (!m) { m = new Map(); usage.set(line.itemId, m) }
      m.set(dish.sectionId, (m.get(dish.sectionId) ?? 0) + line.qty)
    }
  }

  for (const row of rows) {
    // Only shortfalls are attributed. A positive count is not a chef's credit.
    if (row.varianceValue >= 0) continue
    const shares = usage.get(row.itemId)
    if (!shares?.size) continue
    const total = [...shares.values()].reduce((s, v) => s + v, 0) || 1
    for (const [sectionId, q] of shares) {
      out.set(sectionId, (out.get(sectionId) ?? 0) + Math.abs(row.varianceValue) * (q / total))
    }
  }
  return out
}
