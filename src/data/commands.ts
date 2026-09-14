/**
 * Commands: the only places that write to the stock ledger.
 *
 * Each takes the current state plus a document and returns the movements to
 * append and the item masters to patch. Nothing here touches storage or React,
 * so the same logic runs in the browser and on the server.
 */
import type {
  GoodsReceipt, Issue, Item, Movement, ProductionRun, PurchaseBill, PurchaseOrder,
  SalesDay, Stocktake, Wastage,
} from '../core/types'
import { type CostingContext, costRecipe, theoreticalConsumption } from '../core/costing'
import { newAvgCost } from '../core/stock'
import { round, toBase } from '../core/units'

export interface PostContext {
  items: Item[]
  ctx: CostingContext
  /** Current balance for an item at a location, in base units. */
  balance: (itemId: string, locationId: string) => number
  now?: string
}

export interface PostResult {
  movements: Movement[]
  itemPatches: Item[]
  warnings: string[]
  /** Documents other than the one posted that changed as a side effect. */
  poPatch?: PurchaseOrder
}

let counter = 0
export function uid(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const empty = (): PostResult => ({ movements: [], itemPatches: [], warnings: [] })

/** A purchase bill lands stock in a location and re-averages its cost. */
export function postBill(pc: PostContext, bill: PurchaseBill): PostResult {
  const res = empty()
  const byId = new Map(pc.items.map((i) => [i.id, i]))
  const patched = new Map<string, Item>()

  for (const line of bill.lines) {
    const base = patched.get(line.itemId) ?? byId.get(line.itemId)
    if (!base) { res.warnings.push(`Unknown item on line — skipped`); continue }
    const qtyBase = toBase(base, line.qty, line.unit)
    if (qtyBase <= 0) continue
    const net = line.qty * line.rate - (line.discount || 0)
    const rateBase = qtyBase > 0 ? net / qtyBase : 0
    const locationId = bill.locationId || base.defaultLocationId
    const onHand = pc.balance(base.id, locationId)
    const item: Item = {
      ...base,
      avgCost: newAvgCost(onHand, base.avgCost, qtyBase, rateBase),
      lastPurchaseCost: round(rateBase, 6),
    }
    patched.set(item.id, item)
    res.movements.push({
      id: uid('mv'), date: bill.billDate, ts: pc.now ?? new Date().toISOString(),
      itemId: item.id, locationId, qty: round(qtyBase, 4), type: 'RECEIPT',
      rate: round(rateBase, 6), value: round(qtyBase * rateBase, 4),
      refType: 'BILL', refId: bill.id, staffId: bill.enteredBy, batchNo: line.batchNo,
    })
    // A rate that jumps this far is nearly always a unit mix-up on entry.
    if (base.lastPurchaseCost > 0) {
      const jump = (rateBase - base.lastPurchaseCost) / base.lastPurchaseCost
      if (Math.abs(jump) > 0.35) {
        res.warnings.push(
          `${base.name}: rate ${round(rateBase * base.purchaseConversion, 2)}/${base.purchaseUnit} is ${jump > 0 ? 'up' : 'down'} ${Math.abs(round(jump * 100, 0))}% on last purchase`,
        )
      }
    }
  }
  res.itemPatches = [...patched.values()]
  return res
}

/**
 * Goods receipt: the store manager confirms what actually arrived.
 *
 * Only the accepted quantity (received − damaged) enters stock. Shortfalls and
 * refusals never touch the ledger — they become alerts and a mark against the
 * vendor. The PO it was raised against is advanced to PARTIAL or RECEIVED.
 */
export function postGoodsReceipt(
  pc: PostContext,
  grn: GoodsReceipt,
  po?: PurchaseOrder,
): PostResult {
  const res = empty()
  const byId = new Map(pc.items.map((i) => [i.id, i]))
  const patched = new Map<string, Item>()
  const ts = pc.now ?? new Date().toISOString()

  for (const line of grn.lines) {
    const base = patched.get(line.itemId) ?? byId.get(line.itemId)
    if (!base) { res.warnings.push('Unknown item on a line — skipped'); continue }
    const accepted = Math.max(line.receivedQty - (line.damagedQty || 0), 0)
    if (accepted <= 0) continue
    const qtyBase = toBase(base, accepted, line.unit)
    const rateBase = qtyBase > 0 ? (accepted * line.rate) / qtyBase : 0
    const locationId = grn.locationId || base.defaultLocationId
    const onHand = pc.balance(base.id, locationId)
    const item: Item = {
      ...base,
      avgCost: newAvgCost(onHand, base.avgCost, qtyBase, rateBase),
      lastPurchaseCost: round(rateBase, 6),
    }
    patched.set(item.id, item)
    res.movements.push({
      id: uid('mv'), date: grn.date, ts, itemId: item.id, locationId,
      qty: round(qtyBase, 4), type: 'RECEIPT', rate: round(rateBase, 6),
      value: round(qtyBase * rateBase, 4), refType: 'GRN', refId: grn.id,
      staffId: grn.receivedBy, batchNo: line.batchNo,
    })
    if (base.lastPurchaseCost > 0) {
      const jump = (rateBase - base.lastPurchaseCost) / base.lastPurchaseCost
      if (Math.abs(jump) > 0.35) {
        res.warnings.push(`${base.name}: rate is ${jump > 0 ? 'up' : 'down'} ${Math.abs(round(jump * 100, 0))}% on the last delivery — check the unit`)
      }
    }
  }
  res.itemPatches = [...patched.values()]

  if (po) {
    const lines = po.lines.map((pl) => {
      const grnLine = grn.lines.find((g) => g.itemId === pl.itemId)
      if (!grnLine) return pl
      const item = byId.get(pl.itemId)
      const accepted = Math.max(grnLine.receivedQty - (grnLine.damagedQty || 0), 0)
      const acceptedBase = item ? toBase(item, accepted, grnLine.unit) : accepted
      return { ...pl, acceptedBase: round(pl.acceptedBase + acceptedBase, 4) }
    })
    // Received in full when every line has at least 95% of what was ordered;
    // vendors routinely round a 10 kg order to 9.8.
    const complete = lines.every((pl) => {
      const item = byId.get(pl.itemId)
      const orderedBase = item ? toBase(item, pl.qty, pl.unit) : pl.qty
      return orderedBase <= 0 || pl.acceptedBase >= orderedBase * 0.95
    })
    res.poPatch = { ...po, lines, status: complete ? 'RECEIVED' : 'PARTIAL' }
  }
  return res
}

/** Store → kitchen. Two movements per line so both sides balance. */
export function postIssue(pc: PostContext, issue: Issue): PostResult {
  const res = empty()
  const byId = new Map(pc.items.map((i) => [i.id, i]))
  for (const line of issue.lines) {
    const item = byId.get(line.itemId)
    if (!item) continue
    const qty = line.qtyBase || toBase(item, line.qty, line.unit as never)
    if (qty <= 0) continue
    const from = line.fromLocationId ?? issue.fromLocationId
    const available = pc.balance(item.id, from)
    if (qty > available + 0.001) {
      res.warnings.push(
        `${item.name}: only ${round(available, 2)} ${item.baseUnit} available at source — issued anyway, the balance will show negative`,
      )
    }
    const ts = pc.now ?? new Date().toISOString()
    res.movements.push({
      id: uid('mv'), date: issue.date, ts, itemId: item.id,
      locationId: from, qty: -round(qty, 4), type: 'TRANSFER_OUT',
      rate: item.avgCost, value: -round(qty * item.avgCost, 4),
      refType: 'ISSUE', refId: issue.id, staffId: issue.requestedBy,
    })
    res.movements.push({
      id: uid('mv'), date: issue.date, ts, itemId: item.id,
      locationId: issue.toLocationId, qty: round(qty, 4), type: 'TRANSFER_IN',
      rate: item.avgCost, value: round(qty * item.avgCost, 4),
      refType: 'ISSUE', refId: issue.id, staffId: issue.requestedBy,
    })
  }
  return res
}

/** A prep batch: ingredients out, finished prep in, cost rolled up. */
export function postProduction(pc: PostContext, run: ProductionRun): PostResult {
  const res = empty()
  const byId = new Map(pc.items.map((i) => [i.id, i]))
  const target = byId.get(run.itemId)
  if (!target) { res.warnings.push('Unknown prep item'); return res }
  const ts = pc.now ?? new Date().toISOString()
  const produced = run.qtyProduced

  let batchCost = 0
  for (const line of costRecipe(pc.ctx, 'PREP', run.itemId, produced, { explode: false })) {
    const comp = byId.get(line.itemId)
    if (!comp) continue
    const available = pc.balance(comp.id, run.locationId)
    if (line.qty > available + 0.001) {
      res.warnings.push(`${comp.name}: short by ${round(line.qty - available, 2)} ${comp.baseUnit}`)
    }
    batchCost += line.qty * comp.avgCost
    res.movements.push({
      id: uid('mv'), date: run.date, ts, itemId: comp.id, locationId: run.locationId,
      qty: -round(line.qty, 4), type: 'PRODUCTION_OUT', rate: comp.avgCost,
      value: -round(line.qty * comp.avgCost, 4), refType: 'PRODUCTION', refId: run.id,
      staffId: run.byStaffId,
    })
  }

  const unitCost = produced > 0 ? round(batchCost / produced, 6) : target.avgCost
  const onHand = pc.balance(target.id, run.locationId)
  res.itemPatches.push({
    ...target,
    avgCost: newAvgCost(onHand, target.avgCost, produced, unitCost),
    lastPurchaseCost: unitCost,
  })
  res.movements.push({
    id: uid('mv'), date: run.date, ts, itemId: target.id, locationId: run.locationId,
    qty: round(produced, 4), type: 'PRODUCTION_IN', rate: unitCost,
    value: round(produced * unitCost, 4), refType: 'PRODUCTION', refId: run.id,
    staffId: run.byStaffId,
  })
  return res
}

export function postWastage(pc: PostContext, w: Wastage): PostResult {
  const res = empty()
  const item = pc.items.find((i) => i.id === w.itemId)
  if (!item) return res
  res.movements.push({
    id: uid('mv'), date: w.date, ts: pc.now ?? new Date().toISOString(),
    itemId: item.id, locationId: w.locationId, qty: -round(Math.abs(w.qtyBase), 4),
    type: 'WASTAGE', rate: item.avgCost, value: -round(Math.abs(w.qtyBase) * item.avgCost, 4),
    refType: 'WASTAGE', refId: w.id, staffId: w.byStaffId, note: w.reason,
  })
  return res
}

/**
 * Posting a day's sales depletes the kitchen by what the recipes say those
 * dishes should have used. Nothing else in the system creates consumption.
 */
export function postSales(pc: PostContext, day: SalesDay, kitchenId = 'loc_kitchen'): PostResult {
  const res = empty()
  const byId = new Map(pc.items.map((i) => [i.id, i]))
  const sold = day.lines.map((l) => ({ dishId: l.dishId, qty: l.qty }))
  const consumption = theoreticalConsumption(pc.ctx, sold)
  const ts = pc.now ?? new Date().toISOString()
  for (const [itemId, need] of consumption) {
    const item = byId.get(itemId)
    if (!item || need.qty <= 0) continue
    res.movements.push({
      id: uid('mv'), date: day.date, ts, itemId, locationId: kitchenId,
      qty: -round(need.qty, 4), type: 'CONSUMPTION', rate: item.avgCost,
      value: -round(need.qty * item.avgCost, 4), refType: 'SALES', refId: day.id, staffId: null,
    })
  }
  if (!res.movements.length) res.warnings.push('No recipe lines matched — check the dish SOPs')
  return res
}

/** A physical count writes the shelf back to truth and records the gap. */
export function postStocktake(pc: PostContext, take: Stocktake): PostResult {
  const res = empty()
  const byId = new Map(pc.items.map((i) => [i.id, i]))
  const ts = pc.now ?? new Date().toISOString()
  for (const line of take.lines) {
    const item = byId.get(line.itemId)
    if (!item) continue
    const system = pc.balance(item.id, take.locationId)
    const diff = round(line.countedQtyBase - system, 4)
    if (Math.abs(diff) < 0.001) continue
    res.movements.push({
      id: uid('mv'), date: take.date, ts, itemId: item.id, locationId: take.locationId,
      qty: diff, type: 'ADJUSTMENT', rate: item.avgCost, value: round(diff * item.avgCost, 4),
      refType: 'STOCKTAKE', refId: take.id, staffId: take.countedBy,
      note: diff < 0 ? 'Short on count' : 'Over on count',
    })
  }
  return res
}

/** Reverse every movement a document created, for a void or a correction. */
export function reverseDocument(movements: Movement[], refType: Movement['refType'], refId: string): Movement[] {
  return movements
    .filter((m) => m.refType === refType && m.refId === refId)
    .map((m) => ({
      ...m, id: uid('mv'), qty: -m.qty, value: -m.value,
      ts: new Date().toISOString(), note: `Reversal of ${m.id}`,
    }))
}
