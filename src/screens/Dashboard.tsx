import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import type { LedgerState } from '../data/store'
import { PageHead } from '../components/Layout'
import { Bar, Badge, Empty, Modal, Pills, SeverityBadge } from '../components/ui'
import { PALETTE } from '../components/charts'
import { ItemDrawer } from './shared'
import { addDays, dayLabel, monthKey, rangeDays } from '../core/dates'
import { dishPerformance, filterSales, pnlSeries } from '../core/analytics'
import { computeVariance, summarise } from '../core/variance'
import { costDish } from '../core/costing'
import { round } from '../core/units'
import { downloadText, money, moneyShort, num, pct, qty as fmtQty, toCsv } from '../lib/format'
import type { ID, Severity } from '../core/types'

type Metric = 'sales' | 'foodcost' | 'variance' | 'purchases' | 'stock' | 'wastage'
type Range = 'today' | '7' | 'mtd' | '30'

/* ------------------------------------------------------------------ */
/* Three levels: a number → its categories → the rows behind them      */
/* ------------------------------------------------------------------ */

interface Col { key: string; label: string; kind: 'text' | 'money' | 'num' | 'pct' | 'sev' | 'qty' }
interface Row { [k: string]: string | number | undefined }
interface Level2 { key: string; name: string; value: number; count: number; hint?: string }
interface Drill {
  title: string
  sub: string
  total: number
  format: 'money' | 'pct'
  categories: Level2[]
  categoryLabel: string
  byDay: (categoryKey: string | null) => { columns: Col[]; rows: Row[] }
  byItem: (categoryKey: string | null) => { columns: Col[]; rows: Row[]; itemKey?: string }
}

type Derived = ReturnType<typeof useLedger>['derived']

function buildDrill(metric: Metric, state: LedgerState, derived: Derived, from: string, to: string): Drill {
  const cat = (id: ID) => derived.categoryById.get(id)?.name ?? '—'
  const sup = (id: ID) => derived.supplierById.get(id)?.name ?? '—'

  if (metric === 'sales') {
    const sales = filterSales(state.sales, from, to)
    const perf = dishPerformance(derived.ctx, state.dishes, sales)
    const byCat = new Map<ID, Level2>()
    for (const r of perf.rows) {
      const c = byCat.get(r.categoryId) ?? { key: r.categoryId, name: cat(r.categoryId), value: 0, count: 0 }
      c.value += r.revenue; c.count += r.qty
      byCat.set(r.categoryId, c)
    }
    return {
      title: 'Sales', sub: 'gross, by menu category', total: perf.totals.revenue, format: 'money',
      categoryLabel: 'Menu category',
      categories: [...byCat.values()].map((c) => ({ ...c, hint: `${num(c.count)} plates` })).sort((a, b) => b.value - a.value),
      byDay: (key) => ({
        columns: [{ key: 'date', label: 'Day', kind: 'text' }, { key: 'plates', label: 'Plates', kind: 'num' }, { key: 'gross', label: 'Gross', kind: 'money' }, { key: 'discount', label: 'Discount', kind: 'money' }, { key: 'net', label: 'Net', kind: 'money' }],
        rows: rangeDays(from, to).map((date) => {
          let plates = 0; let gross = 0; let discount = 0
          for (const d of sales.filter((s) => s.date === date)) {
            for (const l of d.lines) {
              if (key && derived.dishById.get(l.dishId)?.categoryId !== key) continue
              plates += l.qty; gross += l.grossAmount; discount += l.discount
            }
          }
          return { date: dayLabel(date), plates, gross: round(gross, 0), discount: round(discount, 0), net: round(gross - discount, 0) }
        }).filter((r) => (r.plates as number) > 0).reverse(),
      }),
      byItem: (key) => ({
        columns: [{ key: 'name', label: 'Dish', kind: 'text' }, { key: 'plates', label: 'Plates', kind: 'num' }, { key: 'revenue', label: 'Revenue', kind: 'money' }, { key: 'contribution', label: 'Contribution', kind: 'money' }, { key: 'fc', label: 'Food cost', kind: 'pct' }],
        rows: perf.rows.filter((r) => !key || r.categoryId === key).map((r) => ({ name: r.name, plates: r.qty, revenue: round(r.revenue, 0), contribution: round(r.contribution, 0), fc: r.foodCostPct })),
      }),
    }
  }

  if (metric === 'foodcost') {
    const cons = state.movements.filter((m) => m.date >= from && m.date <= to && (m.type === 'CONSUMPTION' || m.type === 'WASTAGE'))
    const byCat = new Map<ID, Level2>()
    const byItem = new Map<ID, { qty: number; value: number }>()
    for (const m of cons) {
      const item = derived.itemById.get(m.itemId); if (!item) continue
      const c = byCat.get(item.categoryId) ?? { key: item.categoryId, name: cat(item.categoryId), value: 0, count: 0 }
      c.value += Math.abs(m.value); c.count += 1
      byCat.set(item.categoryId, c)
      const i = byItem.get(m.itemId) ?? { qty: 0, value: 0 }
      i.qty += Math.abs(m.qty); i.value += Math.abs(m.value)
      byItem.set(m.itemId, i)
    }
    const pnl = pnlSeries({ ctx: derived.ctx, dishes: state.dishes, sales: state.sales, movements: state.movements, items: state.items, staff: state.staff, from, to, groupBy: 'day' })
    const total = cons.reduce((s, m) => s + Math.abs(m.value), 0)
    const rev = pnl.reduce((s, p) => s + p.netRevenue, 0)
    return {
      title: 'Food cost', sub: 'what the recipes consumed, by ingredient category', total: rev ? (total / rev) * 100 : 0, format: 'pct',
      categoryLabel: 'Ingredient category',
      categories: [...byCat.values()].map((c) => ({ ...c, hint: rev ? pct((c.value / rev) * 100) + ' of sales' : '' })).sort((a, b) => b.value - a.value),
      byDay: () => ({
        columns: [{ key: 'date', label: 'Day', kind: 'text' }, { key: 'revenue', label: 'Net sales', kind: 'money' }, { key: 'food', label: 'Food cost', kind: 'money' }, { key: 'fc', label: 'Food cost %', kind: 'pct' }],
        rows: pnl.map((p) => ({ date: dayLabel(p.key), revenue: round(p.netRevenue, 0), food: round(p.actualFoodCost, 0), fc: p.actualFoodCostPct })).reverse(),
      }),
      byItem: (key) => ({
        columns: [{ key: 'name', label: 'Ingredient', kind: 'text' }, { key: 'used', label: 'Used', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }, { key: 'share', label: 'Share', kind: 'pct' }],
        itemKey: 'itemId',
        rows: [...byItem.entries()].map(([id, v]) => {
          const item = derived.itemById.get(id)!
          return { itemId: id, name: item.name, cat: item.categoryId, used: fmtQty(v.qty, item.baseUnit), value: round(v.value, 0), share: total ? round((v.value / total) * 100, 1) : 0 }
        }).filter((r) => !key || r.cat === key).sort((a, b) => (b.value as number) - (a.value as number)),
      }),
    }
  }

  if (metric === 'variance') {
    const takes = state.stocktakes.filter((s) => s.date >= from && s.date <= to && s.status === 'POSTED')
    const all: { date: string; loc: string; row: ReturnType<typeof computeVariance>[number] }[] = []
    for (const t of takes) {
      const history = state.stocktakes.filter((s) => s.locationId === t.locationId && s.date < t.date).map((s) => ({ date: s.date, rows: new Map<ID, number>() }))
      for (const r of computeVariance({ items: state.items, categories: state.categories, movements: state.movements, stocktake: t, history })) {
        all.push({ date: t.date, loc: derived.locationById.get(t.locationId)?.name ?? '', row: r })
      }
    }
    const byCat = new Map<ID, Level2>()
    for (const { row } of all) {
      if (row.varianceValue >= 0) continue
      const c = byCat.get(row.categoryId) ?? { key: row.categoryId, name: cat(row.categoryId), value: 0, count: 0 }
      c.value += Math.abs(row.varianceValue); if (row.severity !== 'OK') c.count += 1
      byCat.set(row.categoryId, c)
    }
    const total = [...byCat.values()].reduce((s, c) => s + c.value, 0)
    return {
      title: 'Counted short', sub: 'stock that left without a document, by ingredient category', total, format: 'money',
      categoryLabel: 'Ingredient category',
      categories: [...byCat.values()].map((c) => ({ ...c, hint: `${c.count} items over tolerance` })).sort((a, b) => b.value - a.value),
      byDay: (key) => ({
        columns: [{ key: 'date', label: 'Count', kind: 'text' }, { key: 'loc', label: 'Where', kind: 'text' }, { key: 'over', label: 'Over tolerance', kind: 'num' }, { key: 'short', label: 'Short', kind: 'money' }],
        rows: takes.map((t) => {
          const rows = all.filter((a) => a.date === t.date && a.loc === (derived.locationById.get(t.locationId)?.name ?? '') && (!key || a.row.categoryId === key))
          const s = summarise(rows.map((a) => a.row))
          return { date: dayLabel(t.date), loc: derived.locationById.get(t.locationId)?.name ?? '', over: s.critical + s.high + s.watch, short: round(Math.abs(s.negativeLeak), 0) }
        }).reverse(),
      }),
      byItem: (key) => ({
        columns: [{ key: 'name', label: 'Item', kind: 'text' }, { key: 'date', label: 'Count', kind: 'text' }, { key: 'expected', label: 'Expected', kind: 'text' }, { key: 'counted', label: 'Counted', kind: 'text' }, { key: 'gap', label: 'Gap', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }, { key: 'sev', label: 'Severity', kind: 'sev' }],
        itemKey: 'itemId',
        rows: all.filter((a) => a.row.severity !== 'OK' && (!key || a.row.categoryId === key)).map((a) => ({
          itemId: a.row.itemId, name: a.row.name, date: `${dayLabel(a.date)} · ${a.loc}`,
          expected: fmtQty(a.row.expectedClosing, a.row.baseUnit), counted: fmtQty(a.row.actualClosing, a.row.baseUnit),
          gap: fmtQty(a.row.varianceQty, a.row.baseUnit), value: round(a.row.varianceValue, 0), sev: a.row.severity,
        })).sort((a, b) => (a.value as number) - (b.value as number)),
      }),
    }
  }

  if (metric === 'purchases') {
    const grns = state.receipts.filter((g) => g.date >= from && g.date <= to && g.status === 'POSTED')
    const bySup = new Map<ID, Level2>()
    const byItem = new Map<ID, { qty: number; value: number; unit: string }>()
    let total = 0
    for (const g of grns) {
      const s = bySup.get(g.supplierId) ?? { key: g.supplierId, name: sup(g.supplierId), value: 0, count: 0 }
      for (const l of g.lines) {
        const acc = Math.max(l.receivedQty - l.damagedQty, 0) * l.rate
        s.value += acc; total += acc
        if (l.damagedQty > 0 || l.receivedQty < l.orderedQty) s.count += 1
        const i = byItem.get(l.itemId) ?? { qty: 0, value: 0, unit: l.unit }
        i.qty += Math.max(l.receivedQty - l.damagedQty, 0); i.value += acc
        byItem.set(l.itemId, i)
      }
      bySup.set(g.supplierId, s)
    }
    return {
      title: 'Purchases', sub: 'accepted into stock, by vendor', total, format: 'money', categoryLabel: 'Vendor',
      categories: [...bySup.values()].map((c) => ({ ...c, hint: c.count ? `${c.count} lines short or refused` : 'no issues' })).sort((a, b) => b.value - a.value),
      byDay: (key) => ({
        columns: [{ key: 'date', label: 'Day', kind: 'text' }, { key: 'n', label: 'Deliveries', kind: 'num' }, { key: 'value', label: 'Accepted', kind: 'money' }, { key: 'lost', label: 'Short / refused', kind: 'money' }],
        rows: rangeDays(from, to).map((date) => {
          const list = grns.filter((g) => g.date === date && (!key || g.supplierId === key))
          let value = 0; let lost = 0
          for (const g of list) for (const l of g.lines) { value += Math.max(l.receivedQty - l.damagedQty, 0) * l.rate; lost += (Math.max(l.orderedQty - l.receivedQty, 0) + l.damagedQty) * l.rate }
          return { date: dayLabel(date), n: list.length, value: round(value, 0), lost: round(lost, 0) }
        }).filter((r) => (r.n as number) > 0).reverse(),
      }),
      byItem: (key) => ({
        columns: [{ key: 'name', label: 'Item', kind: 'text' }, { key: 'qty', label: 'Received', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }, { key: 'rate', label: 'Avg rate', kind: 'money' }],
        itemKey: 'itemId',
        rows: (() => {
          const m = new Map<ID, { qty: number; value: number; unit: string }>()
          for (const g of grns) {
            if (key && g.supplierId !== key) continue
            for (const l of g.lines) { const i = m.get(l.itemId) ?? { qty: 0, value: 0, unit: l.unit }; i.qty += Math.max(l.receivedQty - l.damagedQty, 0); i.value += Math.max(l.receivedQty - l.damagedQty, 0) * l.rate; m.set(l.itemId, i) }
          }
          return [...m.entries()].map(([id, v]) => ({ itemId: id, name: derived.itemById.get(id)?.name ?? id, qty: `${num(v.qty, 2)} ${v.unit}`, value: round(v.value, 0), rate: v.qty ? round(v.value / v.qty, 2) : 0 })).sort((a, b) => (b.value as number) - (a.value as number))
        })(),
      }),
    }
  }

  if (metric === 'stock') {
    const byLoc = new Map<ID, Level2>()
    for (const loc of state.locations) {
      let value = 0; let count = 0
      for (const item of state.items) { const q = derived.balance(item.id, loc.id); if (Math.abs(q) > 0.001) { value += q * item.avgCost; count++ } }
      if (value > 1) byLoc.set(loc.id, { key: loc.id, name: loc.name, value, count, hint: `${count} items` })
    }
    return {
      title: 'Stock on hand', sub: 'at weighted average cost, by location', total: derived.stockValue, format: 'money', categoryLabel: 'Location',
      categories: [...byLoc.values()].sort((a, b) => b.value - a.value),
      byDay: (key) => ({
        columns: [{ key: 'name', label: 'Category', kind: 'text' }, { key: 'items', label: 'Items', kind: 'num' }, { key: 'value', label: 'Value', kind: 'money' }],
        rows: (() => {
          const m = new Map<ID, { items: number; value: number }>()
          for (const item of state.items) {
            const q = key ? derived.balance(item.id, key) : derived.onHand.get(item.id) ?? 0
            if (Math.abs(q) < 0.001) continue
            const c = m.get(item.categoryId) ?? { items: 0, value: 0 }; c.items++; c.value += q * item.avgCost; m.set(item.categoryId, c)
          }
          return [...m.entries()].map(([id, v]) => ({ name: cat(id), items: v.items, value: round(v.value, 0) })).sort((a, b) => (b.value as number) - (a.value as number))
        })(),
      }),
      byItem: (key) => ({
        columns: [{ key: 'name', label: 'Item', kind: 'text' }, { key: 'onHand', label: 'On hand', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }],
        itemKey: 'itemId',
        rows: state.items.map((item) => {
          const q = key ? derived.balance(item.id, key) : derived.onHand.get(item.id) ?? 0
          return { itemId: item.id, name: item.name, onHand: fmtQty(q, item.baseUnit), value: round(q * item.avgCost, 0), q }
        }).filter((r) => Math.abs(r.q as number) > 0.001).sort((a, b) => (b.value as number) - (a.value as number)),
      }),
    }
  }

  // wastage
  const rows = state.wastage.filter((w) => w.date >= from && w.date <= to).map((w) => {
    const item = derived.itemById.get(w.itemId)
    return { w, item, value: item ? w.qtyBase * item.avgCost : 0 }
  })
  const byReason = new Map<string, Level2>()
  for (const r of rows) { const c = byReason.get(r.w.reason) ?? { key: r.w.reason, name: r.w.reason.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase()), value: 0, count: 0 }; c.value += r.value; c.count++; byReason.set(r.w.reason, c) }
  return {
    title: 'Wastage', sub: 'logged by the kitchen, by reason', total: rows.reduce((s, r) => s + r.value, 0), format: 'money', categoryLabel: 'Reason',
    categories: [...byReason.values()].map((c) => ({ ...c, hint: `${c.count} entries` })).sort((a, b) => b.value - a.value),
    byDay: (key) => ({
      columns: [{ key: 'date', label: 'Day', kind: 'text' }, { key: 'n', label: 'Entries', kind: 'num' }, { key: 'value', label: 'Value', kind: 'money' }],
      rows: rangeDays(from, to).map((date) => { const l = rows.filter((r) => r.w.date === date && (!key || r.w.reason === key)); return { date: dayLabel(date), n: l.length, value: round(l.reduce((s, r) => s + r.value, 0), 0) } }).filter((r) => (r.n as number) > 0).reverse(),
    }),
    byItem: (key) => ({
      columns: [{ key: 'name', label: 'Item', kind: 'text' }, { key: 'qty', label: 'Wasted', kind: 'text' }, { key: 'value', label: 'Value', kind: 'money' }, { key: 'by', label: 'Logged by', kind: 'text' }],
      itemKey: 'itemId',
      rows: rows.filter((r) => !key || r.w.reason === key).map((r) => ({ itemId: r.w.itemId, name: r.item?.name ?? '', qty: r.item ? fmtQty(r.w.qtyBase, r.item.baseUnit) : '', value: round(r.value, 0), by: r.w.byStaffId ? derived.staffById.get(r.w.byStaffId)?.name.split(' ')[0] ?? '' : '', date: r.w.date })).sort((a, b) => (b.value as number) - (a.value as number)),
    }),
  }
}

/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const { state, derived, user } = useLedger()
  const navigate = useNavigate()
  const [range, setRange] = useState<Range>('mtd')
  const [metric, setMetric] = useState<Metric | null>(null)

  const today = derived.today
  const from = range === 'today' ? today : range === '7' ? addDays(today, -6) : range === '30' ? addDays(today, -29) : `${monthKey(today)}-01`
  const rangeLabel = range === 'today' ? 'today' : range === '7' ? 'last 7 days' : range === '30' ? 'last 30 days' : 'this month'

  const numbers = useMemo(() => {
    const sales = dishPerformance(derived.ctx, state.dishes, filterSales(state.sales, from, today))
    const pnl = pnlSeries({ ctx: derived.ctx, dishes: state.dishes, sales: state.sales, movements: state.movements, items: state.items, staff: state.staff, from, to: today, groupBy: 'month' })
    const rev = pnl.reduce((s, p) => s + p.netRevenue, 0)
    const food = pnl.reduce((s, p) => s + p.actualFoodCost, 0)
    // Every count in the period, not just the latest one: a partial five-item
    // count on a Monday must not make Sunday's full count disappear.
    let short = 0; let over = 0; let lastCount: string | null = null
    for (const t of state.stocktakes.filter((s) => s.status === 'POSTED' && s.date >= from && s.date <= today)) {
      const history = state.stocktakes.filter((s) => s.locationId === t.locationId && s.date < t.date).map((s) => ({ date: s.date, rows: new Map<ID, number>() }))
      const s = summarise(computeVariance({ items: state.items, categories: state.categories, movements: state.movements, stocktake: t, history }))
      short += Math.abs(s.negativeLeak); over += s.critical + s.high
      if (!lastCount || t.date > lastCount) lastCount = t.date
    }
    const purchases = state.receipts.filter((g) => g.date >= from && g.date <= today).reduce((s, g) => s + g.lines.reduce((t, l) => t + Math.max(l.receivedQty - l.damagedQty, 0) * l.rate, 0), 0)
    const wastage = state.wastage.filter((w) => w.date >= from && w.date <= today).reduce((s, w) => { const i = derived.itemById.get(w.itemId); return s + (i ? w.qtyBase * i.avgCost : 0) }, 0)
    return { sales, rev, food, fcPct: rev ? (food / rev) * 100 : 0, short, over, lastCount, purchases, wastage }
  }, [state, derived, from, today])

  const open = derived.openAlerts
  const sev = { CRITICAL: open.filter((a) => a.severity === 'CRITICAL').length, HIGH: open.filter((a) => a.severity === 'HIGH').length, WATCH: open.filter((a) => a.severity === 'WATCH').length }
  const dayOpen = state.dayCloses.find((d) => d.date === today && d.status !== 'CLOSED')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <>
      <PageHead
        title={`${greeting}, ${user?.name.split(' ')[0] ?? ''}`}
        sub="Six numbers. Tap any of them to see what is behind it."
        actions={<Pills value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: '7', label: '7 days' }, { value: 'mtd', label: 'This month' }, { value: '30', label: '30 days' }]} />}
      />

      <button className="alert-strip" onClick={() => navigate('/alerts')}>
        <span className="n" style={{ color: open.length ? 'var(--neg)' : 'var(--pos)' }}>{open.length}</span>
        <span className="strip-text">
          <span style={{ fontWeight: 600 }}>{open.length ? 'need attention' : 'nothing needs attention'}</span>
          <span className="dim" style={{ display: 'block', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {open.length ? `${moneyShort(open.reduce((s, a) => s + a.impact, 0))} at stake · top: ${open[0].title}` : 'counts, deliveries and stock are all in order'}
          </span>
        </span>
        <span className="strip-pills">
          {sev.CRITICAL > 0 && <span className="sev-pill" style={{ background: 'var(--neg-soft)', color: 'var(--neg)' }}>{sev.CRITICAL} critical</span>}
          {sev.HIGH > 0 && <span className="sev-pill" style={{ background: 'rgba(240,140,60,0.14)', color: '#f08c3c' }}>{sev.HIGH} high</span>}
          {sev.WATCH > 0 && <span className="sev-pill" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>{sev.WATCH} watch</span>}
          {dayOpen && <span className="sev-pill" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>day still open</span>}
        </span>
        <span className="dim strip-chev">›</span>
      </button>

      <div className="hero-grid">
        <Hero label={`Sales · ${rangeLabel}`} value={moneyShort(numbers.sales.totals.revenue)} ctx={`${num(numbers.sales.totals.covers)} covers · ${money(numbers.sales.totals.avgSpend)} each`} accent="var(--brand)" onClick={() => setMetric('sales')} />
        <Hero label={`Food cost · ${rangeLabel}`} value={pct(numbers.fcPct)} ctx={`${moneyShort(numbers.food)} on ${moneyShort(numbers.rev)} net`} accent={numbers.fcPct > 34 ? 'var(--neg)' : 'var(--pos)'} onClick={() => setMetric('foodcost')} />
        <Hero label={`Counted short · ${rangeLabel}`} value={moneyShort(numbers.short)} ctx={numbers.lastCount ? `${numbers.over} items over tolerance · last counted ${dayLabel(numbers.lastCount)}` : 'no count in this period'} accent="var(--neg)" onClick={() => setMetric('variance')} />
        <Hero label={`Purchases · ${rangeLabel}`} value={moneyShort(numbers.purchases)} ctx={`${state.purchaseOrders.filter((p) => p.status === 'SENT').length} orders waiting for delivery`} accent="var(--info)" onClick={() => setMetric('purchases')} />
        <Hero label="Stock on hand" value={moneyShort(derived.stockValue)} ctx={`${state.locations.length} locations`} accent="var(--purple)" onClick={() => setMetric('stock')} />
        <Hero label={`Wastage · ${rangeLabel}`} value={moneyShort(numbers.wastage)} ctx={`${pct(numbers.rev ? (numbers.wastage / numbers.rev) * 100 : 0, 2)} of sales`} accent="var(--warn)" onClick={() => setMetric('wastage')} />
      </div>

      {metric && <DrillModal metric={metric} from={from} to={today} onClose={() => setMetric(null)} />}
    </>
  )
}

function Hero({ label, value, ctx, accent, onClick }: { label: string; value: string; ctx: string; accent: string; onClick: () => void }) {
  return (
    <button className="hero" onClick={onClick}>
      <span className="accent" style={{ background: accent }} />
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
      <span className="ctx">{ctx}</span>
      <span className="more">more ›</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */

function DrillModal({ metric, from, to, onClose }: { metric: Metric; from: string; to: string; onClose: () => void }) {
  const { state, derived } = useLedger()
  const drill = useMemo(() => buildDrill(metric, state, derived, from, to), [metric, state, derived, from, to])
  const [category, setCategory] = useState<string | null>(null)
  const [view, setView] = useState<'day' | 'item'>('item')
  const [drillItem, setDrillItem] = useState<ID | null>(null)

  const table = view === 'day' ? drill.byDay(category) : drill.byItem(category)
  const itemKey = view === 'item' ? drill.byItem(category).itemKey : undefined
  const fmtTotal = drill.format === 'pct' ? pct(drill.total) : moneyShort(drill.total)
  const catName = category ? drill.categories.find((c) => c.key === category)?.name : null

  return (
    <Modal
      title={catName ? `${drill.title} › ${catName}` : drill.title}
      sub={`${drill.sub} · ${dayLabel(from)} to ${dayLabel(to)} · ${fmtTotal}`}
      size="wide" onClose={onClose}
      footer={
        <>
          {category && <button className="btn" onClick={() => setCategory(null)}>‹ Back to {plural(drill.categoryLabel)}</button>}
          <span className="grow" />
          <button className="btn" onClick={() => downloadText(`${drill.title.toLowerCase().replace(/\s+/g, '-')}-${from}-${to}.csv`, toCsv(table.rows.map((r) => Object.fromEntries(table.columns.map((c) => [c.label, r[c.key]])))))}>Export CSV</button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      {!category ? (
        <>
          <div className="dim" style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>BY {drill.categoryLabel.toUpperCase()} — tap one to see every row behind it</div>
          {drill.categories.length === 0 ? <Empty icon="📊" title="Nothing in this period" /> : (
            <div className="stack" style={{ gap: 8 }}>
              {drill.categories.map((c, i) => (
                <button key={c.key} className="drill-row" style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', width: '100%', textAlign: 'left', color: 'inherit' }} onClick={() => setCategory(c.key)}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span className="num">{moneyShort(c.value)}<span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>{c.hint}</span></span>
                    </div>
                    <Bar value={c.value} max={drill.categories[0].value} color={PALETTE[i % PALETTE.length]} />
                  </div>
                  <span className="dim">›</span>
                </button>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setCategory('__all__')}>Or see every row without picking a {drill.categoryLabel.toLowerCase()} ›</button>
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <Pills value={view} onChange={setView} options={[{ value: 'item', label: metric === 'stock' ? 'By item' : metric === 'sales' ? 'By dish' : 'By item' }, { value: 'day', label: metric === 'stock' ? 'By category' : 'By day' }]} />
            <span className="dim" style={{ fontSize: 12 }}>{table.rows.length} rows</span>
          </div>
          <div className="table-wrap scroll-y mh-560">
            <table className="tbl compact">
              <thead><tr>{table.columns.map((c) => <th key={c.key} className={c.kind === 'text' || c.kind === 'sev' ? '' : 'num'}>{c.label}</th>)}</tr></thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className={itemKey && r[itemKey] ? 'clickable' : ''} onClick={() => itemKey && r[itemKey] && setDrillItem(String(r[itemKey]))}>
                    {table.columns.map((c) => <td key={c.key} className={cellClass(c, r[c.key])}>{cell(c, r[c.key])}</td>)}
                  </tr>
                ))}
                {!table.rows.length && <tr><td colSpan={table.columns.length}><Empty icon="📊" title="Nothing here" /></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {drillItem && <ItemDrawer itemId={drillItem} onClose={() => setDrillItem(null)} />}
    </Modal>
  )
}

function plural(label: string): string {
  const l = label.toLowerCase()
  return l.endsWith('y') ? `${l.slice(0, -1)}ies` : `${l}s`
}

function cellClass(c: Col, v: string | number | undefined): string {
  if (c.kind === 'text' || c.kind === 'sev') return c.key === 'name' ? 'tbl-name' : 'dim'
  if (c.kind === 'money' && typeof v === 'number' && v < 0) return 'num neg'
  return 'num'
}
function cell(c: Col, v: string | number | undefined) {
  if (v === undefined || v === null) return '—'
  if (c.kind === 'money') return money(Number(v))
  if (c.kind === 'pct') return pct(Number(v))
  if (c.kind === 'num') return num(Number(v))
  if (c.kind === 'sev') return <SeverityBadge severity={v as Severity} />
  return String(v)
}

export { Badge }
