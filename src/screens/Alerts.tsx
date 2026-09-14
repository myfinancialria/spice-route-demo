import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, Empty, Modal, Pills, SeverityBadge, Tile, useToast } from '../components/ui'
import { ItemDrawer } from './shared'
import { ALERT_KIND_LABEL, alertPriority } from '../core/alerts'
import { dayLabel } from '../core/dates'
import { money, moneyShort, num } from '../lib/format'
import type { Alert, AlertKind, AlertStatus, ID } from '../core/types'

type StatusFilter = AlertStatus | 'ALL'

/**
 * The manager's inbox. Everything the system found, ranked so the top of the
 * list is always the most expensive thing that is most certainly wrong.
 */
export default function Alerts() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const [status, setStatus] = useState<StatusFilter>('OPEN')
  const [kind, setKind] = useState<AlertKind | 'ALL'>('ALL')
  const [sort, setSort] = useState<'priority' | 'impact' | 'date'>('priority')
  const [expanded, setExpanded] = useState<ID | null>(null)
  const [resolving, setResolving] = useState<Alert | null>(null)
  const [note, setNote] = useState('')
  const [drill, setDrill] = useState<ID | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    let list = state.alerts.filter((a) => (status === 'ALL' || a.status === status) && (kind === 'ALL' || a.kind === kind))
    if (sort === 'priority') list = [...list].sort((a, b) => alertPriority(b) - alertPriority(a))
    else if (sort === 'impact') list = [...list].sort((a, b) => b.impact - a.impact)
    else list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return list
  }, [state.alerts, status, kind, sort])

  const open = state.alerts.filter((a) => a.status === 'OPEN')
  const counts = {
    CRITICAL: open.filter((a) => a.severity === 'CRITICAL').length,
    HIGH: open.filter((a) => a.severity === 'HIGH').length,
    WATCH: open.filter((a) => a.severity === 'WATCH').length,
  }
  const atStake = open.reduce((s, a) => s + a.impact, 0)
  const kinds = [...new Set(state.alerts.map((a) => a.kind))]

  const act = async (a: Alert, next: AlertStatus, n?: string) => {
    setBusy(true)
    try {
      await actions.setAlertStatus(a.id, next, n)
      push({ kind: 'ok', title: next === 'RESOLVED' ? 'Resolved' : 'Acknowledged', msg: a.title })
    } finally {
      setBusy(false)
      setResolving(null)
      setNote('')
    }
  }

  const refresh = async () => {
    setBusy(true)
    try {
      const fresh = await actions.refreshAlerts(derived.today)
      push({ kind: 'ok', title: 'Checked again', msg: `${fresh.length} open alert${fresh.length === 1 ? '' : 's'}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead
        title="Alerts"
        sub="What the system found when it compared the counts, the deliveries and the sales. Ranked by how wrong and how much."
        actions={
          <>
            <Pills value={sort} onChange={setSort} options={[
              { value: 'priority', label: 'By priority' }, { value: 'impact', label: 'By ₹ impact' }, { value: 'date', label: 'Newest' },
            ]} />
            <button className="btn" disabled={busy} onClick={refresh}>↻ Check again</button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Critical" value={num(counts.CRITICAL)} foot="act today" accent="var(--neg)" onClick={() => { setStatus('OPEN'); setKind('ALL') }} />
        <Tile label="High" value={num(counts.HIGH)} foot="this week" accent="#f08c3c" />
        <Tile label="Watch" value={num(counts.WATCH)} foot="keep an eye on" accent="var(--warn)" />
        <Tile label="At stake" value={moneyShort(atStake)} foot="across everything open" accent="var(--brand)" />
      </div>

      <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <Pills value={status} onChange={setStatus} options={[
          { value: 'OPEN', label: `Open (${open.length})` }, { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
          { value: 'RESOLVED', label: 'Resolved' }, { value: 'ALL', label: 'All' },
        ]} />
        <div className="pill-row">
          <button className={`pill${kind === 'ALL' ? ' active' : ''}`} onClick={() => setKind('ALL')}>All types</button>
          {kinds.map((k) => (
            <button key={k} className={`pill${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>{ALERT_KIND_LABEL[k]}</button>
          ))}
        </div>
      </div>

      <Card flush>
        {rows.length === 0 ? (
          <Empty icon="✅" title="Nothing here">No alerts match this filter.</Empty>
        ) : (
          <div className="drill">
            {rows.map((a) => {
              const isOpen = expanded === a.id
              return (
                <div key={a.id} className={`sev-${a.severity}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="drill-row" style={{ borderBottom: 0 }} onClick={() => setExpanded(isOpen ? null : a.id)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <SeverityBadge severity={a.severity} />
                        <Badge kind="neutral">{ALERT_KIND_LABEL[a.kind]}</Badge>
                        <span className="dim" style={{ fontSize: 12 }}>{dayLabel(a.date)}</span>
                        {a.status !== 'OPEN' && <Badge kind={a.status === 'RESOLVED' ? 'ok' : 'info'}>{a.status === 'RESOLVED' ? 'Resolved' : 'Acknowledged'}</Badge>}
                      </div>
                      <div style={{ fontWeight: 600, marginTop: 5 }}>{a.title}</div>
                      {isOpen && <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 80 * 8 }}>{a.detail}</div>}
                      {isOpen && a.note && <div className="step-ccp" style={{ display: 'inline-block', marginTop: 8 }}>📝 {a.note}</div>}
                      {isOpen && a.actedBy && (
                        <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                          {a.status === 'RESOLVED' ? 'Resolved' : 'Acknowledged'} by {derived.staffById.get(a.actedBy)?.name ?? '—'}{a.actedAt ? ` on ${dayLabel(a.actedAt.slice(0, 10))}` : ''}
                        </div>
                      )}
                    </div>
                    <div className="right" style={{ minWidth: 90 }}>
                      <div className={`num ${a.impact > 0 ? 'neg' : 'dim'}`} style={{ fontWeight: 600 }}>{a.impact > 0 ? money(a.impact) : '—'}</div>
                      <div className="dim" style={{ fontSize: 11 }}>{isOpen ? 'hide' : 'details'}</div>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="row" style={{ padding: '0 12px 12px', gap: 8 }}>
                      {a.itemId && <button className="btn btn-sm" onClick={() => setDrill(a.itemId!)}>Item history</button>}
                      {a.kind === 'VARIANCE' && <button className="btn btn-sm" onClick={() => navigate('/eod/variance')}>Open variance review</button>}
                      {a.kind === 'PO_OVERDUE' && <button className="btn btn-sm" onClick={() => navigate('/purchase/orders')}>Open the order</button>}
                      {a.kind === 'RECEIPT_ISSUE' && <button className="btn btn-sm" onClick={() => navigate('/purchase/receipts')}>Open the receipt</button>}
                      {a.kind === 'LOW_STOCK' && <button className="btn btn-sm" onClick={() => navigate('/buy/new')}>Raise an order</button>}
                      <span className="grow" />
                      {a.status === 'OPEN' && <button className="btn btn-sm" disabled={busy} onClick={() => act(a, 'ACKNOWLEDGED')}>Acknowledge</button>}
                      {a.status !== 'RESOLVED' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => { setResolving(a); setNote('') }}>Resolve…</button>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {resolving && (
        <Modal title="Resolve this alert" sub={resolving.title} onClose={() => setResolving(null)}
          footer={
            <>
              <button className="btn" onClick={() => setResolving(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => act(resolving, 'RESOLVED', note || undefined)}>Mark resolved</button>
            </>
          }>
          <label className="dim" style={{ fontSize: 12, fontWeight: 600 }}>What was done (optional, but tomorrow-you will want it)</label>
          <textarea className="input" rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Credit note raised with Al-Barkat for 3.2 kg" />
          <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>Resolving as {user?.name}.</p>
        </Modal>
      )}
      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}
