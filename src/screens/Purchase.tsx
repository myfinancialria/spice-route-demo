import { useCallback, useMemo, useRef, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, CascadeSelect, Empty, Field, Modal, Search, Tile, useToast } from '../components/ui'
import { TrendLine } from '../components/charts'
import { ItemDrawer, PeriodPills, usePeriod } from './shared'
import { uid } from '../data/commands'
import { addDays, dayLabel, iso, longDate } from '../core/dates'
import { priceImpact } from '../core/costing'
import { round, toBase } from '../core/units'
import { loadAliases, parseBill, rememberAlias, type ParsedBill } from '../lib/pdf'
import { downloadText, money, moneyShort, num, pct, qty as fmtQty, signedPct, toCsv } from '../lib/format'
import type { GRNLine, GoodsReceipt, ID, PurchaseBillLine, PurchaseUnit, Supplier } from '../core/types'
import { PurchaseOrders, GoodsReceipts } from './Procurement'

export default function Purchase() {
  return (
    <Routes>
      <Route path="orders" element={<PurchaseOrders />} />
      <Route path="receipts" element={<GoodsReceipts />} />
      <Route path="upload" element={<BillEntry mode="PDF" />} />
      <Route path="manual" element={<BillEntry mode="MANUAL" />} />
      <Route path="register" element={<Register />} />
      <Route path="prices" element={<PriceWatch />} />
      <Route path="suppliers" element={<Suppliers />} />
      <Route path="*" element={<Register />} />
    </Routes>
  )
}

/* ================================================================== */
/* Bill entry — shared by the PDF and manual paths                     */
/* ================================================================== */

interface DraftLine extends PurchaseBillLine {
  raw?: string
  confidence?: number
  matched?: boolean
}

function BillEntry({ mode }: { mode: 'PDF' | 'MANUAL' }) {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [parsed, setParsed] = useState<ParsedBill | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState<ID>(state.suppliers[0]?.id ?? '')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(derived.today)
  const [locationId, setLocationId] = useState<ID>('loc_store')
  const [otherCharges, setOtherCharges] = useState(0)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [picker, setPicker] = useState<{ lineId: ID; description: string } | null>(null)

  const supplier = state.suppliers.find((s) => s.id === supplierId)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      push({ kind: 'err', title: 'Not a PDF', msg: 'For photos of a handwritten bill, use manual entry instead.' })
      return
    }
    setBusy(true)
    setFileName(file.name)
    try {
      const result = await parseBill(file, state.items, state.suppliers, loadAliases())
      setParsed(result)
      if (result.supplierId) setSupplierId(result.supplierId)
      if (result.billNo) setBillNo(result.billNo)
      if (result.billDate) setBillDate(result.billDate)
      setLines(result.lines.map((l, i) => {
        const item = l.itemId ? derived.itemById.get(l.itemId) : undefined
        return {
          id: uid('bl'), itemId: l.itemId ?? '', qty: l.qty ?? 0,
          unit: (l.unit ?? item?.purchaseUnit ?? 'kg') as PurchaseUnit,
          rate: l.rate ?? 0, discount: 0, taxPct: item?.gstPct ?? 5,
          rawText: l.raw, raw: l.description, confidence: l.confidence,
          matched: !!l.itemId,
        }
      }))
      const unmatched = result.lines.filter((l) => !l.itemId).length
      push({
        kind: unmatched ? 'warn' : 'ok',
        title: `Read ${result.lines.length} lines from ${file.name}`,
        msg: unmatched
          ? `${unmatched} could not be matched to an item — pick them below and it will remember for next time.`
          : 'All lines matched. Check the quantities and post.',
      })
    } catch (err) {
      console.error(err)
      push({ kind: 'err', title: 'Could not read that PDF', msg: 'It may be a scan with no text layer. Enter it manually instead.' })
    } finally {
      setBusy(false)
    }
  }, [derived.itemById, push, state.items, state.suppliers])

  const addBlankLine = (itemId: ID | null) => {
    if (!itemId) return
    const item = derived.itemById.get(itemId)
    if (!item) return
    setLines((prev) => [...prev, {
      id: uid('bl'), itemId, qty: 0, unit: item.purchaseUnit,
      rate: round(item.lastPurchaseCost * item.purchaseConversion, 2),
      discount: 0, taxPct: item.gstPct, matched: true,
    }])
  }

  const patch = (id: ID, p: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...p } : l)))
  const drop = (id: ID) => setLines((prev) => prev.filter((l) => l.id !== id))

  const totals = useMemo(() => {
    let net = 0
    let tax = 0
    for (const l of lines) {
      const value = l.qty * l.rate - (l.discount || 0)
      net += value
      tax += value * ((l.taxPct || 0) / 100)
    }
    return { net: round(net, 2), tax: round(tax, 2), gross: round(net + tax + otherCharges, 2) }
  }, [lines, otherCharges])

  // Flag anything whose rate has moved far from the last purchase — nearly
  // always a unit mix-up (a per-kg rate typed against a per-gram quantity).
  const warnings = useMemo(() => {
    const out: { lineId: ID; text: string }[] = []
    for (const l of lines) {
      const item = l.itemId ? derived.itemById.get(l.itemId) : null
      if (!item || !l.rate) continue
      const perBase = toBase(item, l.qty, l.unit) > 0 ? (l.qty * l.rate) / toBase(item, l.qty, l.unit) : 0
      if (item.lastPurchaseCost > 0 && perBase > 0) {
        const jump = (perBase - item.lastPurchaseCost) / item.lastPurchaseCost
        if (Math.abs(jump) > 0.3) {
          out.push({
            lineId: l.id,
            text: `${item.name}: ${signedPct(jump * 100, 0)} against the last purchase (${money(item.lastPurchaseCost * item.purchaseConversion, 2)}/${item.purchaseUnit})`,
          })
        }
      }
    }
    return out
  }, [lines, derived.itemById])

  const ready = lines.length > 0 && lines.every((l) => l.itemId && l.qty > 0 && l.rate >= 0) && !!supplierId && !!billNo

  const post = async () => {
    // A bill entered by hand or read off a PDF is still a delivery: it goes
    // through the same receipt path as an order, just without an order.
    const grnLines: GRNLine[] = lines.map((l) => ({
      id: l.id, itemId: l.itemId, orderedQty: l.qty, receivedQty: l.qty, damagedQty: 0,
      unit: l.unit, rate: l.discount ? round(l.rate - l.discount / (l.qty || 1), 4) : l.rate,
      taxPct: l.taxPct, batchNo: l.batchNo, expiryDate: l.expiryDate,
    }))
    const grn: GoodsReceipt = {
      id: uid('grn'), grnNo: `GRN-${Date.now().toString(36).toUpperCase()}`, poId: null,
      supplierId, date: billDate, locationId, lines: grnLines, invoiceNo: billNo,
      attachmentName: fileName ?? undefined, entryMode: mode, status: 'POSTED',
      receivedBy: user?.id ?? null, notes: otherCharges ? `Other charges ${money(otherCharges)}` : undefined,
      createdAt: new Date().toISOString(),
    }
    const result = await actions.postGoodsReceipt(grn)
    for (const l of lines) {
      if (l.raw && l.itemId) rememberAlias(l.raw, l.itemId)
    }
    push({
      kind: 'ok', title: 'Bill posted',
      msg: `${lines.length} lines · ${money(totals.gross)} added to ${derived.locationById.get(locationId)?.name}`,
    })
    if (result.warnings.length) {
      push({ kind: 'warn', title: 'Worth a look', msg: result.warnings.slice(0, 3).join(' · ') })
    }
    navigate('/purchase/register')
  }

  return (
    <>
      <PageHead
        title={mode === 'PDF' ? 'Upload a Supplier Bill' : 'Manual Bill Entry'}
        sub={
          mode === 'PDF'
            ? 'Drop the PDF in. Lines are read off the invoice and matched to your items — correct anything it got wrong and it will remember that wording next time.'
            : 'Built for handwritten kaccha bills. Pick a category, pick the item, type the quantity and rate. Rates default to what you last paid.'
        }
        breadcrumb={[{ label: 'Purchases' }, { label: mode === 'PDF' ? 'Upload Bill' : 'Manual Entry' }]}
        actions={
          mode === 'PDF'
            ? <button className="btn" onClick={() => navigate('/purchase/manual')}>Enter manually instead</button>
            : <button className="btn" onClick={() => navigate('/purchase/upload')}>Upload a PDF instead</button>
        }
      />

      {mode === 'PDF' && !parsed && (
        <Card>
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) void handleFile(f)
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10 }}>{busy ? '⏳' : '📄'}</div>
            <h3>{busy ? 'Reading the invoice…' : 'Drop a supplier invoice here'}</h3>
            <p className="dim" style={{ maxWidth: 420, margin: '6px auto 0', fontSize: 13 }}>
              PDF invoices only. A scanned photo has no text to read — use manual entry for those.
            </p>
            <input
              ref={fileRef} type="file" accept="application/pdf" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
            />
          </div>
        </Card>
      )}

      {(mode === 'MANUAL' || parsed) && (
        <div className="stack">
          <Card title="Bill details">
            <div className="field-row">
              <Field label="Supplier">
                <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  {state.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Bill number">
                <input className="input" value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. 4821" />
              </Field>
              <Field label="Bill date">
                <input className="input" type="date" value={billDate} max={derived.today} onChange={(e) => setBillDate(e.target.value)} />
              </Field>
              <Field label="Receive into" hint="Where the stock physically goes">
                <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {state.locations.filter((l) => l.kind !== 'KITCHEN').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            </div>
            {parsed && (
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <Badge kind="info">read from {fileName}</Badge>
                {parsed.supplierGuess && <Badge kind="ok">matched {parsed.supplierGuess}</Badge>}
                {parsed.total && <Badge kind="neutral">invoice total {money(parsed.total)}</Badge>}
                <button className="btn btn-sm btn-ghost" onClick={() => { setParsed(null); setLines([]); setFileName(null) }}>
                  Start over
                </button>
              </div>
            )}
          </Card>

          <Card title="Add an item" sub="Category first, then the item beneath it">
            <CascadeSelect
              categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
              items={state.items.filter((i) => i.active && !i.isPrep)}
              value={null} onChange={addBlankLine} placeholder="Choose item"
              itemLabel={(i) => {
                const item = derived.itemById.get(i.id)
                return item ? `${i.name} — last ${money(item.lastPurchaseCost * item.purchaseConversion, 2)}/${item.purchaseUnit}` : i.name
              }}
            />
          </Card>

          {warnings.length > 0 && (
            <Card title={`${warnings.length} rate${warnings.length > 1 ? 's look' : ' looks'} unusual`} sub="check the unit before posting">
              <ul className="list-reset" style={{ fontSize: 12.5 }}>
                {warnings.map((w) => <li key={w.lineId} className="warn" style={{ padding: '2px 0' }}>⚠ {w.text}</li>)}
              </ul>
            </Card>
          )}

          <Card flush>
            {lines.length === 0 ? (
              <Empty icon="🧾" title="No lines yet">Add items above, or upload a PDF to read them off the bill.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="tbl compact">
                  <thead>
                    <tr>
                      <th>Item</th><th className="num" style={{ width: 90 }}>Qty</th>
                      <th style={{ width: 96 }}>Unit</th><th className="num" style={{ width: 104 }}>Rate</th>
                      <th className="num" style={{ width: 88 }}>Discount</th><th className="num" style={{ width: 74 }}>GST %</th>
                      <th className="num">Value</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const item = l.itemId ? derived.itemById.get(l.itemId) : null
                      const value = l.qty * l.rate - (l.discount || 0)
                      return (
                        <tr key={l.id}>
                          <td style={{ minWidth: 210 }}>
                            {item ? (
                              <>
                                <div className="tbl-name">{item.name}</div>
                                <div className="tbl-sub">
                                  {l.raw && l.confidence !== undefined && l.confidence < 1 && (
                                    <span className="dim">from “{l.raw}” · {pct(l.confidence * 100, 0)} sure · </span>
                                  )}
                                  <button
                                    className="btn-ghost" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--brand)' }}
                                    onClick={() => setPicker({ lineId: l.id, description: l.raw ?? item.name })}
                                  >
                                    change
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button className="btn btn-sm btn-danger" onClick={() => setPicker({ lineId: l.id, description: l.raw ?? '' })}>
                                Match “{(l.raw ?? 'unknown').slice(0, 28)}”
                              </button>
                            )}
                          </td>
                          <td><input className="input num" type="number" step="any" value={l.qty || ''} onChange={(e) => patch(l.id, { qty: Number(e.target.value) || 0 })} /></td>
                          <td>
                            <select className="select" value={l.unit} onChange={(e) => patch(l.id, { unit: e.target.value as PurchaseUnit })}>
                              {['kg', 'g', 'litre', 'ml', 'unit', 'packet', 'box', 'tray', 'crate', 'dozen', 'bunch'].map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </td>
                          <td><input className="input num" type="number" step="any" value={l.rate || ''} onChange={(e) => patch(l.id, { rate: Number(e.target.value) || 0 })} /></td>
                          <td><input className="input num" type="number" step="any" value={l.discount || ''} onChange={(e) => patch(l.id, { discount: Number(e.target.value) || 0 })} /></td>
                          <td><input className="input num" type="number" step="any" value={l.taxPct} onChange={(e) => patch(l.id, { taxPct: Number(e.target.value) || 0 })} /></td>
                          <td className="num">{money(value, 2)}</td>
                          <td><button className="icon-btn" onClick={() => drop(l.id)}>✕</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}>{lines.length} lines</td>
                      <td className="num">{money(totals.net, 2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          <div className="sticky-actions">
            <div className="row" style={{ gap: 18 }}>
              <span><span className="dim">Net </span><span className="num">{money(totals.net, 2)}</span></span>
              <span><span className="dim">GST </span><span className="num">{money(totals.tax, 2)}</span></span>
              <span className="row" style={{ gap: 6 }}>
                <span className="dim">Other</span>
                <input className="input num" style={{ width: 88 }} type="number" value={otherCharges || ''}
                  onChange={(e) => setOtherCharges(Number(e.target.value) || 0)} />
              </span>
              <span><strong className="num" style={{ fontSize: 16 }}>{money(totals.gross, 2)}</strong></span>
              {parsed?.total && Math.abs(parsed.total - totals.gross) > 2 && (
                <Badge kind="watch">invoice says {money(parsed.total)}</Badge>
              )}
            </div>
            <div className="row">
              <button className="btn" onClick={() => navigate('/purchase/register')}>Cancel</button>
              <button className="btn btn-primary" disabled={!ready} onClick={post}>
                Post bill &amp; add to stock
              </button>
            </div>
          </div>
        </div>
      )}

      {picker && (
        <Modal title="Match this line to an item" sub={picker.description} onClose={() => setPicker(null)}>
          <CascadeSelect
            categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
            items={state.items.filter((i) => i.active && !i.isPrep)}
            value={null} autoFocus
            onChange={(id) => {
              if (!id) return
              const item = derived.itemById.get(id)
              patch(picker.lineId, {
                itemId: id, matched: true, confidence: 1,
                taxPct: item?.gstPct ?? 5,
                unit: (item?.purchaseUnit ?? 'kg') as PurchaseUnit,
              })
              if (picker.description) rememberAlias(picker.description, id)
              setPicker(null)
            }}
            placeholder="Choose item"
          />
          <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>
            This wording will be remembered, so the same supplier's next invoice matches on its own.
          </p>
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Purchase register                                                   */
/* ================================================================== */

function Register() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(30)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<ID | null>(null)

  const bills = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.receipts
      .filter((g) => g.date >= from && g.date <= to && g.status === 'POSTED')
      .filter((g) => {
        if (!term) return true
        const supplier = derived.supplierById.get(g.supplierId)?.name ?? ''
        return g.grnNo.toLowerCase().includes(term) || (g.invoiceNo ?? '').toLowerCase().includes(term) || supplier.toLowerCase().includes(term)
      })
      .map((g) => {
        const net = g.lines.reduce((s, l) => s + Math.max(l.receivedQty - l.damagedQty, 0) * l.rate, 0)
        const tax = g.lines.reduce((s, l) => s + Math.max(l.receivedQty - l.damagedQty, 0) * l.rate * ((l.taxPct || 0) / 100), 0)
        return {
          bill: { id: g.id, billNo: g.invoiceNo ?? g.grnNo, supplierId: g.supplierId, billDate: g.date, lines: g.lines, entryMode: g.entryMode, status: g.status, locationId: g.locationId, attachmentName: g.attachmentName },
          net, gross: net + tax,
        }
      })
      .sort((a, b) => b.bill.billDate.localeCompare(a.bill.billDate))
  }, [state.receipts, derived.supplierById, from, to, search])

  const total = bills.reduce((s, b) => s + b.gross, 0)
  const bySupplier = useMemo(() => {
    const m = new Map<ID, number>()
    for (const b of bills) m.set(b.bill.supplierId, (m.get(b.bill.supplierId) ?? 0) + b.gross)
    return [...m.entries()].map(([id, v]) => ({ name: derived.supplierById.get(id)?.name ?? id, value: v }))
      .sort((a, b) => b.value - a.value)
  }, [bills, derived.supplierById])

  const detail = open ? bills.find((b) => b.bill.id === open)?.bill ?? null : null

  return (
    <>
      <PageHead
        title="Purchase Register"
        sub="Every bill posted, with the stock movement it created."
        actions={
          <>
            <Search value={search} onChange={setSearch} placeholder="Bill no or supplier" />
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn btn-primary" onClick={() => navigate('/purchase/upload')}>+ New bill</button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Purchases" value={moneyShort(total)} foot={`${bills.length} bills in ${days} days`} accent="var(--brand)" />
        <Tile label="Daily average" value={moneyShort(total / Math.max(days, 1))} foot="including taxes" />
        <Tile label="Suppliers used" value={num(bySupplier.length)} foot={bySupplier[0]?.name ?? '—'} />
        <Tile label="Read from PDF" value={pct(bills.length ? (bills.filter((b) => b.bill.entryMode === 'PDF').length / bills.length) * 100 : 0, 0)}
          foot="rest entered by hand" accent="var(--info)" />
      </div>

      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Bill no</th><th>Supplier</th><th className="num">Lines</th><th className="num">Net</th><th className="num">Total</th><th>Entry</th><th /></tr>
            </thead>
            <tbody>
              {bills.map(({ bill, net, gross }) => (
                <tr key={bill.id} className="clickable" onClick={() => setOpen(bill.id)}>
                  <td className="nowrap">{dayLabel(bill.billDate)}</td>
                  <td className="mono-sm">{bill.billNo}</td>
                  <td>{derived.supplierById.get(bill.supplierId)?.name}</td>
                  <td className="num">{bill.lines.length}</td>
                  <td className="num dim">{money(net)}</td>
                  <td className="num">{money(gross)}</td>
                  <td><Badge kind={bill.entryMode === 'PDF' ? 'info' : bill.entryMode === 'PO' ? 'ok' : 'neutral'}>{bill.entryMode === 'PDF' ? 'PDF' : bill.entryMode === 'PO' ? 'Against order' : 'Manual'}</Badge></td>
                  <td className="right dim">View ›</td>
                </tr>
              ))}
              {!bills.length && <tr><td colSpan={8}><Empty icon="🧾" title="No bills in this period" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {detail && (
        <Modal
          title={`Bill ${detail.billNo}`}
          sub={`${derived.supplierById.get(detail.supplierId)?.name} · ${longDate(detail.billDate)}`}
          size="wide" onClose={() => setOpen(null)}
        >
          <table className="tbl compact">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Value</th><th className="num">GST</th></tr></thead>
            <tbody>
              {detail.lines.map((l) => {
                const item = derived.itemById.get(l.itemId)
                const accepted = Math.max(l.receivedQty - l.damagedQty, 0)
                return (
                  <tr key={l.id}>
                    <td>{item?.name ?? l.itemId}{l.batchNo && <div className="tbl-sub">batch {l.batchNo}</div>}</td>
                    <td className="num">{num(accepted, 2)} {l.unit}</td>
                    <td className="num">{money(l.rate, 2)}</td>
                    <td className="num">{money(accepted * l.rate, 2)}</td>
                    <td className="num dim">{pct(l.taxPct, 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <Badge kind="neutral">into {derived.locationById.get(detail.locationId)?.name}</Badge>
            <Badge kind={detail.status === 'POSTED' ? 'ok' : 'watch'}>{detail.status}</Badge>
            {detail.attachmentName && <Badge kind="info">{detail.attachmentName}</Badge>}
          </div>
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Price watch                                                         */
/* ================================================================== */

function PriceWatch() {
  const { state, derived } = useLedger()
  const { days, setDays, from, to } = usePeriod(60)
  const [focus, setFocus] = useState<ID | null>(null)
  const [drill, setDrill] = useState<ID | null>(null)

  const rows = useMemo(() => {
    // Average purchase rate in the first and last third of the window, so a
    // single odd delivery does not look like a price movement.
    const buckets = new Map<ID, { early: number[]; late: number[] }>()
    const cut = addDays(to, -Math.floor((days * 2) / 3))
    for (const grn of state.receipts) {
      if (grn.date < from || grn.date > to || grn.status !== 'POSTED') continue
      for (const line of grn.lines) {
        const item = derived.itemById.get(line.itemId)
        if (!item || line.receivedQty <= 0) continue
        const perUnit = (line.rate / (toBase(item, 1, line.unit) || 1)) * item.purchaseConversion
        const b = buckets.get(item.id) ?? { early: [], late: [] }
        if (grn.date <= cut) b.early.push(perUnit)
        else b.late.push(perUnit)
        buckets.set(item.id, b)
      }
    }
    const out = []
    for (const [itemId, b] of buckets) {
      if (!b.early.length || !b.late.length) continue
      const item = derived.itemById.get(itemId)!
      const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
      const early = avg(b.early)
      const late = avg(b.late)
      const change = early ? ((late - early) / early) * 100 : 0
      // Annualised spend at the new rate, to rank by rupees rather than percent.
      const consumed = state.movements
        .filter((m) => m.itemId === itemId && m.date >= from && (m.type === 'CONSUMPTION' || m.type === 'PRODUCTION_OUT'))
        .reduce((s, m) => s + Math.abs(m.qty), 0)
      const impact = (consumed / item.purchaseConversion) * (late - early)
      out.push({ item, early, late, change, impact, purchases: b.early.length + b.late.length })
    }
    return out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  }, [state.receipts, state.movements, derived.itemById, from, to, days])

  const focusItem = focus ? derived.itemById.get(focus) : null
  const focusRow = rows.find((r) => r.item.id === focus)
  const impacted = useMemo(() => {
    if (!focusItem || !focusRow) return []
    return priceImpact(
      derived.ctx, state.dishes, focusItem.id,
      focusRow.early / focusItem.purchaseConversion,
      focusRow.late / focusItem.purchaseConversion,
    )
  }, [focusItem, focusRow, derived.ctx, state.dishes])

  const history = useMemo(() => {
    if (!focusItem) return []
    return state.receipts
      .filter((g) => g.status === 'POSTED' && g.date >= from && g.lines.some((l) => l.itemId === focusItem.id && l.receivedQty > 0))
      .map((g) => {
        const l = g.lines.find((x) => x.itemId === focusItem.id)!
        return { date: g.date, label: dayLabel(g.date), rate: round((l.rate / (toBase(focusItem, 1, l.unit) || 1)) * focusItem.purchaseConversion, 2) }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [focusItem, state.receipts, from])

  const risers = rows.filter((r) => r.change > 2)
  const totalImpact = rows.reduce((s, r) => s + r.impact, 0)

  return (
    <>
      <PageHead
        title="Price Watch"
        sub={`Which supplier rates have moved over the last ${days} days, and what that movement is actually costing at current volumes.`}
        actions={<PeriodPills days={days} setDays={setDays} />}
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Items tracked" value={num(rows.length)} foot="bought at least twice" />
        <Tile label="Rates up" value={num(risers.length)} foot="more than 2%" accent="var(--neg)" />
        <Tile label="Cost of the moves" value={moneyShort(totalImpact)} foot={`over the ${days}-day window`}
          accent={totalImpact > 0 ? 'var(--neg)' : 'var(--pos)'} />
        <Tile label="Biggest single mover" value={rows[0] ? signedPct(rows[0].change) : '—'} foot={rows[0]?.item.name ?? ''} />
      </div>

      <div className="grid g-3-2">
        <Card title="Rate movements" sub="ranked by what the change costs, not by percentage" flush>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Item</th><th className="num">Was</th><th className="num">Now</th><th className="num">Change</th><th className="num">Cost of move</th><th /></tr>
              </thead>
              <tbody>
                {rows.slice(0, 24).map((r) => (
                  <tr key={r.item.id} className={`clickable${focus === r.item.id ? ' sev-WATCH' : ''}`} onClick={() => setFocus(r.item.id)}>
                    <td>
                      <div className="tbl-name">{r.item.name}</div>
                      <div className="tbl-sub">{r.purchases} purchases · per {r.item.purchaseUnit}</div>
                    </td>
                    <td className="num dim">{money(r.early, 2)}</td>
                    <td className="num">{money(r.late, 2)}</td>
                    <td className={`num ${r.change > 0 ? 'neg' : 'pos'}`}>{signedPct(r.change)}</td>
                    <td className={`num ${r.impact > 0 ? 'neg' : 'pos'}`}>{money(r.impact)}</td>
                    <td className="right dim">›</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6}><Empty icon="📈" title="Not enough purchase history" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack">
          {focusItem && focusRow ? (
            <>
              <Card
                title={focusItem.name} sub={`rate per ${focusItem.purchaseUnit}, from posted bills`}
                actions={<button className="btn btn-sm btn-ghost" onClick={() => setDrill(focusItem.id)}>Item detail →</button>}
              >
                <TrendLine data={history} xKey="label" format="money" height={170}
                  series={[{ key: 'rate', name: `₹ / ${focusItem.purchaseUnit}` }]} />
              </Card>

              <Card title="What it does to the menu" sub="cost change per plate at the new rate" flush>
                <table className="tbl compact">
                  <thead><tr><th>Dish</th><th className="num">Uses</th><th className="num">Δ cost</th><th className="num">New FC%</th></tr></thead>
                  <tbody>
                    {impacted.slice(0, 12).map((r) => (
                      <tr key={r.dish.id}>
                        <td className="tbl-name">{r.dish.name}</td>
                        <td className="num dim">{fmtQty(r.qtyPerPlate, focusItem.baseUnit, 1)}</td>
                        <td className={`num ${r.costDelta > 0 ? 'neg' : 'pos'}`}>{money(r.costDelta, 2)}</td>
                        <td className="num">{pct(r.newFoodCostPct)}</td>
                      </tr>
                    ))}
                    {!impacted.length && <tr><td colSpan={4} className="dim">Not used in any recipe.</td></tr>}
                  </tbody>
                </table>
              </Card>
            </>
          ) : (
            <Card><Empty icon="👈" title="Pick an item">Select a row to trace the rate change through to every dish that uses it.</Empty></Card>
          )}
        </div>
      </div>

      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

/* ================================================================== */
/* Suppliers                                                           */
/* ================================================================== */

function Suppliers() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const [editing, setEditing] = useState<Supplier | null>(null)

  const rows = useMemo(() => state.suppliers.map((s) => {
    const grns = state.receipts.filter((g) => g.supplierId === s.id && g.status === 'POSTED')
    const spend = grns.reduce((sum, g) => sum + g.lines.reduce((t, l) => t + Math.max(l.receivedQty - l.damagedQty, 0) * l.rate * (1 + (l.taxPct || 0) / 100), 0), 0)
    const lost = grns.reduce((sum, g) => sum + g.lines.reduce((t, l) => t + (Math.max(l.orderedQty - l.receivedQty, 0) + l.damagedQty) * l.rate, 0), 0)
    const items = state.items.filter((i) => i.defaultSupplierId === s.id).length
    return { supplier: s, bills: grns.length, spend, lost, items, last: grns.map((g) => g.date).sort().pop() ?? null }
  }).sort((a, b) => b.spend - a.spend), [state.suppliers, state.receipts, state.items])

  const blank = (): Supplier => ({
    id: uid('sup'), code: `SUP-${String(state.suppliers.length + 1).padStart(3, '0')}`, name: '',
    contact: '', leadTimeDays: 1, paymentTerms: 'Net 7', deliveryScore: 90, qualityScore: 90,
    categoryIds: [], active: true,
  })

  return (
    <>
      <PageHead
        title="Suppliers"
        sub="Lead times drive the reorder alerts; payment terms and scores are here so the buying decision has everything in one place."
        actions={<button className="btn btn-primary" onClick={() => setEditing(blank())}>+ New supplier</button>}
      />
      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Supplier</th><th>Contact</th><th className="num">Lead time</th><th>Terms</th>
                <th className="num">Items</th><th className="num">Deliveries</th><th className="num">Spend</th><th className="num">Short / refused</th>
                <th className="num">Delivery</th><th className="num">Quality</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.supplier.id} className="clickable" onClick={() => setEditing(r.supplier)}>
                  <td>
                    <div className="tbl-name">{r.supplier.name}</div>
                    <div className="tbl-sub">{r.supplier.code}{r.last && ` · last ${dayLabel(r.last)}`}</div>
                  </td>
                  <td className="dim">{r.supplier.contact}</td>
                  <td className="num">{r.supplier.leadTimeDays}d</td>
                  <td className="dim">{r.supplier.paymentTerms}</td>
                  <td className="num">{r.items}</td>
                  <td className="num">{r.bills}</td>
                  <td className="num">{moneyShort(r.spend)}</td>
                  <td className={`num ${r.lost ? 'neg' : 'dim'}`}>{r.lost ? moneyShort(r.lost) : '—'}</td>
                  <td className="num"><span className={r.supplier.deliveryScore >= 90 ? 'pos' : 'warn'}>{r.supplier.deliveryScore}</span></td>
                  <td className="num"><span className={r.supplier.qualityScore >= 90 ? 'pos' : 'warn'}>{r.supplier.qualityScore}</span></td>
                  <td className="right dim">Edit ›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <Modal
          title={editing.name || 'New supplier'} onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!editing.name} onClick={async () => {
                await actions.save('suppliers', editing)
                push({ kind: 'ok', title: 'Supplier saved', msg: editing.name })
                setEditing(null)
              }}>Save</button>
            </>
          }
        >
          <div className="stack">
            <div className="field-row">
              <Field label="Name"><input className="input" value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Code"><input className="input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
            </div>
            <div className="field-row">
              <Field label="Contact"><input className="input" value={editing.contact} onChange={(e) => setEditing({ ...editing, contact: e.target.value })} /></Field>
              <Field label="GSTIN"><input className="input" value={editing.gstin ?? ''} onChange={(e) => setEditing({ ...editing, gstin: e.target.value })} /></Field>
            </div>
            <div className="field-row">
              <Field label="Lead time (days)" hint="Used by the reorder alerts">
                <input className="input num" type="number" value={editing.leadTimeDays} onChange={(e) => setEditing({ ...editing, leadTimeDays: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Payment terms"><input className="input" value={editing.paymentTerms} onChange={(e) => setEditing({ ...editing, paymentTerms: e.target.value })} /></Field>
            </div>
            <div className="field-row">
              <Field label="Delivery score"><input className="input num" type="number" value={editing.deliveryScore} onChange={(e) => setEditing({ ...editing, deliveryScore: Number(e.target.value) || 0 })} /></Field>
              <Field label="Quality score"><input className="input num" type="number" value={editing.qualityScore} onChange={(e) => setEditing({ ...editing, qualityScore: Number(e.target.value) || 0 })} /></Field>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
