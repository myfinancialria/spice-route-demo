import type { BaseUnit, Item, PurchaseUnit } from './types'

/** Purchase units that resolve to a fixed number of base units on their own. */
const FIXED: Record<string, number> = {
  kg: 1000, g: 1, litre: 1000, ml: 1, unit: 1, dozen: 12,
}

/**
 * Convert a quantity entered in any unit into the item's base unit.
 * Pack-style units (packet/box/bunch/tray/crate) fall back to the item's own
 * purchase conversion, which is what the pack actually contains.
 */
export function toBase(item: Item, qty: number, unit: PurchaseUnit | BaseUnit): number {
  if (unit === item.baseUnit) return qty
  const fixed = FIXED[unit]
  if (fixed !== undefined && (unit === 'kg' || unit === 'g' || unit === 'litre' || unit === 'ml')) {
    return qty * fixed
  }
  if (unit === item.purchaseUnit) return qty * item.purchaseConversion
  if (fixed !== undefined) return qty * fixed
  return qty * item.purchaseConversion
}

/** Convert base units back into the unit a human wants to read. */
export function fromBase(item: Item, qtyBase: number, unit: PurchaseUnit | BaseUnit): number {
  if (unit === item.baseUnit) return qtyBase
  if (unit === 'kg' || unit === 'litre') return qtyBase / 1000
  if (unit === item.purchaseUnit) return qtyBase / item.purchaseConversion
  return qtyBase
}

/** Units a given item may sensibly be entered in. */
export function unitOptions(item: Item): (PurchaseUnit | BaseUnit)[] {
  const opts = new Set<PurchaseUnit | BaseUnit>([item.baseUnit, item.purchaseUnit])
  if (item.baseUnit === 'g') { opts.add('g'); opts.add('kg') }
  if (item.baseUnit === 'ml') { opts.add('ml'); opts.add('litre') }
  return [...opts]
}

/**
 * Display a base quantity in the largest unit that still reads naturally,
 * so a kitchen screen shows "1.24 kg" rather than "1240 g".
 */
export function displayQty(item: Pick<Item, 'baseUnit'>, qtyBase: number, dp = 2): string {
  const n = Math.abs(qtyBase)
  if (item.baseUnit === 'g') {
    return n >= 1000 ? `${round(qtyBase / 1000, dp)} kg` : `${round(qtyBase, n < 10 ? 1 : 0)} g`
  }
  if (item.baseUnit === 'ml') {
    return n >= 1000 ? `${round(qtyBase / 1000, dp)} L` : `${round(qtyBase, n < 10 ? 1 : 0)} ml`
  }
  return `${round(qtyBase, qtyBase % 1 === 0 ? 0 : 1)} pc`
}

export function shortUnit(baseUnit: BaseUnit): string {
  return baseUnit === 'unit' ? 'pc' : baseUnit
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp
  return Math.round((n + Number.EPSILON) * f) / f
}
