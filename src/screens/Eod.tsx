import { useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, Empty, Field, SeverityBadge, Tile, useToast } from '../components/ui'
import { Bars, TrendLine } from '../components/charts'
import { ItemDrawer, PeriodPills, usePeriod } from './shared'
import { VarianceSummaryTiles } from './Stocktake'
import { computeVariance, summarise } from '../core/variance'
import { dishPerformance, filterSales } from '../core/analytics'
import { addDays, dayLabel, longDate } from '../core/dates'
import { round } from '../core/units'
import { downloadText, money, moneyShort, num, pct, qty as fmtQty, signedPct, toCsv } from '../lib/format'
import type { ID, Stocktake, VarianceRow } from '../core/types'

export default function Eod() {
  return (
    <Routes>
      <Route path="close" element={<CloseDay />} />
      <Route path="variance" element={<VarianceReview />} />
      <Route path="history" element={<History />} />
      <Route path="*" element={<CloseDay />} />
    </Routes>
  )
}

/* ================================================================== */
/* Close the day                                                       */
/* ================================================================== */

function CloseDay() {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const navigate = useNavigate()
  const [date, setDate] = useState(derived.today)
  const [notes, setNotes] = useState('')

  const status = useMemo(() => {
    const sales = state.sales.filter((s) => s.date === date && s.status === 'POSTED')
    const perf = dishPerformance(derived.ctx, state.dishes, sales)
    const wastage = state.wastage.filter((w) => w.date === date)
    const takes = state.stocktakes.filter((s) => s.date === date)
    const close = state.dayCloses.find((d) => d.date === date)
    const issues = state.issues.filter((i) => i.date === date)

    let varianceRows: VarianceRow[] = []
    for (const take of takes) {
      const history = state.stocktakes
        .filter((s) => s.locationId === take.locationId && s.date < take.date)
        .map((s) => ({ date: s.date, rows: new Map<ID, number>() }))
      varianceRows = varianceRows.concat(computeVariance({
        items: state.items, categories: state.categories, movements: state.movements,
        stocktake: take, history,
      }))
    }

    return { sales, perf, wastage, takes, close, issues, variance: summarise(varianceRows), varianceRows }
  }, [state, derived.ctx, date])

  const steps = [
    {
      key: 'sales', title: 'Post the day’s sales',
      detail: status.sales.length
        ? `${status.sales.length} channels · ${num(status.perf.totals.dishes)} plates · ${money(status.perf.totals.revenue)}`
        : 'Nothing posted yet — the recipes cannot deplete stock without it',
      done: status.sales.length > 0,
      action: 'Enter sales', to: '/sales/entry',
    },
    {
      key: 'issues', title: 'Record what the kitchen took',
      detail: status.issues.length
        ? `${status.issues.length} issue${status.issues.length > 1 ? 's' : ''} · ${num(status.issues.reduce((s, i) => s + i.lines.length, 0))} lines`
        : 'No transfers from the store today',
      done: status.issues.length > 0,
      action: 'Quick Take', to: '/kitchen/quick-take',
    },
    {
      key: 'wastage', title: 'Log wastage and staff meals',
      detail: status.wastage.length
        ? `${status.wastage.length} entries recorded`
        : 'Nothing logged — anything thrown away today will show up as unexplained variance',
      done: status.wastage.length > 0,
      action: 'Log wastage', to: '/kitchen/wastage',
    },
    {
      key: 'count', title: 'Count the kitchen and store',
      detail: status.takes.length
        ? `${status.takes.map((t) => derived.locationById.get(t.locationId)?.name).join(' and ')} counted`
        : 'A physical count is what turns the ledger into a fact',
      done: status.takes.length > 0,
      action: 'Count kitchen', to: '/kitchen/stocktake',
    },
    {
      key: 'review', title: 'Review the variance',
      detail: status.takes.length
        ? `${status.variance.critical + status.variance.high} items over tolerance · ${money(status.variance.negativeLeak)} short`
        : 'Available once something has been counted',
      done: status.takes.length > 0 && status.close?.status === 'CLOSED',
      action: 'Review', to: '/eod/variance',
    },
  ]

  const completed = steps.filter((s) => s.done).length
  const closed = status.close?.status === 'CLOSED'

  const signOff = async () => {
    await actions.closeDay(date, notes || undefined)
    push({ kind: 'ok', title: `${longDate(date)} closed`, msg: 'The day is locked and will appear in the close history.' })
    setNotes('')
  }

  return (
    <>
      <PageHead
        title="Close the Day"
        sub="Five steps. Each one is a fact the variance report depends on — skipping any of them makes the next morning's numbers a guess."
        actions={
          <>
            <input className="input" style={{ width: 160 }} type="date" value={date} max={derived.today}
              onChange={(e) => setDate(e.target.value)} />
            <Badge kind={closed ? 'ok' : 'watch'}>{closed ? 'Closed' : 'Open'}</Badge>
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <Tile label="Revenue" value={moneyShort(status.perf.totals.revenue)}
          foot={`${num(status.perf.totals.covers)} covers`} accent="var(--brand)" />
        <Tile label="Recipe food cost" value={moneyShort(status.perf.totals.foodCost)}
          foot={pct(status.perf.totals.foodCostPct)} />
        <Tile label="Wastage" value={moneyShort(status.wastage.reduce((s, w) => {
          const item = derived.itemById.get(w.itemId)
          return s + (item ? w.qtyBase * item.avgCost : 0)
        }, 0))} foot={`${status.wastage.length} entries`} accent="var(--warn)" />
        <Tile label="Counted short" value={moneyShort(Math.abs(status.variance.negativeLeak))}
          foot={status.takes.length ? `${status.variance.itemsCounted} items counted` : 'not counted yet'}
          accent="var(--neg)" />
        <Tile label="Steps done" value={`${completed}/5`} foot={closed ? 'signed off' : 'still open'}
          accent={completed === 5 ? 'var(--pos)' : 'var(--warn)'} />
      </div>

      <div className="grid g-2-1">
        <Card title="Day close checklist" flush>
          <div className="drill">
            {steps.map((s, i) => (
              <div key={s.key} className="drill-row" onClick={() => navigate(s.to)}>
                <div className="row" style={{ gap: 12, minWidth: 0 }}>
                  <span className="step-no" style={{
                    background: s.done ? 'var(--pos-soft)' : 'var(--surface-3)',
                    color: s.done ? 'var(--pos)' : 'var(--text-dim)',
                  }}>
                    {s.done ? '✓' : i + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{s.title}</div>
                    <div className="dim" style={{ fontSize: 12 }}>{s.detail}</div>
                  </div>
                </div>
                <span className="btn btn-sm">{s.action} ›</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="stack">
          <Card title="Sign off" sub="a note here is what makes tomorrow's review useful">
            <div className="stack">
              <Field label="Manager's note" hint="Why the variance looks the way it does — a function, a delivery short, a new commis">
                <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 40-cover party at 9pm, chicken drawn twice and not recorded" />
              </Field>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="dim" style={{ fontSize: 12 }}>Closing as {user?.name ?? '—'}</span>
                <button className="btn btn-primary" disabled={closed} onClick={signOff}>
                  {closed ? 'Already closed' : 'Close the day'}
                </button>
              </div>
              {status.close?.notes && (
                <div className="step-ccp" style={{ display: 'block' }}>
                  <strong>Note on file:</strong> {status.close.notes}
                </div>
              )}
            </div>
          </Card>

          {status.takes.length > 0 && (
            <Card title="Worst variances today" flush>
              <table className="tbl compact">
                <tbody>
                  {status.variance.worst.slice(0, 6).map((r) => (
                    <tr key={r.itemId} className={`sev-${r.severity}`}>
                      <td className="tbl-name">{r.name}</td>
                      <td className="num neg">{money(r.varianceValue)}</td>
                      <td><SeverityBadge severity={r.severity} /></td>
                    </tr>
                  ))}
                  {!status.variance.worst.length && (
                    <tr><td className="dim">Everything counted within tolerance.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

/* ================================================================== */
/* Variance review                                                     */
/* ================================================================== */

function VarianceReview() {
  const { state, derived } = useLedger()
  const [locationId, setLocationId] = useState<ID>('loc_kitchen')
  const [takeId, setTakeId] = useState<string>('')
  const [drill, setDrill] = useState<ID | null>(null)
  const [onlyIssues, setOnlyIssues] = useState(true)

  const takes = useMemo(
    () => state.stocktakes.filter((s) => s.locationId === locationId).sort((a, b) => b.date.localeCompare(a.date)),
    [state.stocktakes, locationId],
  )
  const take: Stocktake | undefined = takes.find((t) => t.id === takeId) ?? takes[0]

  const { rows, summary, previous } = useMemo(() => {
    if (!take) return { rows: [] as VarianceRow[], summary: summarise([]), previous: null as string | null }
    const earlier = state.stocktakes
      .filter((s) => s.locationId === take.locationId && s.date < take.date)
      .sort((a, b) => a.date.localeCompare(b.date))

    // Trailing variance % per item, so today can be read against normal rather
    // than against zero — a line that is always 3% over is a recipe problem,
    // one that is suddenly 12% over is an incident.
    const history = earlier.map((s) => {
      const hist = earlier.filter((e) => e.date < s.date).map((e) => ({ date: e.date, rows: new Map<ID, number>() }))
      const computed = computeVariance({
        items: state.items, categories: state.categories, movements: state.movements,
        stocktake: s, history: hist,
      })
      return { date: s.date, rows: new Map(computed.map((r) => [r.itemId, r.variancePct])) }
    })

    const computed = computeVariance({
      items: state.items, categories: state.categories, movements: state.movements,
      stocktake: take, history,
    })
    return {
      rows: computed,
      summary: summarise(computed),
      previous: earlier.length ? earlier[earlier.length - 1].date : null,
    }
  }, [take, state])

  const shown = onlyIssues ? rows.filter((r) => r.severity !== 'OK') : rows

  const byCategory = useMemo(() => {
    const m = new Map<ID, number>()
    for (const r of rows) {
      if (r.varianceValue >= 0) continue
      m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + Math.abs(r.varianceValue))
    }
    return [...m.entries()]
      .map(([id, v]) => ({ name: derived.categoryById.get(id)?.name ?? id, value: round(v, 0) }))
      .sort((a, b) => b.value - a.value).slice(0, 8).reverse()
  }, [rows, derived.categoryById])

  const trend = useMemo(() => {
    const list = state.stocktakes
      .filter((s) => s.locationId === locationId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-12)
    return list.map((s) => {
      const earlier = state.stocktakes
        .filter((x) => x.locationId === locationId && x.date < s.date)
        .map((x) => ({ date: x.date, rows: new Map<ID, number>() }))
      const computed = computeVariance({
        items: state.items, categories: state.categories, movements: state.movements,
        stocktake: s, history: earlier,
      })
      const sum = summarise(computed)
      return { label: dayLabel(s.date), leak: round(Math.abs(sum.negativeLeak), 0) }
    })
  }, [state, locationId])

  if (!take) {
    return (
      <>
        <PageHead title="Variance Review" sub="Expected stock against what was physically counted." />
        <Card><Empty icon="⚖️" title="Nothing counted yet">
          Run a stocktake first — <Link to="/kitchen/stocktake" style={{ color: 'var(--brand)' }}>count the kitchen</Link>.
        </Empty></Card>
      </>
    )
  }

  return (
    <>
      <PageHead
        title="Variance Review"
        sub={
          previous
            ? `Counted ${longDate(take.date)}, covering everything since the count on ${dayLabel(previous)}. Expected = opening + received + transfers in − recipe usage − recorded wastage.`
            : `Counted ${longDate(take.date)}. This is the first count at this location, so the period starts from the count date.`
        }
        actions={
          <>
            <select className="select" style={{ width: 160 }} value={locationId} onChange={(e) => { setLocationId(e.target.value); setTakeId('') }}>
              {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className="select" style={{ width: 170 }} value={take.id} onChange={(e) => setTakeId(e.target.value)}>
              {takes.map((t) => <option key={t.id} value={t.id}>{longDate(t.date)}</option>)}
            </select>
            <button className="btn" onClick={() => downloadText(`variance-${take.date}.csv`, toCsv(rows.map((r) => ({
              SKU: r.sku, Item: r.name, Unit: r.baseUnit, Opening: r.opening, Received: r.received,
              'Transferred in': r.transferredIn, 'Recipe usage': r.theoretical, Wastage: r.wastage,
              Expected: r.expectedClosing, Counted: r.actualClosing, 'Variance qty': r.varianceQty,
              'Variance %': r.variancePct, 'Variance value': r.varianceValue,
              'Usual %': r.avgVariancePct ?? '', 'Deviation': r.deviation ?? '', Severity: r.severity,
            }))))}>Export CSV</button>
          </>
        }
      />

      <div style={{ marginBottom: 14 }}><VarianceSummaryTiles rows={rows} /></div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <Card title="Where the loss is" sub="short value by category, this count">
          {byCategory.length
            ? <Bars data={byCategory} xKey="name" series={[{ key: 'value', name: 'Short' }]} horizontal height={230} />
            : <Empty icon="✅" title="No shortfalls" />}
        </Card>
        <Card title="Leakage over time" sub={`last ${trend.length} counts at ${derived.locationById.get(locationId)?.name}`}>
          {trend.length > 1
            ? <TrendLine data={trend} xKey="label" format="money" height={230}
                series={[{ key: 'leak', name: 'Short on count', color: 'var(--neg)' }]} />
            : <Empty icon="📉" title="Not enough counts yet" />}
        </Card>
      </div>

      <Card
        title={`${shown.length} item${shown.length === 1 ? '' : 's'}`}
        sub="Deviation compares this count against the same item's usual variance — that is what separates a bad night from a bad recipe."
        actions={
          <button className={`btn btn-sm${onlyIssues ? ' btn-primary' : ''}`} onClick={() => setOnlyIssues(!onlyIssues)}>
            {onlyIssues ? 'Showing exceptions' : 'Showing everything'}
          </button>
        }
        flush
      >
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th><th className="num">Opening</th><th className="num">In</th>
                <th className="num">Recipe use</th><th className="num">Wastage</th>
                <th className="num">Expected</th><th className="num">Counted</th>
                <th className="num">Variance</th><th className="num">%</th>
                <th className="num">Usual</th><th className="num">Deviation</th>
                <th className="num">Value</th><th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.itemId} className={`clickable sev-${r.severity}`} onClick={() => setDrill(r.itemId)}>
                  <td>
                    <div className="tbl-name">{r.name}</div>
                    <div className="tbl-sub">{r.sku}</div>
                  </td>
                  <td className="num dim">{fmtQty(r.opening, r.baseUnit)}</td>
                  <td className="num dim">{fmtQty(r.received + r.transferredIn, r.baseUnit)}</td>
                  <td className="num dim">{fmtQty(r.theoretical, r.baseUnit)}</td>
                  <td className="num dim">{r.wastage ? fmtQty(r.wastage, r.baseUnit) : '—'}</td>
                  <td className="num">{fmtQty(r.expectedClosing, r.baseUnit)}</td>
                  <td className="num">{fmtQty(r.actualClosing, r.baseUnit)}</td>
                  <td className={`num ${r.varianceQty < 0 ? 'neg' : r.varianceQty > 0 ? 'pos' : 'dim'}`}>
                    {fmtQty(r.varianceQty, r.baseUnit)}
                  </td>
                  <td className={`num ${r.variancePct < 0 ? 'neg' : 'pos'}`}>{signedPct(r.variancePct)}</td>
                  <td className="num dim">{r.avgVariancePct === null ? '—' : signedPct(r.avgVariancePct)}</td>
                  <td className={`num ${r.deviation === null ? 'dim' : Math.abs(r.deviation) > 3 ? 'neg' : 'dim'}`}>
                    {r.deviation === null ? '—' : signedPct(r.deviation)}
                  </td>
                  <td className={`num ${r.varianceValue < 0 ? 'neg' : 'pos'}`}>{money(r.varianceValue)}</td>
                  <td><SeverityBadge severity={r.severity} /></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={13}><Empty icon="✅" title="Everything within tolerance" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

/* ================================================================== */
/* Close history                                                       */
/* ================================================================== */

function History() {
  const { state, derived } = useLedger()
  const { days, setDays, from, to } = usePeriod(30)
  const navigate = useNavigate()

  const rows = useMemo(() => {
    return state.dayCloses
      .filter((d) => d.date >= from && d.date <= to)
      .map((close) => {
        const sales = filterSales(state.sales, close.date, close.date)
        const perf = dishPerformance(derived.ctx, state.dishes, sales)
        const wastage = state.wastage.filter((w) => w.date === close.date).reduce((s, w) => {
          const item = derived.itemById.get(w.itemId)
          return s + (item ? w.qtyBase * item.avgCost : 0)
        }, 0)
        const adjustments = state.movements
          .filter((m) => m.type === 'ADJUSTMENT' && m.date === close.date)
          .reduce((s, m) => s + m.value, 0)
        return { close, perf, wastage, adjustments }
      })
      .sort((a, b) => b.close.date.localeCompare(a.close.date))
  }, [state, derived, from, to])

  const closedCount = rows.filter((r) => r.close.status === 'CLOSED').length

  return (
    <>
      <PageHead
        title="Close History"
        sub="Every day that has been signed off, with the numbers as they stood and whatever the manager wrote down."
        actions={<PeriodPills days={days} setDays={setDays} />}
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Days closed" value={`${closedCount}/${rows.length}`} foot={`last ${days} days`}
          accent={closedCount === rows.length ? 'var(--pos)' : 'var(--warn)'} />
        <Tile label="Revenue" value={moneyShort(rows.reduce((s, r) => s + r.perf.totals.revenue, 0))} accent="var(--brand)" foot="over the period" />
        <Tile label="Wastage" value={moneyShort(rows.reduce((s, r) => s + r.wastage, 0))} accent="var(--warn)" foot="recorded" />
        <Tile label="Count adjustments" value={moneyShort(rows.reduce((s, r) => s + r.adjustments, 0))}
          accent="var(--neg)" foot="written off at stocktake" />
      </div>

      <Card flush>
        <div className="table-wrap scroll-y mh-560">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Status</th><th className="num">Revenue</th><th className="num">Food cost %</th>
                <th className="num">Wastage</th><th className="num">Count adj.</th><th>Counts</th><th>Closed by</th><th>Note</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.close.id} className="clickable" onClick={() => navigate('/eod/variance')}>
                  <td className="nowrap">{dayLabel(r.close.date)}</td>
                  <td><Badge kind={r.close.status === 'CLOSED' ? 'ok' : 'watch'}>{r.close.status}</Badge></td>
                  <td className="num">{money(r.perf.totals.revenue)}</td>
                  <td className="num">{pct(r.perf.totals.foodCostPct)}</td>
                  <td className="num dim">{money(r.wastage)}</td>
                  <td className={`num ${r.adjustments < 0 ? 'neg' : 'dim'}`}>{r.adjustments ? money(r.adjustments) : '—'}</td>
                  <td className="dim">{r.close.stocktakeIds.length || '—'}</td>
                  <td className="dim">{r.close.closedBy ? derived.staffById.get(r.close.closedBy)?.name.split(' ')[0] : '—'}</td>
                  <td className="dim" style={{ maxWidth: 260 }}>{r.close.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
