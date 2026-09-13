import { useMemo, useRef, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, Empty, Field, Modal, Pills, Search, Tile, useToast } from '../components/ui'
import { Bars, ComboBarLine, Donut, PALETTE, TrendArea } from '../components/charts'
import { PeriodPills, usePeriod } from './shared'
import { uid } from '../data/commands'
import { addDays, dayLabel, dow, longDate, rangeDays } from '../core/dates'
import { costDish } from '../core/costing'
import { dishPerformance, filterSales, seriesForRange } from '../core/analytics'
import { round } from '../core/units'
import { downloadText, money, moneyShort, num, pct, toCsv } from '../lib/format'
import type { ID, OrderChannel, SalesDay, SalesLine } from '../core/types'

const CHANNELS: { value: OrderChannel; label: string }[] = [
  { value: 'DINE_IN', label: 'Dine-in' },
  { value: 'TAKEAWAY', label: 'Takeaway' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'AGGREGATOR', label: 'Aggregator' },
]

export default function Sales() {
  return (
    <Routes>
      <Route path="entry" element={<SalesEntry />} />
      <Route path="import" element={<PosImport />} />
      <Route path="register" element={<Register />} />
      <Route path="dishes" element={<DishPerformance />} />
      <Route path="*" element={<Register />} />
    </Routes>
  )
}

/* ================================================================== */
/* Daily sales entry                                                   */
/* ================================================================== */

function SalesEntry() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const [date, setDate] = useState(derived.today)
  const [channel, setChannel] = useState<OrderChannel>('DINE_IN')
  const [covers, setCovers] = useState('')
  const [quantities, setQuantities] = useState<Record<ID, string>>({})
  const [categoryId, setCategoryId] = useState<ID | ''>('')

  const existing = state.sales.find((s) => s.date === date && s.channel === channel)

  const menuCats = state.categories.filter((c) => c.kind === 'MENU' && !c.parentId)
  const dishes = useMemo(() => state.dishes
    .filter((d) => d.active && (!categoryId || d.categoryId === categoryId))
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.name.localeCompare(b.name)),
    [state.dishes, categoryId])

  /** Same weekday over the last six weeks predicts a restaurant far better than a flat mean. */
  const typical = useMemo(() => {
    const target = dow(date)
    const sameDay = state.sales.filter(
      (s) => s.channel === channel && s.date < date && dow(s.date) === target && s.status === 'POSTED',
    ).slice(-6)
    const m = new Map<ID, number>()
    for (const day of sameDay) {
      for (const line of day.lines) m.set(line.dishId, (m.get(line.dishId) ?? 0) + line.qty)
    }
    const n = sameDay.length || 1
    for (const [k, v] of m) m.set(k, Math.round(v / n))
    return { map: m, samples: sameDay.length, covers: Math.round(sameDay.reduce((s, d) => s + d.covers, 0) / n) }
  }, [state.sales, channel, date])

  const totals = useMemo(() => {
    let gross = 0
    let plates = 0
    let foodCost = 0
    for (const dish of state.dishes) {
      const q = Number(quantities[dish.id]) || 0
      if (!q) continue
      gross += q * dish.price
      plates += q
      foodCost += costDish(derived.ctx, dish, true).foodCost * q
    }
    return { gross, plates, foodCost, fcPct: gross ? (foodCost / (gross / 1.05)) * 100 : 0 }
  }, [quantities, state.dishes, derived.ctx])

  const prefill = () => {
    const next: Record<ID, string> = {}
    for (const [dishId, q] of typical.map) if (q > 0) next[dishId] = String(q)
    setQuantities(next)
    setCovers(String(typical.covers || ''))
  }

  const post = async () => {
    const lines: SalesLine[] = []
    for (const dish of state.dishes) {
      const q = Number(quantities[dish.id]) || 0
      if (!q) continue
      lines.push({
        id: uid('sl'), dishId: dish.id, qty: q,
        grossAmount: round(q * dish.price, 2), discount: 0,
        chefId: dish.sectionId
          ? state.staff.find((s) => s.sectionId === dish.sectionId && (s.role === 'HEAD_CHEF' || s.role === 'CHEF'))?.id ?? null
          : null,
      })
    }
    if (!lines.length) return
    const day: SalesDay = {
      id: existing?.id ?? uid('sal'), date, channel, lines,
      covers: Number(covers) || 0, status: 'POSTED', source: 'MANUAL',
      createdAt: new Date().toISOString(),
    }
    if (existing) await actions.voidDocument('SALES', existing.id)
    await actions.postSales(day)
    push({
      kind: 'ok', title: existing ? 'Sales replaced' : 'Sales posted',
      msg: `${lines.length} dishes · ${money(totals.gross)} · recipes deducted from kitchen stock`,
    })
    setQuantities({})
    setCovers('')
  }

  return (
    <>
      <PageHead
        title="Daily Sales Entry"
        sub="Enter what sold. Posting deducts every ingredient the recipes call for from kitchen stock — that theoretical usage is what the physical count is measured against."
        actions={
          <>
            <input className="input" style={{ width: 160 }} type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
            <Pills value={channel} onChange={setChannel} options={CHANNELS} />
          </>
        }
      />

      {existing && (
        <Card style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{longDate(date)} · {CHANNELS.find((c) => c.value === channel)?.label} is already posted</strong>
              <div className="dim" style={{ fontSize: 12.5 }}>
                {existing.lines.reduce((s, l) => s + l.qty, 0)} plates · {money(existing.lines.reduce((s, l) => s + l.grossAmount, 0))}.
                Posting again reverses the old entry first.
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => {
              const next: Record<ID, string> = {}
              for (const l of existing.lines) next[l.dishId] = String(l.qty)
              setQuantities(next)
              setCovers(String(existing.covers))
            }}>Load it for editing</button>
          </div>
        </Card>
      )}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Plates entered" value={num(totals.plates)} foot={`${Object.values(quantities).filter(Boolean).length} dishes`} />
        <Tile label="Gross value" value={moneyShort(totals.gross)} accent="var(--brand)"
          foot={covers ? `${money(totals.gross / (Number(covers) || 1))} per cover` : 'enter covers'} />
        <Tile label="Recipe food cost" value={moneyShort(totals.foodCost)} foot={pct(totals.fcPct)}
          accent={totals.fcPct > 35 ? 'var(--warn)' : 'var(--pos)'} />
        <Tile label="Typical for a" value={new Date(date).toLocaleDateString('en-IN', { weekday: 'long' })}
          foot={typical.samples ? `${typical.samples} past ${new Date(date).toLocaleDateString('en-IN', { weekday: 'short' })}s` : 'no history yet'} />
      </div>

      <Card
        title="Dishes sold"
        sub="Pick a category to narrow the list. Blank means none sold."
        actions={
          <>
            <select className="select" style={{ width: 190 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {menuCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-sm" onClick={prefill} disabled={!typical.samples}>
              Prefill from typical {new Date(date).toLocaleDateString('en-IN', { weekday: 'short' })}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setQuantities({})}>Clear</button>
          </>
        }
        flush
      >
        <div className="table-wrap">
          <table className="tbl compact">
            <thead>
              <tr><th>Dish</th><th>Category</th><th className="num">Price</th><th style={{ width: 120 }}>Qty sold</th>
                <th className="num">Typical</th><th className="num">Value</th><th className="num">Contribution</th></tr>
            </thead>
            <tbody>
              {dishes.map((dish) => {
                const q = Number(quantities[dish.id]) || 0
                const c = costDish(derived.ctx, dish, true)
                return (
                  <tr key={dish.id}>
                    <td className="tbl-name">{dish.name}</td>
                    <td className="dim">{derived.categoryById.get(dish.categoryId)?.name}</td>
                    <td className="num dim">{money(dish.price)}</td>
                    <td>
                      <input
                        className="input num" type="number" min={0} inputMode="numeric"
                        value={quantities[dish.id] ?? ''} placeholder="0"
                        onChange={(e) => setQuantities({ ...quantities, [dish.id]: e.target.value })}
                      />
                    </td>
                    <td className="num dim">{typical.map.get(dish.id) ?? '—'}</td>
                    <td className="num">{q ? money(q * dish.price) : <span className="dim">—</span>}</td>
                    <td className="num pos">{q ? money(q * c.contribution) : <span className="dim">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="sticky-actions">
        <div className="row" style={{ gap: 14 }}>
          <Field label="Covers" style={{ maxWidth: 110 }}>
            <input className="input num" type="number" value={covers} onChange={(e) => setCovers(e.target.value)} />
          </Field>
          <span><span className="dim">Plates </span><span className="num">{num(totals.plates)}</span></span>
          <span><span className="dim">Value </span><span className="num">{money(totals.gross)}</span></span>
        </div>
        <button className="btn btn-primary" disabled={!totals.plates} onClick={post}>
          {existing ? 'Replace posted sales' : 'Post sales & deplete stock'}
        </button>
      </div>
    </>
  )
}

/* ================================================================== */
/* POS import                                                          */
/* ================================================================== */

function PosImport() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [date, setDate] = useState(derived.today)
  const [channel, setChannel] = useState<OrderChannel>('DINE_IN')

  const parsed = useMemo(() => {
    if (!text.trim()) return []
    const rows = text.trim().split(/\r?\n/)
    const out: { raw: string; name: string; qty: number; amount: number | null; dishId: ID | null }[] = []
    for (const [i, row] of rows.entries()) {
      const cells = row.split(/[,\t;|]/).map((c) => c.trim().replace(/^"|"$/g, ''))
      if (cells.length < 2) continue
      // Skip a header row if the second column is not numeric.
      if (i === 0 && Number.isNaN(Number(cells[1]))) continue
      const name = cells[0]
      const qty = Number(cells[1])
      const amount = cells[2] !== undefined ? Number(cells[2].replace(/[₹,]/g, '')) : null
      if (!name || !Number.isFinite(qty) || qty <= 0) continue
      const key = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      const dish = state.dishes.find((d) => {
        const dk = d.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
        return dk === key || dk.includes(key) || key.includes(dk) || d.code.toLowerCase() === key
      })
      out.push({ raw: row, name, qty, amount: Number.isFinite(amount ?? NaN) ? amount : null, dishId: dish?.id ?? null })
    }
    return out
  }, [text, state.dishes])

  const matched = parsed.filter((p) => p.dishId)
  const unmatched = parsed.filter((p) => !p.dishId)
  const total = matched.reduce((s, p) => {
    const dish = p.dishId ? derived.dishById.get(p.dishId) : null
    return s + (p.amount ?? (dish ? dish.price * p.qty : 0))
  }, 0)

  const post = async () => {
    const lines: SalesLine[] = matched.map((p) => {
      const dish = derived.dishById.get(p.dishId!)!
      return {
        id: uid('sl'), dishId: dish.id, qty: p.qty,
        grossAmount: round(p.amount ?? dish.price * p.qty, 2), discount: 0,
        chefId: dish.sectionId
          ? state.staff.find((s) => s.sectionId === dish.sectionId && (s.role === 'HEAD_CHEF' || s.role === 'CHEF'))?.id ?? null
          : null,
      }
    })
    const day: SalesDay = {
      id: uid('sal'), date, channel, lines,
      covers: Math.round(lines.reduce((s, l) => s + l.qty, 0) / 2.5),
      status: 'POSTED', source: 'POS_IMPORT', createdAt: new Date().toISOString(),
    }
    await actions.postSales(day)
    push({ kind: 'ok', title: 'Sales imported', msg: `${lines.length} dishes · ${money(total)}` })
    navigate('/sales/register')
  }

  const sample = 'Chicken Biryani,42,14280\nButter Naan,88,5280\nButter Chicken,31,12090'

  return (
    <>
      <PageHead
        title="Import from POS"
        sub="Any billing system that exports a dish-and-quantity list will do. Paste the rows or drop the CSV in — names are matched to the menu automatically."
        breadcrumb={[{ label: 'Sales' }, { label: 'Import' }]}
      />

      <div className="grid g-1-2">
        <Card title="Source">
          <div className="stack">
            <div className="field-row">
              <Field label="Business date">
                <input className="input" type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Channel">
                <select className="select" value={channel} onChange={(e) => setChannel(e.target.value as OrderChannel)}>
                  {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Paste rows" hint="dish name, quantity, amount — comma or tab separated">
              <textarea className="input" rows={12} value={text} placeholder={sample}
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="row">
              <button className="btn" onClick={() => fileRef.current?.click()}>Choose a CSV file</button>
              <button className="btn btn-ghost" onClick={() => setText(sample)}>Use a sample</button>
              <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) setText(await f.text())
                }} />
            </div>
          </div>
        </Card>

        <Card
          title={`Preview (${matched.length} matched${unmatched.length ? `, ${unmatched.length} not found` : ''})`}
          sub={parsed.length ? `${money(total)} total` : 'nothing parsed yet'}
          flush
          footer={
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="dim" style={{ fontSize: 12 }}>
                Unmatched rows are skipped. Add the dish to the menu first if you need it counted.
              </span>
              <button className="btn btn-primary" disabled={!matched.length} onClick={post}>
                Import {matched.length} lines
              </button>
            </div>
          }
        >
          {!parsed.length ? (
            <Empty icon="📤" title="Nothing to preview">Paste rows on the left.</Empty>
          ) : (
            <div className="table-wrap scroll-y mh-420">
              <table className="tbl compact">
                <thead><tr><th>From the file</th><th>Matched dish</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {parsed.map((p, i) => {
                    const dish = p.dishId ? derived.dishById.get(p.dishId) : null
                    return (
                      <tr key={i}>
                        <td className="mono-sm dim">{p.name}</td>
                        <td>{dish ? dish.name : <Badge kind="critical">not found</Badge>}</td>
                        <td className="num">{num(p.qty)}</td>
                        <td className="num">{p.amount !== null ? money(p.amount) : dish ? <span className="dim">{money(dish.price * p.qty)}</span> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

/* ================================================================== */
/* Sales register                                                      */
/* ================================================================== */

function Register() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(30)
  const [open, setOpen] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, { gross: number; discount: number; plates: number; covers: number; channels: Set<OrderChannel> }>()
    for (const day of filterSales(state.sales, from, to)) {
      const cur = map.get(day.date) ?? { gross: 0, discount: 0, plates: 0, covers: 0, channels: new Set<OrderChannel>() }
      cur.covers += day.covers
      cur.channels.add(day.channel)
      for (const l of day.lines) {
        cur.gross += l.grossAmount
        cur.discount += l.discount
        cur.plates += l.qty
      }
      map.set(day.date, cur)
    }
    return [...map.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => b.date.localeCompare(a.date))
  }, [state.sales, from, to])

  const trend = useMemo(
    () => seriesForRange(state.sales, from, to, (d) => d.lines.reduce((s, l) => s + l.grossAmount - l.discount, 0))
      .map((p) => ({ label: dayLabel(p.date), value: p.value })),
    [state.sales, from, to],
  )

  const byChannel = useMemo(() => {
    const m = new Map<OrderChannel, number>()
    for (const d of filterSales(state.sales, from, to)) {
      m.set(d.channel, (m.get(d.channel) ?? 0) + d.lines.reduce((s, l) => s + l.grossAmount - l.discount, 0))
    }
    return [...m.entries()].map(([k, v], i) => ({
      name: CHANNELS.find((c) => c.value === k)?.label ?? k, value: v, color: PALETTE[i],
    }))
  }, [state.sales, from, to])

  const totals = byDay.reduce((s, d) => ({
    gross: s.gross + d.gross, discount: s.discount + d.discount,
    plates: s.plates + d.plates, covers: s.covers + d.covers,
  }), { gross: 0, discount: 0, plates: 0, covers: 0 })

  const detail = open ? state.sales.filter((s) => s.date === open) : []

  return (
    <>
      <PageHead
        title="Sales Register"
        sub="Day by day, channel by channel. Click a day to see exactly what sold."
        actions={
          <>
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn" onClick={() => downloadText(`sales-${from}-to-${to}.csv`, toCsv(byDay.map((d) => ({
              Date: d.date, Gross: round(d.gross, 2), Discount: round(d.discount, 2),
              Net: round(d.gross - d.discount, 2), Plates: d.plates, Covers: d.covers,
            }))))}>Export CSV</button>
            <button className="btn btn-primary" onClick={() => navigate('/sales/entry')}>+ Enter sales</button>
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <Tile label="Gross sales" value={moneyShort(totals.gross)} foot={`${days} days`} accent="var(--brand)" />
        <Tile label="Discounts" value={moneyShort(totals.discount)}
          foot={pct(totals.gross ? (totals.discount / totals.gross) * 100 : 0)} accent="var(--warn)" />
        <Tile label="Net sales" value={moneyShort(totals.gross - totals.discount)} accent="var(--pos)" foot="after discount" />
        <Tile label="Covers" value={num(totals.covers)} foot={`${money(totals.covers ? totals.gross / totals.covers : 0)} average`} />
        <Tile label="Plates" value={num(totals.plates)}
          foot={`${(totals.covers ? totals.plates / totals.covers : 0).toFixed(1)} per cover`} />
      </div>

      <div className="grid g-3-2" style={{ marginBottom: 14 }}>
        <Card title="Net sales by day">
          <TrendArea data={trend} xKey="label" series={[{ key: 'value', name: 'Net sales' }]} height={230} />
        </Card>
        <Card title="By channel" sub="net of discount">
          <Donut data={byChannel} height={200} />
          <table className="tbl compact" style={{ marginTop: 6 }}>
            <tbody>
              {byChannel.sort((a, b) => b.value - a.value).map((c) => (
                <tr key={c.name}>
                  <td><span className="dot" style={{ background: c.color, marginRight: 7 }} />{c.name}</td>
                  <td className="num">{moneyShort(c.value)}</td>
                  <td className="num dim">{pct(totals.gross ? (c.value / (totals.gross - totals.discount)) * 100 : 0, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card flush>
        <div className="table-wrap scroll-y mh-560">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th className="num">Gross</th><th className="num">Discount</th><th className="num">Net</th>
                <th className="num">Plates</th><th className="num">Covers</th><th className="num">Avg spend</th><th>Channels</th><th /></tr>
            </thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.date} className="clickable" onClick={() => setOpen(d.date)}>
                  <td className="nowrap">{dayLabel(d.date)}<span className="dim"> {new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}</span></td>
                  <td className="num">{money(d.gross)}</td>
                  <td className="num dim">{money(d.discount)}</td>
                  <td className="num">{money(d.gross - d.discount)}</td>
                  <td className="num">{num(d.plates)}</td>
                  <td className="num">{num(d.covers)}</td>
                  <td className="num">{money(d.covers ? d.gross / d.covers : 0)}</td>
                  <td className="dim">{d.channels.size}</td>
                  <td className="right dim">›</td>
                </tr>
              ))}
              {!byDay.length && <tr><td colSpan={9}><Empty icon="💳" title="No sales in this period" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {open && detail.length > 0 && (
        <Modal title={longDate(open)} sub={`${detail.length} channels posted`} size="wide" onClose={() => setOpen(null)}>
          {detail.map((day) => (
            <Card key={day.id} title={CHANNELS.find((c) => c.value === day.channel)?.label}
              sub={`${day.covers} covers · ${day.source === 'SEED' ? 'demo data' : day.source === 'POS_IMPORT' ? 'imported' : 'entered manually'}`}
              flush style={{ marginBottom: 12 }}>
              <table className="tbl compact">
                <thead><tr><th>Dish</th><th className="num">Qty</th><th className="num">Gross</th><th className="num">Discount</th><th>Chef</th></tr></thead>
                <tbody>
                  {[...day.lines].sort((a, b) => b.grossAmount - a.grossAmount).map((l) => (
                    <tr key={l.id}>
                      <td>{derived.dishById.get(l.dishId)?.name}</td>
                      <td className="num">{num(l.qty)}</td>
                      <td className="num">{money(l.grossAmount)}</td>
                      <td className="num dim">{money(l.discount)}</td>
                      <td className="dim">{l.chefId ? derived.staffById.get(l.chefId)?.name.split(' ')[0] : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Dish performance                                                    */
/* ================================================================== */

function DishPerformance() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(30)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'contribution' | 'qty' | 'revenue' | 'margin'>('contribution')
  const [focus, setFocus] = useState<ID | null>(null)

  const perf = useMemo(
    () => dishPerformance(derived.ctx, state.dishes, filterSales(state.sales, from, to)),
    [derived.ctx, state.dishes, state.sales, from, to],
  )

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = perf.rows.filter((r) => !term || r.name.toLowerCase().includes(term))
    const key = sort === 'margin' ? 'contributionPerPlate' : sort === 'qty' ? 'qty' : sort === 'revenue' ? 'revenue' : 'contribution'
    return [...list].sort((a, b) => (b as never as Record<string, number>)[key] - (a as never as Record<string, number>)[key])
  }, [perf.rows, search, sort])

  const top = rows.slice(0, 12).map((r) => ({ name: r.name, value: round(r.contribution, 0) })).reverse()

  // Per-dish daily history, so a "best seller" can be checked for a trend.
  const history = useMemo(() => {
    if (!focus) return []
    const dates = rangeDays(from, to)
    const map = new Map<string, { qty: number; revenue: number }>()
    for (const day of filterSales(state.sales, from, to)) {
      for (const l of day.lines) {
        if (l.dishId !== focus) continue
        const cur = map.get(day.date) ?? { qty: 0, revenue: 0 }
        cur.qty += l.qty
        cur.revenue += l.grossAmount - l.discount
        map.set(day.date, cur)
      }
    }
    return dates.map((d) => ({ label: dayLabel(d), qty: map.get(d)?.qty ?? 0, revenue: round(map.get(d)?.revenue ?? 0, 0) }))
  }, [focus, state.sales, from, to])

  const focusRow = rows.find((r) => r.dishId === focus)

  return (
    <>
      <PageHead
        title="Dish Performance"
        sub={`Best sellers and what each one actually earns, over the last ${days} days. Click a dish for its daily trend.`}
        actions={
          <>
            <Search value={search} onChange={setSearch} />
            <Pills value={sort} onChange={setSort} options={[
              { value: 'contribution', label: 'Contribution' },
              { value: 'qty', label: 'Plates' },
              { value: 'revenue', label: 'Revenue' },
              { value: 'margin', label: 'Per plate' },
            ]} />
            <PeriodPills days={days} setDays={setDays} />
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <Tile label="Dishes sold" value={num(perf.totals.dishes)} foot={`${rows.length} on the menu`} />
        <Tile label="Revenue" value={moneyShort(perf.totals.revenue)} accent="var(--brand)" foot="gross" />
        <Tile label="Food cost" value={pct(perf.totals.foodCostPct)} foot={moneyShort(perf.totals.foodCost)}
          accent={perf.totals.foodCostPct > 34 ? 'var(--warn)' : 'var(--pos)'} />
        <Tile label="Contribution" value={moneyShort(perf.totals.contribution)} accent="var(--pos)"
          foot={pct(perf.totals.netRevenue ? (perf.totals.contribution / perf.totals.netRevenue) * 100 : 0)} />
        <Tile label="Best seller" value={[...rows].sort((a, b) => b.qty - a.qty)[0]?.name ?? '—'}
          foot={`${num([...rows].sort((a, b) => b.qty - a.qty)[0]?.qty ?? 0)} plates`} />
      </div>

      <div className="grid g-3-2" style={{ marginBottom: 14 }}>
        <Card title="Top contributors" sub="total contribution over the period, not revenue">
          <Bars data={top} xKey="name" series={[{ key: 'value', name: 'Contribution' }]} horizontal height={330}
            onClick={(row) => { const r = rows.find((x) => x.name === row?.name); if (r) setFocus(r.dishId) }} />
        </Card>
        <Card
          title={focusRow ? focusRow.name : 'Pick a dish'}
          sub={focusRow ? `${num(focusRow.qty)} plates · ${money(focusRow.contributionPerPlate)} per plate` : 'click a bar or a row'}
          actions={focusRow && <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/menu/costing?dish=${focusRow.dishId}`)}>Costing →</button>}
        >
          {focusRow ? (
            <>
              <ComboBarLine data={history} xKey="label" height={210}
                bars={[{ key: 'revenue', name: 'Revenue', color: 'rgba(232,145,58,0.7)' }]}
                lines={[]} barFormat="money" />
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Revenue</dt><dd>{money(focusRow.revenue)}</dd>
                <dt>Food cost</dt><dd className="neg">−{money(focusRow.foodCost)}</dd>
                <dt>Contribution</dt><dd className="pos">{money(focusRow.contribution)}</dd>
                <dt>Food cost %</dt><dd>{pct(focusRow.foodCostPct)}</dd>
                <dt>Share of revenue</dt><dd>{pct(focusRow.share)}</dd>
              </dl>
            </>
          ) : (
            <Empty icon="⭐" title="No dish selected" />
          )}
        </Card>
      </div>

      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Dish</th><th>Category</th><th className="num">Plates</th><th className="num">Revenue</th>
                <th className="num">Food cost</th><th className="num">Per plate</th><th className="num">Contribution</th>
                <th className="num">FC %</th><th className="num">Share</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.dishId} className={`clickable${focus === r.dishId ? ' sev-WATCH' : ''}`} onClick={() => setFocus(r.dishId)}>
                  <td><span className={`rank${i < 3 ? ' top' : ''}`}>{i + 1}</span></td>
                  <td className="tbl-name">{r.name}</td>
                  <td className="dim">{derived.categoryById.get(r.categoryId)?.name}</td>
                  <td className="num">{num(r.qty)}</td>
                  <td className="num">{money(r.revenue)}</td>
                  <td className="num dim">{money(r.foodCost)}</td>
                  <td className="num">{money(r.contributionPerPlate)}</td>
                  <td className="num pos">{money(r.contribution)}</td>
                  <td className="num"><span className={r.foodCostPct > 40 ? 'neg' : r.foodCostPct > 33 ? 'warn' : 'pos'}>{pct(r.foodCostPct)}</span></td>
                  <td className="num dim">{pct(r.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
