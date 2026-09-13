import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Badge, Card, Empty, SeverityBadge, Tile } from '../components/ui'
import { ComboBarLine, Donut, PALETTE } from '../components/charts'
import { ItemDrawer, ValueBar } from './shared'
import { addDays, dayLabel, diffDays, monthKey, monthLabel, rangeDays } from '../core/dates'
import { chefScorecards, dishPerformance, filterSales, pnlSeries } from '../core/analytics'
import { computeVariance, summarise } from '../core/variance'
import { reorderAlerts } from '../core/stock'
import { varianceBySection as attributeVarianceToSections } from '../core/attribution'
import { money, moneyShort, num, pct, qty, signedPct } from '../lib/format'
import type { ID, Severity } from '../core/types'

export default function Dashboard() {
  const { state, derived } = useLedger()
  const navigate = useNavigate()
  const [drill, setDrill] = useState<ID | null>(null)

  const data = useMemo(() => {
    const today = derived.today
    const monthStart = `${monthKey(today)}-01`
    const elapsed = diffDays(monthStart, today)
    // Compare month-to-date against the same stretch of the previous month —
    // fourteen days against a full month would read as a 55% collapse.
    const prevMonthEnd = addDays(monthStart, -1)
    const prevMonthStart = `${monthKey(prevMonthEnd)}-01`
    const prevCompareEnd = addDays(prevMonthStart, elapsed)

    const todaySales = filterSales(state.sales, today, today)
    const monthSales = filterSales(state.sales, monthStart, today)
    const prevSales = filterSales(state.sales, prevMonthStart, prevCompareEnd)

    const todayPerf = dishPerformance(derived.ctx, state.dishes, todaySales)
    const monthPerf = dishPerformance(derived.ctx, state.dishes, monthSales)
    const prevPerf = dishPerformance(derived.ctx, state.dishes, prevSales)

    // Daily revenue and food-cost line for the last 30 days.
    const days = rangeDays(addDays(today, -29), today)
    const daily = pnlSeries({
      ctx: derived.ctx, dishes: state.dishes, sales: state.sales, movements: state.movements,
      items: state.items, staff: state.staff, from: days[0], to: today, groupBy: 'day',
    })
    const dailyMap = new Map(daily.map((d) => [d.key, d]))
    const trend = days.map((d) => {
      const p = dailyMap.get(d)
      return {
        label: dayLabel(d),
        date: d,
        revenue: p?.netRevenue ?? 0,
        foodCost: p?.theoreticalFoodCost ?? 0,
        foodCostPct: p?.actualFoodCostPct ?? 0,
      }
    })

    // Most recent physical count at each location, and what it revealed.
    const latestTakes = new Map<ID, typeof state.stocktakes[number]>()
    for (const t of [...state.stocktakes].sort((a, b) => a.date.localeCompare(b.date))) {
      latestTakes.set(t.locationId, t)
    }
    let varianceRows: ReturnType<typeof computeVariance> = []
    for (const take of latestTakes.values()) {
      const history = state.stocktakes
        .filter((s) => s.locationId === take.locationId && s.date < take.date)
        .map((s) => ({ date: s.date, rows: new Map<ID, number>() }))
      varianceRows = varianceRows.concat(
        computeVariance({ items: state.items, categories: state.categories, movements: state.movements, stocktake: take, history }),
      )
    }
    const variance = summarise(varianceRows)
    const lastCountDate = [...latestTakes.values()].map((t) => t.date).sort().pop() ?? null

    // Reorder pressure.
    const last30 = addDays(today, -29)
    const usage = new Map<ID, number>()
    for (const m of state.movements) {
      if (m.date < last30) continue
      if (m.type !== 'CONSUMPTION' && m.type !== 'PRODUCTION_OUT') continue
      usage.set(m.itemId, (usage.get(m.itemId) ?? 0) + Math.abs(m.qty) / 30)
    }
    const alerts = reorderAlerts(state.items, derived.onHand, usage, (item) =>
      item.defaultSupplierId ? derived.supplierById.get(item.defaultSupplierId)?.leadTimeDays ?? 2 : 1)
      .map((a) => {
        const item = derived.itemById.get(a.itemId)
        return { ...a, orderLabel: item ? qty(a.suggestedOrderQty, item.baseUnit) : String(Math.round(a.suggestedOrderQty)) }
      })

    // Stock value by location.
    const byLocation = state.locations.map((loc, i) => {
      let value = 0
      for (const item of state.items) value += derived.balance(item.id, loc.id) * item.avgCost
      return { name: loc.name, value, color: PALETTE[i % PALETTE.length], id: loc.id }
    }).filter((r) => r.value > 1)

    // Chefs, this month.
    const sectionLeak = attributeVarianceToSections(derived.ctx, state.dishes, varianceRows)
    const chefs = chefScorecards({
      ctx: derived.ctx, dishes: state.dishes, sales: monthSales, staff: state.staff,
      sections: state.sections, wastage: state.wastage.filter((w) => w.date >= monthStart),
      items: state.items, varianceBySection: sectionLeak, days: Math.max(1, monthSales.length / 4),
    })

    const monthWastage = state.movements
      .filter((m) => m.type === 'WASTAGE' && m.date >= monthStart)
      .reduce((s, m) => s + Math.abs(m.value), 0)

    const openDay = state.dayCloses.find((d) => d.date === today && d.status !== 'CLOSED')

    return {
      today, todayPerf, monthPerf, prevPerf, trend, variance, varianceRows, lastCountDate,
      alerts, byLocation, chefs, monthWastage, openDay, monthStart,
    }
  }, [state, derived])

  const m = data.monthPerf.totals
  const p = data.prevPerf.totals
  const revDelta = p.netRevenue ? ((m.netRevenue - p.netRevenue) / p.netRevenue) * 100 : 0
  const fcDelta = p.foodCostPct ? m.foodCostPct - p.foodCostPct : 0

  // A month's worth of the leakage found at the last count.
  const projectedLeak = data.variance.negativeLeak * 4.3

  const actions = buildActions(data)

  return (
    <>
      <PageHead
        title="Control Tower"
        sub={`Spice Route Kitchen · ${monthLabel(monthKey(data.today))} to date. Every tile opens the detail behind it.`}
        actions={
          <>
            <button className="btn" onClick={() => navigate('/kitchen/quick-take')}>⚡ Quick Take</button>
            <button className="btn btn-primary" onClick={() => navigate('/eod/close')}>
              {data.openDay ? 'Close the day' : 'Day close'}
            </button>
          </>
        }
      />

      <div className="stack">
        <div className="grid g6">
          <Tile
            label="Revenue today" value={moneyShort(data.todayPerf.totals.revenue)}
            foot={`${num(data.todayPerf.totals.covers)} covers · ${money(data.todayPerf.totals.avgSpend)} avg`}
            accent="var(--brand)" onClick={() => navigate('/sales/register')}
          />
          <Tile
            label="Revenue MTD" value={moneyShort(m.revenue)} delta={revDelta}
            foot="vs same days last month" accent="var(--info)" onClick={() => navigate('/reports/pnl')}
          />
          <Tile
            label="Food cost MTD" value={pct(m.foodCostPct)} delta={fcDelta} deltaGood={false} deltaUnit="pp"
            foot={`${moneyShort(m.foodCost)} of ${moneyShort(m.netRevenue)}`}
            accent={m.foodCostPct > 34 ? 'var(--neg)' : 'var(--pos)'}
            onClick={() => navigate('/reports/pnl')}
          />
          <Tile
            label="Contribution MTD" value={moneyShort(m.contribution)}
            foot={pct(m.netRevenue ? (m.contribution / m.netRevenue) * 100 : 0)}
            accent="var(--pos)" onClick={() => navigate('/reports/pnl')}
          />
          <Tile
            label="Leakage found" value={moneyShort(Math.abs(data.variance.negativeLeak))}
            foot={data.lastCountDate ? `count on ${dayLabel(data.lastCountDate)}` : 'no count yet'}
            accent="var(--neg)" onClick={() => navigate('/reports/variance')}
          />
          <Tile
            label="Stock on hand" value={moneyShort(derived.stockValue)}
            foot={`${data.byLocation.length} locations`} accent="var(--purple)"
            onClick={() => navigate('/reports/valuation')}
          />
        </div>

        <div className="grid g-2-1">
          <Card
            title="Revenue and food cost" sub="last 30 days — bars are money, the line is food cost %"
            actions={<button className="btn btn-sm btn-ghost" onClick={() => navigate('/reports/pnl')}>Full P&L →</button>}
          >
            <ComboBarLine
              data={data.trend} xKey="label" height={268}
              bars={[
                { key: 'revenue', name: 'Net revenue', color: 'rgba(74,168,240,0.55)' },
                { key: 'foodCost', name: 'Food cost', color: 'rgba(232,145,58,0.75)' },
              ]}
              lines={[{ key: 'foodCostPct', name: 'Food cost %', color: 'var(--neg)' }]}
            />
          </Card>

          <Card title="What needs attention" sub="ranked by what it costs you" flush>
            {actions.length === 0 ? (
              <Empty icon="✅" title="Nothing urgent">Stock, variance and the day close are all in order.</Empty>
            ) : (
              <div className="drill scroll-y mh-300">
                {actions.map((a, i) => (
                  <div key={i} className="drill-row" onClick={() => navigate(a.to)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="dot" style={{ background: a.color }} />
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{a.title}</span>
                      </div>
                      <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{a.detail}</div>
                    </div>
                    <span className="dim">›</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid g3">
          <Card
            title="Top dishes this month" sub="by contribution, not by covers"
            actions={<button className="btn btn-sm btn-ghost" onClick={() => navigate('/sales/dishes')}>All →</button>}
            flush
          >
            <table className="tbl compact">
              <thead><tr><th>Dish</th><th className="num">Sold</th><th className="num">Contribution</th><th className="num">FC%</th></tr></thead>
              <tbody>
                {[...data.monthPerf.rows].sort((a, b) => b.contribution - a.contribution).slice(0, 7).map((r) => (
                  <tr key={r.dishId} className="clickable" onClick={() => navigate(`/menu/costing?dish=${r.dishId}`)}>
                    <td className="tbl-name">{r.name}</td>
                    <td className="num">{num(r.qty)}</td>
                    <td className="num pos">{moneyShort(r.contribution)}</td>
                    <td className="num">{pct(r.foodCostPct, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card
            title="Chef contribution" sub="this month, after leakage and labour"
            actions={<button className="btn btn-sm btn-ghost" onClick={() => navigate('/reports/chefs')}>Detail →</button>}
            flush
          >
            <table className="tbl compact">
              <thead><tr><th>Chef</th><th>Section</th><th className="num">Contribution</th><th className="num">Index</th></tr></thead>
              <tbody>
                {data.chefs.slice(0, 7).map((c) => (
                  <tr key={c.chefId} className="clickable" onClick={() => navigate('/reports/chefs')}>
                    <td>
                      <span className={`rank${c.rank === 1 ? ' top' : ''}`} style={{ marginRight: 8, display: 'inline-grid' }}>{c.rank}</span>
                      {c.name}
                    </td>
                    <td className="dim">{c.sectionName}</td>
                    <td className="num">{moneyShort(c.contribution)}</td>
                    <td className="num">{c.efficiencyIndex.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Where the stock sits" sub="valued at weighted average cost">
            <Donut
              data={data.byLocation} height={168}
              onClick={(row) => { const loc = data.byLocation.find((l) => l.name === row?.name); if (loc) navigate(loc.id === 'loc_kitchen' ? '/kitchen/stock' : '/store/stock') }}
            />
            <div style={{ marginTop: 10 }}>
              <ValueBar
                rows={data.byLocation.map((l) => ({ label: l.name, value: l.value, color: l.color }))}
                total={derived.stockValue}
              />
            </div>
          </Card>
        </div>

        <div className="grid g2">
          <Card
            title="Biggest variances at the last count"
            sub={data.lastCountDate ? `counted ${dayLabel(data.lastCountDate)} — expected against physical` : 'no count recorded yet'}
            actions={<button className="btn btn-sm btn-ghost" onClick={() => navigate('/eod/variance')}>Review →</button>}
            flush
          >
            {data.variance.worst.length === 0 ? (
              <Empty icon="⚖️" title="No material variance">Everything counted within tolerance.</Empty>
            ) : (
              <table className="tbl compact">
                <thead><tr><th>Item</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Gap</th><th>Severity</th></tr></thead>
                <tbody>
                  {data.variance.worst.map((r) => (
                    <tr key={r.itemId} className={`clickable sev-${r.severity}`} onClick={() => setDrill(r.itemId)}>
                      <td className="tbl-name">{r.name}</td>
                      <td className="num dim">{qty(r.expectedClosing, r.baseUnit)}</td>
                      <td className="num">{qty(r.actualClosing, r.baseUnit)}</td>
                      <td className="num neg">{money(r.varianceValue)}<span className="dim"> ({signedPct(r.variancePct)})</span></td>
                      <td><SeverityBadge severity={r.severity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Running out soon" sub="at the current rate of use, allowing for supplier lead time" flush>
            {data.alerts.length === 0 ? (
              <Empty icon="📦" title="Everything is covered">No item drops below its reorder point inside its lead time.</Empty>
            ) : (
              <table className="tbl compact">
                <thead><tr><th>Item</th><th className="num">On hand</th><th className="num">Days left</th><th className="num">Order</th><th /></tr></thead>
                <tbody>
                  {data.alerts.slice(0, 8).map((a) => {
                    const item = derived.itemById.get(a.itemId)!
                    return (
                      <tr key={a.itemId} className="clickable" onClick={() => setDrill(a.itemId)}>
                        <td className="tbl-name">{a.name}</td>
                        <td className="num">{qty(a.onHand, item.baseUnit)}</td>
                        <td className="num">{a.daysLeft === null ? '—' : a.daysLeft.toFixed(1)}</td>
                        <td className="num">{qty(a.suggestedOrderQty, item.baseUnit)}</td>
                        <td><Badge kind={a.severity === 'CRITICAL' ? 'critical' : a.severity === 'LOW' ? 'watch' : 'neutral'}>{a.severity}</Badge></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <Card title="If nothing changes" sub="the last count, projected across a month of trading">
          <div className="grid g4">
            <Tile label="Leakage / month" value={moneyShort(Math.abs(projectedLeak))}
              foot={`${pct(m.netRevenue ? (Math.abs(projectedLeak) / m.netRevenue) * 100 : 0)} of revenue`} accent="var(--neg)" />
            <Tile label="Wastage MTD" value={moneyShort(data.monthWastage)}
              foot={`${pct(m.netRevenue ? (data.monthWastage / m.netRevenue) * 100 : 0)} of revenue`} accent="var(--warn)" />
            <Tile label="Items over tolerance" value={num(data.variance.critical + data.variance.high)}
              foot={`of ${num(data.variance.itemsCounted)} counted`} accent="#f08c3c" />
            <Tile label="Recoverable" value={moneyShort(Math.abs(projectedLeak) * 0.6)}
              foot="at 60% of the gap closed" accent="var(--pos)" />
          </div>
        </Card>
      </div>

      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

/* ------------------------------------------------------------------ */

interface Action { title: string; detail: string; to: string; color: string; weight: number }

interface ActionInput {
  openDay?: unknown
  alerts: { name: string; daysLeft: number | null; leadTimeDays: number; orderLabel: string; severity: string }[]
  variance: { worst: { name: string; variancePct: number; varianceValue: number; severity: Severity }[] }
}

function buildActions(d: ActionInput): Action[] {
  const out: Action[] = []
  if (d.openDay) {
    out.push({
      title: 'Today is still open', detail: 'Post sales, count the kitchen and sign off',
      to: '/eod/close', color: 'var(--warn)', weight: 60,
    })
  }
  for (const a of d.alerts.slice(0, 5)) {
    out.push({
      title: `${a.name} runs out in ${a.daysLeft === null ? '—' : `${a.daysLeft.toFixed(1)} days`}`,
      detail: `${a.leadTimeDays}-day lead time · order ${a.orderLabel}`,
      to: '/purchase/manual', color: a.severity === 'CRITICAL' ? 'var(--neg)' : 'var(--warn)',
      weight: a.severity === 'CRITICAL' ? 100 : 50,
    })
  }
  for (const v of d.variance.worst.slice(0, 4)) {
    if (v.severity !== 'CRITICAL' && v.severity !== 'HIGH') continue
    out.push({
      title: `${v.name} is ${Math.abs(v.variancePct).toFixed(1)}% over recipe`,
      detail: `${money(Math.abs(v.varianceValue))} unaccounted at the last count`,
      to: '/eod/variance', color: v.severity === 'CRITICAL' ? 'var(--neg)' : '#f08c3c',
      weight: v.severity === 'CRITICAL' ? 90 : 45,
    })
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 8)
}
