import { Fragment, useMemo, useRef, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useLedger } from '../data/store'
import { PageHead } from '../components/Layout'
import { Avatar, Badge, Card, Confirm, Empty, Field, Modal, Search, Tile, useToast } from '../components/ui'
import { ItemDrawer } from './shared'
import { uid } from '../data/commands'
import { ROLE_LABEL } from '../components/nav'
import { DEFAULT_TOLERANCE } from '../core/variance'
import { downloadText, money, num, pct, qty as fmtQty, toCsv } from '../lib/format'
import type {
  BaseUnit, Category, ID, Item, PurchaseUnit, Section, Staff, StaffRole, StockLocation,
} from '../core/types'

export default function Setup() {
  return (
    <Routes>
      <Route path="items" element={<Items />} />
      <Route path="categories" element={<Categories />} />
      <Route path="locations" element={<Locations />} />
      <Route path="staff" element={<StaffSetup />} />
      <Route path="data" element={<DataAndBackup />} />
      <Route path="*" element={<Items />} />
    </Routes>
  )
}

/* ================================================================== */
/* Items                                                               */
/* ================================================================== */

const PURCHASE_UNITS: PurchaseUnit[] = ['kg', 'g', 'litre', 'ml', 'unit', 'packet', 'bunch', 'dozen', 'box', 'tray', 'crate']
const BASE_UNITS: BaseUnit[] = ['g', 'ml', 'unit']

function Items() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<ID | ''>('')
  const [editing, setEditing] = useState<Item | null>(null)
  const [drill, setDrill] = useState<ID | null>(null)

  const tops = state.categories.filter((c) => c.kind === 'INGREDIENT' && !c.parentId)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.items
      .filter((i) => !categoryId || i.categoryId === categoryId)
      .filter((i) => !term || i.name.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.items, search, categoryId])

  const blank = (): Item => ({
    id: uid('itm'), sku: '', name: '', categoryId: tops[0]?.id ?? '', subCategoryId: null,
    baseUnit: 'g', purchaseUnit: 'kg', purchaseConversion: 1000, yieldPct: 1,
    shelfLifeDays: null, parLevel: 0, reorderLevel: 0,
    defaultSupplierId: state.suppliers[0]?.id ?? null, defaultLocationId: 'loc_store',
    gstPct: 5, isPrep: false, trackBatches: false, avgCost: 0, lastPurchaseCost: 0, active: true,
  })

  return (
    <>
      <PageHead
        title="Items & Ingredients"
        sub="The master every other screen reads from. Units and conversions matter most — get those wrong and every cost downstream is wrong with them."
        actions={
          <>
            <select className="select" style={{ width: 190 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {tops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Search value={search} onChange={setSearch} />
            <button className="btn" onClick={() => downloadText('items.csv', toCsv(rows.map((i) => ({
              SKU: i.sku, Name: i.name, Category: derived.categoryById.get(i.categoryId)?.name ?? '',
              'Sub-category': i.subCategoryId ? derived.categoryById.get(i.subCategoryId)?.name ?? '' : '',
              'Base unit': i.baseUnit, 'Purchase unit': i.purchaseUnit, Conversion: i.purchaseConversion,
              'Yield %': i.yieldPct * 100, 'Shelf life': i.shelfLifeDays ?? '',
              'Par level': i.parLevel, 'Reorder level': i.reorderLevel,
              'Average cost': i.avgCost, 'GST %': i.gstPct,
            }))))}>Export</button>
            <button className="btn btn-primary" onClick={() => setEditing(blank())}>+ New item</button>
          </>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Items" value={num(state.items.filter((i) => i.active).length)} foot={`${state.items.filter((i) => i.isPrep).length} made in-house`} />
        <Tile label="Categories" value={num(tops.length)} foot={`${state.categories.filter((c) => c.parentId).length} sub-categories`} />
        <Tile label="Perishable" value={num(state.items.filter((i) => i.shelfLifeDays !== null && i.shelfLifeDays <= 7).length)}
          foot="7 days or less" accent="var(--warn)" />
        <Tile label="Stock value" value={money(derived.stockValue)} foot="at average cost" accent="var(--purple)" />
      </div>

      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th>Category</th><th>Units</th><th className="num">Yield</th>
                <th className="num">Shelf life</th><th className="num">Reorder at</th>
                <th className="num">Avg cost</th><th className="num">On hand</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="clickable" onClick={() => setEditing(item)}>
                  <td>
                    <div className="tbl-name">
                      {item.name}
                      {item.isPrep && <Badge kind="purple">prep</Badge>}
                    </div>
                    <div className="tbl-sub">{item.sku}</div>
                  </td>
                  <td className="dim">
                    {derived.categoryById.get(item.categoryId)?.name}
                    {item.subCategoryId && <span className="dim"> › {derived.categoryById.get(item.subCategoryId)?.name}</span>}
                  </td>
                  <td className="dim mono-sm">1 {item.purchaseUnit} = {num(item.purchaseConversion)} {item.baseUnit}</td>
                  <td className="num">{pct(item.yieldPct * 100, 0)}</td>
                  <td className="num dim">{item.shelfLifeDays ?? '—'}</td>
                  <td className="num dim">{fmtQty(item.reorderLevel, item.baseUnit)}</td>
                  <td className="num">{money(item.avgCost * item.purchaseConversion, 2)}<span className="dim">/{item.purchaseUnit}</span></td>
                  <td className="num">{fmtQty(derived.onHand.get(item.id) ?? 0, item.baseUnit)}</td>
                  <td className="right">
                    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setDrill(item.id) }}>Detail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <ItemEditor
          item={editing} onClose={() => setEditing(null)}
          onSave={async (i) => {
            await actions.save('items', i)
            push({ kind: 'ok', title: 'Item saved', msg: i.name })
            setEditing(null)
          }}
        />
      )}
      {drill && <ItemDrawer itemId={drill} onClose={() => setDrill(null)} />}
    </>
  )
}

function ItemEditor({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (i: Item) => void }) {
  const { state } = useLedger()
  const [i, setI] = useState(item)
  const tops = state.categories.filter((c) => c.kind === 'INGREDIENT' && !c.parentId)
  const subs = state.categories.filter((c) => c.parentId === i.categoryId)

  return (
    <Modal
      title={item.name || 'New item'} size="wide" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!i.name || !i.sku} onClick={() => onSave(i)}>Save item</button>
        </>
      }
    >
      <div className="grid g2">
        <div className="stack">
          <div className="field-row">
            <Field label="Name"><input className="input" value={i.name} autoFocus onChange={(e) => setI({ ...i, name: e.target.value })} /></Field>
            <Field label="SKU" style={{ maxWidth: 140 }}><input className="input" value={i.sku} onChange={(e) => setI({ ...i, sku: e.target.value.toUpperCase() })} /></Field>
          </div>
          <div className="field-row">
            <Field label="Category">
              <select className="select" value={i.categoryId} onChange={(e) => setI({ ...i, categoryId: e.target.value, subCategoryId: null })}>
                {tops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Sub-category">
              <select className="select" value={i.subCategoryId ?? ''} onChange={(e) => setI({ ...i, subCategoryId: e.target.value || null })}>
                <option value="">—</option>
                {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="field-row">
            <Field label="Base unit" hint="What recipes and stock are held in">
              <select className="select" value={i.baseUnit} onChange={(e) => setI({ ...i, baseUnit: e.target.value as BaseUnit })}>
                {BASE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Purchase unit" hint="What the supplier bills in">
              <select className="select" value={i.purchaseUnit} onChange={(e) => setI({ ...i, purchaseUnit: e.target.value as PurchaseUnit })}>
                {PURCHASE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Conversion" hint={`1 ${i.purchaseUnit} = ? ${i.baseUnit}`}>
              <input className="input num" type="number" value={i.purchaseConversion}
                onChange={(e) => setI({ ...i, purchaseConversion: Number(e.target.value) || 1 })} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Usable yield %" hint="After peeling, trimming, deboning">
              <input className="input num" type="number" min={1} max={100} value={Math.round(i.yieldPct * 100)}
                onChange={(e) => setI({ ...i, yieldPct: (Number(e.target.value) || 100) / 100 })} />
            </Field>
            <Field label="Shelf life (days)">
              <input className="input num" type="number" value={i.shelfLifeDays ?? ''}
                onChange={(e) => setI({ ...i, shelfLifeDays: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="GST %">
              <input className="input num" type="number" value={i.gstPct} onChange={(e) => setI({ ...i, gstPct: Number(e.target.value) || 0 })} />
            </Field>
          </div>
        </div>

        <div className="stack">
          <div className="field-row">
            <Field label={`Par level (${i.baseUnit})`} hint="Top back up to this when ordering">
              <input className="input num" type="number" value={i.parLevel} onChange={(e) => setI({ ...i, parLevel: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={`Reorder at (${i.baseUnit})`} hint="Triggers the low-stock alert">
              <input className="input num" type="number" value={i.reorderLevel} onChange={(e) => setI({ ...i, reorderLevel: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Default supplier">
              <select className="select" value={i.defaultSupplierId ?? ''} onChange={(e) => setI({ ...i, defaultSupplierId: e.target.value || null })}>
                <option value="">Made in-house</option>
                {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Stored in">
              <select className="select" value={i.defaultLocationId} onChange={(e) => setI({ ...i, defaultLocationId: e.target.value })}>
                {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="row" style={{ gap: 18 }}>
            <label className="row" style={{ gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={i.isPrep} onChange={(e) => setI({ ...i, isPrep: e.target.checked })} />
              <span>Made in the kitchen (prep item)</span>
            </label>
            <label className="row" style={{ gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={i.trackBatches} onChange={(e) => setI({ ...i, trackBatches: e.target.checked })} />
              <span>Track batches &amp; expiry</span>
            </label>
            <label className="row" style={{ gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={i.active} onChange={(e) => setI({ ...i, active: e.target.checked })} />
              <span>Active</span>
            </label>
          </div>
          <Card title="Costing" sub="average cost is maintained by the system on every receipt">
            <dl className="kv">
              <dt>Average cost</dt><dd>{money(i.avgCost * i.purchaseConversion, 2)} / {i.purchaseUnit}</dd>
              <dt>Last purchase</dt><dd>{money(i.lastPurchaseCost * i.purchaseConversion, 2)} / {i.purchaseUnit}</dd>
              <dt>Per {i.baseUnit}</dt><dd>{money(i.avgCost, 4)}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </Modal>
  )
}

/* ================================================================== */
/* Categories                                                          */
/* ================================================================== */

function Categories() {
  const { state, actions } = useLedger()
  const { push } = useToast()
  const [editing, setEditing] = useState<Category | null>(null)

  const tree = useMemo(() => {
    const tops = state.categories.filter((c) => !c.parentId).sort((a, b) => a.sort - b.sort)
    return tops.map((top) => ({
      top,
      children: state.categories.filter((c) => c.parentId === top.id).sort((a, b) => a.sort - b.sort),
      items: state.items.filter((i) => i.categoryId === top.id).length,
      dishes: state.dishes.filter((d) => d.categoryId === top.id).length,
    }))
  }, [state.categories, state.items, state.dishes])

  const blank = (kind: 'INGREDIENT' | 'MENU', parentId: ID | null): Category => ({
    id: uid('cat'), name: '', parentId, kind, sort: state.categories.length,
    varianceTolerancePct: kind === 'INGREDIENT' ? DEFAULT_TOLERANCE : undefined,
  })

  return (
    <>
      <PageHead
        title="Categories"
        sub="The two-level tree behind every dropdown in the app. The tolerance on an ingredient category is what decides when a variance is flagged — spices can move a few percent, meat cannot."
        actions={
          <>
            <button className="btn" onClick={() => setEditing(blank('INGREDIENT', null))}>+ Ingredient category</button>
            <button className="btn" onClick={() => setEditing(blank('MENU', null))}>+ Menu category</button>
          </>
        }
      />

      <div className="grid g2">
        {(['INGREDIENT', 'MENU'] as const).map((kind) => (
          <Card key={kind} title={kind === 'INGREDIENT' ? 'Ingredient categories' : 'Menu categories'}
            sub={kind === 'INGREDIENT' ? 'used by items, purchases, stock and variance' : 'used by dishes and menu reports'} flush>
            <table className="tbl compact">
              <thead>
                <tr><th>Category</th><th className="num">{kind === 'INGREDIENT' ? 'Items' : 'Dishes'}</th>
                  {kind === 'INGREDIENT' && <th className="num">Tolerance</th>}<th /></tr>
              </thead>
              <tbody>
                {tree.filter((t) => t.top.kind === kind).map(({ top, children, items, dishes }) => (
                  <Fragment key={top.id}>
                    <tr className="clickable" onClick={() => setEditing(top)}>
                      <td><strong>{top.name}</strong></td>
                      <td className="num">{kind === 'INGREDIENT' ? items : dishes}</td>
                      {kind === 'INGREDIENT' && <td className="num dim">{pct(top.varianceTolerancePct ?? DEFAULT_TOLERANCE, 1)}</td>}
                      <td className="right">
                        <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setEditing(blank(kind, top.id)) }}>
                          + Sub
                        </button>
                      </td>
                    </tr>
                    {children.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => setEditing(c)}>
                        <td className="dim" style={{ paddingLeft: 28 }}>└ {c.name}</td>
                        <td className="num dim">
                          {kind === 'INGREDIENT'
                            ? state.items.filter((i) => i.subCategoryId === c.id).length
                            : state.dishes.filter((d) => d.subCategoryId === c.id).length}
                        </td>
                        {kind === 'INGREDIENT' && <td className="num dim">{pct(c.varianceTolerancePct ?? DEFAULT_TOLERANCE, 1)}</td>}
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      {editing && (
        <Modal
          title={editing.name || 'New category'} onClose={() => setEditing(null)}
          sub={editing.parentId ? `beneath ${state.categories.find((c) => c.id === editing.parentId)?.name}` : 'top level'}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!editing.name} onClick={async () => {
                await actions.save('categories', editing)
                push({ kind: 'ok', title: 'Category saved', msg: editing.name })
                setEditing(null)
              }}>Save</button>
            </>
          }
        >
          <div className="stack">
            <Field label="Name"><input className="input" value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            {editing.kind === 'INGREDIENT' && (
              <Field label="Variance tolerance %" hint="How far a count can differ from expected before it is flagged">
                <input className="input num" type="number" step="0.5" value={editing.varianceTolerancePct ?? DEFAULT_TOLERANCE}
                  onChange={(e) => setEditing({ ...editing, varianceTolerancePct: Number(e.target.value) || DEFAULT_TOLERANCE })} />
              </Field>
            )}
            <Field label="Sort order">
              <input className="input num" type="number" value={editing.sort} onChange={(e) => setEditing({ ...editing, sort: Number(e.target.value) || 0 })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Locations                                                           */
/* ================================================================== */

function Locations() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const [editing, setEditing] = useState<StockLocation | null>(null)
  const [editingSection, setEditingSection] = useState<Section | null>(null)

  return (
    <>
      <PageHead
        title="Locations & Sections"
        sub="Stock lives in locations; dishes belong to kitchen sections. The section is what connects a sale to a chef."
        actions={
          <>
            <button className="btn" onClick={() => setEditing({ id: uid('loc'), name: '', kind: 'STORE', isIssuingStore: true, sort: state.locations.length })}>
              + Location
            </button>
            <button className="btn" onClick={() => setEditingSection({ id: uid('sec'), name: '', sort: state.sections.length })}>
              + Section
            </button>
          </>
        }
      />

      <div className="grid g2">
        <Card title="Stock locations" flush>
          <table className="tbl">
            <thead><tr><th>Location</th><th>Type</th><th className="num">Items</th><th className="num">Value</th><th /></tr></thead>
            <tbody>
              {state.locations.map((loc) => {
                const items = state.items.filter((i) => Math.abs(derived.balance(i.id, loc.id)) > 0.001)
                const value = items.reduce((s, i) => s + derived.balance(i.id, loc.id) * i.avgCost, 0)
                return (
                  <tr key={loc.id} className="clickable" onClick={() => setEditing(loc)}>
                    <td className="tbl-name">{loc.name}</td>
                    <td><Badge kind={loc.kind === 'KITCHEN' ? 'brand' : 'neutral'}>{loc.kind}</Badge></td>
                    <td className="num">{items.length}</td>
                    <td className="num">{money(value)}</td>
                    <td className="right dim">Edit ›</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Kitchen sections" flush>
          <table className="tbl">
            <thead><tr><th>Section</th><th className="num">Dishes</th><th className="num">Chefs</th><th /></tr></thead>
            <tbody>
              {state.sections.map((sec) => (
                <tr key={sec.id} className="clickable" onClick={() => setEditingSection(sec)}>
                  <td className="tbl-name">{sec.name}</td>
                  <td className="num">{state.dishes.filter((d) => d.sectionId === sec.id).length}</td>
                  <td className="num">{state.staff.filter((s) => s.sectionId === sec.id).length}</td>
                  <td className="right dim">Edit ›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {editing && (
        <Modal title={editing.name || 'New location'} onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!editing.name} onClick={async () => {
                await actions.save('locations', editing)
                push({ kind: 'ok', title: 'Location saved', msg: editing.name })
                setEditing(null)
              }}>Save</button>
            </>
          }>
          <div className="stack">
            <Field label="Name"><input className="input" value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Type">
              <select className="select" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as StockLocation['kind'] })}>
                {['STORE', 'COLD', 'DRY', 'KITCHEN', 'BAR'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <label className="row" style={{ gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.isIssuingStore} onChange={(e) => setEditing({ ...editing, isIssuingStore: e.target.checked })} />
              <span>The kitchen can draw stock from here</span>
            </label>
          </div>
        </Modal>
      )}

      {editingSection && (
        <Modal title={editingSection.name || 'New section'} onClose={() => setEditingSection(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditingSection(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!editingSection.name} onClick={async () => {
                await actions.save('sections', editingSection)
                push({ kind: 'ok', title: 'Section saved', msg: editingSection.name })
                setEditingSection(null)
              }}>Save</button>
            </>
          }>
          <Field label="Name"><input className="input" value={editingSection.name} autoFocus onChange={(e) => setEditingSection({ ...editingSection, name: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Staff                                                               */
/* ================================================================== */

function StaffSetup() {
  const { state, derived, actions } = useLedger()
  const { push } = useToast()
  const [editing, setEditing] = useState<Staff | null>(null)

  const roles: StaffRole[] = ['OWNER', 'MANAGER', 'HEAD_CHEF', 'CHEF', 'STORE', 'ACCOUNTS']

  return (
    <>
      <PageHead
        title="Staff & Roles"
        sub="Who can see what, and whose cost goes into the chef P&L. A chef's monthly cost is pro-rated by the number of days in the report period."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({
            id: uid('stf'), code: '', name: '', role: 'CHEF', sectionId: state.sections[0]?.id ?? null,
            monthlyCost: 0, shiftHours: 9, pin: '0000', active: true,
          })}>+ New staff</button>
        }
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Tile label="Active staff" value={num(state.staff.filter((s) => s.active).length)} />
        <Tile label="Chefs" value={num(state.staff.filter((s) => s.role === 'CHEF' || s.role === 'HEAD_CHEF').length)} accent="var(--brand)" />
        <Tile label="Monthly payroll" value={money(state.staff.filter((s) => s.active).reduce((s, x) => s + x.monthlyCost, 0))} />
        <Tile label="Kitchen payroll" value={money(state.staff.filter((s) => s.active && (s.role === 'CHEF' || s.role === 'HEAD_CHEF')).reduce((s, x) => s + x.monthlyCost, 0))} accent="var(--purple)" />
      </div>

      <Card flush>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Section</th><th className="num">Monthly cost</th><th className="num">Shift hours</th><th>Status</th><th /></tr></thead>
          <tbody>
            {state.staff.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setEditing(s)}>
                <td>
                  <div className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
                    <Avatar name={s.name} />
                    <span>
                      <span className="tbl-name" style={{ display: 'block' }}>{s.name}</span>
                      <span className="tbl-sub">{s.code}</span>
                    </span>
                  </div>
                </td>
                <td><Badge kind={s.role === 'OWNER' || s.role === 'MANAGER' ? 'brand' : 'neutral'}>{ROLE_LABEL[s.role]}</Badge></td>
                <td className="dim">{s.sectionId ? derived.sectionById.get(s.sectionId)?.name : '—'}</td>
                <td className="num">{money(s.monthlyCost)}</td>
                <td className="num dim">{s.shiftHours}</td>
                <td>{s.active ? <Badge kind="ok">Active</Badge> : <Badge kind="neutral">Inactive</Badge>}</td>
                <td className="right dim">Edit ›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {editing && (
        <Modal title={editing.name || 'New staff member'} onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!editing.name} onClick={async () => {
                await actions.save('staff', editing)
                push({ kind: 'ok', title: 'Staff saved', msg: editing.name })
                setEditing(null)
              }}>Save</button>
            </>
          }>
          <div className="stack">
            <div className="field-row">
              <Field label="Name"><input className="input" value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Code" style={{ maxWidth: 130 }}><input className="input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
            </div>
            <div className="field-row">
              <Field label="Role">
                <select className="select" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as StaffRole })}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </Field>
              <Field label="Section" hint="Chefs only — drives their P&L">
                <select className="select" value={editing.sectionId ?? ''} onChange={(e) => setEditing({ ...editing, sectionId: e.target.value || null })}>
                  <option value="">—</option>
                  {state.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="field-row">
              <Field label="Monthly cost"><input className="input num" type="number" value={editing.monthlyCost} onChange={(e) => setEditing({ ...editing, monthlyCost: Number(e.target.value) || 0 })} /></Field>
              <Field label="Shift hours"><input className="input num" type="number" value={editing.shiftHours} onChange={(e) => setEditing({ ...editing, shiftHours: Number(e.target.value) || 0 })} /></Field>
              <Field label="PIN" style={{ maxWidth: 110 }}><input className="input num" value={editing.pin} maxLength={6} onChange={(e) => setEditing({ ...editing, pin: e.target.value })} /></Field>
            </div>
            <label className="row" style={{ gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              <span>Active</span>
            </label>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ================================================================== */
/* Data & backup                                                       */
/* ================================================================== */

function DataAndBackup() {
  const { state, actions } = useLedger()
  const { push } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<'reset' | 'wipe' | null>(null)
  const [busy, setBusy] = useState(false)

  const counts = [
    ['Items', state.items.length], ['Dishes', state.dishes.length], ['Recipes', state.recipes.length],
    ['Purchase bills', state.bills.length], ['Store issues', state.issues.length],
    ['Prep batches', state.production.length], ['Wastage entries', state.wastage.length],
    ['Sales days', state.sales.length], ['Stocktakes', state.stocktakes.length],
    ['Ledger movements', state.movements.length],
  ] as const

  return (
    <>
      <PageHead
        title="Data & Backup"
        sub="Everything lives in this browser, on this device. Export a backup before you change devices, clear site data, or let anyone loose on the demo."
      />

      <div className="grid g-2-1">
        <Card title="What is stored" sub="counts as at right now">
          <div className="grid g2">
            {counts.map(([label, n]) => (
              <div key={label} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="dim">{label}</span>
                <span className="num">{num(n as number)}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="stack">
          <Card title="Backup" sub="a single JSON file with everything in it">
            <div className="stack">
              <button className="btn btn-block" onClick={() => {
                downloadText(`kitchen-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`, actions.exportBackup(), 'application/json')
                push({ kind: 'ok', title: 'Backup downloaded' })
              }}>⬇ Export everything</button>
              <button className="btn btn-block" onClick={() => fileRef.current?.click()}>⬆ Restore from a backup</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setBusy(true)
                try {
                  await actions.importBackup(await f.text())
                  push({ kind: 'ok', title: 'Backup restored', msg: 'Everything has been replaced with the file you chose.' })
                } catch {
                  push({ kind: 'err', title: 'That file could not be read', msg: 'It needs to be a backup exported from this app.' })
                } finally {
                  setBusy(false)
                }
              }} />
            </div>
          </Card>

          <Card title="Start again" sub="both of these are permanent">
            <div className="stack">
              <button className="btn btn-block" disabled={busy} onClick={() => setConfirm('reset')}>
                ♻️ Rebuild the demo data
              </button>
              <button className="btn btn-danger btn-block" disabled={busy} onClick={() => setConfirm('wipe')}>
                🗑 Erase everything and start empty
              </button>
              <p className="dim" style={{ fontSize: 12, margin: 0 }}>
                Rebuilding regenerates four months of demo trading. Erasing leaves you with a blank system —
                use that when setting up a real restaurant.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Card title="How this is put together" style={{ marginTop: 14 }}>
        <div className="grid g3">
          <div>
            <h4 style={{ fontSize: 12.5, marginBottom: 5 }}>One ledger, no shortcuts</h4>
            <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
              Nothing changes a stock balance directly. Bills, issues, prep batches, sales, wastage and counts
              all write movements, and every balance is the sum of them — so any figure can be traced to the
              document that caused it.
            </p>
          </div>
          <div>
            <h4 style={{ fontSize: 12.5, marginBottom: 5 }}>Costs at the time</h4>
            <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
              Each movement stores the rate that applied on the day. Historical reports use those rates rather
              than re-pricing at today's, which is what lets a four-month cost drift actually show up.
            </p>
          </div>
          <div>
            <h4 style={{ fontSize: 12.5, marginBottom: 5 }}>Works offline</h4>
            <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
              The whole system runs in the browser against IndexedDB, so a phone in a kitchen with no signal
              behaves exactly like the manager's laptop. Point it at the bundled Node server when you want
              several devices sharing one set of books.
            </p>
          </div>
        </div>
      </Card>

      {confirm && (
        <Confirm
          title={confirm === 'reset' ? 'Rebuild the demo data?' : 'Erase everything?'}
          danger={confirm === 'wipe'}
          confirmLabel={confirm === 'reset' ? 'Rebuild' : 'Erase everything'}
          message={
            confirm === 'reset'
              ? 'Every bill, issue, sale and count on this device will be replaced with a freshly generated four months of demo trading. Anything you entered yourself will be lost.'
              : 'This deletes all data on this device and leaves a completely empty system. There is no undo — export a backup first if you might want it back.'
          }
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setBusy(true)
            setConfirm(null)
            if (confirm === 'reset') {
              await actions.resetDemo()
              push({ kind: 'ok', title: 'Demo data rebuilt' })
            } else {
              await actions.wipe()
              push({ kind: 'ok', title: 'Everything erased', msg: 'Start by adding categories, items and dishes under Setup.' })
            }
            setBusy(false)
          }}
        />
      )}
    </>
  )
}
