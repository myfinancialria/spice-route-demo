import { useMemo, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Avatar, Badge, Card, Empty, Pills, Search, SeverityBadge, Tile, useToast } from '../components/ui'
import { Bars, ColouredBars, ComboBarLine, Donut, PALETTE, TrendArea, TrendLine } from '../components/charts'
import { ItemDrawer, MOVEMENT_LABEL, MOVEMENT_TONE, PeriodPills, ValueBar, usePeriod } from './shared'
import { chefScorecards, dishPerformance, filterSales, pnlSeries, stats, zScore } from '../core/analytics'
import { varianceBySection } from '../core/attribution'
import { computeVariance, summarise } from '../core/variance'
import { addDays, dayLabel, monthKey, monthLabel, rangeDays } from '../core/dates'
import { round } from '../core/units'
import { downloadText, money, moneyShort, num, pct, qty as fmtQty, signedPct, toCsv, trendClass } from '../lib/format'
import { ROLE_LABEL } from '../components/nav'
import type { ID, Movement, VarianceRow } from '../core/types'

export default function Reports() {
  return (
    <Routes>
      <Route path="pnl" element={<PnL />} />
      <Route path="variance" element={<VarianceReport />} />
      <Route path="chefs" element={<ChefEfficiency />} />
      <Route path="trends" element={<Trends />} />
      <Route path="movement" element={<ItemMovement />} />
      <Route path="wastage" element={<WastageAnalysis />} />
      <Route path="valuation" element={<Valuation />} />
      <Route path="*" element={<PnL />} />
    </Routes>
  )
}

/* ------------------------------------------------------------------ */
/* Shared: every counted variance across the whole history             */
/* ------------------------------------------------------------------ */

function useAllVariance(from: string, to: string) {
  const { state } = useLedger()
  return useMemo(() => {
    const out: { date: string; locationId: ID; rows: VarianceRow[] }[] = []
    const takes = [...state.stocktakes].sort((a, b) => a.date.localeCompare(b.date))
    for (const take of takes) {
      if (take.date < from || take.date > to) continue
      const history = takes
        .filter((s) => s.locationId === take.locationId && s.date < take.date)
        .map((s) => ({ date: s.date, rows: new Map<ID, number>() }))
      out.push({
        date: take.date, locationId: take.locationId,
        rows: computeVariance({
          items: state.items, categories: state.categories, movements: state.movements,
          stocktake: take, history,
        }),
      })
    }
    return out
  }, [state, from, to])
}

/* ================================================================== */
/* Food cost & P&L                                                     */
/* ================================================================== */

function PnL() {
  const { state, derived } = useLedger()
  const [groupBy, setGroupBy] = useState<'month' | 'day'>('month')
  const { days, setDays, from, to } = usePeriod(120)

  const periods = useMemo(() => pnlSeries({
    ctx: derived.ctx, dishes: state.dishes, sales: state.sales, movements: state.movements,
    items: state.items, staff: state.staff, from, to, groupBy,
  }), [state, derived.ctx, from, to, groupBy])

  const chart = periods.map((p) => ({
    label: groupBy === 'month' ? monthLabel(p.key) : dayLabel(p.key),
    revenue: round(p.netRevenue, 0),
    foodCost: round(p.theoreticalFoodCost, 0),
    wastage: round(p.wastage, 0),
    variance: round(Math.max(p.variance, 0), 0),
    foodCostPct: p.actualFoodCostPct,
    contributionPct: p.contributionPct,
  }))

  const first = periods[0]
  const last = periods[periods.length - 1]
  const drift = first && last ? last.actualFoodCostPct - first.actualFoodCostPct : 0
  const totals = periods.reduce((s, p) => ({
    revenue: s.revenue + p.netRevenue,
    food: s.food + p.theoreticalFoodCost,
    wastage: s.wastage + p.wastage,
    variance: s.variance + p.variance,
    packaging: s.packaging + p.packaging,
    labour: s.labour + p.labour,
    contribution: s.contribution + p.contribution,
  }), { revenue: 0, food: 0, wastage: 0, variance: 0, packaging: 0, labour: 0, contribution: 0 })

  return (
    <>
      <PageHead
        title="Food Cost & P&L"
        sub="Costs are taken from the ledger at the rate that applied on the day, not re-priced at today's rates — that is what makes the drift visible instead of averaging it away."
        actions={
          <>
            <Pills value={groupBy} onChange={setGroupBy} options={[{ value: 'month', label: 'Monthly' }, { value: 'day', label: 'Daily' }]} />
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn" onClick={() => downloadText(`pnl-${from}-${to}.csv`, toCsv(periods.map((p) => ({
              Period: p.key, Days: p.days, 'Net revenue': round(p.netRevenue, 2),
              'Recipe food cost': round(p.theoreticalFoodCost, 2), Wastage: round(p.wastage, 2),
              'Count variance': round(p.variance, 2), 'Actual food cost': round(p.actualFoodCost, 2),
              'Food cost %': p.actualFoodCostPct, Packaging: round(p.packaging, 2),
              Labour: p.labour, Contribution: round(p.contribution, 2), 'Contribution %': p.contributionPct,
            }))))}>Export CSV</button>
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <Tile label="Net revenue" value={moneyShort(totals.revenue)} foot={`${periods.length} ${groupBy === 'month' ? 'months' : 'days'}`} accent="var(--brand)" />
        <Tile label="Food cost" value={pct(totals.revenue ? ((totals.food + totals.wastage + totals.variance) / totals.revenue) * 100 : 0)}
          foot={moneyShort(totals.food + totals.wastage + totals.variance)}
          accent={drift > 1 ? 'var(--neg)' : 'var(--pos)'} />
        <Tile label="Drift over the period" value={signedPct(drift)} deltaGood={false}
          foot={first && last ? `${pct(first.actualFoodCostPct)} → ${pct(last.actualFoodCostPct)}` : ''}
          accent={drift > 0 ? 'var(--neg)' : 'var(--pos)'} />
        <Tile label="Contribution" value={moneyShort(totals.contribution)}
          foot={pct(totals.revenue ? (totals.contribution / totals.revenue) * 100 : 0)} accent="var(--pos)" />
        <Tile label="Cost of drift" value={moneyShort(totals.revenue && first ? (drift / 100) * (last?.netRevenue ?? 0) * 12 : 0)}
          foot="annualised at the current run rate" accent="var(--neg)" />
      </div>

      <div className="grid g-3-2" style={{ marginBottom: 14 }}>
        <Card title="Revenue, cost and the food-cost line" sub="bars stack the three components of actual food cost">
          <ComboBarLine
            data={chart} xKey="label" height={300}
            bars={[
              { key: 'foodCost', name: 'Recipe cost', color: 'rgba(232,145,58,0.8)', stackId: 'c' },
              { key: 'wastage', name: 'Wastage', color: 'rgba(245,181,68,0.8)', stackId: 'c' },
              { key: 'variance', name: 'Unaccounted', color: 'rgba(242,84,91,0.8)', stackId: 'c' },
            ]}
            lines={[
              { key: 'foodCostPct', name: 'Food cost %', color: 'var(--neg)' },
              { key: 'contributionPct', name: 'Contribution %', color: 'var(--pos)' },
            ]}
          />
        </Card>
        <Card title="Where the money goes" sub="over the whole period, as a share of net revenue">
          <ValueBar
            total={totals.revenue}
            rows={[
              { label: 'Recipe food cost', value: totals.food, color: 'var(--brand)' },
              { label: 'Wastage', value: totals.wastage, color: 'var(--warn)' },
              { label: 'Unaccounted at count', value: Math.max(totals.variance, 0), color: 'var(--neg)' },
              { label: 'Packaging & variable', value: totals.packaging, color: 'var(--info)' },
              { label: 'Kitchen labour', value: totals.labour, color: 'var(--purple)' },
              { label: 'Contribution', value: Math.max(totals.contribution - totals.labour, 0), color: 'var(--pos)' },
            ]}
          />
        </Card>
      </div>

      <Card title="Period by period" flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Period</th><th className="num">Days</th><th className="num">Net revenue</th>
                <th className="num">Recipe cost</th><th className="num">Wastage</th><th className="num">Unaccounted</th>
                <th className="num">Actual food cost</th><th className="num">Food cost %</th>
                <th className="num">Packaging</th><th className="num">Labour</th>
                <th className="num">Contribution</th><th className="num">Contribution %</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => {
                const prev = periods[i - 1]
                const delta = prev ? p.actualFoodCostPct - prev.actualFoodCostPct : 0
                return (
                  <tr key={p.key}>
                    <td className="tbl-name">{groupBy === 'month' ? monthLabel(p.key) : dayLabel(p.key)}</td>
                    <td className="num dim">{p.days}</td>
                    <td className="num">{money(p.netRevenue)}</td>
                    <td className="num dim">{money(p.theoreticalFoodCost)}</td>
                    <td className="num dim">{money(p.wastage)}</td>
                    <td className={`num ${p.variance > 0 ? 'neg' : 'dim'}`}>{money(p.variance)}</td>
                    <td className="num">{money(p.actualFoodCost)}</td>
                    <td className="num">
                      <span className={p.actualFoodCostPct > 34 ? 'neg' : p.actualFoodCostPct > 31 ? 'warn' : 'pos'}>
                        {pct(p.actualFoodCostPct)}
                      </span>
                      {prev && <span className={`dim ${trendClass(delta, false)}`} style={{ fontSize: 11 }}> {signedPct(delta)}</span>}
                    </td>
                    <td className="num dim">{money(p.packaging)}</td>
                    <td className="num dim">{money(p.labour)}</td>
                    <td className="num pos">{money(p.contribution)}</td>
                    <td className="num">{pct(p.contributionPct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

/* ================================================================== */
/* Chef efficiency                                                     */
/* ================================================================== */

function ChefEfficiency() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(30)
  const [focus, setFocus] = useState<ID | null>(null)

  const counted = useAllVariance(from, to)

  const cards = useMemo(() => {
    const sales = filterSales(state.sales, from, to)
    const allRows = counted.flatMap((c) => c.rows)
    const sectionLeak = varianceBySection(derived.ctx, state.dishes, allRows)
    return chefScorecards({
      ctx: derived.ctx, dishes: state.dishes, sales, staff: state.staff, sections: state.sections,
      wastage: state.wastage.filter((w) => w.date >= from && w.date <= to),
      items: state.items, varianceBySection: sectionLeak, days,
    })
  }, [state, derived.ctx, from, to, days, counted])

  /** Month-by-month contribution per chef, to see who is improving. */
  const monthly = useMemo(() => {
    const months = [...new Set(state.sales.filter((s) => s.status === 'POSTED').map((s) => monthKey(s.date)))].sort()
    return months.map((mk) => {
      const monthSales = state.sales.filter((s) => s.status === 'POSTED' && monthKey(s.date) === mk)
      const rows = chefScorecards({
        ctx: derived.ctx, dishes: state.dishes, sales: monthSales, staff: state.staff,
        sections: state.sections, wastage: state.wastage.filter((w) => monthKey(w.date) === mk),
        items: state.items, days: 30,
      })
      const entry: Record<string, number | string> = { label: monthLabel(mk) }
      for (const r of rows) entry[r.name.split(' ')[0]] = round(r.contribution, 0)
      return entry
    })
  }, [state, derived.ctx])

  const chefNames = cards.map((c) => c.name.split(' ')[0])
  const totalContribution = cards.reduce((s, c) => s + c.contribution, 0)
  const focusCard = cards.find((c) => c.chefId === focus)

  const focusDishes = useMemo(() => {
    if (!focusCard) return []
    const chef = state.staff.find((s) => s.id === focusCard.chefId)
    if (!chef?.sectionId) return []
    const sales = filterSales(state.sales, from, to)
    const perf = dishPerformance(derived.ctx, state.dishes.filter((d) => d.sectionId === chef.sectionId), sales)
    return perf.rows.sort((a, b) => b.contribution - a.contribution)
  }, [focusCard, state, derived.ctx, from, to])

  return (
    <>
      <PageHead
        title="Chef Efficiency"
        sub="Each chef's own P&L: what their station sold, what the recipes said it should cost, what it actually cost after leakage and waste, and what is left after their labour."
        actions={
          <>
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn" onClick={() => downloadText(`chef-efficiency-${from}-${to}.csv`, toCsv(cards.map((c) => ({
              Rank: c.rank, Chef: c.name, Role: ROLE_LABEL[c.role], Section: c.sectionName,
              'Plates sold': c.dishesSold, Revenue: c.revenue, 'Recipe food cost': c.theoreticalFoodCost,
              'Leakage': c.varianceLeak, Wastage: c.wastage, 'Actual food cost': c.actualFoodCost,
              'Recipe FC %': c.theoreticalFoodCostPct, 'Actual FC %': c.actualFoodCostPct,
              Contribution: c.contribution, Labour: c.labourCost, 'Net contribution': c.netContribution,
              'Per labour hour': c.contributionPerHour, 'Efficiency index': c.efficiencyIndex,
            }))))}>Export CSV</button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Kitchen contribution" value={moneyShort(totalContribution)} foot={`across ${cards.length} chefs`} accent="var(--pos)" />
        <Tile label="Best index" value={cards[0]?.efficiencyIndex.toFixed(0) ?? '—'} foot={cards[0]?.name ?? ''} accent="var(--brand)" />
        <Tile label="Widest gap" value={cards.length > 1 ? `${(cards[0].efficiencyIndex - cards[cards.length - 1].efficiencyIndex).toFixed(0)} pts` : '—'}
          foot={cards.length > 1 ? `${cards[0].name.split(' ')[0]} vs ${cards[cards.length - 1].name.split(' ')[0]}` : ''} />
        <Tile label="Leakage attributed" value={moneyShort(cards.reduce((s, c) => s + c.varianceLeak, 0))}
          foot="shared out by what each section cooks" accent="var(--neg)" />
      </div>

      <div className="grid g-3-2" style={{ marginBottom: 14 }}>
        <Card
          title="Scorecard" flush
          sub="The index blends margin quality, control discipline and output — so the biggest station cannot top the table on volume alone."
        >
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th><th>Chef</th><th>Section</th><th className="num">Plates</th>
                  <th className="num">Revenue</th><th className="num">Recipe FC%</th><th className="num">Actual FC%</th>
                  <th className="num">Leakage</th><th className="num">Wastage</th>
                  <th className="num">Contribution</th><th className="num">Net of labour</th>
                  <th className="num">Per hour</th><th className="num">Index</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.chefId} className={`clickable${focus === c.chefId ? ' sev-WATCH' : ''}`} onClick={() => setFocus(c.chefId)}>
                    <td><span className={`rank${c.rank === 1 ? ' top' : ''}`}>{c.rank}</span></td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <Avatar name={c.name} />
                        <span>
                          <span className="tbl-name" style={{ display: 'block' }}>{c.name}</span>
                          <span className="tbl-sub">{ROLE_LABEL[c.role]}</span>
                        </span>
                      </div>
                    </td>
                    <td className="dim">{c.sectionName}</td>
                    <td className="num">{num(c.dishesSold)}</td>
                    <td className="num">{moneyShort(c.revenue)}</td>
                    <td className="num dim">{pct(c.theoreticalFoodCostPct)}</td>
                    <td className="num">
                      <span className={c.actualFoodCostPct > 38 ? 'neg' : c.actualFoodCostPct > 33 ? 'warn' : 'pos'}>
                        {pct(c.actualFoodCostPct)}
                      </span>
                    </td>
                    <td className="num neg">{moneyShort(c.varianceLeak)}</td>
                    <td className="num dim">{moneyShort(c.wastage)}</td>
                    <td className="num pos">{moneyShort(c.contribution)}</td>
                    <td className="num">{moneyShort(c.netContribution)}</td>
                    <td className="num">{money(c.contributionPerHour)}</td>
                    <td className="num"><strong>{c.efficiencyIndex.toFixed(0)}</strong></td>
                  </tr>
                ))}
                {!cards.length && <tr><td colSpan={13}><Empty icon="🏅" title="No chefs configured" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack">
          <Card title="Contribution by chef" sub="after leakage, waste and labour">
            <ColouredBars
              data={cards.map((c, i) => ({
                name: c.name.split(' ')[0], value: c.netContribution,
                _color: PALETTE[i % PALETTE.length], chefId: c.chefId,
              })).reverse()}
              xKey="name" valueKey="value" height={230}
              onClick={(row) => row?.chefId && setFocus(row.chefId)}
            />
          </Card>
          <Card title="Control discipline" sub="actual food cost against what the recipes say — the gap is the chef's own">
            <Bars
              data={cards.map((c) => ({
                name: c.name.split(' ')[0], recipe: c.theoreticalFoodCostPct, actual: c.actualFoodCostPct,
              }))}
              xKey="name" format="pct" height={230}
              series={[
                { key: 'recipe', name: 'Recipe', color: 'var(--info)' },
                { key: 'actual', name: 'Actual', color: 'var(--neg)' },
              ]}
            />
          </Card>
        </div>
      </div>

      {monthly.length > 1 && (
        <Card title="Contribution month by month" sub="who is improving and who is sliding" style={{ marginBottom: 14 }}>
          <TrendLine
            data={monthly} xKey="label" format="money" height={260}
            series={chefNames.map((n, i) => ({ key: n, name: n, color: PALETTE[i % PALETTE.length] }))}
          />
        </Card>
      )}

      {focusCard && (
        <Card
          title={`${focusCard.name} — ${focusCard.sectionName}`}
          sub={`${ROLE_LABEL[focusCard.role]} · rank ${focusCard.rank} of ${cards.length} · index ${focusCard.efficiencyIndex.toFixed(0)}`}
          actions={<button className="btn btn-sm btn-ghost" onClick={() => setFocus(null)}>Close</button>}
        >
          <div className="grid g-1-2">
            <div>
              <dl className="kv">
                <dt>Plates produced</dt><dd>{num(focusCard.dishesSold)}</dd>
                <dt>Revenue attributed</dt><dd>{money(focusCard.revenue)}</dd>
                <dt>Recipe food cost</dt><dd className="dim">−{money(focusCard.theoreticalFoodCost)}</dd>
                <dt>Leakage at count</dt><dd className="neg">−{money(focusCard.varianceLeak)}</dd>
                <dt>Wastage logged</dt><dd className="neg">−{money(focusCard.wastage)}</dd>
                <dt>Packaging</dt><dd className="dim">−{money(focusCard.packagingCost)}</dd>
                <dt><strong>Contribution</strong></dt><dd><strong className="pos">{money(focusCard.contribution)}</strong></dd>
                <dt>Labour for the period</dt><dd className="dim">−{money(focusCard.labourCost)}</dd>
                <dt><strong>Net contribution</strong></dt><dd><strong>{money(focusCard.netContribution)}</strong></dd>
                <dt>Per labour hour</dt><dd>{money(focusCard.contributionPerHour)}</dd>
              </dl>
            </div>
            <Card title="Their dishes" sub="everything their section produced in this period" flush>
              <div className="scroll-y mh-300">
                <table className="tbl compact">
                  <thead><tr><th>Dish</th><th className="num">Plates</th><th className="num">Contribution</th><th className="num">FC%</th></tr></thead>
                  <tbody>
                    {focusDishes.map((d) => (
                      <tr key={d.dishId} className="clickable" onClick={() => navigate(`/menu/costing?dish=${d.dishId}`)}>
                        <td className="tbl-name">{d.name}</td>
                        <td className="num">{num(d.qty)}</td>
                        <td className="num pos">{moneyShort(d.contribution)}</td>
                        <td className="num">{pct(d.foodCostPct)}</td>
                      </tr>
                    ))}
                    {!focusDishes.length && <tr><td colSpan={4} className="dim">No dishes assigned to this section.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </Card>
      )}

      <Card title="How the index is built" sub="so nobody has to guess why they are ranked where they are">
        <div className="grid g3">
          <div>
            <h4 style={{ fontSize: 12, color: 'var(--brand)', marginBottom: 5 }}>Margin quality — 50 points</h4>
            <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
              Contribution as a share of the revenue their station produced, scaled against a 70% target.
              A chef selling cheap high-margin dishes is not penalised for low revenue.
            </p>
          </div>
          <div>
            <h4 style={{ fontSize: 12, color: 'var(--brand)', marginBottom: 5 }}>Control — 30 points</h4>
            <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
              Leakage plus logged wastage against a 3%-of-revenue allowance. Full marks only when the
              physical count matches what the recipes predicted.
            </p>
          </div>
          <div>
            <h4 style={{ fontSize: 12, color: 'var(--brand)', marginBottom: 5 }}>Output — 20 points</h4>
            <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
              Net contribution per labour hour, relative to the best performer. This is the only part
              that rewards sheer volume, and it is deliberately the smallest.
            </p>
          </div>
        </div>
      </Card>
    </>
  )
}

/* ================================================================== */
/* Variance report (across counts)                                     */
/* ================================================================== */

function VarianceReport() {
  const { state, derived } = useLedger()
  const { days, setDays, from, to } = usePeriod(90)
  const [drill, setDrill] = useState<ID | null>(null)
  const counted = useAllVariance(from, to)

  const byItem = useMemo(() => {
    const m = new Map<ID, { name: string; sku: string; baseUnit: VarianceRow['baseUnit']; counts: number; value: number; pcts: number[] }>()
    for (const c of counted) {
      for (const r of c.rows) {
        const cur = m.get(r.itemId) ?? { name: r.name, sku: r.sku, baseUnit: r.baseUnit, counts: 0, value: 0, pcts: [] }
        cur.counts += 1
        cur.value += r.varianceValue
        cur.pcts.push(r.variancePct)
        m.set(r.itemId, cur)
      }
    }
    return [...m.entries()].map(([itemId, v]) => {
      const s = stats(v.pcts)
      const latest = v.pcts[v.pcts.length - 1]
      return {
        itemId, ...v, avgPct: s.mean, sd: s.sd, latest,
        z: zScore(latest, s.mean, s.sd),
        monthly: (v.value / Math.max(counted.length, 1)) * 4.3,
      }
    }).sort((a, b) => a.value - b.value)
  }, [counted])

  const totalLeak = byItem.reduce((s, r) => s + Math.min(r.value, 0), 0)
  const worst = byItem.slice(0, 12).map((r) => ({ name: r.name, value: round(Math.abs(Math.min(r.value, 0)), 0) })).reverse()

  const overTime = counted.map((c) => ({
    label: `${dayLabel(c.date)} ${derived.locationById.get(c.locationId)?.name.split(' ')[0] ?? ''}`,
    leak: round(Math.abs(summarise(c.rows).negativeLeak), 0),
  }))

  return (
    <>
      <PageHead
        title="Variance Report"
        sub={`Every physical count in the last ${days} days, rolled up by item. The deviation column is what matters: a line that is always 3% over is a recipe to fix, one that jumps to 12% is an incident to investigate.`}
        actions={
          <>
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn" onClick={() => downloadText(`variance-summary-${from}-${to}.csv`, toCsv(byItem.map((r) => ({
              SKU: r.sku, Item: r.name, Counts: r.counts, 'Total value': round(r.value, 2),
              'Average %': r.avgPct, 'Latest %': r.latest, 'Std dev': r.sd, 'Z score': r.z,
              'Projected monthly': round(r.monthly, 0),
            }))))}>Export CSV</button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Counted short" value={moneyShort(Math.abs(totalLeak))} foot={`${counted.length} counts`} accent="var(--neg)" />
        <Tile label="Projected monthly" value={moneyShort(Math.abs(byItem.reduce((s, r) => s + Math.min(r.monthly, 0), 0)))}
          foot="at the current rate" accent="var(--neg)" />
        <Tile label="Items over tolerance" value={num(byItem.filter((r) => Math.abs(r.avgPct) > 2.5).length)}
          foot={`of ${byItem.length} tracked`} accent="#f08c3c" />
        <Tile label="Worst single item" value={byItem[0]?.name ?? '—'} foot={byItem[0] ? moneyShort(Math.abs(byItem[0].value)) : ''} />
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <Card title="Biggest losses" sub="total short value across every count in the period">
          {worst.length ? <Bars data={worst} xKey="name" series={[{ key: 'value', name: 'Short' }]} horizontal height={300} />
            : <Empty icon="✅" title="No shortfalls recorded" />}
        </Card>
        <Card title="Leakage per count" sub="is it getting better or worse">
          {overTime.length > 1
            ? <TrendLine data={overTime} xKey="label" format="money" height={300}
                series={[{ key: 'leak', name: 'Short on count', color: 'var(--neg)' }]} />
            : <Empty icon="📉" title="Not enough counts yet" />}
        </Card>
      </div>

      <Card title="By item" sub="ranked by rupees lost, with how far the latest count sits from that item's normal" flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th className="num">Counts</th><th className="num">Total value</th>
                <th className="num">Projected / month</th><th className="num">Usual %</th>
                <th className="num">Latest %</th><th className="num">Deviation</th><th>Reading</th></tr>
            </thead>
            <tbody>
              {byItem.filter((r) => Math.abs(r.value) > 1).map((r) => {
                const unusual = Math.abs(r.z) >= 1.5
                return (
                  <tr key={r.itemId} className="clickable" onClick={() => setDrill(r.itemId)}>
                    <td>
                      <div className="tbl-name">{r.name}</div>
                      <div className="tbl-sub">{r.sku}</div>
                    </td>
                    <td className="num dim">{r.counts}</td>
                    <td className={`num ${r.value < 0 ? 'neg' : 'pos'}`}>{money(r.value)}</td>
                    <td className={`num ${r.monthly < 0 ? 'neg' : 'dim'}`}>{money(r.monthly)}</td>
                    <td className="num dim">{signedPct(r.avgPct)}</td>
                    <td className={`num ${r.latest < 0 ? 'neg' : 'pos'}`}>{signedPct(r.latest)}</td>
                    <td className={`num ${unusual ? 'neg' : 'dim'}`}>{r.sd ? `${r.z > 0 ? '+' : ''}${r.z.toFixed(1)}σ` : '—'}</td>
                    <td>
                      {Math.abs(r.avgPct) > 5 ? <Badge kind="critical">Recipe or portioning</Badge>
                        : unusual ? <Badge kind="watch">Unusual this time</Badge>
                        : Math.abs(r.avgPct) > 2.5 ? <Badge kind="high">Persistently over</Badge>
                        : <Badge kind="ok">Normal</Badge>}
                    </td>
                  </tr>
                )
              })}
              {!byItem.length && <tr><td colSpan={8}><Empty icon="⚖️" title="No counts in this period" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

/* ================================================================== */
/* Trends vs average                                                   */
/* ================================================================== */

function Trends() {
  const { state, derived } = useLedger()
  const { days, setDays, from, to } = usePeriod(60)
  const [metric, setMetric] = useState<'revenue' | 'foodCostPct' | 'covers' | 'wastage'>('foodCostPct')

  const series = useMemo(() => {
    const daily = pnlSeries({
      ctx: derived.ctx, dishes: state.dishes, sales: state.sales, movements: state.movements,
      items: state.items, staff: state.staff, from, to, groupBy: 'day',
    })
    const map = new Map(daily.map((d) => [d.key, d]))
    const covers = new Map<string, number>()
    for (const s of filterSales(state.sales, from, to)) covers.set(s.date, (covers.get(s.date) ?? 0) + s.covers)
    return rangeDays(from, to).map((date) => {
      const p = map.get(date)
      return {
        date, label: dayLabel(date),
        revenue: round(p?.netRevenue ?? 0, 0),
        foodCostPct: p?.actualFoodCostPct ?? 0,
        covers: covers.get(date) ?? 0,
        wastage: round(p?.wastage ?? 0, 0),
      }
    }).filter((d) => d.revenue > 0 || d.covers > 0)
  }, [state, derived.ctx, from, to])

  const values = series.map((d) => d[metric])
  const s = stats(values)
  const latest = values[values.length - 1] ?? 0
  const z = zScore(latest, s.mean, s.sd)

  const withBands = series.map((d) => ({ ...d, mean: s.mean, upper: round(s.mean + s.sd, 2), lower: round(s.mean - s.sd, 2) }))

  // Same-weekday comparison, which is how a restaurant week actually behaves.
  const byDow = useMemo(() => {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const buckets = new Map<number, number[]>()
    for (const d of series) {
      const k = new Date(d.date).getDay()
      const list = buckets.get(k) ?? []
      list.push(d[metric])
      buckets.set(k, list)
    }
    return names.map((name, i) => {
      const list = buckets.get(i) ?? []
      return { name, value: round(list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0, 2) }
    })
  }, [series, metric])

  const labels: Record<typeof metric, { title: string; format: 'money' | 'pct' | 'num'; good: boolean }> = {
    revenue: { title: 'Net revenue', format: 'money', good: true },
    foodCostPct: { title: 'Food cost %', format: 'pct', good: false },
    covers: { title: 'Covers', format: 'num', good: true },
    wastage: { title: 'Wastage value', format: 'money', good: false },
  }
  const cfg = labels[metric]
  const fmt = (v: number) => (cfg.format === 'money' ? moneyShort(v) : cfg.format === 'pct' ? pct(v) : num(v))

  return (
    <>
      <PageHead
        title="Trends vs Average"
        sub="How far the latest day sits from what is normal for this restaurant. One standard deviation either side of the mean is the shaded band — outside it is worth asking about."
        actions={
          <>
            <Pills value={metric} onChange={setMetric} options={[
              { value: 'foodCostPct', label: 'Food cost %' },
              { value: 'revenue', label: 'Revenue' },
              { value: 'covers', label: 'Covers' },
              { value: 'wastage', label: 'Wastage' },
            ]} />
            <PeriodPills days={days} setDays={setDays} />
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <Tile label="Latest" value={fmt(latest)} foot={series[series.length - 1]?.label ?? ''} accent="var(--brand)" />
        <Tile label={`${days}-day average`} value={fmt(s.mean)} foot="the normal line" />
        <Tile label="Spread" value={`± ${fmt(s.sd)}`} foot="one standard deviation" />
        <Tile label="How unusual" value={`${z > 0 ? '+' : ''}${z.toFixed(1)}σ`}
          foot={Math.abs(z) >= 2 ? 'well outside normal' : Math.abs(z) >= 1 ? 'a little off normal' : 'within normal'}
          accent={Math.abs(z) >= 2 ? 'var(--neg)' : Math.abs(z) >= 1 ? 'var(--warn)' : 'var(--pos)'} />
        <Tile label="Range" value={`${fmt(s.min)} – ${fmt(s.max)}`} foot="over the period" />
      </div>

      <div className="grid g-3-2">
        <Card title={cfg.title} sub="daily, against the period average and its normal band">
          <TrendLine
            data={withBands} xKey="label" format={cfg.format} height={320}
            series={[
              { key: metric, name: cfg.title, color: cfg.good ? 'var(--pos)' : 'var(--brand)' },
              { key: 'mean', name: 'Average', color: 'var(--text-dim)', dashed: true },
              { key: 'upper', name: '+1σ', color: 'var(--border-strong)', dashed: true },
              { key: 'lower', name: '−1σ', color: 'var(--border-strong)', dashed: true },
            ]}
          />
        </Card>
        <Card title="By day of week" sub="the shape of a normal week here">
          <Bars data={byDow} xKey="name" format={cfg.format} height={320}
            series={[{ key: 'value', name: cfg.title, color: cfg.good ? 'var(--pos)' : 'var(--brand)' }]} />
        </Card>
      </div>

      <Card title="Days that stand out" sub="more than one standard deviation from normal" flush style={{ marginTop: 14 }}>
        <table className="tbl compact">
          <thead><tr><th>Date</th><th className="num">{cfg.title}</th><th className="num">Average</th><th className="num">Gap</th><th className="num">σ</th><th /></tr></thead>
          <tbody>
            {[...series]
              .map((d) => ({ ...d, z: zScore(d[metric], s.mean, s.sd) }))
              .filter((d) => Math.abs(d.z) >= 1)
              .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
              .slice(0, 15)
              .map((d) => (
                <tr key={d.date}>
                  <td>{d.label} <span className="dim">{new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}</span></td>
                  <td className="num">{fmt(d[metric])}</td>
                  <td className="num dim">{fmt(s.mean)}</td>
                  <td className={`num ${trendClass(d[metric] - s.mean, cfg.good)}`}>{fmt(d[metric] - s.mean)}</td>
                  <td className="num">{d.z > 0 ? '+' : ''}{d.z.toFixed(1)}</td>
                  <td><Badge kind={Math.abs(d.z) >= 2 ? 'critical' : 'watch'}>{Math.abs(d.z) >= 2 ? 'Way off' : 'Off normal'}</Badge></td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}

/* ================================================================== */
/* Item movement                                                       */
/* ================================================================== */

function ItemMovement() {
  const { state, derived } = useLedger()
  const { days, setDays, from, to } = usePeriod(30)
  const [search, setSearch] = useState('')
  const [type, setType] = useState<Movement['type'] | ''>('')
  const [locationId, setLocationId] = useState<ID | ''>('')
  const [drill, setDrill] = useState<ID | null>(null)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.movements
      .filter((m) => m.date >= from && m.date <= to)
      .filter((m) => !type || m.type === type)
      .filter((m) => !locationId || m.locationId === locationId)
      .filter((m) => {
        if (!term) return true
        const item = derived.itemById.get(m.itemId)
        return item ? item.name.toLowerCase().includes(term) || item.sku.toLowerCase().includes(term) : false
      })
      .sort((a, b) => b.ts.localeCompare(a.ts))
  }, [state.movements, derived.itemById, from, to, type, locationId, search])

  const byType = useMemo(() => {
    const m = new Map<Movement['type'], number>()
    for (const mv of rows) m.set(mv.type, (m.get(mv.type) ?? 0) + Math.abs(mv.value))
    return [...m.entries()].map(([k, v], i) => ({ name: MOVEMENT_LABEL[k], value: round(v, 0), color: PALETTE[i % PALETTE.length] }))
      .sort((a, b) => b.value - a.value)
  }, [rows])

  return (
    <>
      <PageHead
        title="Item Movement"
        sub="The full ledger. Every number anywhere in this system traces back to rows on this page."
        actions={
          <>
            <Search value={search} onChange={setSearch} placeholder="Item name or SKU" />
            <select className="select" style={{ width: 160 }} value={type} onChange={(e) => setType(e.target.value as never)}>
              <option value="">All movement types</option>
              {Object.entries(MOVEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="select" style={{ width: 150 }} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All locations</option>
              {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <PeriodPills days={days} setDays={setDays} />
          </>
        }
      />

      <div className="grid g-3-2" style={{ marginBottom: 14 }}>
        <Card title="Movements by type" sub={`${num(rows.length)} rows in the current filter`}>
          <Bars data={byType} xKey="name" series={[{ key: 'value', name: 'Value' }]} horizontal height={230} />
        </Card>
        <Card title="Share of value">
          <Donut data={byType} height={230} />
        </Card>
      </div>

      <Card flush>
        <div className="table-wrap scroll-y mh-560">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Item</th><th>Type</th><th>Location</th><th className="num">Qty</th>
                <th className="num">Rate</th><th className="num">Value</th><th>By</th><th>Reference</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((m) => {
                const item = derived.itemById.get(m.itemId)
                return (
                  <tr key={m.id} className="clickable" onClick={() => setDrill(m.itemId)}>
                    <td className="nowrap dim">{dayLabel(m.date)}</td>
                    <td className="tbl-name">{item?.name ?? m.itemId}</td>
                    <td><Badge kind={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge></td>
                    <td className="dim">{derived.locationById.get(m.locationId)?.name}</td>
                    <td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>
                      {m.qty > 0 ? '+' : ''}{item ? fmtQty(m.qty, item.baseUnit) : num(m.qty, 2)}
                    </td>
                    <td className="num dim">{item ? money(m.rate * item.purchaseConversion, 2) : money(m.rate, 4)}</td>
                    <td className="num">{money(Math.abs(m.value))}</td>
                    <td className="dim">{m.staffId ? derived.staffById.get(m.staffId)?.name.split(' ')[0] ?? '—' : '—'}</td>
                    <td className="dim mono-sm">{m.refType}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 500 && (
          <div className="card-foot dim" style={{ fontSize: 12 }}>
            Showing the 500 most recent of {num(rows.length)} rows. Narrow the filter or export to see the rest.
          </div>
        )}
      </Card>
    </>
  )
}

/* ================================================================== */
/* Wastage analysis                                                    */
/* ================================================================== */

function WastageAnalysis() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const { days, setDays, from, to } = usePeriod(90)

  const rows = useMemo(() => state.wastage
    .filter((w) => w.date >= from && w.date <= to)
    .map((w) => {
      const item = derived.itemById.get(w.itemId)
      return { w, item, value: item ? w.qtyBase * item.avgCost : 0 }
    }), [state.wastage, derived.itemById, from, to])

  const total = rows.reduce((s, r) => s + r.value, 0)
  const revenue = filterSales(state.sales, from, to)
    .reduce((s, d) => s + d.lines.reduce((t, l) => t + l.grossAmount - l.discount, 0), 0)

  const monthly = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(monthKey(r.w.date), (m.get(monthKey(r.w.date)) ?? 0) + r.value)
    return [...m.entries()].sort().map(([k, v]) => ({ label: monthLabel(k), value: round(v, 0) }))
  }, [rows])

  const byCategory = useMemo(() => {
    const m = new Map<ID, number>()
    for (const r of rows) {
      if (!r.item) continue
      m.set(r.item.categoryId, (m.get(r.item.categoryId) ?? 0) + r.value)
    }
    return [...m.entries()].map(([id, v], i) => ({
      name: derived.categoryById.get(id)?.name ?? id, value: round(v, 0), color: PALETTE[i % PALETTE.length],
    })).sort((a, b) => b.value - a.value)
  }, [rows, derived.categoryById])

  const byStaff = useMemo(() => {
    const m = new Map<ID, number>()
    for (const r of rows) {
      if (!r.w.byStaffId) continue
      m.set(r.w.byStaffId, (m.get(r.w.byStaffId) ?? 0) + r.value)
    }
    return [...m.entries()].map(([id, v]) => ({
      name: derived.staffById.get(id)?.name.split(' ')[0] ?? id, value: round(v, 0),
    })).sort((a, b) => b.value - a.value).reverse()
  }, [rows, derived.staffById])

  return (
    <>
      <PageHead
        title="Wastage Analysis"
        sub="Logged wastage only. What is thrown away without being recorded shows up in the variance report instead — the two together are the real number."
        actions={
          <>
            <PeriodPills days={days} setDays={setDays} />
            <button className="btn" onClick={() => navigate('/kitchen/wastage')}>Log wastage</button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Wastage recorded" value={moneyShort(total)} foot={`${rows.length} entries`} accent="var(--warn)" />
        <Tile label="As % of sales" value={pct(revenue ? (total / revenue) * 100 : 0, 2)}
          foot="1% is a common target" accent={revenue && total / revenue > 0.015 ? 'var(--neg)' : 'var(--pos)'} />
        <Tile label="Per day" value={moneyShort(total / Math.max(days, 1))} foot="average" />
        <Tile label="Annualised" value={moneyShort((total / Math.max(days, 1)) * 365)} foot="at this rate" accent="var(--neg)" />
      </div>

      <div className="grid g3">
        <Card title="Month by month">
          {monthly.length ? <Bars data={monthly} xKey="label" series={[{ key: 'value', name: 'Wastage' }]} height={240} />
            : <Empty icon="♻️" title="Nothing recorded" />}
        </Card>
        <Card title="By category">
          <Donut data={byCategory} height={240} />
        </Card>
        <Card title="By who logged it" sub="recording waste is a good habit, not a black mark">
          {byStaff.length ? <Bars data={byStaff} xKey="name" series={[{ key: 'value', name: 'Wastage' }]} horizontal height={240} />
            : <Empty icon="👥" title="No attribution" />}
        </Card>
      </div>
    </>
  )
}

/* ================================================================== */
/* Stock valuation                                                     */
/* ================================================================== */

function Valuation() {
  const { state, derived } = useLedger()
  const [drill, setDrill] = useState<ID | null>(null)
  const { days, from, to } = usePeriod(30)

  const rows = useMemo(() => {
    const usage = new Map<ID, number>()
    for (const m of state.movements) {
      if (m.date < from) continue
      if (m.type !== 'CONSUMPTION' && m.type !== 'PRODUCTION_OUT') continue
      usage.set(m.itemId, (usage.get(m.itemId) ?? 0) + Math.abs(m.qty))
    }
    return state.items.map((item) => {
      const onHand = derived.onHand.get(item.id) ?? 0
      const value = onHand * item.avgCost
      const perDay = (usage.get(item.id) ?? 0) / Math.max(days, 1)
      return {
        item, onHand, value, perDay,
        cover: perDay > 0 ? onHand / perDay : null,
        dead: perDay === 0 && Math.abs(onHand) > 0.001,
      }
    }).filter((r) => Math.abs(r.onHand) > 0.001).sort((a, b) => b.value - a.value)
  }, [state.items, state.movements, derived, from, days])

  const total = rows.reduce((s, r) => s + r.value, 0)
  const dead = rows.filter((r) => r.dead)
  const slow = rows.filter((r) => r.cover !== null && r.cover > 14)

  const byCategory = useMemo(() => {
    const m = new Map<ID, number>()
    for (const r of rows) m.set(r.item.categoryId, (m.get(r.item.categoryId) ?? 0) + r.value)
    return [...m.entries()].map(([id, v], i) => ({
      name: derived.categoryById.get(id)?.name ?? id, value: round(v, 0), color: PALETTE[i % PALETTE.length],
    })).sort((a, b) => b.value - a.value)
  }, [rows, derived.categoryById])

  const byLocation = state.locations.map((loc, i) => ({
    name: loc.name, color: PALETTE[i % PALETTE.length],
    value: round(state.items.reduce((s, item) => s + derived.balance(item.id, loc.id) * item.avgCost, 0), 0),
  })).filter((r) => r.value > 1)

  // Daily cost of sales, to express stock as days of cover for the whole business.
  const dailyCogs = useMemo(() => {
    const total = state.movements
      .filter((m) => m.date >= from && m.date <= to && m.type === 'CONSUMPTION')
      .reduce((s, m) => s + Math.abs(m.value), 0)
    return total / Math.max(days, 1)
  }, [state.movements, from, to, days])

  return (
    <>
      <PageHead
        title="Stock Valuation"
        sub="What is on the shelves right now, at weighted average cost, and how long it would last at the current rate of use."
        actions={
          <button className="btn" onClick={() => downloadText(`stock-valuation-${to}.csv`, toCsv(rows.map((r) => ({
            SKU: r.item.sku, Item: r.item.name,
            Category: derived.categoryById.get(r.item.categoryId)?.name ?? '',
            Unit: r.item.baseUnit, 'On hand': round(r.onHand, 3),
            'Cost per unit': round(r.item.avgCost, 6), Value: round(r.value, 2),
            'Days cover': r.cover === null ? '' : round(r.cover, 1),
          }))))}>Export CSV</button>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Total stock value" value={moneyShort(total)} foot={`${rows.length} items`} accent="var(--purple)" />
        <Tile label="Days of cover" value={dailyCogs > 0 ? (total / dailyCogs).toFixed(1) : '—'}
          foot={`at ${moneyShort(dailyCogs)} a day`} />
        <Tile label="Slow moving" value={moneyShort(slow.reduce((s, r) => s + r.value, 0))}
          foot={`${slow.length} items with over 14 days cover`} accent="var(--warn)" />
        <Tile label="Not moving at all" value={moneyShort(dead.reduce((s, r) => s + r.value, 0))}
          foot={`${dead.length} items unused in ${days} days`} accent="var(--neg)" />
      </div>

      <div className="grid g-3-2" style={{ marginBottom: 14 }}>
        <Card title="Value by category">
          <Bars data={byCategory.slice(0, 10).reverse()} xKey="name" series={[{ key: 'value', name: 'Value' }]} horizontal height={280} />
        </Card>
        <Card title="By location">
          <Donut data={byLocation} height={200} />
          <div style={{ marginTop: 10 }}>
            <ValueBar rows={byLocation.map((l) => ({ label: l.name, value: l.value, color: l.color }))} total={total} />
          </div>
        </Card>
      </div>

      <Card title="Every item on hand" flush>
        <div className="table-wrap scroll-y mh-560">
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th>Category</th><th className="num">On hand</th><th className="num">Cost / unit</th>
                <th className="num">Value</th><th className="num">Share</th><th className="num">Days cover</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item.id} className="clickable" onClick={() => setDrill(r.item.id)}>
                  <td>
                    <div className="tbl-name">{r.item.name}</div>
                    <div className="tbl-sub">{r.item.sku}</div>
                  </td>
                  <td className="dim">{derived.categoryById.get(r.item.categoryId)?.name}</td>
                  <td className="num">{fmtQty(r.onHand, r.item.baseUnit)}</td>
                  <td className="num dim">{money(r.item.avgCost * r.item.purchaseConversion, 2)}<span className="dim">/{r.item.purchaseUnit}</span></td>
                  <td className="num">{money(r.value)}</td>
                  <td className="num dim">{pct(total ? (r.value / total) * 100 : 0, 1)}</td>
                  <td className="num">{r.cover === null ? '—' : r.cover.toFixed(1)}</td>
                  <td>
                    {r.dead ? <Badge kind="critical">Not moving</Badge>
                      : r.cover !== null && r.cover > 14 ? <Badge kind="watch">Slow</Badge>
                      : <Badge kind="ok">Moving</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}
