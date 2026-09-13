import { useEffect, useMemo, useState } from 'react'
import { Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import {
  Badge, Card, CascadeSelect, Empty, Field, Modal, Search, Tile, useToast,
} from '../components/ui'
import { MenuMatrix, PALETTE } from '../components/charts'
import { ItemDrawer, PeriodPills, usePeriod } from './shared'
import { costDish, costRecipe, mergeCostedLines } from '../core/costing'
import { dishPerformance, filterSales } from '../core/analytics'
import { uid } from '../data/commands'
import { round, unitOptions } from '../core/units'
import { money, moneyShort, num, pct, qty as fmtQty, toCsv, downloadText } from '../lib/format'
import type { Dish, ID, Recipe, RecipeLine, SopStep } from '../core/types'

export default function Menu() {
  return (
    <Routes>
      <Route path="recipes" element={<RecipeList owner="DISH" />} />
      <Route path="prep" element={<RecipeList owner="PREP" />} />
      <Route path="dishes" element={<Dishes />} />
      <Route path="costing" element={<Costing />} />
      <Route path="engineering" element={<Engineering />} />
      <Route path="*" element={<RecipeList owner="DISH" />} />
    </Routes>
  )
}

/* ================================================================== */
/* SOP list + builder                                                  */
/* ================================================================== */

function RecipeList({ owner }: { owner: 'DISH' | 'PREP' }) {
  const { state, derived } = useLedger()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const editing = params.get('edit')

  const owners = useMemo(() => {
    if (owner === 'DISH') {
      return state.dishes.filter((d) => d.active).map((d) => ({
        id: d.id, name: d.name, categoryId: d.categoryId, subCategoryId: d.subCategoryId,
        meta: money(d.price), unit: 'portion',
      }))
    }
    return state.items.filter((i) => i.isPrep && i.active).map((i) => ({
      id: i.id, name: i.name, categoryId: i.categoryId, subCategoryId: i.subCategoryId,
      meta: i.sku, unit: i.baseUnit,
    }))
  }, [owner, state.dishes, state.items])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return owners
      .filter((o) => !term || o.name.toLowerCase().includes(term))
      .map((o) => {
        const recipe = derived.recipeFor(owner, o.id)
        const lines = recipe?.lines.length ?? 0
        const steps = recipe?.steps.length ?? 0
        let cost = 0
        let fcPct: number | null = null
        if (owner === 'DISH') {
          const dish = derived.dishById.get(o.id)
          if (dish) {
            const c = costDish(derived.ctx, dish, true)
            cost = c.foodCost
            fcPct = c.foodCostPct
          }
        } else if (recipe) {
          const costed = costRecipe(derived.ctx, 'PREP', o.id, recipe.yieldQty, { explode: true })
          cost = costed.reduce((s, l) => s + l.cost, 0)
        }
        return { ...o, recipe, lines, steps, cost, fcPct }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [owners, derived, owner, search])

  const missing = rows.filter((r) => !r.recipe || r.lines === 0).length
  const noSteps = rows.filter((r) => r.recipe && r.steps === 0).length

  return (
    <>
      <PageHead
        title={owner === 'DISH' ? 'Recipe SOPs' : 'Prep & Sub-recipes'}
        sub={
          owner === 'DISH'
            ? 'One standard per dish: exact quantities, the method, and the checks that matter. Everything downstream — costing, depletion, variance — reads these numbers.'
            : 'Gravies, pastes and masala blends the kitchen makes itself. A dish that uses one of these is costed all the way down to the raw ingredients.'
        }
        actions={<Search value={search} onChange={setSearch} placeholder="Search…" />}
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label={owner === 'DISH' ? 'Dishes' : 'Prep items'} value={num(rows.length)} foot="on the menu" />
        <Tile label="With a full SOP" value={num(rows.length - missing)}
          foot={`${num(missing)} still to write`} accent={missing ? 'var(--warn)' : 'var(--pos)'} />
        <Tile label="Method documented" value={num(rows.length - noSteps)}
          foot={`${num(noSteps)} have quantities but no method`} accent={noSteps ? 'var(--warn)' : 'var(--pos)'} />
        <Tile
          label={owner === 'DISH' ? 'Average plate cost' : 'Average batch cost'}
          value={money(rows.length ? rows.reduce((s, r) => s + r.cost, 0) / rows.length : 0)}
          foot="at today's prices"
        />
      </div>

      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{owner === 'DISH' ? 'Dish' : 'Prep item'}</th>
                <th>Category</th>
                <th className="num">Ingredients</th>
                <th className="num">Method steps</th>
                <th className="num">{owner === 'DISH' ? 'Plate cost' : 'Batch cost'}</th>
                {owner === 'DISH' && <th className="num">Food cost %</th>}
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setParams({ edit: r.id })}>
                  <td>
                    <div className="tbl-name">{r.name}</div>
                    <div className="tbl-sub">{r.meta}</div>
                  </td>
                  <td className="dim">{derived.categoryById.get(r.categoryId)?.name}</td>
                  <td className="num">{r.lines || <span className="dim">—</span>}</td>
                  <td className="num">{r.steps || <span className="dim">—</span>}</td>
                  <td className="num">{money(r.cost, 2)}</td>
                  {owner === 'DISH' && (
                    <td className="num">
                      <span className={r.fcPct && r.fcPct > 40 ? 'neg' : r.fcPct && r.fcPct > 33 ? 'warn' : 'pos'}>
                        {r.fcPct === null ? '—' : pct(r.fcPct)}
                      </span>
                    </td>
                  )}
                  <td>
                    {!r.recipe || r.lines === 0 ? <Badge kind="critical">No SOP</Badge>
                      : r.steps === 0 ? <Badge kind="watch">No method</Badge>
                      : <Badge kind="ok">Complete</Badge>}
                  </td>
                  <td className="right"><span className="dim">Edit ›</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <SopEditor
          owner={owner}
          ownerId={editing}
          onClose={() => setParams({})}
        />
      )}
    </>
  )
}

/* ---------------- the builder itself ---------------- */

function SopEditor({ owner, ownerId, onClose }: { owner: 'DISH' | 'PREP'; ownerId: ID; onClose: () => void }) {
  const { state, derived, actions, user } = useLedger()
  const { push } = useToast()
  const existing = derived.recipeFor(owner, ownerId)
  const dish = owner === 'DISH' ? derived.dishById.get(ownerId) : undefined
  const prepItem = owner === 'PREP' ? derived.itemById.get(ownerId) : undefined
  const [tab, setTab] = useState<'lines' | 'method'>('lines')
  const [drill, setDrill] = useState<ID | null>(null)

  const [draft, setDraft] = useState<Recipe>(() => existing ?? {
    id: uid('rcp'), ownerType: owner, ownerId, version: 1,
    yieldQty: owner === 'DISH' ? 1 : 1000, lines: [], steps: [],
    updatedAt: new Date().toISOString(), active: true,
  })
  useEffect(() => {
    setDraft(existing ?? {
      id: uid('rcp'), ownerType: owner, ownerId, version: 1,
      yieldQty: owner === 'DISH' ? 1 : 1000, lines: [], steps: [],
      updatedAt: new Date().toISOString(), active: true,
    })
  }, [existing, owner, ownerId])

  // Cost the draft as it is edited, not just what was saved, so the effect of
  // changing a quantity is visible before committing to it.
  const costed = useMemo(() => {
    const previewCtx = {
      items: derived.ctx.items,
      recipes: new Map(derived.ctx.recipes),
    }
    previewCtx.recipes.set(`${owner}:${ownerId}`, draft)
    const lines = mergeCostedLines(costRecipe(previewCtx, owner, ownerId, draft.yieldQty, { explode: false }))
    const total = lines.reduce((s, l) => s + l.cost, 0)
    const perUnit = draft.yieldQty > 0 ? total / draft.yieldQty : 0
    return { lines, total, perUnit }
  }, [draft, derived.ctx, owner, ownerId])

  const netPrice = dish ? dish.price / (1 + (dish.gstPct || 0) / 100) : 0
  const plateCost = owner === 'DISH' ? costed.total : costed.perUnit
  const variableCost = dish ? plateCost + dish.packagingCost + dish.otherVariableCost : plateCost
  const contribution = netPrice - variableCost
  const fcPct = netPrice ? (plateCost / netPrice) * 100 : 0

  const ingredientPool = state.items.filter((i) => i.active && i.id !== ownerId)

  const addLine = (itemId: ID | null) => {
    if (!itemId) return
    if (draft.lines.some((l) => l.itemId === itemId)) {
      push({ kind: 'warn', title: 'Already in this recipe', msg: 'Change the quantity on the existing line instead.' })
      return
    }
    const line: RecipeLine = { id: uid('rl'), itemId, qty: 0, wastagePct: 0, optional: false }
    setDraft({ ...draft, lines: [...draft.lines, line] })
  }

  const patchLine = (id: ID, patch: Partial<RecipeLine>) => {
    setDraft({ ...draft, lines: draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  }
  const removeLine = (id: ID) => setDraft({ ...draft, lines: draft.lines.filter((l) => l.id !== id) })

  const addStep = () => setDraft({
    ...draft,
    steps: [...draft.steps, { id: uid('sp'), seq: draft.steps.length + 1, instruction: '' }],
  })
  const patchStep = (id: ID, patch: Partial<SopStep>) => {
    setDraft({ ...draft, steps: draft.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }
  const removeStep = (id: ID) => setDraft({
    ...draft,
    steps: draft.steps.filter((s) => s.id !== id).map((s, i) => ({ ...s, seq: i + 1 })),
  })
  const moveStep = (id: ID, dir: -1 | 1) => {
    const idx = draft.steps.findIndex((s) => s.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= draft.steps.length) return
    const next = [...draft.steps]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setDraft({ ...draft, steps: next.map((s, i) => ({ ...s, seq: i + 1 })) })
  }

  const save = async () => {
    const blank = draft.lines.filter((l) => l.qty <= 0)
    if (blank.length) {
      push({ kind: 'err', title: 'Some lines have no quantity', msg: `${blank.length} ingredient${blank.length > 1 ? 's' : ''} still at zero.` })
      return
    }
    const record: Recipe = {
      ...draft,
      version: existing ? existing.version + 1 : 1,
      steps: draft.steps.filter((s) => s.instruction.trim()),
      updatedAt: new Date().toISOString(),
      updatedBy: user?.id,
    }
    await actions.save('recipes', record)
    push({ kind: 'ok', title: 'SOP saved', msg: `Version ${record.version} · ${record.lines.length} ingredients` })
    onClose()
  }

  const title = dish?.name ?? prepItem?.name ?? 'Recipe'

  return (
    <Modal
      title={title} size="xwide"
      sub={
        owner === 'DISH'
          ? `Standard for one portion${existing ? ` · version ${existing.version}` : ' · new SOP'}`
          : `Batch recipe · yields ${num(draft.yieldQty)} ${prepItem?.baseUnit ?? ''}`
      }
      onClose={onClose}
      footer={
        <>
          <span className="dim grow" style={{ fontSize: 12 }}>
            {owner === 'DISH'
              ? 'Saving creates a new version. Past costings keep the version they were calculated with.'
              : 'Dishes that use this prep item are re-costed immediately.'}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save SOP</button>
        </>
      }
    >
      <div className="grid g-3-2">
        <div className="stack">
          <div className="tabs">
            <button className={`tab${tab === 'lines' ? ' active' : ''}`} onClick={() => setTab('lines')}>
              Ingredients ({draft.lines.length})
            </button>
            <button className={`tab${tab === 'method' ? ' active' : ''}`} onClick={() => setTab('method')}>
              Method &amp; controls ({draft.steps.length})
            </button>
          </div>

          {tab === 'lines' && (
            <>
              <Card title="Add an ingredient" sub="Pick the category first — the list below narrows to it">
                <CascadeSelect
                  categories={state.categories.filter((c) => c.kind === 'INGREDIENT')}
                  items={ingredientPool}
                  value={null}
                  onChange={addLine}
                  placeholder="Choose ingredient"
                  itemLabel={(i) => {
                    const item = derived.itemById.get(i.id)
                    return item ? `${i.name} — ${money(item.avgCost * item.purchaseConversion, 2)}/${item.purchaseUnit}` : i.name
                  }}
                />
              </Card>

              <Card flush>
                {draft.lines.length === 0 ? (
                  <Empty icon="🥄" title="No ingredients yet">Add the first one above.</Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="tbl compact">
                      <thead>
                        <tr>
                          <th>Ingredient</th><th className="num" style={{ width: 96 }}>Qty</th>
                          <th style={{ width: 86 }}>Unit</th><th className="num" style={{ width: 78 }}>Waste %</th>
                          <th style={{ width: 64 }} title="Quantity is the edible weight after trimming">Net</th>
                          <th className="num">Cost</th><th className="num">Share</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {draft.lines.map((line) => {
                          const item = derived.itemById.get(line.itemId)
                          if (!item) return null
                          const costLine = costed.lines.find((c) => c.itemId === line.itemId)
                          const cost = costLine?.cost ?? 0
                          return (
                            <tr key={line.id}>
                              <td>
                                <button className="btn-ghost" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                                  onClick={() => setDrill(item.id)}>
                                  <div className="tbl-name">{item.name}</div>
                                  <div className="tbl-sub">
                                    {item.isPrep ? 'made in-house' : money(item.avgCost * item.purchaseConversion, 2)}
                                    {!item.isPrep && `/${item.purchaseUnit}`}
                                  </div>
                                </button>
                              </td>
                              <td>
                                <input
                                  className="input num" type="number" min={0} step="any" value={line.qty || ''}
                                  onChange={(e) => patchLine(line.id, { qty: Number(e.target.value) || 0 })}
                                />
                              </td>
                              <td className="dim mono-sm">{item.baseUnit === 'unit' ? 'pc' : item.baseUnit}</td>
                              <td>
                                <input
                                  className="input num" type="number" min={0} max={60} step="any"
                                  value={round(line.wastagePct * 100, 1) || ''}
                                  onChange={(e) => patchLine(line.id, { wastagePct: (Number(e.target.value) || 0) / 100 })}
                                />
                              </td>
                              <td className="center">
                                <input
                                  type="checkbox" checked={!!line.netBasis}
                                  title={`Apply the ${pct(item.yieldPct * 100, 0)} usable yield`}
                                  onChange={(e) => patchLine(line.id, { netBasis: e.target.checked })}
                                />
                              </td>
                              <td className="num">{money(cost, 2)}</td>
                              <td className="num dim">{costed.total ? pct((cost / costed.total) * 100, 0) : '—'}</td>
                              <td className="right">
                                <button className="icon-btn" onClick={() => removeLine(line.id)} title="Remove">✕</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5}>{draft.lines.length} ingredients</td>
                          <td className="num">{money(costed.total, 2)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}

          {tab === 'method' && (
            <Card
              title="Method" sub="Numbered steps the chef follows. Mark anything that must be checked."
              actions={<button className="btn btn-sm" onClick={addStep}>+ Add step</button>}
            >
              {draft.steps.length === 0 ? (
                <Empty icon="📝" title="No method written">
                  Quantities alone do not make a standard — write down how it is actually made.
                </Empty>
              ) : (
                <div>
                  {draft.steps.map((step, i) => (
                    <div key={step.id} className="step">
                      <span className="step-no">{i + 1}</span>
                      <div className="col" style={{ gap: 7 }}>
                        <textarea
                          className="input" rows={2} value={step.instruction}
                          placeholder="What happens at this step"
                          onChange={(e) => patchStep(step.id, { instruction: e.target.value })}
                        />
                        <div className="field-row">
                          <Field label="Minutes">
                            <input
                              className="input num" type="number" min={0} value={step.minutes ?? ''}
                              onChange={(e) => patchStep(step.id, { minutes: Number(e.target.value) || undefined })}
                            />
                          </Field>
                          <Field label="Control point" hint="Temperature, holding time, hygiene check">
                            <input
                              className="input" value={step.ccp ?? ''} placeholder="e.g. core temp ≥ 75 °C"
                              onChange={(e) => patchStep(step.id, { ccp: e.target.value || undefined })}
                            />
                          </Field>
                          <div className="row" style={{ alignItems: 'flex-end', gap: 4 }}>
                            <button className="icon-btn" onClick={() => moveStep(step.id, -1)} disabled={i === 0}>↑</button>
                            <button className="icon-btn" onClick={() => moveStep(step.id, 1)} disabled={i === draft.steps.length - 1}>↓</button>
                            <button className="icon-btn" onClick={() => removeStep(step.id)}>✕</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <hr className="hr" />
              <div className="field-row">
                <Field label="Plating / finishing notes">
                  <textarea
                    className="input" rows={2} value={draft.platingNotes ?? ''}
                    onChange={(e) => setDraft({ ...draft, platingNotes: e.target.value })}
                  />
                </Field>
                <Field label="Standard prep time (mins)" style={{ maxWidth: 180 }}>
                  <input
                    className="input num" type="number" min={0} value={draft.standardPrepMins ?? ''}
                    onChange={(e) => setDraft({ ...draft, standardPrepMins: Number(e.target.value) || undefined })}
                  />
                </Field>
              </div>
            </Card>
          )}
        </div>

        <div className="stack">
          {owner === 'PREP' && (
            <Card title="Batch yield" sub="How much one run of this recipe produces">
              <Field label={`Yield in ${prepItem?.baseUnit ?? 'units'}`}>
                <input
                  className="input num" type="number" min={1} value={draft.yieldQty}
                  onChange={(e) => setDraft({ ...draft, yieldQty: Number(e.target.value) || 1 })}
                />
              </Field>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <span className="dim">Cost per {prepItem?.baseUnit}</span>
                <span className="num">{money(costed.perUnit, 4)}</span>
              </div>
            </Card>
          )}

          <Card title={owner === 'DISH' ? 'Plate economics' : 'Batch economics'} sub="updates as you type">
            <div className="stack" style={{ gap: 10 }}>
              <Tile label={owner === 'DISH' ? 'Plate cost' : 'Batch cost'} value={money(costed.total, 2)}
                foot={owner === 'PREP' ? `${money(costed.perUnit, 4)} per ${prepItem?.baseUnit}` : 'ingredients only'}
                accent="var(--brand)" />
              {dish && (
                <>
                  <dl className="kv">
                    <dt>Menu price</dt><dd>{money(dish.price)}</dd>
                    <dt>Less GST {pct(dish.gstPct, 0)}</dt><dd className="dim">−{money(dish.price - netPrice, 2)}</dd>
                    <dt>Net price</dt><dd>{money(netPrice, 2)}</dd>
                    <dt>Food cost</dt><dd className="neg">−{money(plateCost, 2)}</dd>
                    <dt>Packaging</dt><dd className="neg">−{money(dish.packagingCost, 2)}</dd>
                    <dt>Other variable</dt><dd className="neg">−{money(dish.otherVariableCost, 2)}</dd>
                  </dl>
                  <hr className="hr" />
                  <div className="grid g2" style={{ gap: 10 }}>
                    <Tile label="Contribution" value={money(contribution, 2)}
                      foot={pct(netPrice ? (contribution / netPrice) * 100 : 0)}
                      accent={contribution > 0 ? 'var(--pos)' : 'var(--neg)'} />
                    <Tile label="Food cost %" value={pct(fcPct)}
                      foot={fcPct > 40 ? 'well over target' : fcPct > 33 ? 'above target' : 'within target'}
                      accent={fcPct > 40 ? 'var(--neg)' : fcPct > 33 ? 'var(--warn)' : 'var(--pos)'} />
                  </div>
                  {fcPct > 35 && (
                    <div className="step-ccp" style={{ display: 'block' }}>
                      To reach a 33% food cost this dish would need to sell at{' '}
                      <strong>{money((plateCost / 0.33) * (1 + dish.gstPct / 100))}</strong>, or the recipe cost
                      would have to come down to {money(netPrice * 0.33, 2)}.
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card title="Where the cost sits" sub="biggest ingredients first">
            {costed.lines.length === 0 ? (
              <div className="dim">Add ingredients to see the breakdown.</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {[...costed.lines].sort((a, b) => b.cost - a.cost).slice(0, 8).map((l, i) => (
                  <div key={l.itemId} className="bar-row">
                    <div>
                      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 12.5 }}>{l.name}</span>
                        <span className="num" style={{ fontSize: 12 }}>{money(l.cost, 2)}</span>
                      </div>
                      <div className="bar">
                        <span style={{ width: `${costed.total ? (l.cost / costed.total) * 100 : 0}%`, background: PALETTE[i % PALETTE.length] }} />
                      </div>
                    </div>
                    <span className="num dim" style={{ fontSize: 11, minWidth: 34, textAlign: 'right' }}>
                      {costed.total ? pct((l.cost / costed.total) * 100, 0) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </Modal>
  )
}

/* ================================================================== */
/* Dish master                                                         */
/* ================================================================== */

function Dishes() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Dish | null>(null)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.dishes
      .filter((d) => !term || d.name.toLowerCase().includes(term))
      .map((d) => ({ dish: d, costing: costDish(derived.ctx, d, true) }))
      .sort((a, b) => a.dish.name.localeCompare(b.dish.name))
  }, [state.dishes, derived.ctx, search])

  const blank = (): Dish => ({
    id: uid('dsh'), code: `M${String(state.dishes.length + 1).padStart(3, '0')}`, name: '',
    categoryId: state.categories.find((c) => c.kind === 'MENU' && !c.parentId)?.id ?? '',
    subCategoryId: null, price: 0, gstPct: 5, packagingCost: 0, otherVariableCost: 0,
    sectionId: state.sections[0]?.id ?? null, prepTimeMins: 10, active: true,
  })

  return (
    <>
      <PageHead
        title="Menu Dishes"
        sub="Prices, categories and which kitchen section owns each dish. The section is what attributes sales and leakage to a chef."
        actions={
          <>
            <Search value={search} onChange={setSearch} />
            <button className="btn btn-primary" onClick={() => setEditing(blank())}>+ New dish</button>
          </>
        }
      />
      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Dish</th><th>Category</th><th>Section</th><th className="num">Price</th>
                <th className="num">Plate cost</th><th className="num">Contribution</th>
                <th className="num">Food cost %</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(({ dish, costing }) => (
                <tr key={dish.id} className="clickable" onClick={() => setEditing(dish)}>
                  <td>
                    <div className="tbl-name">{dish.name}</div>
                    <div className="tbl-sub">{dish.code}</div>
                  </td>
                  <td className="dim">
                    {derived.categoryById.get(dish.categoryId)?.name}
                    {dish.subCategoryId && <span className="dim"> › {derived.categoryById.get(dish.subCategoryId)?.name}</span>}
                  </td>
                  <td className="dim">{dish.sectionId ? derived.sectionById.get(dish.sectionId)?.name : '—'}</td>
                  <td className="num">{money(dish.price)}</td>
                  <td className="num">{money(costing.foodCost, 2)}</td>
                  <td className="num pos">{money(costing.contribution, 2)}</td>
                  <td className="num">
                    <span className={costing.foodCostPct > 40 ? 'neg' : costing.foodCostPct > 33 ? 'warn' : 'pos'}>
                      {pct(costing.foodCostPct)}
                    </span>
                  </td>
                  <td className="right dim">Edit ›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <DishEditor
          dish={editing}
          onClose={() => setEditing(null)}
          onSave={async (d) => {
            await actions.save('dishes', d)
            push({ kind: 'ok', title: 'Dish saved', msg: d.name })
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function DishEditor({ dish, onClose, onSave }: { dish: Dish; onClose: () => void; onSave: (d: Dish) => void }) {
  const { state, derived } = useLedger()
  const [d, setD] = useState(dish)
  const tops = state.categories.filter((c) => c.kind === 'MENU' && !c.parentId)
  const subs = state.categories.filter((c) => c.parentId === d.categoryId)
  const costing = costDish(derived.ctx, d, true)
  const net = d.price / (1 + (d.gstPct || 0) / 100)

  return (
    <Modal
      title={dish.name || 'New dish'} onClose={onClose} size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!d.name || !d.price} onClick={() => onSave(d)}>Save dish</button>
        </>
      }
    >
      <div className="grid g2">
        <div className="stack">
          <Field label="Dish name">
            <input className="input" value={d.name} autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <div className="field-row">
            <Field label="Category">
              <select className="select" value={d.categoryId}
                onChange={(e) => setD({ ...d, categoryId: e.target.value, subCategoryId: null })}>
                {tops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Sub-category">
              <select className="select" value={d.subCategoryId ?? ''}
                onChange={(e) => setD({ ...d, subCategoryId: e.target.value || null })}>
                <option value="">—</option>
                {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="field-row">
            <Field label="Kitchen section" hint="Drives chef attribution">
              <select className="select" value={d.sectionId ?? ''}
                onChange={(e) => setD({ ...d, sectionId: e.target.value || null })}>
                <option value="">—</option>
                {state.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Prep time (mins)">
              <input className="input num" type="number" value={d.prepTimeMins}
                onChange={(e) => setD({ ...d, prepTimeMins: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Menu price (incl. GST)">
              <input className="input num" type="number" value={d.price || ''}
                onChange={(e) => setD({ ...d, price: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="GST %">
              <input className="input num" type="number" value={d.gstPct}
                onChange={(e) => setD({ ...d, gstPct: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Packaging cost" hint="Box, container, bag">
              <input className="input num" type="number" value={d.packagingCost}
                onChange={(e) => setD({ ...d, packagingCost: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Other variable cost" hint="Delivery commission, condiments">
              <input className="input num" type="number" value={d.otherVariableCost}
                onChange={(e) => setD({ ...d, otherVariableCost: Number(e.target.value) || 0 })} />
            </Field>
          </div>
        </div>

        <Card title="What this dish earns" sub="from the current SOP and today's prices">
          <dl className="kv">
            <dt>Menu price</dt><dd>{money(d.price)}</dd>
            <dt>Net of GST</dt><dd>{money(net, 2)}</dd>
            <dt>Food cost</dt><dd className="neg">−{money(costing.foodCost, 2)}</dd>
            <dt>Packaging</dt><dd className="neg">−{money(d.packagingCost, 2)}</dd>
            <dt>Other variable</dt><dd className="neg">−{money(d.otherVariableCost, 2)}</dd>
            <dt><strong>Contribution</strong></dt>
            <dd><strong className={costing.contribution > 0 ? 'pos' : 'neg'}>{money(costing.contribution, 2)}</strong></dd>
            <dt>Food cost %</dt><dd>{pct(costing.foodCostPct)}</dd>
          </dl>
        </Card>
      </div>
    </Modal>
  )
}

/* ================================================================== */
/* Plate costing                                                       */
/* ================================================================== */

function Costing() {
  const { state, derived } = useLedger()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('dish') ?? state.dishes[0]?.id ?? ''
  const [drill, setDrill] = useState<ID | null>(null)
  const navigate = useNavigate()

  const dish = derived.dishById.get(selectedId)
  const costing = useMemo(() => (dish ? costDish(derived.ctx, dish, true) : null), [dish, derived.ctx])
  const shallow = useMemo(() => (dish ? costDish(derived.ctx, dish, false) : null), [dish, derived.ctx])
  const recipe = dish ? derived.recipeFor('DISH', dish.id) : undefined

  if (!dish || !costing || !shallow) return <Empty icon="🍽" title="No dishes yet" />

  const exportCsv = () => {
    downloadText(
      `plate-cost-${dish.name.toLowerCase().replace(/\s+/g, '-')}.csv`,
      toCsv(costing.lines.map((l) => ({
        Ingredient: l.name, SKU: l.sku, Quantity: l.qty, Unit: l.baseUnit,
        'Unit cost': round(l.unitCost, 4), Cost: round(l.cost, 2),
        'Share %': costing.foodCost ? round((l.cost / costing.foodCost) * 100, 1) : 0,
      }))),
    )
  }

  return (
    <>
      <PageHead
        title="Plate Costing"
        sub="What a dish actually costs today, traced to every ingredient — including the ones hidden inside a gravy."
        breadcrumb={[{ label: 'SOP & Menu' }, { label: 'Plate Costing' }]}
        actions={
          <>
            <select className="select" style={{ maxWidth: 260 }} value={selectedId}
              onChange={(e) => setParams({ dish: e.target.value })}>
              {state.dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="btn" onClick={exportCsv}>Export CSV</button>
            <button className="btn" onClick={() => navigate(`/menu/recipes?edit=${dish.id}`)}>Edit SOP</button>
          </>
        }
      />

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <Tile label="Menu price" value={money(dish.price)} foot={`incl. ${pct(dish.gstPct, 0)} GST`} />
        <Tile label="Net price" value={money(costing.netPrice, 2)} foot="what you keep" accent="var(--info)" />
        <Tile label="Food cost" value={money(costing.foodCost, 2)} foot={pct(costing.foodCostPct)} accent="var(--brand)" />
        <Tile label="Variable cost" value={money(costing.variableCost, 2)} foot="food + packaging + other" />
        <Tile label="Contribution" value={money(costing.contribution, 2)} foot={pct(costing.contributionPct)}
          accent={costing.contribution > 0 ? 'var(--pos)' : 'var(--neg)'} />
      </div>

      <div className="grid g-3-2">
        <Card title="Cost build-up" sub="fully exploded — prep items broken into their raw ingredients" flush>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Ingredient</th><th className="num">Quantity</th><th className="num">Rate</th><th className="num">Cost</th><th className="num">Share</th></tr>
              </thead>
              <tbody>
                {costing.lines.map((l) => (
                  <tr key={l.itemId} className="clickable" onClick={() => setDrill(l.itemId)}>
                    <td>
                      <div className="tbl-name">{l.name}</div>
                      <div className="tbl-sub">{l.sku}</div>
                    </td>
                    <td className="num">{fmtQty(l.qty, l.baseUnit, 3)}</td>
                    <td className="num dim">{money(l.unitCost * 1000, 2)}<span className="dim">/{l.baseUnit === 'unit' ? 'pc' : `k${l.baseUnit}`}</span></td>
                    <td className="num">{money(l.cost, 2)}</td>
                    <td className="num dim">{pct(costing.foodCost ? (l.cost / costing.foodCost) * 100 : 0, 1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total food cost</td>
                  <td className="num">{money(costing.foodCost, 2)}</td>
                  <td className="num">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="stack">
          <Card title="As the chef sees it" sub="prep items shown as single components">
            <table className="tbl compact">
              <tbody>
                {shallow.lines.map((l) => (
                  <tr key={l.itemId}>
                    <td>
                      {l.name}
                      {l.isPrep && <Badge kind="purple">prep</Badge>}
                    </td>
                    <td className="num">{fmtQty(l.qty, l.baseUnit, 2)}</td>
                    <td className="num dim">{money(l.cost, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {recipe && recipe.steps.length > 0 && (
            <Card title="Method" sub={`${recipe.steps.length} steps · ${recipe.standardPrepMins ?? '—'} mins standard`}>
              {recipe.steps.map((s) => (
                <div key={s.id} className="step">
                  <span className="step-no">{s.seq}</span>
                  <div>
                    <div style={{ fontSize: 13 }}>{s.instruction}</div>
                    {s.minutes && <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{s.minutes} mins</div>}
                    {s.ccp && <div className="step-ccp">⚠ {s.ccp}</div>}
                  </div>
                </div>
              ))}
              {recipe.platingNotes && (
                <>
                  <hr className="hr" />
                  <div className="dim" style={{ fontSize: 12.5 }}><strong>Plating:</strong> {recipe.platingNotes}</div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>

      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

/* ================================================================== */
/* Menu engineering                                                    */
/* ================================================================== */

const QUADRANT: Record<string, { label: string; note: string; color: string; kind: string }> = {
  STAR: { label: 'Stars', note: 'Popular and profitable — protect the recipe and the price', color: 'var(--pos)', kind: 'ok' },
  PLOUGHHORSE: { label: 'Plough-horses', note: 'Popular but thin — trim the cost, not the portion', color: 'var(--info)', kind: 'info' },
  PUZZLE: { label: 'Puzzles', note: 'Profitable but nobody orders them — move them up the menu', color: 'var(--warn)', kind: 'watch' },
  DOG: { label: 'Dogs', note: 'Neither popular nor profitable — reprice or drop', color: 'var(--neg)', kind: 'critical' },
}

function Engineering() {
  const { state, derived } = useLedger()
  const { days, setDays, from, to } = usePeriod(30)
  const navigate = useNavigate()

  const perf = useMemo(
    () => dishPerformance(derived.ctx, state.dishes, filterSales(state.sales, from, to)),
    [derived.ctx, state.dishes, state.sales, from, to],
  )

  const points = perf.rows.map((r) => ({
    x: r.qty, y: r.contributionPerPlate, z: Math.max(r.contribution, 1),
    name: r.name, color: QUADRANT[r.classification].color, dishId: r.dishId,
  }))

  const groups = (['STAR', 'PLOUGHHORSE', 'PUZZLE', 'DOG'] as const).map((k) => ({
    key: k, ...QUADRANT[k], rows: perf.rows.filter((r) => r.classification === k),
  }))

  return (
    <>
      <PageHead
        title="Menu Engineering"
        sub={`Every dish placed by how often it sells against what it earns per plate, over the last ${days} days. The dividing lines are the menu's own averages.`}
        actions={<PeriodPills days={days} setDays={setDays} />}
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        {groups.map((g) => (
          <Tile key={g.key} label={g.label} value={num(g.rows.length)}
            foot={`${moneyShort(g.rows.reduce((s, r) => s + r.contribution, 0))} contribution`} accent={g.color} />
        ))}
      </div>

      <div className="grid g-3-2">
        <Card title="The menu, plotted" sub="bubble size is total contribution over the period">
          <MenuMatrix
            data={points} xLabel="Plates sold" yLabel="Contribution per plate"
            xRef={perf.popularityThreshold} yRef={perf.avgContribution} height={380}
            onClick={(row) => row?.dishId && navigate(`/menu/costing?dish=${row.dishId}`)}
          />
          <div className="legend" style={{ marginTop: 10 }}>
            {groups.map((g) => (
              <span key={g.key}><span className="dot" style={{ background: g.color }} /> {g.label}</span>
            ))}
          </div>
        </Card>

        <div className="quadrant">
          {groups.map((g) => (
            <div key={g.key}>
              <h4 style={{ color: g.color }}>{g.label}</h4>
              <div className="dim" style={{ fontSize: 11.5, marginBottom: 8 }}>{g.note}</div>
              <ul className="list-reset" style={{ fontSize: 12.5 }}>
                {g.rows.slice(0, 6).map((r) => (
                  <li key={r.dishId} className="row" style={{ justifyContent: 'space-between', padding: '2px 0', cursor: 'pointer' }}
                    onClick={() => navigate(`/menu/costing?dish=${r.dishId}`)}>
                    <span>{r.name}</span>
                    <span className="num dim">{money(r.contributionPerPlate)}</span>
                  </li>
                ))}
                {!g.rows.length && <li className="dim">None</li>}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <Card title="Every dish, ranked" sub="sorted by total contribution over the period" flush style={{ marginTop: 14 }}>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th><th>Dish</th><th>Class</th><th className="num">Sold</th>
                <th className="num">Revenue</th><th className="num">Per plate</th>
                <th className="num">Contribution</th><th className="num">Food cost %</th><th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {[...perf.rows].sort((a, b) => b.contribution - a.contribution).map((r, i) => (
                <tr key={r.dishId} className="clickable" onClick={() => navigate(`/menu/costing?dish=${r.dishId}`)}>
                  <td><span className={`rank${i < 3 ? ' top' : ''}`}>{i + 1}</span></td>
                  <td className="tbl-name">{r.name}</td>
                  <td><Badge kind={QUADRANT[r.classification].kind}>{QUADRANT[r.classification].label.replace(/s$/, '')}</Badge></td>
                  <td className="num">{num(r.qty)}</td>
                  <td className="num">{moneyShort(r.revenue)}</td>
                  <td className="num">{money(r.contributionPerPlate)}</td>
                  <td className="num pos">{moneyShort(r.contribution)}</td>
                  <td className="num">
                    <span className={r.foodCostPct > 40 ? 'neg' : r.foodCostPct > 33 ? 'warn' : 'pos'}>{pct(r.foodCostPct)}</span>
                  </td>
                  <td className="num dim">{pct(r.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
