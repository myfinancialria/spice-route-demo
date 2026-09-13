import { useMemo, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import {
  Badge, Card, CascadeSelect, Empty, Field, Keypad, Modal, Search, Tile, useToast,
} from '../components/ui'
import { Bars, Donut, PALETTE } from '../components/charts'
import { ItemDrawer, PeriodPills, StockTable, usePeriod } from './shared'
import { StocktakeSheet } from './Stocktake'
import { uid } from '../data/commands'
import { addDays, dayLabel } from '../core/dates'
import { costRecipe } from '../core/costing'
import { round } from '../core/units'
import { money, moneyShort, num, pct, qty as fmtQty } from '../lib/format'
import type { ID, Issue, Item, ProductionRun, Wastage, WastageReason } from '../core/types'

export default function Kitchen() {
  return (
    <Routes>
      <Route path="quick-take" element={<QuickTake />} />
      <Route path="production" element={<Production />} />
      <Route path="stock" element={<KitchenStock />} />
      <Route path="wastage" element={<WastageLog />} />
      <Route path="stocktake" element={
        <StocktakeSheet
          locationId="loc_kitchen" title="Kitchen Stocktake"
          sub="Count what is actually on the line at the end of service. This is the number every variance report is measured against."
        />
      } />
      <Route path="*" element={<QuickTake />} />
    </Routes>
  )
}

/* ================================================================== */
/* Quick Take — the highest-frequency screen in the building           */
/* ================================================================== */

interface BasketLine { itemId: ID; qty: number }

/**
 * The unit a chef would actually say out loud for this quantity of this item.
 * Asking for "5" and meaning five kilos, when the box is counting grams, is
 * exactly the kind of thousand-fold error that poisons a whole week of data.
 */
function entryUnit(item: Item, typical: number): { label: string; factor: number } {
  if (item.baseUnit === 'unit') return { label: 'pc', factor: 1 }
  const big = item.baseUnit === 'g' ? 'kg' : 'L'
  // Spices are drawn in grams, rice in kilos — pick by the size of a normal draw.
  return typical >= 1000 ? { label: big, factor: 1000 } : { label: item.baseUnit, factor: 1 }
}

function QuickTake() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const [basket, setBasket] = useState<BasketLine[]>([])
  const [active, setActive] = useState<ID | null>(null)
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  // A kitchen tablet gets tapped twice out of habit; without this that is two issues.
  const [sending, setSending] = useState(false)

  /**
   * Frequently-taken items first, learned from the issue history. A chef
   * should find what they need in the first row without searching — a screen
   * that needs a search box mid-service does not get used.
   */
  const frequent = useMemo(() => {
    const since = addDays(derived.today, -30)
    const freq = new Map<ID, { count: number; total: number }>()
    // Value, not just frequency: nearly everything gets drawn every day, so
    // counting alone would leave the tiles in alphabetical order and the chef
    // hunting for chicken behind black pepper.
    for (const issue of state.issues) {
      if (issue.date < since) continue
      for (const line of issue.lines) {
        const cur = freq.get(line.itemId) ?? { count: 0, total: 0 }
        cur.count += 1
        cur.total += line.qtyBase
        freq.set(line.itemId, cur)
      }
    }
    const term = search.trim().toLowerCase()
    return state.items
      .filter((i) => i.active && !i.isPrep)
      .map((item) => {
        const f = freq.get(item.id)
        return {
          item,
          score: f?.count ?? 0,
          value: (f?.total ?? 0) * item.avgCost,
          typical: f && f.count ? f.total / f.count : 0,
          store: derived.balance(item.id, item.defaultLocationId),
        }
      })
      .filter((r) => (showAll || r.score > 0) && (!term || r.item.name.toLowerCase().includes(term)))
      .sort((a, b) => b.value - a.value || b.score - a.score || a.item.name.localeCompare(b.item.name))
      .slice(0, showAll ? 200 : 24)
  }, [state.issues, state.items, derived, search, showAll])

  const activeItem = active ? derived.itemById.get(active) : null
  const activeRow = frequent.find((r) => r.item.id === active)
  const activeUnit = activeItem ? entryUnit(activeItem, activeRow?.typical ?? 0) : { label: '', factor: 1 }

  const openKeypad = (itemId: ID) => {
    setActive(itemId)
    const row = frequent.find((r) => r.item.id === itemId)
    const item = derived.itemById.get(itemId)
    if (!item) return
    const unit = entryUnit(item, row?.typical ?? 0)
    const existing = basket.find((b) => b.itemId === itemId)
    // Default to what is usually taken, so most entries are one tap and Add.
    const base = existing?.qty ?? row?.typical ?? 0
    const shown = base ? round(base / unit.factor, unit.factor === 1 ? 0 : 2) : 0
    setTyped(shown ? String(shown) : '')
  }

  const commit = () => {
    if (!active || !activeItem) return
    const value = Number(typed)
    if (!value || value <= 0) { setActive(null); return }
    const unit = entryUnit(activeItem, activeRow?.typical ?? 0)
    setBasket((prev) => {
      const rest = prev.filter((b) => b.itemId !== active)
      return [...rest, { itemId: active, qty: value * unit.factor }]
    })
    setActive(null)
    setTyped('')
  }

  const basketValue = basket.reduce((s, b) => {
    const item = derived.itemById.get(b.itemId)
    return s + (item ? b.qty * item.avgCost : 0)
  }, 0)

  const send = async () => {
    if (sending || !basket.length) return
    setSending(true)
    try {
      const lines = basket.map((b) => {
        const item = derived.itemById.get(b.itemId)!
        return {
          id: uid('il'), itemId: b.itemId, qty: b.qty, unit: item.baseUnit,
          qtyBase: b.qty, fromLocationId: item.defaultLocationId,
        }
      })
      const issue: Issue = {
        id: uid('iss'), ref: `ISS-${Date.now().toString(36).toUpperCase()}`, date: derived.today,
        fromLocationId: 'loc_store', toLocationId: 'loc_kitchen', lines,
        requestedBy: user?.id ?? null, status: 'POSTED', createdAt: new Date().toISOString(),
      }
      const result = await actions.postIssue(issue)
      push({
        kind: result.warnings.length ? 'warn' : 'ok',
        title: `${lines.length} item${lines.length > 1 ? 's' : ''} moved to the kitchen`,
        msg: result.warnings.length ? result.warnings[0] : `${money(basketValue)} issued from store`,
      })
      setBasket([])
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHead
        title="Quick Take"
        sub="Tap what you are taking, type the amount, send. Everything you take moves from the store to the kitchen the moment you hit send."
        actions={
          <>
            <Search value={search} onChange={setSearch} placeholder="Find anything" />
            <button className={`btn btn-sm${showAll ? ' btn-primary' : ''}`} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Showing everything' : 'Show all items'}
            </button>
            <button className="btn" onClick={() => navigate('/store/issue')}>Full indent form</button>
          </>
        }
      />

      <div className="grid g-3-2">
        <Card
          title={showAll || search ? 'All items' : 'What your section usually takes'}
          sub={showAll || search ? 'every stocked item' : 'ordered by how often it has been drawn in the last 30 days'}
        >
          {frequent.length === 0 ? (
            <Empty icon="🔍" title="Nothing matches">Try “Show all items”.</Empty>
          ) : (
            <div className="pick-grid">
              {frequent.map((r) => {
                const inBasket = basket.find((b) => b.itemId === r.item.id)
                return (
                  <button
                    key={r.item.id}
                    className={`pick${inBasket ? ' selected' : ''}`}
                    onClick={() => openKeypad(r.item.id)}
                  >
                    <span className="pick-name">{r.item.name}</span>
                    <span className="pick-meta">
                      {r.store > 0 ? `${fmtQty(r.store, r.item.baseUnit, 1)} in store` : 'none in store'}
                    </span>
                    {inBasket
                      ? <span className="pick-qty">＋{fmtQty(inBasket.qty, r.item.baseUnit, 1)}</span>
                      : r.typical > 0 && <span className="pick-meta dim">usually {fmtQty(r.typical, r.item.baseUnit, 1)}</span>}
                  </button>
                )
              })}
            </div>
          )}
          <hr className="hr" />
          <Field label="Not in the list? Pick it by category">
            <CascadeSelect
              categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
              items={state.items.filter((i) => i.active && !i.isPrep)}
              value={null} onChange={(id) => id && openKeypad(id)} placeholder="Choose item"
            />
          </Field>
        </Card>

        <Card
          title={`Taking (${basket.length})`}
          sub={basket.length ? `${money(basketValue)} leaving the store` : 'nothing selected yet'}
          flush
          footer={
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-ghost btn-sm" disabled={!basket.length} onClick={() => setBasket([])}>Clear</button>
              <button className="btn btn-primary" disabled={!basket.length || sending} onClick={send}>
                {sending ? 'Sending…' : 'Send to kitchen'}
              </button>
            </div>
          }
        >
          {basket.length === 0 ? (
            <Empty icon="🧺" title="Nothing yet">Tap an item to start.</Empty>
          ) : (
            <table className="tbl compact">
              <tbody>
                {basket.map((b) => {
                  const item = derived.itemById.get(b.itemId)!
                  const store = derived.balance(b.itemId, item.defaultLocationId)
                  const short = b.qty > store
                  return (
                    <tr key={b.itemId}>
                      <td>
                        <div className="tbl-name">{item.name}</div>
                        {short && <div className="tbl-sub neg">only {fmtQty(store, item.baseUnit, 1)} in store</div>}
                      </td>
                      <td className="num" style={{ cursor: 'pointer' }} onClick={() => openKeypad(b.itemId)}>
                        {fmtQty(b.qty, item.baseUnit, 2)}
                      </td>
                      <td className="num dim">{money(b.qty * item.avgCost)}</td>
                      <td>
                        <button className="icon-btn" onClick={() => setBasket(basket.filter((x) => x.itemId !== b.itemId))}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {activeItem && (
        <Modal
          title={activeItem.name}
          sub={`${fmtQty(activeRow?.store ?? derived.balance(activeItem.id, activeItem.defaultLocationId), activeItem.baseUnit, 1)} in store · ${money(activeItem.avgCost * activeItem.purchaseConversion, 2)}/${activeItem.purchaseUnit}`}
          onClose={() => setActive(null)}
        >
          <Keypad value={typed} onChange={setTyped} onDone={commit} unit={activeUnit.label} />
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            {[0.25, 0.5, 1, 2].map((mult) => {
              const base = activeRow?.typical || (activeItem.baseUnit === 'unit' ? 1 : 1000)
              const shown = round((base * mult) / activeUnit.factor, activeUnit.factor === 1 ? 0 : 2)
              if (shown <= 0) return null
              return (
                <button key={mult} className="pill" onClick={() => setTyped(String(shown))}>
                  {shown} {activeUnit.label}
                </button>
              )
            })}
          </div>
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Prep production                                                     */
/* ================================================================== */

function Production() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const { days, setDays, from, to } = usePeriod(30)
  const [making, setMaking] = useState<ID | null>(null)
  const [batches, setBatches] = useState(1)

  const preps = useMemo(() => state.items.filter((i) => i.isPrep && i.active).map((item) => {
    const recipe = derived.recipeFor('PREP', item.id)
    const onHand = derived.balance(item.id, 'loc_kitchen')
    const runs = state.production.filter((p) => p.itemId === item.id && p.date >= from)
    const made = runs.reduce((s, p) => s + p.qtyProduced, 0)
    // A day's typical draw, used to say how long the current batch lasts.
    const used = state.movements
      .filter((m) => m.itemId === item.id && m.date >= from && (m.type === 'CONSUMPTION' || m.type === 'PRODUCTION_OUT'))
      .reduce((s, m) => s + Math.abs(m.qty), 0)
    const perDay = used / Math.max(days, 1)
    return { item, recipe, onHand, runs: runs.length, made, perDay, cover: perDay > 0 ? onHand / perDay : null }
  }), [state.items, state.production, state.movements, derived, from, days])

  const target = making ? derived.itemById.get(making) : null
  const targetRecipe = making ? derived.recipeFor('PREP', making) : undefined
  const preview = useMemo(() => {
    if (!making || !targetRecipe) return null
    const produced = batches * targetRecipe.yieldQty
    const lines = costRecipe(derived.ctx, 'PREP', making, produced, { explode: false })
    const cost = lines.reduce((s, l) => s + l.cost, 0)
    return { produced, lines, cost, unitCost: produced ? cost / produced : 0 }
  }, [making, targetRecipe, batches, derived.ctx])

  const run = async () => {
    if (!target || !targetRecipe || !preview) return
    const record: ProductionRun = {
      id: uid('prod'), ref: `PRD-${Date.now().toString(36).toUpperCase()}`, date: derived.today,
      itemId: target.id, recipeId: targetRecipe.id, batches, qtyProduced: preview.produced,
      locationId: 'loc_kitchen', byStaffId: user?.id ?? null, status: 'POSTED',
      createdAt: new Date().toISOString(),
    }
    const result = await actions.postProduction(record)
    push({
      kind: result.warnings.length ? 'warn' : 'ok',
      title: `${fmtQty(preview.produced, target.baseUnit)} of ${target.name} made`,
      msg: result.warnings.length ? result.warnings[0] : `${money(preview.cost)} of ingredients used · ${money(preview.unitCost, 4)} per ${target.baseUnit}`,
    })
    setMaking(null)
    setBatches(1)
  }

  const recent = state.production
    .filter((p) => p.date >= from && p.date <= to)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40)

  return (
    <>
      <PageHead
        title="Prep Production"
        sub="Batch gravies, pastes and blends. Making a batch consumes the ingredients and puts the finished prep into kitchen stock at its true built-up cost."
        actions={<PeriodPills days={days} setDays={setDays} />}
      />

      <div className="grid g3" style={{ marginBottom: 14 }}>
        {preps.slice(0, 3).map((p) => (
          <Tile
            key={p.item.id} label={p.item.name} value={fmtQty(p.onHand, p.item.baseUnit)}
            foot={p.cover === null ? 'no recent use' : `${p.cover.toFixed(1)} days at current use`}
            accent={p.cover !== null && p.cover < 1 ? 'var(--neg)' : 'var(--pos)'}
            onClick={() => setMaking(p.item.id)}
          />
        ))}
      </div>

      <div className="grid g-3-2">
        <Card title="Prep items" sub="tap one to make a batch" flush>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Prep item</th><th className="num">On hand</th><th className="num">Days cover</th>
                  <th className="num">Cost / unit</th><th className="num">Batches made</th><th>Shelf life</th><th /></tr>
              </thead>
              <tbody>
                {preps.map((p) => (
                  <tr key={p.item.id} className="clickable" onClick={() => setMaking(p.item.id)}>
                    <td>
                      <div className="tbl-name">{p.item.name}</div>
                      <div className="tbl-sub">{p.recipe ? `${p.recipe.lines.length} ingredients · yields ${fmtQty(p.recipe.yieldQty, p.item.baseUnit)}` : 'no recipe yet'}</div>
                    </td>
                    <td className="num">{fmtQty(p.onHand, p.item.baseUnit)}</td>
                    <td className="num">
                      <span className={p.cover !== null && p.cover < 1 ? 'neg' : ''}>{p.cover === null ? '—' : p.cover.toFixed(1)}</span>
                    </td>
                    <td className="num dim">{money(p.item.avgCost, 4)}</td>
                    <td className="num">{p.runs}</td>
                    <td className="dim">{p.item.shelfLifeDays ? `${p.item.shelfLifeDays} days` : '—'}</td>
                    <td className="right"><span className="badge badge-brand">Make</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Recent batches" sub={`last ${days} days`} flush>
          <div className="scroll-y mh-420">
            <table className="tbl compact">
              <thead><tr><th>Date</th><th>Item</th><th className="num">Made</th><th>By</th></tr></thead>
              <tbody>
                {recent.map((p) => {
                  const item = derived.itemById.get(p.itemId)
                  return (
                    <tr key={p.id}>
                      <td className="nowrap dim">{dayLabel(p.date)}</td>
                      <td>{item?.name}</td>
                      <td className="num">{item ? fmtQty(p.qtyProduced, item.baseUnit) : p.qtyProduced}</td>
                      <td className="dim">{p.byStaffId ? derived.staffById.get(p.byStaffId)?.name.split(' ')[0] : '—'}</td>
                    </tr>
                  )
                })}
                {!recent.length && <tr><td colSpan={4}><Empty icon="🍲" title="No batches yet" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {target && targetRecipe && preview && (
        <Modal
          title={`Make ${target.name}`}
          sub={`One batch yields ${fmtQty(targetRecipe.yieldQty, target.baseUnit)}`}
          onClose={() => { setMaking(null); setBatches(1) }}
          footer={
            <>
              <button className="btn" onClick={() => { setMaking(null); setBatches(1) }}>Cancel</button>
              <button className="btn btn-primary" onClick={run}>
                Make {fmtQty(preview.produced, target.baseUnit)}
              </button>
            </>
          }
        >
          <div className="field-row" style={{ marginBottom: 12 }}>
            <Field label="How many batches">
              <input className="input num" type="number" min={1} value={batches}
                onChange={(e) => setBatches(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Produces">
              <input className="input" readOnly value={fmtQty(preview.produced, target.baseUnit)} />
            </Field>
            <Field label="Cost per unit">
              <input className="input" readOnly value={`${money(preview.unitCost, 4)} / ${target.baseUnit}`} />
            </Field>
          </div>
          <Card title="Ingredients this will use" flush>
            <table className="tbl compact">
              <thead><tr><th>Ingredient</th><th className="num">Needed</th><th className="num">In kitchen</th><th className="num">Cost</th></tr></thead>
              <tbody>
                {preview.lines.map((l) => {
                  const have = derived.balance(l.itemId, 'loc_kitchen')
                  const short = have < l.qty
                  return (
                    <tr key={l.itemId}>
                      <td>{l.name}</td>
                      <td className="num">{fmtQty(l.qty, l.baseUnit)}</td>
                      <td className={`num ${short ? 'neg' : 'dim'}`}>{fmtQty(have, l.baseUnit)}</td>
                      <td className="num dim">{money(l.cost, 2)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr><td colSpan={3}>Batch cost</td><td className="num">{money(preview.cost, 2)}</td></tr></tfoot>
            </table>
          </Card>
          {preview.lines.some((l) => derived.balance(l.itemId, 'loc_kitchen') < l.qty) && (
            <div className="step-ccp" style={{ display: 'block', marginTop: 10 }}>
              ⚠ Some ingredients are not in the kitchen yet. Take them from the store first, or the balance will go negative.
            </div>
          )}
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Kitchen stock                                                       */
/* ================================================================== */

function KitchenStock() {
  const { derived } = useLedger()
  const [search, setSearch] = useState('')
  const [drill, setDrill] = useState<ID | null>(null)
  return (
    <>
      <PageHead
        title="Kitchen Stock"
        sub="What the line is holding right now — everything issued in, less what the recipes have consumed."
        actions={<Search value={search} onChange={setSearch} />}
      />
      <Card flush><StockTable locationId="loc_kitchen" search={search} onPick={setDrill} /></Card>
      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
      <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
        Balance shown here is what the system believes. The physical count at day close is what decides the variance.
      </p>
    </>
  )
}

/* ================================================================== */
/* Wastage                                                             */
/* ================================================================== */

const REASONS: { value: WastageReason; label: string; tone: string }[] = [
  { value: 'SPOILAGE', label: 'Spoiled', tone: 'critical' },
  { value: 'EXPIRY', label: 'Expired', tone: 'critical' },
  { value: 'BURNT', label: 'Burnt / ruined', tone: 'high' },
  { value: 'SPILLAGE', label: 'Spilled', tone: 'high' },
  { value: 'CUSTOMER_RETURN', label: 'Customer return', tone: 'watch' },
  { value: 'STAFF_MEAL', label: 'Staff meal', tone: 'info' },
  { value: 'COMPLIMENTARY', label: 'Complimentary', tone: 'info' },
  { value: 'TRIAL', label: 'Tasting / trial', tone: 'neutral' },
  { value: 'OTHER', label: 'Other', tone: 'neutral' },
]

function WastageLog() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const { days, setDays, from, to } = usePeriod(30)
  const [itemId, setItemId] = useState<ID | null>(null)
  const [qtyText, setQtyText] = useState('')
  const [reason, setReason] = useState<WastageReason>('SPOILAGE')
  const [note, setNote] = useState('')

  const rows = useMemo(() => state.wastage
    .filter((w) => w.date >= from && w.date <= to)
    .map((w) => {
      const item = derived.itemById.get(w.itemId)
      return { w, item, value: item ? w.qtyBase * item.avgCost : 0 }
    })
    .sort((a, b) => b.w.createdAt.localeCompare(a.w.createdAt)), [state.wastage, derived.itemById, from, to])

  const total = rows.reduce((s, r) => s + r.value, 0)
  const byReason = useMemo(() => {
    const m = new Map<WastageReason, number>()
    for (const r of rows) m.set(r.w.reason, (m.get(r.w.reason) ?? 0) + r.value)
    return [...m.entries()].map(([k, v], i) => ({
      name: REASONS.find((x) => x.value === k)?.label ?? k, value: v, color: PALETTE[i % PALETTE.length],
    })).sort((a, b) => b.value - a.value)
  }, [rows])

  const byItem = useMemo(() => {
    const m = new Map<ID, number>()
    for (const r of rows) m.set(r.w.itemId, (m.get(r.w.itemId) ?? 0) + r.value)
    return [...m.entries()]
      .map(([id, v]) => ({ name: derived.itemById.get(id)?.name ?? id, value: round(v, 0) }))
      .sort((a, b) => b.value - a.value).slice(0, 10).reverse()
  }, [rows, derived.itemById])

  const item = itemId ? derived.itemById.get(itemId) : null

  const record = async () => {
    if (!item) return
    const q = Number(qtyText)
    if (!q || q <= 0) return
    const w: Wastage = {
      id: uid('wst'), ref: `WST-${Date.now().toString(36).toUpperCase()}`, date: derived.today,
      itemId: item.id, locationId: 'loc_kitchen', qtyBase: q, reason,
      byStaffId: user?.id ?? null, note: note || undefined, createdAt: new Date().toISOString(),
    }
    await actions.postWastage(w)
    push({
      kind: 'ok', title: 'Wastage recorded',
      msg: `${fmtQty(q, item.baseUnit)} of ${item.name} · ${money(q * item.avgCost)}`,
    })
    setItemId(null); setQtyText(''); setNote('')
  }

  return (
    <>
      <PageHead
        title="Wastage & Staff Meals"
        sub="Recording waste costs nothing and explains a gap. Not recording it turns the same loss into an unexplained variance at the count."
        actions={<PeriodPills days={days} setDays={setDays} />}
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Wastage value" value={moneyShort(total)} foot={`${rows.length} entries in ${days} days`} accent="var(--neg)" />
        <Tile label="Per day" value={moneyShort(total / Math.max(days, 1))} foot="average" />
        <Tile label="Biggest cause" value={byReason[0]?.name ?? '—'} foot={byReason[0] ? moneyShort(byReason[0].value) : ''} />
        <Tile label="Most wasted item" value={byItem[byItem.length - 1]?.name ?? '—'}
          foot={byItem.length ? moneyShort(byItem[byItem.length - 1].value) : ''} />
      </div>

      <div className="grid g-1-2" style={{ marginBottom: 14 }}>
        <Card title="Record wastage" sub="takes about ten seconds">
          <div className="stack">
            <Field label="What was wasted">
              <CascadeSelect
                categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
                items={state.items.filter((i) => i.active)}
                value={itemId} onChange={setItemId} placeholder="Choose item"
              />
            </Field>
            <div className="field-row">
              <Field label={`Quantity${item ? ` (${item.baseUnit === 'unit' ? 'pc' : item.baseUnit})` : ''}`}>
                <input className="input num" type="number" inputMode="decimal" value={qtyText}
                  onChange={(e) => setQtyText(e.target.value)} />
              </Field>
              <Field label="Value">
                <input className="input" readOnly value={item && qtyText ? money(Number(qtyText) * item.avgCost, 2) : '—'} />
              </Field>
            </div>
            <Field label="Reason">
              <div className="pill-row">
                {REASONS.map((r) => (
                  <button key={r.value} className={`pill${reason === r.value ? ' active' : ''}`} onClick={() => setReason(r.value)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Note (optional)">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened" />
            </Field>
            <button className="btn btn-primary btn-block" disabled={!item || !Number(qtyText)} onClick={record}>
              Record wastage
            </button>
          </div>
        </Card>

        <div className="grid g2">
          <Card title="By reason" sub={`last ${days} days`}>
            <Donut data={byReason} height={190} />
          </Card>
          <Card title="Most wasted items" sub="by value">
            {byItem.length ? <Bars data={byItem} xKey="name" series={[{ key: 'value', name: 'Value' }]} horizontal height={220} />
              : <Empty icon="♻️" title="No wastage recorded" />}
          </Card>
        </div>
      </div>

      <Card title="Wastage log" flush>
        <div className="table-wrap scroll-y mh-420">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Item</th><th className="num">Qty</th><th className="num">Value</th><th>Reason</th><th>By</th><th>Note</th></tr></thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.w.id}>
                  <td className="nowrap dim">{dayLabel(r.w.date)}</td>
                  <td className="tbl-name">{r.item?.name}</td>
                  <td className="num">{r.item ? fmtQty(r.w.qtyBase, r.item.baseUnit) : r.w.qtyBase}</td>
                  <td className="num neg">{money(r.value)}</td>
                  <td>
                    <Badge kind={REASONS.find((x) => x.value === r.w.reason)?.tone ?? 'neutral'}>
                      {REASONS.find((x) => x.value === r.w.reason)?.label ?? r.w.reason}
                    </Badge>
                  </td>
                  <td className="dim">{r.w.byStaffId ? derived.staffById.get(r.w.byStaffId)?.name.split(' ')[0] : '—'}</td>
                  <td className="dim">{r.w.note ?? ''}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7}><Empty icon="♻️" title="Nothing recorded in this period" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
