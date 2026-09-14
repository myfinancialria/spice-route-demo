import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, Empty, Modal, Search, Tile } from '../components/ui'
import { PeriodPills, usePeriod } from './shared'
import { issueLabel } from '../core/alerts'
import { dayLabel, longDate } from '../core/dates'
import { money, moneyShort, num, pct } from '../lib/format'
import type { GoodsReceipt, PurchaseOrder } from '../core/types'

const PO_LABEL: Record<PurchaseOrder['status'], { label: string; kind: string }> = {
  DRAFT: { label: 'Draft', kind: 'neutral' }, SENT: { label: 'Waiting', kind: 'info' },
  PARTIAL: { label: 'Part received', kind: 'watch' }, RECEIVED: { label: 'Received', kind: 'ok' },
  CANCELLED: { label: 'Cancelled', kind: 'neutral' },
}

export function PurchaseOrders() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(30)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<PurchaseOrder | null>(null)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.purchaseOrders
      .filter((p) => (p.date >= from && p.date <= to) || p.status === 'SENT')
      .filter((p) => !term || p.poNo.toLowerCase().includes(term) || (derived.supplierById.get(p.supplierId)?.name ?? '').toLowerCase().includes(term))
      .map((p) => ({ po: p, value: p.lines.reduce((s, l) => s + l.qty * l.rate, 0), late: p.status === 'SENT' && p.expectedDate < derived.today }))
      .sort((a, b) => b.po.date.localeCompare(a.po.date))
  }, [state.purchaseOrders, derived, from, to, search])

  const waiting = rows.filter((r) => r.po.status === 'SENT')
  const receipts = open ? state.receipts.filter((g) => g.poId === open.id) : []

  return (
    <>
      <PageHead
        title="Purchase Orders"
        sub="What the purchase manager has sent to vendors, and how much of each order actually turned up."
        actions={
          <>
            <Search value={search} onChange={setSearch} placeholder="PO number or vendor" />
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn btn-primary" onClick={() => navigate('/buy/new')}>+ New order</button>
          </>
        }
      />
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Waiting for delivery" value={num(waiting.length)} foot={moneyShort(waiting.reduce((s, r) => s + r.value, 0))} accent="var(--info)" />
        <Tile label="Late" value={num(waiting.filter((r) => r.late).length)} foot="past their expected date" accent="var(--neg)" />
        <Tile label="Ordered" value={moneyShort(rows.reduce((s, r) => s + r.value, 0))} foot={`${rows.length} orders in ${days} days`} accent="var(--brand)" />
        <Tile label="Received in full" value={pct(rows.length ? (rows.filter((r) => r.po.status === 'RECEIVED').length / rows.length) * 100 : 0, 0)} foot="of orders in the period" />
      </div>
      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Sent</th><th>PO</th><th>Vendor</th><th className="num">Items</th><th className="num">Value</th><th>Expected</th><th>Status</th><th>By</th><th /></tr></thead>
            <tbody>
              {rows.map(({ po, value, late }) => (
                <tr key={po.id} className="clickable" onClick={() => setOpen(po)}>
                  <td className="nowrap">{dayLabel(po.date)}</td>
                  <td className="mono-sm">{po.poNo}</td>
                  <td>{derived.supplierById.get(po.supplierId)?.name}</td>
                  <td className="num">{po.lines.length}</td>
                  <td className="num">{money(value)}</td>
                  <td className={late ? 'neg' : 'dim'}>{dayLabel(po.expectedDate)}</td>
                  <td><Badge kind={late ? 'critical' : PO_LABEL[po.status].kind}>{late ? 'Late' : PO_LABEL[po.status].label}</Badge></td>
                  <td className="dim">{po.createdBy ? derived.staffById.get(po.createdBy)?.name.split(' ')[0] : '—'}</td>
                  <td className="right dim">›</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9}><Empty icon="📝" title="No orders in this period" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {open && (
        <Modal title={open.poNo} sub={`${derived.supplierById.get(open.supplierId)?.name} · sent ${longDate(open.date)} · expected ${longDate(open.expectedDate)}`} size="wide" onClose={() => setOpen(null)}>
          <table className="tbl compact">
            <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Rate</th><th className="num">Value</th><th className="num">Accepted</th></tr></thead>
            <tbody>
              {open.lines.map((l) => {
                const item = derived.itemById.get(l.itemId)
                const accepted = item ? l.acceptedBase / item.purchaseConversion : 0
                return (
                  <tr key={l.id}>
                    <td>{item?.name}</td>
                    <td className="num">{num(l.qty, 2)} {l.unit}</td>
                    <td className="num dim">{money(l.rate, 2)}</td>
                    <td className="num">{money(l.qty * l.rate)}</td>
                    <td className={`num ${open.status === 'SENT' ? 'dim' : accepted >= l.qty * 0.95 ? 'pos' : 'neg'}`}>
                      {open.status === 'SENT' ? '—' : `${num(accepted, 2)} ${l.unit}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <Badge kind={PO_LABEL[open.status].kind}>{PO_LABEL[open.status].label}</Badge>
            {receipts.map((g) => <Badge key={g.id} kind="neutral">{g.grnNo} · {dayLabel(g.date)}</Badge>)}
            {open.status === 'SENT' && <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/receive/${open.id}`)}>Check it in →</button>}
          </div>
        </Modal>
      )}
    </>
  )
}

export function GoodsReceipts() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(30)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<GoodsReceipt | null>(null)
  const [onlyIssues, setOnlyIssues] = useState(false)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.receipts
      .filter((g) => g.date >= from && g.date <= to)
      .filter((g) => !term || g.grnNo.toLowerCase().includes(term) || (g.invoiceNo ?? '').toLowerCase().includes(term) || (derived.supplierById.get(g.supplierId)?.name ?? '').toLowerCase().includes(term))
      .map((g) => {
        let accepted = 0; let lost = 0; let issues = 0
        for (const l of g.lines) {
          const acc = Math.max(l.receivedQty - l.damagedQty, 0)
          accepted += acc * l.rate
          const short = Math.max(l.orderedQty - l.receivedQty, 0)
          if (short > 0 || l.damagedQty > 0) { issues++; lost += (short + l.damagedQty) * l.rate }
        }
        return { grn: g, accepted, lost, issues }
      })
      .filter((r) => !onlyIssues || r.issues > 0)
      .sort((a, b) => b.grn.date.localeCompare(a.grn.date))
  }, [state.receipts, derived, from, to, search, onlyIssues])

  const totalLost = rows.reduce((s, r) => s + r.lost, 0)
  const bySupplier = useMemo(() => {
    const m = new Map<string, { lost: number; n: number }>()
    for (const r of rows) {
      const name = derived.supplierById.get(r.grn.supplierId)?.name ?? '—'
      const cur = m.get(name) ?? { lost: 0, n: 0 }
      cur.lost += r.lost; cur.n += r.issues
      m.set(name, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].lost - a[1].lost)
  }, [rows, derived])

  return (
    <>
      <PageHead
        title="Goods Receipts"
        sub="Every delivery the store checked in, with what was short or refused. The lost value is what to chase vendors for."
        actions={
          <>
            <Search value={search} onChange={setSearch} placeholder="GRN, invoice or vendor" />
            <button className={`btn btn-sm${onlyIssues ? ' btn-primary' : ''}`} onClick={() => setOnlyIssues(!onlyIssues)}>{onlyIssues ? 'Showing problems' : 'Show problems only'}</button>
            <PeriodPills days={days} setDays={setDays} />
          </>
        }
      />
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Received" value={moneyShort(rows.reduce((s, r) => s + r.accepted, 0))} foot={`${rows.length} deliveries`} accent="var(--pos)" />
        <Tile label="Short or refused" value={moneyShort(totalLost)} foot="to recover from vendors" accent="var(--neg)" />
        <Tile label="Deliveries with issues" value={num(rows.filter((r) => r.issues > 0).length)} foot={pct(rows.length ? (rows.filter((r) => r.issues > 0).length / rows.length) * 100 : 0, 0) + ' of deliveries'} accent="var(--warn)" />
        <Tile label="Worst vendor" value={bySupplier[0]?.[0] ?? '—'} foot={bySupplier[0] ? `${moneyShort(bySupplier[0][1].lost)} lost` : ''} />
      </div>
      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th>GRN</th><th>Vendor</th><th>Invoice</th><th className="num">Items</th><th className="num">Accepted</th><th className="num">Lost</th><th>Checked by</th><th /></tr></thead>
            <tbody>
              {rows.map(({ grn, accepted, lost, issues }) => (
                <tr key={grn.id} className={`clickable${issues ? ' sev-WATCH' : ''}`} onClick={() => setOpen(grn)}>
                  <td className="nowrap">{dayLabel(grn.date)}</td>
                  <td className="mono-sm">{grn.grnNo}</td>
                  <td>{derived.supplierById.get(grn.supplierId)?.name}</td>
                  <td className="dim mono-sm">{grn.invoiceNo ?? '—'}</td>
                  <td className="num">{grn.lines.length}</td>
                  <td className="num">{money(accepted)}</td>
                  <td className={`num ${lost ? 'neg' : 'dim'}`}>{lost ? money(lost) : '—'}</td>
                  <td className="dim">{grn.receivedBy ? derived.staffById.get(grn.receivedBy)?.name.split(' ')[0] : '—'}</td>
                  <td className="right">{issues ? <Badge kind="watch">{issues} flagged</Badge> : <span className="dim">›</span>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9}><Empty icon="📥" title="No deliveries in this period" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {open && (
        <Modal title={open.grnNo} sub={`${derived.supplierById.get(open.supplierId)?.name} · ${longDate(open.date)}${open.poId ? ` · against ${state.purchaseOrders.find((p) => p.id === open.poId)?.poNo ?? 'an order'}` : ' · no order'}`} size="wide" onClose={() => setOpen(null)}>
          <table className="tbl compact">
            <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Refused</th><th className="num">Missing</th><th className="num">Rate</th><th className="num">Into stock</th><th>Issue</th></tr></thead>
            <tbody>
              {open.lines.map((l) => {
                const item = derived.itemById.get(l.itemId)
                const missing = Math.max(l.orderedQty - l.receivedQty, 0)
                const accepted = Math.max(l.receivedQty - l.damagedQty, 0)
                return (
                  <tr key={l.id} className={missing > 0 || l.damagedQty > 0 ? 'sev-WATCH' : ''}>
                    <td>{item?.name}</td>
                    <td className="num dim">{num(l.orderedQty, 2)} {l.unit}</td>
                    <td className="num">{num(l.receivedQty, 2)}</td>
                    <td className={`num ${l.damagedQty ? 'neg' : 'dim'}`}>{l.damagedQty ? num(l.damagedQty, 2) : '—'}</td>
                    <td className={`num ${missing ? 'neg' : 'dim'}`}>{missing ? num(missing, 2) : '—'}</td>
                    <td className="num dim">{money(l.rate, 2)}</td>
                    <td className="num">{money(accepted * l.rate)}</td>
                    <td className="dim">{l.issue ? issueLabel(l.issue) : ''}{l.note ? ` — ${l.note}` : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-sm" onClick={() => { setOpen(null); navigate('/alerts') }}>See the alerts it raised</button>
          </div>
        </Modal>
      )}
    </>
  )
}
