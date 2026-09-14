import { useMemo, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useLedger } from '../../data/store'
import { DoneScreen, StaffShell } from '../../components/StaffShell'
import { Badge, CascadeSelect, useToast } from '../../components/ui'
import { BlindCount } from './ChefApp'
import { uid } from '../../data/commands'
import { dayLabel } from '../../core/dates'
import { round } from '../../core/units'
import { money, num } from '../../lib/format'
import type { GRNLine, GoodsReceipt, ID, ReceiptIssue } from '../../core/types'

const TABS = [
  { path: '/receive', label: 'Receive', icon: '🚚' },
  { path: '/store-count', label: 'Count', icon: '🔢' },
]

/** The store manager's world: check deliveries in, count the store. */
/** The receiving screens, relative so they mount under /receive anywhere. */
export function ReceiveRoutes() {
  return (
    <Routes>
      <Route path="" element={<Deliveries />} />
      <Route path="new" element={<ReceiveForm />} />
      <Route path=":poId" element={<ReceiveForm />} />
    </Routes>
  )
}

export function StoreCount() {
  return <BlindCount locationId="loc_store" title="Count the store" />
}

export function StoreRoutes() {
  return (
    <Routes>
      <Route path="/receive/*" element={<ReceiveRoutes />} />
      <Route path="/store-count" element={<StoreCount />} />
      <Route path="*" element={<Navigate to="/receive" replace />} />
    </Routes>
  )
}

export default function StoreApp() {
  return (
    <StaffShell tabs={TABS} title="Store">
      <StoreRoutes />
    </StaffShell>
  )
}

/* ================================================================== */
/* Deliveries waiting                                                  */
/* ================================================================== */

export function Deliveries() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const waiting = state.purchaseOrders
    .filter((p) => p.status === 'SENT')
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))
  const recent = state.receipts
    .filter((g) => g.status === 'POSTED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

  return (
    <>
      <div className="big-title">Deliveries</div>
      <div className="big-sub">Tap an order when the van arrives and check it in.</div>

      <div className="big-list">
        {waiting.map((po) => {
          const supplier = derived.supplierById.get(po.supplierId)
          const late = po.expectedDate < derived.today
          const value = po.lines.reduce((s, l) => s + l.qty * l.rate, 0)
          return (
            <button key={po.id} className="big-row" onClick={() => navigate(`/receive/${po.id}`)}>
              <div className="main">
                <div className="name">{supplier?.name}</div>
                <div className="meta">
                  {po.poNo} · {po.lines.length} items · {money(value)} ·{' '}
                  {late ? <span className="neg">was due {dayLabel(po.expectedDate)}</span> : `due ${dayLabel(po.expectedDate)}`}
                </div>
              </div>
              {late && <Badge kind="critical">Late</Badge>}
              <span className="chev">›</span>
            </button>
          )
        })}
        {!waiting.length && <div className="empty">Nothing on order right now.</div>}
      </div>

      <button className="big-btn ghost" style={{ marginTop: 14 }} onClick={() => navigate('/receive/new')}>
        + Something arrived without an order
      </button>

      {recent.length > 0 && (
        <>
          <div className="dim" style={{ fontSize: 13, fontWeight: 600, margin: '22px 0 8px' }}>Recently checked in</div>
          <div className="big-list">
            {recent.map((g) => {
              const issues = g.lines.filter((l) => l.damagedQty > 0 || l.receivedQty < l.orderedQty).length
              return (
                <div key={g.id} className="big-row" style={{ cursor: 'default' }}>
                  <div className="main">
                    <div className="name">{derived.supplierById.get(g.supplierId)?.name}</div>
                    <div className="meta">{g.grnNo} · {dayLabel(g.date)} · {g.lines.length} items{issues ? ` · ${issues} flagged` : ''}</div>
                  </div>
                  {issues ? <Badge kind="watch">{issues} issue{issues > 1 ? 's' : ''}</Badge> : <Badge kind="ok">All good</Badge>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

/* ================================================================== */
/* Receive: what came, what didn't, what was refused                    */
/* ================================================================== */

const ISSUES: { value: ReceiptIssue; label: string }[] = [
  { value: 'SHORT_SUPPLIED', label: 'Short' }, { value: 'DAMAGED_IN_TRANSIT', label: 'Damaged' },
  { value: 'QUALITY_REJECTED', label: 'Bad quality' }, { value: 'WRONG_ITEM', label: 'Wrong item' },
  { value: 'EXPIRED', label: 'Expired' }, { value: 'EXCESS_SUPPLIED', label: 'Too much' }, { value: 'OTHER', label: 'Other' },
]

interface Draft { id: ID; itemId: ID; ordered: number; received: string; damaged: string; unit: string; rate: number; issue?: ReceiptIssue; note?: string }

export function ReceiveForm() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const { poId } = useParams()
  const po = poId ? state.purchaseOrders.find((p) => p.id === poId) : undefined
  const supplierDefault = po?.supplierId ?? state.suppliers[0]?.id ?? ''
  const [supplierId, setSupplierId] = useState<ID>(supplierDefault)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [lines, setLines] = useState<Draft[]>(() => (po?.lines ?? []).map((l) => ({
    id: uid('grl'), itemId: l.itemId, ordered: l.qty, received: String(l.qty), damaged: '', unit: l.unit, rate: l.rate,
  })))
  const [done, setDone] = useState<{ n: number; issues: number; value: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const patch = (id: ID, p: Partial<Draft>) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...p } : l)))

  const addItem = (itemId: ID | null) => {
    if (!itemId || lines.some((l) => l.itemId === itemId)) return
    const item = derived.itemById.get(itemId)
    if (!item) return
    setLines((prev) => [...prev, {
      id: uid('grl'), itemId, ordered: 0, received: '', damaged: '', unit: item.purchaseUnit,
      rate: round(item.lastPurchaseCost * item.purchaseConversion, 2),
    }])
  }

  const summary = useMemo(() => {
    let value = 0; let issues = 0
    for (const l of lines) {
      const rec = Number(l.received) || 0
      const dam = Number(l.damaged) || 0
      value += Math.max(rec - dam, 0) * l.rate
      if (dam > 0 || (l.ordered > 0 && rec < l.ordered) || (l.ordered > 0 && rec > l.ordered * 1.05)) issues++
    }
    return { value, issues }
  }, [lines])

  const confirm = async () => {
    setBusy(true)
    try {
      const grnLines: GRNLine[] = lines
        .filter((l) => (Number(l.received) || 0) > 0 || l.ordered > 0)
        .map((l) => {
          const item = derived.itemById.get(l.itemId)!
          const rec = Number(l.received) || 0
          const dam = Number(l.damaged) || 0
          const short = l.ordered > 0 && rec < l.ordered
          return {
            id: l.id, itemId: l.itemId, orderedQty: l.ordered || rec, receivedQty: rec, damagedQty: dam,
            unit: l.unit as never, rate: l.rate, taxPct: item.gstPct,
            issue: l.issue ?? (dam > 0 ? 'DAMAGED_IN_TRANSIT' : short ? 'SHORT_SUPPLIED' : undefined),
            note: l.note,
          }
        })
      const grn: GoodsReceipt = {
        id: uid('grn'), grnNo: `GRN-${Date.now().toString(36).toUpperCase()}`, poId: po?.id ?? null,
        supplierId, date: derived.today, locationId: 'loc_store', lines: grnLines,
        invoiceNo: invoiceNo || undefined, entryMode: po ? 'PO' : 'MANUAL', status: 'POSTED',
        receivedBy: user?.id ?? null, createdAt: new Date().toISOString(),
      }
      // Stock lands where each item lives; the receipt's location is the fallback.
      const result = await actions.postGoodsReceipt({ ...grn, locationId: grnLines.length && derived.itemById.get(grnLines[0].itemId)?.defaultLocationId || 'loc_store' })
      setDone({ n: grnLines.length, issues: summary.issues, value: summary.value })
      if (result.warnings.length) push({ kind: 'warn', title: 'Check this', msg: result.warnings[0] })
    } catch (err) {
      push({ kind: 'err', title: 'Could not save', msg: String(err) })
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <DoneScreen
        title="Added to the store"
        detail={`${done.n} items worth ${money(done.value)} are in stock.${done.issues ? ` ${done.issues} problem${done.issues > 1 ? 's' : ''} flagged to the manager.` : ' Nothing to flag.'}`}
        onDone={() => navigate('/receive')}
      />
    )
  }

  const supplier = derived.supplierById.get(supplierId)

  return (
    <>
      <div className="big-title">{po ? `Check in ${po.poNo}` : 'Receive without an order'}</div>
      <div className="big-sub">
        {po ? `${supplier?.name} · due ${dayLabel(po.expectedDate)}. Enter what actually arrived; the system works out what is missing.` : 'For a delivery that was never ordered through the system.'}
      </div>

      {!po && (
        <div className="stack" style={{ marginBottom: 14 }}>
          <div>
            <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>Supplier</label>
            <select className="select" style={{ fontSize: 16, padding: 12 }} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {state.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>Add an item</label>
            <CascadeSelect
              categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
              items={state.items.filter((i) => i.active && !i.isPrep)}
              value={null} onChange={addItem} placeholder="Choose item"
            />
          </div>
        </div>
      )}

      <div>
        <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>Invoice / challan number (optional)</label>
        <input className="input" style={{ fontSize: 16, padding: 12, marginBottom: 14 }} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="From the paper that came with it" />
      </div>

      <div className="big-list">
        {lines.map((l) => {
          const item = derived.itemById.get(l.itemId)
          if (!item) return null
          const rec = Number(l.received) || 0
          const dam = Number(l.damaged) || 0
          const missing = l.ordered > 0 ? Math.max(l.ordered - rec, 0) : 0
          const extra = l.ordered > 0 && rec > l.ordered * 1.05 ? rec - l.ordered : 0
          const flag = dam > 0 || missing > 0 || extra > 0
          return (
            <div key={l.id} className={`recv-line${flag ? ' flag' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="name" style={{ fontSize: 16, fontWeight: 600 }}>{item.name}</div>
                  <div className="meta dim" style={{ fontSize: 13 }}>
                    {l.ordered > 0 ? `Ordered ${num(l.ordered, 2)} ${l.unit}` : 'Not on an order'} · {money(l.rate)}/{l.unit}
                  </div>
                </div>
                {flag && <Badge kind="watch">Flagged</Badge>}
              </div>
              <div className="recv-grid">
                <div>
                  <label>Received</label>
                  <input className="big-input" type="number" inputMode="decimal" step="any" value={l.received}
                    onChange={(e) => patch(l.id, { received: e.target.value })} />
                </div>
                <div>
                  <label>Damaged / refused</label>
                  <input className="big-input" type="number" inputMode="decimal" step="any" value={l.damaged} placeholder="0"
                    onChange={(e) => patch(l.id, { damaged: e.target.value })} />
                </div>
                <div>
                  <label>{extra > 0 ? 'Extra' : 'Missing'}</label>
                  <div className={`recv-missing ${missing > 0 || extra > 0 ? 'neg' : 'dim'}`}>{num(extra > 0 ? extra : missing, 2)}</div>
                </div>
              </div>
              {flag && (
                <div style={{ marginTop: 10 }}>
                  <div className="pill-row">
                    {ISSUES.map((r) => (
                      <button key={r.value} className={`pill${l.issue === r.value ? ' active' : ''}`} onClick={() => patch(l.id, { issue: r.value })}>{r.label}</button>
                    ))}
                  </div>
                  <input className="input" style={{ marginTop: 8 }} placeholder="Note for the manager (optional)" value={l.note ?? ''} onChange={(e) => patch(l.id, { note: e.target.value })} />
                </div>
              )}
              {!po && (
                <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>Remove</button>
                </div>
              )}
            </div>
          )
        })}
        {!lines.length && <div className="empty">Add the items that arrived.</div>}
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 62, padding: '10px 16px', background: 'linear-gradient(transparent, var(--bg) 40%)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }} className="row">
          <button className="big-btn ghost" style={{ flex: 1 }} onClick={() => navigate('/receive')}>Back</button>
          <button className="big-btn primary" style={{ flex: 2 }} disabled={busy || !lines.some((l) => Number(l.received) > 0)} onClick={confirm}>
            {busy ? 'Saving…' : `Confirm · ${money(summary.value)}${summary.issues ? ` · ${summary.issues} flagged` : ''}`}
          </button>
        </div>
      </div>
    </>
  )
}
