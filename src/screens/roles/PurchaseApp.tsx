import { useMemo, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLedger } from '../../data/store'
import { DoneScreen, StaffShell } from '../../components/StaffShell'
import { Badge, CascadeSelect, useToast } from '../../components/ui'
import { uid } from '../../data/commands'
import { addDays, dayLabel } from '../../core/dates'
import { reorderAlerts } from '../../core/stock'
import { round } from '../../core/units'
import { money, num, qty as fmtQty } from '../../lib/format'
import type { ID, POLine, PurchaseOrder } from '../../core/types'

const TABS = [
  { path: '/buy', label: 'Order', icon: '🛒' },
  { path: '/buy/list', label: 'Orders', icon: '📋' },
]

/** The purchase manager's world: what to order, and what has been ordered. */
export function PurchaseRoutes() {
  return (
    <Routes>
        <Route path="" element={<Suggested />} />
        <Route path="new" element={<NewOrder />} />
        <Route path="list" element={<OrderList />} />
        <Route path="view/:poId" element={<ViewOrder />} />
        <Route path="*" element={<Navigate to="/buy" replace />} />
      </Routes>
  )
}

export default function PurchaseApp() {
  return (
    <StaffShell tabs={TABS} title="Purchasing">
      <PurchaseRoutes />
    </StaffShell>
  )
}

/** Items running low, grouped by the vendor who supplies them. */
function useSuggestions() {
  const { state, derived } = useLedger()
  return useMemo(() => {
    const since = addDays(derived.today, -29)
    const usage = new Map<ID, number>()
    for (const m of state.movements) {
      if (m.date < since) continue
      if (m.type !== 'CONSUMPTION' && m.type !== 'PRODUCTION_OUT') continue
      usage.set(m.itemId, (usage.get(m.itemId) ?? 0) + Math.abs(m.qty) / 30)
    }
    const onOrder = new Set(state.purchaseOrders.filter((p) => p.status === 'SENT').flatMap((p) => p.lines.map((l) => l.itemId)))
    const alerts = reorderAlerts(state.items, derived.onHand, usage, (item) =>
      item.defaultSupplierId ? derived.supplierById.get(item.defaultSupplierId)?.leadTimeDays ?? 2 : 1)
    const bySupplier = new Map<ID, typeof alerts>()
    for (const a of alerts) {
      if (onOrder.has(a.itemId)) continue
      const item = derived.itemById.get(a.itemId)
      const sid = item?.defaultSupplierId
      if (!sid) continue
      const list = bySupplier.get(sid) ?? []
      list.push(a)
      bySupplier.set(sid, list)
    }
    return [...bySupplier.entries()]
      .map(([sid, list]) => ({ supplier: derived.supplierById.get(sid)!, items: list }))
      .filter((g) => g.supplier)
      .sort((a, b) => b.items.length - a.items.length)
  }, [state, derived])
}

/* ================================================================== */

export function Suggested() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const groups = useSuggestions()
  const open = state.purchaseOrders.filter((p) => p.status === 'SENT')

  return (
    <>
      <div className="big-title">What to order</div>
      <div className="big-sub">Worked out from what the kitchen has been using and what is on the shelf. Tap a vendor to make the order.</div>

      <div className="big-list">
        {groups.map((g) => (
          <button key={g.supplier.id} className="big-row" onClick={() => navigate(`/buy/new?supplier=${g.supplier.id}`)}>
            <div className="main">
              <div className="name">{g.supplier.name}</div>
              <div className="meta">
                {g.items.length} item{g.items.length > 1 ? 's' : ''} running low · {g.items.slice(0, 3).map((a) => a.name).join(', ')}{g.items.length > 3 ? '…' : ''}
              </div>
            </div>
            {g.items.some((a) => a.severity === 'CRITICAL') && <Badge kind="critical">Urgent</Badge>}
            <span className="chev">›</span>
          </button>
        ))}
        {!groups.length && <div className="empty">Nothing is running low. Stock is covered.</div>}
      </div>

      <button className="big-btn primary" style={{ marginTop: 14 }} onClick={() => navigate('/buy/new')}>+ New order</button>

      {open.length > 0 && (
        <p className="dim center" style={{ fontSize: 13, marginTop: 14 }}>
          {open.length} order{open.length > 1 ? 's' : ''} waiting for delivery · {' '}
          <a onClick={() => navigate('/buy/list')} style={{ color: 'var(--brand)', cursor: 'pointer' }}>see them</a>
        </p>
      )}
    </>
  )
}

/* ================================================================== */

interface Draft { id: ID; itemId: ID; qty: number; rate: number; unit: string }

export function NewOrder() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const groups = useSuggestions()
  const [supplierId, setSupplierId] = useState<ID>(params.get('supplier') ?? state.suppliers[0]?.id ?? '')
  const [expected, setExpected] = useState(() => {
    const s = derived.supplierById.get(params.get('supplier') ?? '')
    return addDays(derived.today, s?.leadTimeDays ?? 1)
  })
  const [lines, setLines] = useState<Draft[]>(() => {
    const g = groups.find((x) => x.supplier.id === params.get('supplier'))
    return (g?.items ?? []).map((a) => {
      const item = derived.itemById.get(a.itemId)!
      return {
        id: uid('pol'), itemId: a.itemId,
        qty: Math.max(1, Math.ceil(a.suggestedOrderQty / item.purchaseConversion)),
        rate: round(item.lastPurchaseCost * item.purchaseConversion, 2), unit: item.purchaseUnit,
      }
    })
  })
  const [done, setDone] = useState<PurchaseOrder | null>(null)

  const supplier = derived.supplierById.get(supplierId)
  const vendorItems = state.items.filter((i) => i.active && !i.isPrep && i.defaultSupplierId === supplierId)
  const total = lines.reduce((s, l) => s + l.qty * l.rate, 0)

  const add = (itemId: ID | null) => {
    if (!itemId || lines.some((l) => l.itemId === itemId)) return
    const item = derived.itemById.get(itemId)
    if (!item) return
    setLines([...lines, { id: uid('pol'), itemId, qty: 1, rate: round(item.lastPurchaseCost * item.purchaseConversion, 2), unit: item.purchaseUnit }])
  }
  const setQty = (id: ID, qty: number) => setLines(lines.map((l) => (l.id === id ? { ...l, qty: Math.max(0, qty) } : l)))

  const send = async () => {
    const usable = lines.filter((l) => l.qty > 0)
    if (!usable.length || !supplier) return
    const po: PurchaseOrder = {
      id: uid('po'), poNo: `PO-${Date.now().toString(36).toUpperCase()}`, supplierId, date: derived.today,
      expectedDate: expected, status: 'SENT', createdBy: user?.id ?? null,
      sentAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      lines: usable.map((l): POLine => ({ id: l.id, itemId: l.itemId, qty: l.qty, unit: l.unit as never, rate: l.rate, acceptedBase: 0 })),
    }
    await actions.savePurchaseOrder(po)
    push({ kind: 'ok', title: `${po.poNo} sent to ${supplier.name}` })
    setDone(po)
  }

  if (done) {
    return (
      <DoneScreen
        title={`Order sent to ${supplier?.name}`}
        detail={`${done.lines.length} items · ${money(total)} · expected ${dayLabel(done.expectedDate)}. The store will check it in when it arrives.`}
        onDone={() => navigate('/buy')}
      />
    )
  }

  return (
    <>
      <div className="big-title">New order</div>
      <div className="big-sub">Pick the vendor, then the items. Quantities are in the units the vendor bills in.</div>

      <div className="stack">
        <div>
          <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>Vendor</label>
          <select className="select" style={{ fontSize: 16, padding: 12 }} value={supplierId}
            onChange={(e) => { setSupplierId(e.target.value); setLines([]); setExpected(addDays(derived.today, derived.supplierById.get(e.target.value)?.leadTimeDays ?? 1)) }}>
            {state.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>Needed by</label>
          <input className="input" style={{ fontSize: 16, padding: 12 }} type="date" min={derived.today} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </div>
        <div>
          <label className="dim" style={{ fontSize: 13, fontWeight: 600 }}>Add an item{supplier ? ` from ${supplier.name}` : ''}</label>
          <CascadeSelect
            categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
            items={vendorItems.length ? vendorItems : state.items.filter((i) => i.active && !i.isPrep)}
            value={null} onChange={add} placeholder="Choose item"
          />
        </div>

        <div className="big-list">
          {lines.map((l) => {
            const item = derived.itemById.get(l.itemId)!
            const onHand = derived.onHand.get(l.itemId) ?? 0
            return (
              <div key={l.id} className="recv-line">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{item.name}</div>
                    <div className="dim" style={{ fontSize: 13 }}>{fmtQty(onHand, item.baseUnit)} on hand · {money(l.rate)}/{l.unit}</div>
                  </div>
                  <button className="icon-btn" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>✕</button>
                </div>
                <div className="row" style={{ marginTop: 10, gap: 12 }}>
                  <div className="stepper" style={{ flex: 1 }}>
                    <button onClick={() => setQty(l.id, l.qty - 1)}>−</button>
                    <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value) || 0)} />
                    <button onClick={() => setQty(l.id, l.qty + 1)}>+</button>
                  </div>
                  <span className="unit-tag" style={{ fontSize: 14 }}>{l.unit}</span>
                  <span className="num" style={{ minWidth: 80, textAlign: 'right' }}>{money(l.qty * l.rate)}</span>
                </div>
              </div>
            )
          })}
          {!lines.length && <div className="empty">No items yet.</div>}
        </div>
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 62, padding: '10px 16px', background: 'linear-gradient(transparent, var(--bg) 40%)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }} className="row">
          <button className="big-btn ghost" style={{ flex: 1 }} onClick={() => navigate('/buy')}>Back</button>
          <button className="big-btn primary" style={{ flex: 2 }} disabled={!lines.some((l) => l.qty > 0)} onClick={send}>
            Send order · {money(total)}
          </button>
        </div>
      </div>
    </>
  )
}

/* ================================================================== */

export function OrderList() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const orders = [...state.purchaseOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60)
  const tone = (s: PurchaseOrder['status']) => s === 'SENT' ? 'info' : s === 'RECEIVED' ? 'ok' : s === 'PARTIAL' ? 'watch' : 'neutral'
  const label = (s: PurchaseOrder['status']) => s === 'SENT' ? 'Waiting' : s === 'RECEIVED' ? 'Received' : s === 'PARTIAL' ? 'Part received' : s === 'CANCELLED' ? 'Cancelled' : 'Draft'

  return (
    <>
      <div className="big-title">Orders</div>
      <div className="big-sub">Newest first.</div>
      <div className="big-list">
        {orders.map((po) => {
          const late = po.status === 'SENT' && po.expectedDate < derived.today
          return (
            <button key={po.id} className="big-row" onClick={() => navigate(`/buy/view/${po.id}`)}>
              <div className="main">
                <div className="name">{derived.supplierById.get(po.supplierId)?.name}</div>
                <div className="meta">{po.poNo} · {dayLabel(po.date)} · {po.lines.length} items · {money(po.lines.reduce((s, l) => s + l.qty * l.rate, 0))}</div>
              </div>
              <Badge kind={late ? 'critical' : tone(po.status)}>{late ? 'Late' : label(po.status)}</Badge>
              <span className="chev">›</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

export function ViewOrder() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const { poId } = useParams()
  const po = state.purchaseOrders.find((p) => p.id === poId)
  if (!po) return <div className="empty">Order not found.</div>
  const receipts = state.receipts.filter((g) => g.poId === po.id)

  return (
    <>
      <div className="big-title">{po.poNo}</div>
      <div className="big-sub">{derived.supplierById.get(po.supplierId)?.name} · sent {dayLabel(po.date)} · expected {dayLabel(po.expectedDate)}</div>
      <div className="big-list">
        {po.lines.map((l) => {
          const item = derived.itemById.get(l.itemId)!
          const acceptedPU = l.acceptedBase / item.purchaseConversion
          return (
            <div key={l.id} className="recv-line">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{item.name}</div>
                  <div className="dim" style={{ fontSize: 13 }}>{num(l.qty, 2)} {l.unit} at {money(l.rate)} = {money(l.qty * l.rate)}</div>
                </div>
                {po.status !== 'SENT' && (
                  <Badge kind={acceptedPU >= l.qty * 0.95 ? 'ok' : 'watch'}>{num(acceptedPU, 2)} {l.unit} accepted</Badge>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {receipts.length > 0 && (
        <p className="dim" style={{ fontSize: 13, marginTop: 12 }}>
          Checked in as {receipts.map((g) => `${g.grnNo} on ${dayLabel(g.date)}`).join(', ')}.
        </p>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="big-btn ghost" style={{ flex: 1 }} onClick={() => navigate('/buy/list')}>Back</button>
        {po.status === 'SENT' && (
          <button className="big-btn" style={{ flex: 1 }} onClick={async () => {
            await actions.savePurchaseOrder({ ...po, status: 'CANCELLED' })
            push({ kind: 'ok', title: `${po.poNo} cancelled` })
            navigate('/buy/list')
          }}>Cancel order</button>
        )}
      </div>
    </>
  )
}
