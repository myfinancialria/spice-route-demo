import type { ID, Item, Movement, MovementType } from './types'
import { round } from './units'

/** Movement types that add to stock. Everything else reduces it. */
export const INBOUND: MovementType[] = ['OPENING', 'RECEIPT', 'TRANSFER_IN', 'PRODUCTION_IN', 'RETURN']

export interface Balance {
  itemId: ID
  locationId: ID
  qty: number
  value: number
}

const key = (itemId: ID, locationId: ID) => `${itemId}|${locationId}`

/** Running balance per item per location, optionally as at a date. */
export function balances(movements: Movement[], asOf?: string): Map<string, Balance> {
  const map = new Map<string, Balance>()
  for (const m of movements) {
    if (asOf && m.date > asOf) continue
    const k = key(m.itemId, m.locationId)
    const cur = map.get(k) ?? { itemId: m.itemId, locationId: m.locationId, qty: 0, value: 0 }
    cur.qty += m.qty
    cur.value += m.value
    map.set(k, cur)
  }
  return map
}

/** Total stock of an item across every location. */
export function itemTotals(movements: Movement[], asOf?: string): Map<ID, number> {
  const out = new Map<ID, number>()
  for (const m of movements) {
    if (asOf && m.date > asOf) continue
    out.set(m.itemId, (out.get(m.itemId) ?? 0) + m.qty)
  }
  return out
}

export function balanceOf(movements: Movement[], itemId: ID, locationId?: ID, asOf?: string): number {
  let qty = 0
  for (const m of movements) {
    if (m.itemId !== itemId) continue
    if (locationId && m.locationId !== locationId) continue
    if (asOf && m.date > asOf) continue
    qty += m.qty
  }
  return qty
}

/**
 * Weighted-average cost after a receipt.
 * Falls back to the incoming rate when there is no stock to average against,
 * which is the common case for a new item's first bill.
 */
export function newAvgCost(
  onHandQty: number,
  currentAvg: number,
  receivedQty: number,
  receivedRate: number,
): number {
  if (receivedQty <= 0) return currentAvg
  const q = Math.max(onHandQty, 0)
  if (q <= 0) return receivedRate
  return round((q * currentAvg + receivedQty * receivedRate) / (q + receivedQty), 6)
}

export interface DayFlow {
  opening: number
  received: number
  transferredIn: number
  transferredOut: number
  consumed: number
  produced: number
  wastage: number
  adjusted: number
  closing: number
}

const ZERO: DayFlow = {
  opening: 0, received: 0, transferredIn: 0, transferredOut: 0,
  consumed: 0, produced: 0, wastage: 0, adjusted: 0, closing: 0,
}

/**
 * Per-item flow for a date window at one location (or everywhere).
 * This is the arithmetic the EOD review is built on:
 *   opening + in − out = closing
 */
export function flows(
  movements: Movement[],
  from: string,
  to: string,
  locationId?: ID,
): Map<ID, DayFlow> {
  const out = new Map<ID, DayFlow>()
  const get = (id: ID) => {
    let f = out.get(id)
    if (!f) { f = { ...ZERO }; out.set(id, f) }
    return f
  }

  for (const m of movements) {
    if (locationId && m.locationId !== locationId) continue
    if (m.date < from) { get(m.itemId).opening += m.qty; continue }
    if (m.date > to) continue
    const f = get(m.itemId)
    switch (m.type) {
      case 'OPENING':
      case 'RECEIPT': f.received += m.qty; break
      case 'TRANSFER_IN': f.transferredIn += m.qty; break
      case 'TRANSFER_OUT': f.transferredOut += -m.qty; break
      case 'CONSUMPTION': f.consumed += -m.qty; break
      case 'PRODUCTION_IN': f.produced += m.qty; break
      case 'PRODUCTION_OUT': f.consumed += -m.qty; break
      case 'WASTAGE': f.wastage += -m.qty; break
      case 'ADJUSTMENT': f.adjusted += m.qty; break
      case 'RETURN': f.received += m.qty; break
    }
  }

  for (const f of out.values()) {
    f.closing = f.opening + f.received + f.transferredIn + f.produced + f.adjusted
      - f.transferredOut - f.consumed - f.wastage
  }
  return out
}

/** Days of cover left at the recent consumption rate — drives reorder alerts. */
export function daysOfCover(onHand: number, dailyUsage: number): number | null {
  if (dailyUsage <= 0) return null
  return round(onHand / dailyUsage, 1)
}

export interface StockAlert {
  itemId: ID
  name: string
  onHand: number
  dailyUsage: number
  daysLeft: number | null
  reorderLevel: number
  parLevel: number
  suggestedOrderQty: number
  severity: 'CRITICAL' | 'LOW' | 'WATCH'
  leadTimeDays: number
}

/**
 * Reorder suggestions: anything that runs out inside its own lead time, or
 * has fallen below its reorder level, topped back up to par.
 */
export function reorderAlerts(
  items: Item[],
  onHand: Map<ID, number>,
  usagePerDay: Map<ID, number>,
  leadTime: (item: Item) => number,
): StockAlert[] {
  const out: StockAlert[] = []
  for (const item of items) {
    if (!item.active || item.isPrep) continue
    const qty = onHand.get(item.id) ?? 0
    const usage = usagePerDay.get(item.id) ?? 0
    const days = daysOfCover(qty, usage)
    const lead = leadTime(item)
    const belowReorder = item.reorderLevel > 0 && qty <= item.reorderLevel
    const runsOut = days !== null && days <= lead + 1
    if (!belowReorder && !runsOut) continue
    const severity: StockAlert['severity'] =
      days !== null && days <= lead ? 'CRITICAL' : belowReorder ? 'LOW' : 'WATCH'
    out.push({
      itemId: item.id,
      name: item.name,
      onHand: qty,
      dailyUsage: usage,
      daysLeft: days,
      reorderLevel: item.reorderLevel,
      parLevel: item.parLevel,
      suggestedOrderQty: Math.max(item.parLevel - qty, usage * (lead + 2) - qty, 0),
      severity,
      leadTimeDays: lead,
    })
  }
  const order = { CRITICAL: 0, LOW: 1, WATCH: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity] || (a.daysLeft ?? 99) - (b.daysLeft ?? 99))
}
