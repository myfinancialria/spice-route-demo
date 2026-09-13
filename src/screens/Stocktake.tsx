import { useMemo, useState } from 'react'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, Empty, Search, SeverityBadge, Tile, useToast } from '../components/ui'
import { uid } from '../data/commands'
import { computeVariance, summarise } from '../core/variance'
import { dayLabel, longDate } from '../core/dates'
import { money, moneyShort, num, pct, qty as fmtQty, signedPct, toCsv, downloadText } from '../lib/format'
import type { ID, Stocktake, StocktakeLine } from '../core/types'

/**
 * A count sheet, not a form. The system quantity stays hidden until a number
 * is typed — showing it first is how counts end up being copied rather than
 * counted, and a copied count makes every variance report worthless.
 */
export function StocktakeSheet({ locationId, title, sub }: { locationId: ID; title: string; sub: string }) {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState<Record<ID, string>>({})
  const [blind, setBlind] = useState(true)
  const [date, setDate] = useState(derived.today)
  const [posted, setPosted] = useState<Stocktake | null>(null)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.items
      .filter((i) => i.active)
      .map((item) => ({ item, system: derived.balance(item.id, locationId) }))
      .filter((r) => Math.abs(r.system) > 0.001)
      .filter((r) => !term || r.item.name.toLowerCase().includes(term) || r.item.sku.toLowerCase().includes(term))
      .sort((a, b) => {
        const ca = derived.categoryById.get(a.item.categoryId)?.name ?? ''
        const cb = derived.categoryById.get(b.item.categoryId)?.name ?? ''
        return ca.localeCompare(cb) || a.item.name.localeCompare(b.item.name)
      })
  }, [state.items, derived, locationId, search])

  const entered = rows.filter((r) => counts[r.item.id] !== undefined && counts[r.item.id] !== '')
  const gap = entered.reduce((s, r) => {
    const item = r.item
    const counted = Number(counts[item.id]) || 0
    return s + (counted - r.system) * item.avgCost
  }, 0)

  const previous = state.stocktakes
    .filter((s) => s.locationId === locationId)
    .sort((a, b) => b.date.localeCompare(a.date))

  const post = async () => {
    const lines: StocktakeLine[] = entered.map((r) => ({
      id: uid('stl'), itemId: r.item.id,
      countedQtyBase: Number(counts[r.item.id]) || 0,
      systemQtyBase: r.system,
    }))
    const take: Stocktake = {
      id: uid('stk'), ref: `STK-${Date.now().toString(36).toUpperCase()}`, date,
      locationId, lines, countedBy: user?.id ?? null, status: 'POSTED',
      createdAt: new Date().toISOString(),
    }
    await actions.postStocktake(take)
    setPosted(take)
    setCounts({})
    push({
      kind: 'ok', title: 'Count posted',
      msg: `${lines.length} items · stock written back to what was physically there`,
    })
  }

  const exportSheet = () => {
    downloadText(
      `count-sheet-${locationId}-${date}.csv`,
      toCsv(rows.map((r) => ({
        SKU: r.item.sku, Item: r.item.name,
        Category: derived.categoryById.get(r.item.categoryId)?.name ?? '',
        Unit: r.item.baseUnit, Counted: '',
      }))),
    )
  }

  const varianceRows = useMemo(() => {
    if (!posted) return []
    const history = state.stocktakes
      .filter((s) => s.locationId === locationId && s.date < posted.date)
      .map((s) => ({ date: s.date, rows: new Map<ID, number>() }))
    return computeVariance({
      items: state.items, categories: state.categories, movements: state.movements,
      stocktake: posted, history,
    })
  }, [posted, state, locationId])

  return (
    <>
      <PageHead
        title={title} sub={sub}
        actions={
          <>
            <Search value={search} onChange={setSearch} placeholder="Find an item" />
            <input className="input" style={{ width: 150 }} type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
            <button className={`btn btn-sm${blind ? ' btn-primary' : ''}`} onClick={() => setBlind(!blind)}
              title="Hide the system quantity until a count is entered">
              {blind ? '🙈 Blind count on' : '👁 Blind count off'}
            </button>
            <button className="btn" onClick={exportSheet}>Print sheet</button>
          </>
        }
      />

      {posted ? (
        <div className="stack">
          <Card
            title={`Count posted — ${longDate(posted.date)}`}
            sub="Stock has been corrected. This is the gap it revealed."
            actions={<button className="btn btn-sm" onClick={() => setPosted(null)}>Count again</button>}
          >
            <VarianceSummaryTiles rows={varianceRows} />
          </Card>
          <Card title="Item by item" flush>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Item</th><th className="num">Expected</th><th className="num">Counted</th>
                    <th className="num">Gap</th><th className="num">Value</th><th>Severity</th></tr>
                </thead>
                <tbody>
                  {varianceRows.filter((r) => Math.abs(r.varianceQty) > 0.001).map((r) => (
                    <tr key={r.itemId} className={`sev-${r.severity}`}>
                      <td className="tbl-name">{r.name}</td>
                      <td className="num dim">{fmtQty(r.expectedClosing, r.baseUnit)}</td>
                      <td className="num">{fmtQty(r.actualClosing, r.baseUnit)}</td>
                      <td className={`num ${r.varianceQty < 0 ? 'neg' : 'pos'}`}>
                        {fmtQty(r.varianceQty, r.baseUnit)} <span className="dim">({signedPct(r.variancePct)})</span>
                      </td>
                      <td className={`num ${r.varianceValue < 0 ? 'neg' : 'pos'}`}>{money(r.varianceValue)}</td>
                      <td><SeverityBadge severity={r.severity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : (
        <>
          <div className="grid g4" style={{ marginBottom: 14 }}>
            <Tile label="Items to count" value={num(rows.length)} foot="with stock on hand" />
            <Tile label="Counted so far" value={num(entered.length)}
              foot={`${pct(rows.length ? (entered.length / rows.length) * 100 : 0, 0)} done`} accent="var(--info)" />
            <Tile label="Gap so far" value={moneyShort(gap)} foot="counted less expected"
              accent={gap < 0 ? 'var(--neg)' : 'var(--pos)'} />
            <Tile label="Last count" value={previous[0] ? dayLabel(previous[0].date) : '—'}
              foot={previous[0] ? `${previous[0].lines.length} items` : 'never counted'} />
          </div>

          <Card flush>
            {rows.length === 0 ? (
              <Empty icon="📭" title="Nothing to count here" />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Item</th><th>Category</th><th style={{ width: 150 }}>Counted</th>
                      <th className="num">System</th><th className="num">Gap</th><th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const raw = counts[r.item.id]
                      const has = raw !== undefined && raw !== ''
                      const counted = Number(raw) || 0
                      const diff = counted - r.system
                      const show = !blind || has
                      return (
                        <tr key={r.item.id}>
                          <td>
                            <div className="tbl-name">{r.item.name}</div>
                            <div className="tbl-sub">{r.item.sku}</div>
                          </td>
                          <td className="dim">{derived.categoryById.get(r.item.categoryId)?.name}</td>
                          <td>
                            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                              <input
                                className="input num" type="number" step="any" inputMode="decimal"
                                value={raw ?? ''} placeholder="—"
                                onChange={(e) => setCounts({ ...counts, [r.item.id]: e.target.value })}
                              />
                              <span className="dim mono-sm">{r.item.baseUnit === 'unit' ? 'pc' : r.item.baseUnit}</span>
                            </div>
                          </td>
                          <td className="num dim">{show ? fmtQty(r.system, r.item.baseUnit) : '•••'}</td>
                          <td className={`num ${has ? (diff < 0 ? 'neg' : diff > 0 ? 'pos' : 'dim') : 'dim'}`}>
                            {has ? fmtQty(diff, r.item.baseUnit) : '—'}
                          </td>
                          <td className={`num ${has ? (diff < 0 ? 'neg' : 'pos') : 'dim'}`}>
                            {has ? money(diff * r.item.avgCost) : '—'}
                          </td>
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
              <span><span className="dim">Counted </span><span className="num">{entered.length}/{rows.length}</span></span>
              <span><span className="dim">Gap </span><span className={`num ${gap < 0 ? 'neg' : 'pos'}`}>{money(gap)}</span></span>
              {blind && <Badge kind="info">system quantities hidden until you enter a count</Badge>}
            </div>
            <button className="btn btn-primary" disabled={!entered.length} onClick={post}>
              Post count ({entered.length} items)
            </button>
          </div>
        </>
      )}
    </>
  )
}

export function VarianceSummaryTiles({ rows }: { rows: ReturnType<typeof computeVariance> }) {
  const s = summarise(rows)
  return (
    <div className="grid g4">
      <Tile label="Short on count" value={moneyShort(Math.abs(s.negativeLeak))} foot="stock that left with no document"
        accent="var(--neg)" />
      <Tile label="Over on count" value={moneyShort(s.positiveLeak)} foot="found more than expected" accent="var(--pos)" />
      <Tile label="Net gap" value={moneyShort(s.totalLeak)} foot={`${s.itemsCounted} items counted`} />
      <Tile label="Over tolerance" value={num(s.critical + s.high)}
        foot={`${s.critical} critical · ${s.high} high · ${s.watch} watch`} accent="#f08c3c" />
    </div>
  )
}
