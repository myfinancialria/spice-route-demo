import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLedger } from '../data/store'
import type { ID, Item, Movement } from '../core/types'
import { addDays, dayLabel, iso, longDate, rangeDays } from '../core/dates'
import { costRecipe, mergeCostedLines } from '../core/costing'
import { Bar, Badge, Card, Drawer, Empty, Pills, Tile } from '../components/ui'
import { Sparkline, TrendLine } from '../components/charts'
import { money, moneyShort, num, pct, qty } from '../lib/format'

/* ---------------- period selection ---------------- */

export type PeriodKey = 7 | 30 | 60 | 90 | 120

export function usePeriod(initial: PeriodKey = 30) {
  const { derived } = useLedger()
  const [days, setDays] = useState<PeriodKey>(initial)
  const to = derived.today
  const from = addDays(to, -(days - 1))
  return { days, setDays, from, to }
}

export function PeriodPills({ days, setDays }: { days: PeriodKey; setDays: (d: PeriodKey) => void }) {
  return (
    <Pills
      value={days}
      onChange={(v) => setDays(v as PeriodKey)}
      options={[
        { value: 7, label: '7 days' },
        { value: 30, label: '30 days' },
        { value: 60, label: '60 days' },
        { value: 90, label: '90 days' },
        { value: 120, label: 'All' },
      ]}
    />
  )
}

/* ---------------- movement type labels ---------------- */

export const MOVEMENT_LABEL: Record<Movement['type'], string> = {
  OPENING: 'Opening', RECEIPT: 'Received', TRANSFER_OUT: 'Issued out',
  TRANSFER_IN: 'Received in', CONSUMPTION: 'Used by recipe', PRODUCTION_IN: 'Produced',
  PRODUCTION_OUT: 'Used in prep', WASTAGE: 'Wastage', ADJUSTMENT: 'Count adjustment',
  RETURN: 'Returned',
}

export const MOVEMENT_TONE: Record<Movement['type'], string> = {
  OPENING: 'neutral', RECEIPT: 'ok', TRANSFER_OUT: 'info', TRANSFER_IN: 'info',
  CONSUMPTION: 'brand', PRODUCTION_IN: 'ok', PRODUCTION_OUT: 'brand',
  WASTAGE: 'critical', ADJUSTMENT: 'watch', RETURN: 'neutral',
}

/* ---------------- item drill-down ---------------- */

/**
 * Everything the system knows about one ingredient, on one panel: where it is,
 * what it cost over time, which dishes consume it, and every movement behind
 * the balance. This is the "click into it" layer for most screens.
 */
export function ItemDrawer({ itemId, onClose }: { itemId: ID; onClose: () => void }) {
  const { state, derived } = useLedger()
  const item = derived.itemById.get(itemId)
  const [tab, setTab] = useState<'summary' | 'movements' | 'dishes'>('summary')

  const data = useMemo(() => {
    if (!item) return null
    const movements = state.movements
      .filter((m) => m.itemId === itemId)
      .sort((a, b) => (b.ts > a.ts ? 1 : -1))
    const byLocation = state.locations.map((loc) => ({
      loc,
      qty: derived.balance(itemId, loc.id),
    })).filter((r) => Math.abs(r.qty) > 0.001)

    // Purchase rate history, from the receipts rather than the average.
    const priceHistory = state.receipts
      .filter((g) => g.status === 'POSTED' && g.lines.some((l) => l.itemId === itemId && l.receivedQty > 0))
      .map((g) => {
        const line = g.lines.find((l) => l.itemId === itemId)!
        return { date: g.date, label: dayLabel(g.date), rate: line.rate }
      })
      .sort((a, b) => a.date.localeCompare(b.date))

    // 30-day usage, to turn a balance into days of cover.
    const last30 = addDays(derived.today, -29)
    const used = movements
      .filter((m) => m.date >= last30 && (m.type === 'CONSUMPTION' || m.type === 'PRODUCTION_OUT'))
      .reduce((s, m) => s + Math.abs(m.qty), 0)
    const perDay = used / 30

    const dishes = state.dishes.map((d) => {
      const lines = mergeCostedLines(costRecipe(derived.ctx, 'DISH', d.id, 1, { explode: true }))
      const use = lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0)
      return { dish: d, qty: use, cost: use * item.avgCost }
    }).filter((r) => r.qty > 0).sort((a, b) => b.cost - a.cost)

    const daily = rangeDays(addDays(derived.today, -29), derived.today).map((date) => {
      const v = movements
        .filter((m) => m.date === date && (m.type === 'CONSUMPTION' || m.type === 'PRODUCTION_OUT'))
        .reduce((s, m) => s + Math.abs(m.qty), 0)
      return v
    })

    return { movements, byLocation, priceHistory, perDay, dishes, daily, onHand: derived.onHand.get(itemId) ?? 0 }
  }, [item, itemId, state, derived])

  if (!item || !data) return null
  const cover = data.perDay > 0 ? data.onHand / data.perDay : null
  const category = derived.categoryById.get(item.categoryId)
  const subCategory = item.subCategoryId ? derived.categoryById.get(item.subCategoryId) : null

  return (
    <Drawer
      title={item.name}
      sub={`${item.sku} · ${category?.name ?? ''}${subCategory ? ` › ${subCategory.name}` : ''}`}
      onClose={onClose}
    >
      <div className="stack">
        <div className="grid g2">
          <Tile label="On hand" value={qty(data.onHand, item.baseUnit)}
            foot={cover !== null ? `${cover.toFixed(1)} days of cover` : 'no recent usage'} />
          <Tile label="Average cost" value={money(item.avgCost * item.purchaseConversion, 2)}
            foot={`per ${item.purchaseUnit}`} />
        </div>

        <div className="tabs">
          {(['summary', 'movements', 'dishes'] as const).map((t) => (
            <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'summary' ? 'Summary' : t === 'movements' ? `Movements (${data.movements.length})` : `Used in (${data.dishes.length})`}
            </button>
          ))}
        </div>

        {tab === 'summary' && (
          <>
            <Card title="Where it is" flush>
              <table className="tbl compact">
                <tbody>
                  {data.byLocation.map((r) => (
                    <tr key={r.loc.id}>
                      <td>{r.loc.name}</td>
                      <td className="num">{qty(r.qty, item.baseUnit)}</td>
                      <td className="num dim">{money(r.qty * item.avgCost)}</td>
                    </tr>
                  ))}
                  {!data.byLocation.length && <tr><td className="dim">Nothing on hand</td></tr>}
                </tbody>
              </table>
            </Card>

            <Card title="Purchase rate" sub={`per ${item.purchaseUnit}, from posted bills`}>
              {data.priceHistory.length > 1 ? (
                <TrendLine
                  data={data.priceHistory} xKey="label" format="money" height={160}
                  series={[{ key: 'rate', name: `Rate / ${item.purchaseUnit}` }]}
                />
              ) : <div className="dim">Not purchased yet in this period.</div>}
            </Card>

            <Card title="Daily usage" sub="last 30 days">
              <Sparkline data={data.daily} height={44} />
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                <span className="dim">Average</span>
                <span className="num">{qty(data.perDay, item.baseUnit)} / day</span>
              </div>
            </Card>

            <Card title="Master data">
              <dl className="kv">
                <dt>Base unit</dt><dd>{item.baseUnit}</dd>
                <dt>Purchase unit</dt><dd>1 {item.purchaseUnit} = {num(item.purchaseConversion)} {item.baseUnit}</dd>
                <dt>Usable yield</dt><dd>{pct(item.yieldPct * 100, 0)}</dd>
                <dt>Shelf life</dt><dd>{item.shelfLifeDays ? `${item.shelfLifeDays} days` : '—'}</dd>
                <dt>Par level</dt><dd>{qty(item.parLevel, item.baseUnit)}</dd>
                <dt>Reorder at</dt><dd>{qty(item.reorderLevel, item.baseUnit)}</dd>
                <dt>Supplier</dt><dd>{item.defaultSupplierId ? derived.supplierById.get(item.defaultSupplierId)?.name ?? '—' : 'Made in-house'}</dd>
              </dl>
            </Card>
          </>
        )}

        {tab === 'movements' && (
          <Card flush>
            <div className="table-wrap scroll-y mh-560">
              <table className="tbl compact">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Location</th><th className="num">Qty</th><th className="num">Value</th></tr>
                </thead>
                <tbody>
                  {data.movements.slice(0, 400).map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap dim">{dayLabel(m.date)}</td>
                      <td><Badge kind={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge></td>
                      <td className="dim">{derived.locationById.get(m.locationId)?.name}</td>
                      <td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{qty(m.qty, item.baseUnit)}</td>
                      <td className="num dim">{money(Math.abs(m.value))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === 'dishes' && (
          <Card flush sub="per plate, after prep explosion">
            <table className="tbl compact">
              <thead><tr><th>Dish</th><th className="num">Qty / plate</th><th className="num">Cost</th></tr></thead>
              <tbody>
                {data.dishes.map((r) => (
                  <tr key={r.dish.id}>
                    <td><Link to={`/menu/costing?dish=${r.dish.id}`}>{r.dish.name}</Link></td>
                    <td className="num">{qty(r.qty, item.baseUnit)}</td>
                    <td className="num">{money(r.cost, 2)}</td>
                  </tr>
                ))}
                {!data.dishes.length && <tr><td colSpan={3} className="dim">Not used in any recipe.</td></tr>}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </Drawer>
  )
}

/* ---------------- reusable stock table ---------------- */

export function StockTable({
  locationId, search, onPick,
}: { locationId?: ID; search?: string; onPick: (id: ID) => void }) {
  const { state, derived } = useLedger()

  const rows = useMemo(() => {
    const last30 = addDays(derived.today, -29)
    const usage = new Map<ID, number>()
    for (const m of state.movements) {
      if (m.date < last30) continue
      if (m.type !== 'CONSUMPTION' && m.type !== 'PRODUCTION_OUT') continue
      usage.set(m.itemId, (usage.get(m.itemId) ?? 0) + Math.abs(m.qty))
    }
    const term = (search ?? '').trim().toLowerCase()
    return state.items
      .filter((i) => i.active)
      .map((item) => {
        const onHand = locationId ? derived.balance(item.id, locationId) : derived.onHand.get(item.id) ?? 0
        const perDay = (usage.get(item.id) ?? 0) / 30
        return {
          item,
          onHand,
          value: onHand * item.avgCost,
          perDay,
          cover: perDay > 0 ? onHand / perDay : null,
          low: item.reorderLevel > 0 && onHand <= item.reorderLevel,
        }
      })
      .filter((r) => Math.abs(r.onHand) > 0.001 || r.low)
      .filter((r) => !term || r.item.name.toLowerCase().includes(term) || r.item.sku.toLowerCase().includes(term))
      .sort((a, b) => b.value - a.value)
  }, [state, derived, locationId, search])

  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!rows.length) return <Empty icon="📭" title="Nothing on hand here" >Receive stock or issue it in to see balances.</Empty>

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th className="num">On hand</th>
            <th className="num">Cost / unit</th><th className="num">Value</th>
            <th className="num">Days cover</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.id} className="clickable" onClick={() => onPick(r.item.id)}>
              <td>
                <div className="tbl-name">{r.item.name}</div>
                <div className="tbl-sub">{r.item.sku}</div>
              </td>
              <td className="dim">{derived.categoryById.get(r.item.categoryId)?.name}</td>
              <td className="num">{qty(r.onHand, r.item.baseUnit)}</td>
              <td className="num dim">{money(r.item.avgCost * r.item.purchaseConversion, 2)}<span className="dim">/{r.item.purchaseUnit}</span></td>
              <td className="num">{money(r.value)}</td>
              <td className="num">{r.cover === null ? '—' : r.cover.toFixed(1)}</td>
              <td>
                {r.onHand < 0 ? <Badge kind="critical">Negative</Badge>
                  : r.low ? <Badge kind="watch">Below reorder</Badge>
                  : r.cover !== null && r.cover < 1 ? <Badge kind="high">Runs out today</Badge>
                  : <Badge kind="ok">OK</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>{rows.length} items</td>
            <td className="num">{money(total)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/* ---------------- small helpers ---------------- */

export function ValueBar({ rows, total }: { rows: { label: string; value: number; color?: string }[]; total: number }) {
  return (
    <div className="stack" style={{ gap: 9 }}>
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12.5 }}>{r.label}</span>
              <span className="num" style={{ fontSize: 12.5 }}>{moneyShort(r.value)}</span>
            </div>
            <Bar value={r.value} max={total} color={r.color} />
          </div>
          <span className="num dim" style={{ fontSize: 11, minWidth: 38, textAlign: 'right' }}>
            {total ? pct((r.value / total) * 100, 0) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

export function NoData({ what }: { what: string }) {
  return <Empty icon="📊" title={`No ${what} yet`}>Once there is data for this period it appears here.</Empty>
}

export { longDate, iso, dayLabel }
export type { Item }
