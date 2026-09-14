import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { ReactNode } from 'react'
import type {
  Alert, AlertStatus, Category, DayClose, Dish, GoodsReceipt, ID, Issue, Item,
  Movement, ProductionRun, PurchaseBill, PurchaseOrder, Recipe, SalesDay,
  Section, Staff, StockLocation, Stocktake, Supplier, Wastage,
} from '../core/types'
import { computeAlerts, mergeAlerts } from '../core/alerts'
import { buildContext, type CostingContext } from '../core/costing'
import { balances } from '../core/stock'
import { generateSeed } from '../core/seed/generate'
import { iso } from '../core/dates'
import {
  type CollectionName, type Collections, clearDatabase, deleteRecord,
  emptyCollections, loadAll, putRecords, writeAll,
} from './db'
import {
  type PostContext, type PostResult, postBill, postGoodsReceipt, postIssue,
  postProduction, postSales, postStocktake, postWastage, reverseDocument,
} from './commands'
import { API_BASE, isRemote, remote } from './remote'

export interface LedgerState extends Collections {}

interface Derived {
  ctx: CostingContext
  itemById: Map<ID, Item>
  dishById: Map<ID, Dish>
  categoryById: Map<ID, Category>
  staffById: Map<ID, Staff>
  locationById: Map<ID, StockLocation>
  sectionById: Map<ID, Section>
  supplierById: Map<ID, Supplier>
  recipeFor: (ownerType: 'DISH' | 'PREP', ownerId: ID) => Recipe | undefined
  balance: (itemId: ID, locationId: ID) => number
  onHand: Map<ID, number>
  stockValue: number
  today: string
  /** Open alerts, highest priority first. */
  openAlerts: Alert[]
  /** Is the signed-in person one of the roles that runs the whole system? */
}

interface Actions {
  save: <T extends { id: string }>(collection: CollectionName, record: T) => Promise<void>
  saveMany: <T extends { id: string }>(collection: CollectionName, records: T[]) => Promise<void>
  remove: (collection: CollectionName, id: string) => Promise<void>
  postBill: (bill: PurchaseBill) => Promise<PostResult>
  postIssue: (issue: Issue) => Promise<PostResult>
  postProduction: (run: ProductionRun) => Promise<PostResult>
  postWastage: (w: Wastage) => Promise<PostResult>
  postSales: (day: SalesDay) => Promise<PostResult>
  postStocktake: (take: Stocktake) => Promise<PostResult>
  postGoodsReceipt: (grn: GoodsReceipt) => Promise<PostResult>
  savePurchaseOrder: (po: PurchaseOrder) => Promise<void>
  /** Re-run the alert engine for a date and persist what changed. */
  refreshAlerts: (date?: string) => Promise<Alert[]>
  setAlertStatus: (id: ID, status: AlertStatus, note?: string) => Promise<void>
  voidDocument: (refType: Movement['refType'], refId: string) => Promise<void>
  closeDay: (date: string, notes?: string) => Promise<void>
  resetDemo: () => Promise<void>
  wipe: () => Promise<void>
  exportBackup: () => string
  importBackup: (json: string) => Promise<void>
}

interface Ctx {
  state: LedgerState
  derived: Derived
  actions: Actions
  ready: boolean
  status: string
  user: Staff | null
  setUser: (s: Staff | null) => void
}

const LedgerContext = createContext<Ctx | null>(null)

const sev = (s: Alert['severity']) => (s === 'CRITICAL' ? 3 : s === 'HIGH' ? 2 : 1)

const USER_KEY = 'kl.user'

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LedgerState>(() => emptyCollections())
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('Opening local database…')
  const [user, setUserState] = useState<Staff | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (isRemote) {
          setStatus(`Connecting to ${API_BASE}…`)
          const data = await remote.state()
          if (cancelled) return
          setState(data)
          setReady(true)
          return
        }
        setStatus('Opening local database…')
        const existing = await loadAll()
        if (cancelled) return
        if (existing && existing.items.length) {
          setState(existing)
        } else {
          setStatus('Building four months of trading history…')
          const seed = generateSeed(iso(new Date())) as unknown as Collections
          setStatus('Saving to this device…')
          await writeAll(seed)
          if (cancelled) return
          setState(seed)
        }
      } catch (err) {
        console.error('Falling back to in-memory data', err)
        // A blocked IndexedDB (private browsing) or an unreachable server both
        // land here; the app still works, it just cannot persist.
        setState(generateSeed(iso(new Date())) as unknown as Collections)
        setStatus(isRemote
          ? 'Server unreachable — running on local demo data'
          : 'Running in memory — this browser is blocking storage')
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready || user) return
    // Remember who was here last; otherwise the lock screen asks.
    const saved = localStorage.getItem(USER_KEY)
    const found = saved ? state.staff.find((s) => s.id === saved && s.active) : null
    if (found) setUserState(found)
  }, [ready, state.staff, user])

  const setUser = useCallback((s: Staff | null) => {
    setUserState(s)
    if (s) localStorage.setItem(USER_KEY, s.id)
    else localStorage.removeItem(USER_KEY)
  }, [])

  const derived = useMemo<Derived>(() => {
    const itemById = new Map(state.items.map((i) => [i.id, i]))
    const bal = balances(state.movements)
    const onHand = new Map<ID, number>()
    let stockValue = 0
    for (const b of bal.values()) {
      onHand.set(b.itemId, (onHand.get(b.itemId) ?? 0) + b.qty)
    }
    for (const [itemId, qty] of onHand) {
      const item = itemById.get(itemId)
      if (item) stockValue += qty * item.avgCost
    }
    const recipeIndex = new Map<string, Recipe>()
    for (const r of state.recipes) {
      if (r.active) recipeIndex.set(`${r.ownerType}:${r.ownerId}`, r)
    }
    const openAlerts = [...state.alerts]
      .filter((a) => a.status === 'OPEN')
      .sort((a, b) => sev(b.severity) * 1e6 + b.impact - (sev(a.severity) * 1e6 + a.impact))
    return {
      openAlerts,
      ctx: buildContext(state.items, state.recipes),
      itemById,
      dishById: new Map(state.dishes.map((d) => [d.id, d])),
      categoryById: new Map(state.categories.map((c) => [c.id, c])),
      staffById: new Map(state.staff.map((s) => [s.id, s])),
      locationById: new Map(state.locations.map((l) => [l.id, l])),
      sectionById: new Map(state.sections.map((s) => [s.id, s])),
      supplierById: new Map(state.suppliers.map((s) => [s.id, s])),
      recipeFor: (t, id) => recipeIndex.get(`${t}:${id}`),
      balance: (itemId, locationId) => bal.get(`${itemId}|${locationId}`)?.qty ?? 0,
      onHand,
      stockValue,
      today: iso(new Date()),
    }
  }, [state])

  const postContext = useCallback((): PostContext => ({
    items: stateRef.current.items,
    ctx: buildContext(stateRef.current.items, stateRef.current.recipes),
    balance: (itemId, locationId) => {
      let qty = 0
      for (const m of stateRef.current.movements) {
        if (m.itemId === itemId && m.locationId === locationId) qty += m.qty
      }
      return qty
    },
  }), [])

  /** Merge a command's output into memory, and persist it when running locally. */
  const applyResult = useCallback(async (result: PostResult, alreadyPersisted = false) => {
    // Update the ref synchronously too, so a follow-up action in the same
    // tick (raising alerts after a count) sees the movements it just posted.
    const next: LedgerState = {
      ...stateRef.current,
      movements: result.movements.length ? [...stateRef.current.movements, ...result.movements] : stateRef.current.movements,
      items: result.itemPatches.length
        ? stateRef.current.items.map((i) => result.itemPatches.find((p) => p.id === i.id) ?? i)
        : stateRef.current.items,
    }
    stateRef.current = next
    setState(next)
    if (alreadyPersisted || isRemote) return
    await putRecords('movements', result.movements)
    await putRecords('items', result.itemPatches)
  }, [])

  const save = useCallback(async <T extends { id: string }>(collection: CollectionName, record: T) => {
    const list = (stateRef.current as any)[collection] as T[]
    const idx = list.findIndex((r) => r.id === record.id)
    const nextList = idx >= 0 ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record]
    const next = { ...stateRef.current, [collection]: nextList } as LedgerState
    stateRef.current = next
    setState(next)
    if (isRemote) await remote.put(collection, [record])
    else await putRecords(collection, [record])
  }, [])

  const saveMany = useCallback(async <T extends { id: string }>(collection: CollectionName, records: T[]) => {
    if (!records.length) return
    const list = (stateRef.current as any)[collection] as T[]
    const map = new Map(list.map((r) => [r.id, r]))
    for (const r of records) map.set(r.id, r)
    const next = { ...stateRef.current, [collection]: [...map.values()] } as LedgerState
    stateRef.current = next
    setState(next)
    if (isRemote) await remote.put(collection, records)
    else await putRecords(collection, records)
  }, [])

  const remove = useCallback(async (collection: CollectionName, id: string) => {
    const next = {
      ...stateRef.current,
      [collection]: ((stateRef.current as any)[collection] as { id: string }[]).filter((r) => r.id !== id),
    } as LedgerState
    stateRef.current = next
    setState(next)
    if (isRemote) await remote.remove(collection, id)
    else await deleteRecord(collection, id)
  }, [])

  const actionsRef = useRef<Actions | null>(null)
  const actions = useMemo<Actions>(() => ({
    save,
    saveMany,
    remove,
    async postBill(bill) {
      if (isRemote) {
        // The server runs the same command and persists both sides atomically.
        const result = await remote.command('bill', bill)
        setState((prev) => ({
          ...prev,
          bills: upsertInto(prev.bills, bill),
        }))
        await applyResult(result, true)
        return result
      }
      const result = postBill(postContext(), bill)
      await save('bills', bill)
      await applyResult(result)
      return result
    },
    async postIssue(issue) {
      if (isRemote) {
        // The server runs the same command and persists both sides atomically.
        const result = await remote.command('issue', issue)
        setState((prev) => ({
          ...prev,
          issues: upsertInto(prev.issues, issue),
        }))
        await applyResult(result, true)
        return result
      }
      const result = postIssue(postContext(), issue)
      await save('issues', issue)
      await applyResult(result)
      return result
    },
    async postProduction(run) {
      if (isRemote) {
        // The server runs the same command and persists both sides atomically.
        const result = await remote.command('production', run)
        setState((prev) => ({
          ...prev,
          production: upsertInto(prev.production, run),
        }))
        await applyResult(result, true)
        return result
      }
      const result = postProduction(postContext(), run)
      await save('production', run)
      await applyResult(result)
      return result
    },
    async postWastage(w) {
      if (isRemote) {
        // The server runs the same command and persists both sides atomically.
        const result = await remote.command('wastage', w)
        setState((prev) => ({
          ...prev,
          wastage: upsertInto(prev.wastage, w),
        }))
        await applyResult(result, true)
        return result
      }
      const result = postWastage(postContext(), w)
      await save('wastage', w)
      await applyResult(result)
      return result
    },
    async postSales(day) {
      if (isRemote) {
        // The server runs the same command and persists both sides atomically.
        const result = await remote.command('sales', day)
        setState((prev) => ({
          ...prev,
          sales: upsertInto(prev.sales, day),
        }))
        await applyResult(result, true)
        return result
      }
      const result = postSales(postContext(), day)
      await save('sales', day)
      await applyResult(result)
      return result
    },
    async postStocktake(take) {
      if (isRemote) {
        // The server runs the same command and persists both sides atomically.
        const result = await remote.command('stocktake', take)
        setState((prev) => ({
          ...prev,
          stocktakes: upsertInto(prev.stocktakes, take),
        }))
        await applyResult(result, true)
        await actionsRef.current?.refreshAlerts(take.date)
        return result
      }
      const result = postStocktake(postContext(), take)
      await save('stocktakes', take)
      await applyResult(result)
      // The count is what the manager is waiting for — raise the alerts now.
      await actionsRef.current?.refreshAlerts(take.date)
      return result
    },
    async postGoodsReceipt(grn) {
      const po = grn.poId ? stateRef.current.purchaseOrders.find((p) => p.id === grn.poId) : undefined
      if (isRemote) {
        const result = await remote.command('receipt', grn)
        setState((prev) => ({
          ...prev,
          receipts: upsertInto(prev.receipts, grn),
          purchaseOrders: result.poPatch ? upsertInto(prev.purchaseOrders, result.poPatch) : prev.purchaseOrders,
        }))
        await applyResult(result, true)
        await actionsRef.current?.refreshAlerts(grn.date)
        return result
      }
      const result = postGoodsReceipt(postContext(), grn, po)
      await save('receipts', grn)
      if (result.poPatch) await save('purchaseOrders', result.poPatch)
      await applyResult(result)
      await actionsRef.current?.refreshAlerts(grn.date)
      return result
    },
    async savePurchaseOrder(po) {
      await save('purchaseOrders', po)
    },
    async refreshAlerts(date) {
      const st = stateRef.current
      const d = date ?? iso(new Date())
      const fresh = computeAlerts({
        date: d, items: st.items, categories: st.categories, dishes: st.dishes,
        recipes: st.recipes, suppliers: st.suppliers, movements: st.movements,
        stocktakes: st.stocktakes, receipts: st.receipts, purchaseOrders: st.purchaseOrders,
        sales: st.sales,
      })
      const merged = mergeAlerts(st.alerts, fresh, d)
      // Only write what actually changed; the inbox can hold a few hundred rows.
      const before = new Map(st.alerts.map((a) => [a.id, JSON.stringify(a)]))
      const changed = merged.filter((a) => before.get(a.id) !== JSON.stringify(a))
      if (changed.length) await saveMany('alerts', changed)
      return merged.filter((a) => a.status === 'OPEN')
    },
    async setAlertStatus(id, status, note) {
      const alert = stateRef.current.alerts.find((a) => a.id === id)
      if (!alert) return
      await save('alerts', {
        ...alert, status, note: note ?? alert.note,
        actedBy: user?.id ?? null, actedAt: new Date().toISOString(),
      })
    },
    async voidDocument(refType, refId) {
      if (isRemote) {
        const result = await remote.voidDocument(refType, refId)
        await applyResult(result, true)
        return
      }
      const reversals = reverseDocument(stateRef.current.movements, refType, refId)
      await applyResult({ movements: reversals, itemPatches: [], warnings: [] })
    },
    async closeDay(date, notes) {
      const existing = stateRef.current.dayCloses.find((d) => d.date === date)
      const close: DayClose = {
        id: existing?.id ?? `dc_${date}`,
        date,
        status: 'CLOSED',
        salesPosted: true,
        consumptionPosted: true,
        stocktakeIds: stateRef.current.stocktakes.filter((s) => s.date === date).map((s) => s.id),
        closedBy: user?.id ?? null,
        closedAt: new Date().toISOString(),
        notes,
      }
      await save('dayCloses', close)
    },
    async resetDemo() {
      if (isRemote) {
        setState(await remote.seed())
        return
      }
      const seed = generateSeed(iso(new Date())) as unknown as Collections
      await writeAll(seed)
      setState(seed)
    },
    async wipe() {
      await clearDatabase()
      const blank = emptyCollections()
      setState(blank)
    },
    exportBackup() {
      return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: stateRef.current })
    },
    async importBackup(json) {
      const parsed = JSON.parse(json)
      const data = (parsed.data ?? parsed) as Collections
      if (isRemote) await remote.restore(data)
      else await writeAll(data)
      setState(data)
    },
  }), [applyResult, postContext, save, saveMany, remove, user])

  actionsRef.current = actions

  const value = useMemo<Ctx>(
    () => ({ state, derived, actions, ready, status, user, setUser }),
    [state, derived, actions, ready, status, user, setUser],
  )

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
}

/** Replace a record in a collection, or append it when it is new. */
function upsertInto<T extends { id: string }>(list: T[], record: T): T[] {
  const idx = list.findIndex((r) => r.id === record.id)
  return idx >= 0 ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record]
}

export function useLedger(): Ctx {
  const ctx = useContext(LedgerContext)
  if (!ctx) throw new Error('useLedger must be used inside <LedgerProvider>')
  return ctx
}

export type { Alert, Category, Dish, GoodsReceipt, Item, Movement, PurchaseOrder, Recipe, SalesDay, Staff, Stocktake, Supplier, Wastage }
