import { useMemo, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useLedger } from '../../data/store'
import { DoneScreen, StaffShell } from '../../components/StaffShell'
import { CascadeSelect, Modal, useToast } from '../../components/ui'
import { QuickTake } from '../Kitchen'
import { uid } from '../../data/commands'
import { qty as fmtQty } from '../../lib/format'
import type { ID, Stocktake, StocktakeLine, Wastage, WastageReason } from '../../core/types'

const TABS = [
  { path: '/chef/take', label: 'Take', icon: '⚡' },
  { path: '/chef/count', label: 'Count', icon: '🔢' },
  { path: '/chef/waste', label: 'Waste', icon: '🗑' },
]

/** The chef's whole world: take stock, count stock, log waste. */
export function ChefRoutes() {
  return (
    <Routes>
        <Route path="take" element={<QuickTake compact />} />
        <Route path="count" element={<BlindCount locationId="loc_kitchen" title="Count the kitchen" />} />
        <Route path="waste" element={<WasteScreen />} />
        <Route path="*" element={<Navigate to="/chef/take" replace />} />
      </Routes>
  )
}

export default function ChefApp() {
  return (
    <StaffShell tabs={TABS} title="Kitchen">
      <ChefRoutes />
    </StaffShell>
  )
}

/* ================================================================== */
/* Blind count                                                         */
/* ================================================================== */

/**
 * The chef enters what is physically there and nothing else. No system
 * quantity, no gap, no value — those are for the manager. A count that can
 * be steered towards the number the system expects is not a count.
 */
export function BlindCount({ locationId, title }: { locationId: ID; title: string }) {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const [counts, setCounts] = useState<Record<ID, string>>({})
  const [category, setCategory] = useState<ID | ''>('')
  const [search, setSearch] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const items = useMemo(() => state.items
    .filter((i) => i.active && Math.abs(derived.balance(i.id, locationId)) > 0.001)
    .filter((i) => !category || i.categoryId === category)
    .filter((i) => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const ca = derived.categoryById.get(a.categoryId)?.sort ?? 0
      const cb = derived.categoryById.get(b.categoryId)?.sort ?? 0
      return ca - cb || a.name.localeCompare(b.name)
    }), [state.items, derived, locationId, category, search])

  const allItems = useMemo(() => state.items.filter((i) => i.active && Math.abs(derived.balance(i.id, locationId)) > 0.001), [state.items, derived, locationId])
  const categories = useMemo(() => {
    const ids = new Set(allItems.map((i) => i.categoryId))
    return state.categories.filter((c) => ids.has(c.id)).sort((a, b) => a.sort - b.sort)
  }, [allItems, state.categories])

  const entered = allItems.filter((i) => counts[i.id] !== undefined && counts[i.id] !== '')
  const alreadyToday = state.stocktakes.find((s) => s.date === derived.today && s.locationId === locationId)

  const submit = async () => {
    setBusy(true)
    try {
      const lines: StocktakeLine[] = entered.map((i) => ({
        id: uid('stl'), itemId: i.id,
        countedQtyBase: Number(counts[i.id]) || 0,
        systemQtyBase: derived.balance(i.id, locationId),
      }))
      const take: Stocktake = {
        id: uid('stk'), ref: `STK-${Date.now().toString(36).toUpperCase()}`, date: derived.today,
        locationId, lines, countedBy: user?.id ?? null, status: 'POSTED', createdAt: new Date().toISOString(),
      }
      await actions.postStocktake(take)
      setDone(lines.length)
      setCounts({})
      setConfirm(false)
    } catch (err) {
      push({ kind: 'err', title: 'Could not save the count', msg: String(err) })
    } finally {
      setBusy(false)
    }
  }

  if (done !== null) {
    return (
      <DoneScreen
        title="Count sent to the manager"
        detail={`${done} items recorded for ${derived.today}. The system is checking them against today's sales now.`}
        onDone={() => setDone(null)}
        doneLabel="Back"
      />
    )
  }

  return (
    <>
      <div className="big-title">{title}</div>
      <div className="big-sub">
        Type what is actually there. Leave blank anything you did not count.
        {alreadyToday && <span className="warn"> A count was already sent today — sending again adds a second one.</span>}
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <input className="input" style={{ fontSize: 16, padding: '12px 14px' }} placeholder="Find an item…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="progress-pill"><strong>{entered.length}</strong> of {allItems.length}</span>
      </div>
      <div className="pill-row" style={{ marginBottom: 14 }}>
        <button className={`pill${category === '' ? ' active' : ''}`} onClick={() => setCategory('')}>All</button>
        {categories.map((c) => (
          <button key={c.id} className={`pill${category === c.id ? ' active' : ''}`} onClick={() => setCategory(c.id)}>{c.name}</button>
        ))}
      </div>

      <div className="big-list">
        {items.map((i) => {
          const v = counts[i.id] ?? ''
          return (
            <div key={i.id} className={`count-row${v !== '' ? ' done' : ''}`}>
              <div>
                <div className="name">{i.name}</div>
                <div className="meta">{derived.categoryById.get(i.categoryId)?.name}</div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input className="big-input" type="number" inputMode="decimal" step="any" placeholder="—"
                  value={v} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} />
                <span className="unit-tag">{i.baseUnit === 'unit' ? 'pc' : i.baseUnit}</span>
              </div>
            </div>
          )
        })}
        {!items.length && <div className="empty">Nothing here to count.</div>}
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 62, padding: '10px 16px', background: 'linear-gradient(transparent, var(--bg) 40%)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <button className="big-btn primary" disabled={!entered.length || busy} onClick={() => setConfirm(true)}>
            Send count ({entered.length} items)
          </button>
        </div>
      </div>

      {confirm && (
        <Modal title="Send this count?" onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>Not yet</button>
              <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Yes, send it'}</button>
            </>
          }>
          <p className="muted">{entered.length} items go to the manager as tonight's physical count. You cannot change them afterwards — a wrong number needs a fresh count.</p>
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Waste — three taps                                                  */
/* ================================================================== */

const REASONS: { value: WastageReason; label: string }[] = [
  { value: 'SPOILAGE', label: 'Spoiled' }, { value: 'EXPIRY', label: 'Expired' },
  { value: 'BURNT', label: 'Burnt' }, { value: 'SPILLAGE', label: 'Spilled' },
  { value: 'CUSTOMER_RETURN', label: 'Sent back' }, { value: 'STAFF_MEAL', label: 'Staff meal' },
  { value: 'COMPLIMENTARY', label: 'Complimentary' }, { value: 'OTHER', label: 'Other' },
]

function WasteScreen() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const [itemId, setItemId] = useState<ID | null>(null)
  const [q, setQ] = useState('')
  const [reason, setReason] = useState<WastageReason>('SPOILAGE')
  const [done, setDone] = useState<string | null>(null)

  const item = itemId ? derived.itemById.get(itemId) : null
  const inKitchen = state.items.filter((i) => i.active && derived.balance(i.id, 'loc_kitchen') > 0.001)

  const record = async () => {
    if (!item) return
    const n = Number(q)
    if (!n || n <= 0) return
    const w: Wastage = {
      id: uid('wst'), ref: `WST-${Date.now().toString(36).toUpperCase()}`, date: derived.today,
      itemId: item.id, locationId: 'loc_kitchen', qtyBase: n, reason,
      byStaffId: user?.id ?? null, createdAt: new Date().toISOString(),
    }
    await actions.postWastage(w)
    setDone(`${fmtQty(n, item.baseUnit)} of ${item.name}`)
    setItemId(null); setQ('')
    push({ kind: 'ok', title: 'Recorded' })
  }

  if (done) {
    return <DoneScreen title="Waste recorded" detail={done} onDone={() => setDone(null)} doneLabel="Record another" />
  }

  return (
    <>
      <div className="big-title">Log waste</div>
      <div className="big-sub">Recording it here explains a gap. Not recording it turns the same loss into a question for you at the count.</div>

      <div className="stack">
        <div>
          <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>What</label>
          <CascadeSelect
            categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
            items={inKitchen} value={itemId} onChange={setItemId} placeholder="Choose item"
          />
        </div>
        {item && (
          <>
            <div>
              <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>How much ({item.baseUnit === 'unit' ? 'pc' : item.baseUnit})</label>
              <input className="big-input" style={{ textAlign: 'left' }} type="number" inputMode="decimal" step="any" autoFocus
                value={q} onChange={(e) => setQ(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>Why</label>
              <div className="pill-row">
                {REASONS.map((r) => (
                  <button key={r.value} className={`pill${reason === r.value ? ' active' : ''}`} style={{ padding: '9px 14px', fontSize: 14 }} onClick={() => setReason(r.value)}>{r.label}</button>
                ))}
              </div>
            </div>
            <button className="big-btn primary" disabled={!Number(q)} onClick={record}>Record</button>
          </>
        )}
        <button className="big-btn ghost" onClick={() => navigate('/chef/take')}>Cancel</button>
      </div>
    </>
  )
}
