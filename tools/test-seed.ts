import { generateSeed } from '../src/core/seed/generate'
import { buildContext, costDish } from '../src/core/costing'
import { dishPerformance, pnlSeries, chefScorecards } from '../src/core/analytics'
import { computeVariance, summarise } from '../src/core/variance'
import { balances } from '../src/core/stock'

const today = '2026-09-14'
const t0 = Date.now()
const s = generateSeed(today)
console.log('generated in', Date.now() - t0, 'ms')
console.log({
  movements: s.movements.length, bills: s.bills.length, issues: s.issues.length,
  production: s.production.length, wastage: s.wastage.length, sales: s.sales.length,
  stocktakes: s.stocktakes.length, dishes: s.dishes.length, items: s.items.length,
})
const ctx = buildContext(s.items, s.recipes)
const perf = dishPerformance(ctx, s.dishes, s.sales.filter(x => x.date >= '2026-08-15'))
console.log('\n-- totals (last 30d) --', perf.totals)
console.log('\n-- top 6 dishes --')
for (const r of perf.rows.slice(0, 6)) console.log(r.rank, r.name.padEnd(22), 'qty', String(r.qty).padStart(5), 'rev', Math.round(r.revenue), 'fc%', r.foodCostPct, r.classification)
console.log('\n-- plate cost check --')
for (const d of s.dishes.slice(0, 4)) { const c = costDish(ctx, d, true); console.log(d.name.padEnd(22), 'price', c.price, 'food', c.foodCost, 'fc%', c.foodCostPct, 'contrib', c.contribution) }
const pnl = pnlSeries({ ctx, dishes: s.dishes, sales: s.sales, movements: s.movements, items: s.items, staff: s.staff, from: '2026-05-18', to: today, groupBy: 'month' })
console.log('\n-- monthly P&L --')
for (const p of pnl) console.log(p.key, 'rev', Math.round(p.netRevenue), 'fc', Math.round(p.theoreticalFoodCost), 'fc%', p.foodCostPct, 'contrib%', p.contributionPct, 'days', p.days)
const kTakes = s.stocktakes.filter(x => x.locationId === 'loc_kitchen')
const lastTake = kTakes[kTakes.length - 1]
const history = kTakes.slice(0, -1).map(t => ({ date: t.date, rows: new Map<string, number>() }))
const v = computeVariance({ items: s.items, categories: s.categories, movements: s.movements, stocktake: lastTake, history })
console.log('\n-- variance (last kitchen count', lastTake.date, ') --', summarise(v))
console.log('period throughput basis; top rows:')
for (const r of v.slice(0, 8)) console.log(' ', r.name.padEnd(24), 'exp', String(Math.round(r.expectedClosing)).padStart(8), 'actual', String(Math.round(r.actualClosing)).padStart(8), 'var%', String(r.variancePct).padStart(7), 'INR', String(r.varianceValue).padStart(9), r.severity)
const chefs = chefScorecards({ ctx, dishes: s.dishes, sales: s.sales.filter(x => x.date >= '2026-08-15'), staff: s.staff, sections: s.sections, wastage: s.wastage.filter(w => w.date >= '2026-08-15'), items: s.items, days: 30 })
console.log('\n-- chef scorecards --')
for (const c of chefs) console.log(c.rank, c.name.padEnd(16), c.sectionName.padEnd(18), 'rev', Math.round(c.revenue), 'fc%', c.actualFoodCostPct, 'contrib', Math.round(c.contribution), 'idx', c.efficiencyIndex)
const kitchenTakes = s.stocktakes.filter(x => x.locationId === 'loc_kitchen')
console.log('\n-- kitchen count variance over time (chicken) --')
for (const t of kitchenTakes.slice(-6)) {
  const l = t.lines.find(x => x.itemId === 'itm_chk001')
  if (l) console.log(' ', t.date, 'system', Math.round(l.systemQtyBase), 'counted', Math.round(l.countedQtyBase), 'gap', Math.round(l.countedQtyBase - l.systemQtyBase))
}
const b = balances(s.movements)
let neg = 0; for (const x of b.values()) if (x.qty < -0.5) neg++
console.log('\nnegative balances:', neg, 'of', b.size)
