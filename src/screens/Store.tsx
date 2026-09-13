import { useMemo, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, CascadeSelect, Empty, Field, Modal, Search, Tile, useToast } from '../components/ui'
import { Bars } from '../components/charts'
import { ItemDrawer, PeriodPills, StockTable, usePeriod } from './shared'
import { StocktakeSheet } from './Stocktake'
import { uid } from '../data/commands'
import { addDays, dayLabel, longDate } from '../core/dates'
import { costRecipe } from '../core/costing'
import { round } from '../core/units'
import { money, moneyShort, num, pct, qty as fmtQty } from '../lib/format'
import type { ID, Issue, PurchaseBill } from '../core/types'

export default function Store() {
  return (
    <Routes>
      <Route path="receipts" element={<Receipts />} />
      <Route path="stock" element={<StoreStock />} />
      <Route path="issue" element={<IssueForm />} />
      <Route path="stocktake" element={
        <StocktakeSheet
          locationId="loc_store" title="Store Stocktake"
          sub="Count the store shelves. Differences here point at receiving errors or stock leaving without an issue note."
        />
      } />
      <Route path="*" element={<StoreStock />} />
    </Routes>
  )
}

/* ================================================================== */
/* Goods receipt                                                       */
/* ================================================================== */

function Receipts() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(30)
  const [opening, setOpening] = useState(false)
  const [drill, setDrill] = useState<ID | null>(null)

  const receipts = useMemo(() => state.movements
    .filter((m) => m.type === 'RECEIPT' && m.date >= from && m.date <= to)
    .sort((a, b) => b.ts.localeCompare(a.ts)), [state.movements, from, to])

  const totals = useMemo(() => {
    const byDay = new Map<string, number>()
    const byLocation = new Map<ID, number>()
    for (const m of receipts) {
      byDay.set(m.date, (byDay.get(m.date) ?? 0) + m.value)
      byLocation.set(m.locationId, (byLocation.get(m.locationId) ?? 0) + m.value)
    }
    return {
      value: receipts.reduce((s, m) => s + m.value, 0),
      lines: receipts.length,
      byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({ label: dayLabel(date), value: round(v, 0) })),
      byLocation: [...byLocation.entries()].map(([id, v]) => ({ name: derived.locationById.get(id)?.name ?? id, value: v })),
    }
  }, [receipts, derived.locationById])

  return (
    <>
      <PageHead
        title="Goods Receipt"
        sub="Everything that has come into the building. Posting a purchase bill puts the stock here automatically — use the manual entry below only when goods arrive ahead of the paperwork."
        actions={
          <>
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn" onClick={() => setOpening(true)}>Receive without a bill</button>
            <button className="btn btn-primary" onClick={() => navigate('/purchase/upload')}>+ Post a bill</button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Received" value={moneyShort(totals.value)} foot={`${totals.lines} receipt lines`} accent="var(--pos)" />
        <Tile label="Per day" value={moneyShort(totals.value / Math.max(days, 1))} foot="at cost" />
        <Tile label="Store value now" value={moneyShort(state.items.reduce((s, i) => s + derived.balance(i.id, 'loc_store') * i.avgCost, 0))} foot="Main Store" />
        <Tile label="All locations" value={moneyShort(derived.stockValue)} foot="total stock on hand" accent="var(--purple)" />
      </div>

      <div className="grid g-2-1" style={{ marginBottom: 14 }}>
        <Card title="Goods in" sub={`value received per day, last ${days} days`}>
          <Bars data={totals.byDay} xKey="label" series={[{ key: 'value', name: 'Received' }]} height={210} />
        </Card>
        <Card title="Into which location">
          <table className="tbl compact">
            <tbody>
              {totals.byLocation.sort((a, b) => b.value - a.value).map((l) => (
                <tr key={l.name}><td>{l.name}</td><td className="num">{money(l.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Receipt lines" flush>
        <div className="table-wrap scroll-y mh-560">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Item</th><th>Location</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Value</th><th>Source</th></tr></thead>
            <tbody>
              {receipts.slice(0, 300).map((m) => {
                const item = derived.itemById.get(m.itemId)
                const bill = state.bills.find((b) => b.id === m.refId)
                return (
                  <tr key={m.id} className="clickable" onClick={() => setDrill(m.itemId)}>
                    <td className="nowrap dim">{dayLabel(m.date)}</td>
                    <td className="tbl-name">{item?.name}</td>
                    <td className="dim">{derived.locationById.get(m.locationId)?.name}</td>
                    <td className="num pos">+{item ? fmtQty(m.qty, item.baseUnit) : m.qty}</td>
                    <td className="num dim">{item ? money(m.rate * item.purchaseConversion, 2) : money(m.rate, 4)}</td>
                    <td className="num">{money(m.value)}</td>
                    <td className="dim">{bill ? `${derived.supplierById.get(bill.supplierId)?.name} · ${bill.billNo}` : m.note ?? '—'}</td>
                  </tr>
                )
              })}
              {!receipts.length && <tr><td colSpan={7}><Empty icon="📥" title="Nothing received in this period" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {opening && (
        <OpeningEntry
          onClose={() => setOpening(false)}
          onDone={(count, value) => {
            push({ kind: 'ok', title: 'Stock added', msg: `${count} items · ${money(value)} added to the store balance` })
            setOpening(false)
          }}
        />
      )}
      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

/** Receive stock with no bill behind it — an opening balance or a late invoice. */
function OpeningEntry({ onClose, onDone }: { onClose: () => void; onDone: (count: number, value: number) => void }) {
  const { state, derived, actions, user } = useLedger()
  const [locationId, setLocationId] = useState<ID>('loc_store')
  const [date, setDate] = useState(derived.today)
  const [lines, setLines] = useState<{ id: ID; itemId: ID; qty: number; rate: number }[]>([])

  const add = (itemId: ID | null) => {
    if (!itemId || lines.some((l) => l.itemId === itemId)) return
    const item = derived.itemById.get(itemId)
    if (!item) return
    setLines([...lines, {
      id: uid('ol'), itemId, qty: 0,
      rate: round(item.lastPurchaseCost * item.purchaseConversion, 2),
    }])
  }

  const value = lines.reduce((s, l) => {
    const item = derived.itemById.get(l.itemId)
    if (!item) return s
    return s + l.qty * l.rate
  }, 0)

  const post = async () => {
    const usable = lines.filter((l) => l.qty > 0)
    if (!usable.length) return
    // Modelled as a zero-supplier bill so it goes through the same costing path
    // and shows up in the audit trail like any other receipt.
    const bill: PurchaseBill = {
      id: uid('bill'), billNo: `OPEN-${Date.now().toString(36).toUpperCase()}`,
      supplierId: state.suppliers[0]?.id ?? '', billDate: date,
      receivedAt: new Date().toISOString(), locationId,
      lines: usable.map((l) => {
        const item = derived.itemById.get(l.itemId)!
        return {
          id: uid('bl'), itemId: l.itemId, qty: l.qty, unit: item.purchaseUnit,
          rate: l.rate, discount: 0, taxPct: 0,
        }
      }),
      otherCharges: 0, roundOff: 0, status: 'POSTED', entryMode: 'MANUAL',
      enteredBy: user?.id ?? null, notes: 'Received without a bill',
      createdAt: new Date().toISOString(),
    }
    await actions.postBill(bill)
    onDone(usable.length, value)
  }

  return (
    <Modal
      title="Receive stock without a bill" size="wide"
      sub="Use this for an opening balance, or when goods arrive before the invoice does"
      onClose={onClose}
      footer={
        <>
          <span className="dim grow">{lines.length} items · {money(value)}</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!lines.some((l) => l.qty > 0)} onClick={post}>Add to stock</button>
        </>
      }
    >
      <div className="field-row" style={{ marginBottom: 12 }}>
        <Field label="Into location">
          <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Add an item">
        <CascadeSelect
          categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
          items={state.items.filter((i) => i.active)}
          value={null} onChange={add} placeholder="Choose item"
        />
      </Field>
      {lines.length > 0 && (
        <table className="tbl compact" style={{ marginTop: 12 }}>
          <thead><tr><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th><th className="num">Value</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => {
              const item = derived.itemById.get(l.itemId)!
              return (
                <tr key={l.id}>
                  <td>{item.name}</td>
                  <td><input className="input num" type="number" step="any" value={l.qty || ''}
                    onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) || 0 } : x))} /></td>
                  <td className="dim">{item.purchaseUnit}</td>
                  <td><input className="input num" type="number" step="any" value={l.rate || ''}
                    onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, rate: Number(e.target.value) || 0 } : x))} /></td>
                  <td className="num">{money(l.qty * l.rate, 2)}</td>
                  <td><button className="icon-btn" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

/* ================================================================== */
/* Store stock                                                         */
/* ================================================================== */

function StoreStock() {
  const { state, derived } = useLedger()
  const [search, setSearch] = useState('')
  const [locationId, setLocationId] = useState<ID | ''>('')
  const [drill, setDrill] = useState<ID | null>(null)

  const stores = state.locations.filter((l) => l.kind !== 'KITCHEN')

  return (
    <>
      <PageHead
        title="Store Stock"
        sub="Everything held in the stores and cold rooms, valued at weighted average cost."
        actions={
          <>
            <select className="select" style={{ width: 180 }} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All store locations</option>
              {stores.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <Search value={search} onChange={setSearch} />
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        {stores.map((loc) => {
          const value = state.items.reduce((s, i) => s + derived.balance(i.id, loc.id) * i.avgCost, 0)
          const count = state.items.filter((i) => Math.abs(derived.balance(i.id, loc.id)) > 0.001).length
          return (
            <Tile key={loc.id} label={loc.name} value={moneyShort(value)} foot={`${count} items`}
              onClick={() => setLocationId(loc.id)} accent={locationId === loc.id ? 'var(--brand)' : undefined} />
          )
        })}
      </div>

      <Card flush>
        <StockTable locationId={locationId || undefined} search={search} onPick={setDrill} />
      </Card>
      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

/* ================================================================== */
/* Full indent form                                                    */
/* ================================================================== */

function IssueForm() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const [fromLocationId, setFrom] = useState<ID>('loc_store')
  const [toLocationId, setTo] = useState<ID>('loc_kitchen')
  const [date, setDate] = useState(derived.today)
  const [lines, setLines] = useState<{ id: ID; itemId: ID; qty: number; unit: string; from: ID }[]>([])
  const [showSuggest, setShowSuggest] = useState(false)

  const add = (itemId: ID | null) => {
    if (!itemId || lines.some((l) => l.itemId === itemId)) return
    const item = derived.itemById.get(itemId)
    if (!item) return
    // Default each line to the shelf the item actually sits on; the header
    // selector is only a fallback for items with no home.
    setLines([...lines, {
      id: uid('il'), itemId, qty: 0, unit: item.baseUnit,
      from: item.defaultLocationId || fromLocationId,
    }])
  }

  /**
   * What today's menu will actually need, from the recipes and the last few
   * days of sales — so the indent starts from a real number rather than a
   * guess, and the store keeper only adjusts the exceptions.
   */
  const suggestion = useMemo(() => {
    const recent = state.sales.filter((s) => s.date >= addDays(derived.today, -7) && s.status === 'POSTED')
    const perDish = new Map<ID, number>()
    for (const day of recent) {
      for (const line of day.lines) perDish.set(line.dishId, (perDish.get(line.dishId) ?? 0) + line.qty)
    }
    const days = new Set(recent.map((s) => s.date)).size || 1
    const need = new Map<ID, number>()
    for (const [dishId, total] of perDish) {
      for (const l of costRecipe(derived.ctx, 'DISH', dishId, total / days, { explode: false })) {
        need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty)
      }
    }
    return [...need.entries()]
      .map(([itemId, q]) => {
        const item = derived.itemById.get(itemId)
        if (!item || item.isPrep) return null
        const inKitchen = derived.balance(itemId, toLocationId)
        const shortfall = Math.max(q * 1.15 - inKitchen, 0)
        return shortfall > 0 ? { item, need: q, inKitchen, shortfall: round(shortfall, 2) } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.shortfall * b.item.avgCost - a.shortfall * a.item.avgCost)
  }, [state.sales, derived, toLocationId])

  const value = lines.reduce((s, l) => {
    const item = derived.itemById.get(l.itemId)
    return s + (item ? l.qty * item.avgCost : 0)
  }, 0)

  const post = async () => {
    const usable = lines.filter((l) => l.qty > 0)
    if (!usable.length) return
    const issue: Issue = {
      id: uid('iss'), ref: `ISS-${Date.now().toString(36).toUpperCase()}`, date,
      fromLocationId, toLocationId,
      lines: usable.map((l) => ({
        id: l.id, itemId: l.itemId, qty: l.qty, unit: l.unit as never,
        qtyBase: l.qty, fromLocationId: l.from,
      })),
      requestedBy: user?.id ?? null, status: 'POSTED', createdAt: new Date().toISOString(),
    }
    const result = await actions.postIssue(issue)
    push({
      kind: result.warnings.length ? 'warn' : 'ok',
      title: 'Issue posted',
      msg: result.warnings.length ? result.warnings[0] : `${usable.length} items · ${money(value)} moved`,
    })
    setLines([])
  }

  return (
    <>
      <PageHead
        title="Issue to Kitchen"
        sub="The full indent form, with quantities, a source location and an audit trail. For speed during service, Quick Take does the same job in two taps."
        actions={
          <>
            <button className="btn" onClick={() => setShowSuggest(!showSuggest)}>
              {showSuggest ? 'Hide' : 'Suggest'} today’s needs
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/kitchen/quick-take')}>⚡ Quick Take</button>
          </>
        }
      />

      {showSuggest && (
        <Card
          title="What today probably needs" sub="from the last 7 days of sales and the current recipes, less what the kitchen already holds"
          actions={
            <button className="btn btn-sm btn-primary" onClick={() => {
              setLines(suggestion.slice(0, 30).map((s) => ({
                id: uid('il'), itemId: s.item.id, qty: s.shortfall, unit: s.item.baseUnit,
                from: s.item.defaultLocationId || fromLocationId,
              })))
            }}>Fill the indent</button>
          }
          style={{ marginBottom: 14 }}
        >
          <div className="table-wrap scroll-y mh-300">
            <table className="tbl compact">
              <thead><tr><th>Item</th><th className="num">Daily need</th><th className="num">In kitchen</th><th className="num">Suggest</th></tr></thead>
              <tbody>
                {suggestion.slice(0, 20).map((s) => (
                  <tr key={s.item.id} className="clickable" onClick={() => add(s.item.id)}>
                    <td className="tbl-name">{s.item.name}</td>
                    <td className="num dim">{fmtQty(s.need, s.item.baseUnit)}</td>
                    <td className="num dim">{fmtQty(s.inKitchen, s.item.baseUnit)}</td>
                    <td className="num">{fmtQty(s.shortfall, s.item.baseUnit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Indent details">
        <div className="field-row">
          <Field label="Default source" hint="Each line still comes from wherever that item is kept">
            <select className="select" value={fromLocationId} onChange={(e) => setFrom(e.target.value)}>
              {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="To">
            <select className="select" value={toLocationId} onChange={(e) => setTo(e.target.value)}>
              {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Requested by">
            <input className="input" readOnly value={user?.name ?? '—'} />
          </Field>
        </div>
        <hr className="hr" />
        <Field label="Add an item">
          <CascadeSelect
            categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
            items={state.items.filter((i) => i.active)}
            value={null} onChange={add} placeholder="Choose item"
          />
        </Field>
      </Card>

      <Card flush style={{ marginTop: 14 }}>
        {lines.length === 0 ? (
          <Empty icon="📋" title="Nothing on the indent yet">Add items above, or use the suggestion.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Item</th><th style={{ width: 150 }}>From</th><th className="num">Available</th><th className="num" style={{ width: 130 }}>Issue qty</th><th>Unit</th><th className="num">Value</th><th /></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const item = derived.itemById.get(l.itemId)!
                  const available = derived.balance(l.itemId, l.from)
                  const short = l.qty > available
                  return (
                    <tr key={l.id}>
                      <td>
                        <div className="tbl-name">{item.name}</div>
                        <div className="tbl-sub">{item.sku}</div>
                      </td>
                      <td>
                        <select className="select" value={l.from}
                          onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, from: e.target.value } : x))}>
                          {state.locations.filter((loc) => loc.id !== toLocationId).map((loc) => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className={`num ${short ? 'neg' : 'dim'}`}>{fmtQty(available, item.baseUnit)}</td>
                      <td>
                        <input className="input num" type="number" step="any" value={l.qty || ''}
                          onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) || 0 } : x))} />
                      </td>
                      <td className="dim mono-sm">{item.baseUnit === 'unit' ? 'pc' : item.baseUnit}</td>
                      <td className="num">{money(l.qty * item.avgCost)}</td>
                      <td><button className="icon-btn" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="sticky-actions">
        <div className="row" style={{ gap: 16 }}>
          <span><span className="dim">Items </span><span className="num">{lines.filter((l) => l.qty > 0).length}</span></span>
          <span><span className="dim">Value </span><span className="num">{money(value)}</span></span>
        </div>
        <button className="btn btn-primary" disabled={!lines.some((l) => l.qty > 0)} onClick={post}>
          Post issue
        </button>
      </div>
    </>
  )
}
