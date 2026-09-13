/**
 * Local-first persistence.
 *
 * Everything the app knows lives in IndexedDB in the browser, so the whole
 * system works on a phone in a kitchen with no connection and nothing to keep
 * running. When VITE_API_BASE is set the same collections are mirrored to the
 * Node server instead, which is what makes it multi-device.
 */
import { type IDBPDatabase, openDB } from 'idb'
import type {
  Category, DayClose, Dish, Issue, Item, Movement, ProductionRun, PurchaseBill,
  Recipe, SalesDay, Section, Staff, StockLocation, Stocktake, Supplier, Wastage,
} from '../core/types'

export const DB_NAME = 'kitchen-ledger'
export const DB_VERSION = 1

export interface Collections {
  categories: Category[]
  sections: Section[]
  locations: StockLocation[]
  staff: Staff[]
  suppliers: Supplier[]
  items: Item[]
  dishes: Dish[]
  recipes: Recipe[]
  bills: PurchaseBill[]
  issues: Issue[]
  production: ProductionRun[]
  wastage: Wastage[]
  sales: SalesDay[]
  stocktakes: Stocktake[]
  dayCloses: DayClose[]
  movements: Movement[]
}

export const COLLECTIONS = [
  'categories', 'sections', 'locations', 'staff', 'suppliers', 'items', 'dishes',
  'recipes', 'bills', 'issues', 'production', 'wastage', 'sales', 'stocktakes',
  'dayCloses', 'movements',
] as const

export type CollectionName = (typeof COLLECTIONS)[number]

// The store names are data-driven, which a typed DBSchema cannot express
// without restating all sixteen collections; the wrapper below keeps the
// type safety where it matters, at the collection boundary.
type AnyDB = IDBPDatabase<unknown>

let dbPromise: Promise<AnyDB> | null = null

export function getDb(): Promise<AnyDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
        for (const name of COLLECTIONS) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' })
          }
        }
      },
    })
  }
  return dbPromise
}

export async function loadAll(): Promise<Collections | null> {
  const db = await getDb()
  const seeded = await db.get('meta' as never, 'seededAt')
  if (!seeded) return null
  const out = {} as Collections
  for (const name of COLLECTIONS) {
    ;(out as any)[name] = await db.getAll(name as never)
  }
  return out
}

/** Bulk write, used for seeding and for restoring a backup. */
export async function writeAll(data: Collections, meta: Record<string, unknown> = {}): Promise<void> {
  const db = await getDb()
  for (const name of COLLECTIONS) {
    const records = (data as any)[name] as { id: string }[]
    const tx = db.transaction(name as never, 'readwrite')
    const store = tx.objectStore(name as never) as any
    await store.clear()
    // One transaction per collection keeps a 28k-row seed responsive without
    // holding a single giant transaction open across every store.
    for (const r of records) store.put(r)
    await tx.done
  }
  const tx = db.transaction('meta' as never, 'readwrite')
  const metaStore = tx.objectStore('meta' as never) as any
  metaStore.put(new Date().toISOString(), 'seededAt')
  for (const [k, v] of Object.entries(meta)) metaStore.put(v, k)
  await tx.done
}

export async function putRecords(name: CollectionName, records: { id: string }[]): Promise<void> {
  if (!records.length) return
  const db = await getDb()
  const tx = db.transaction(name as never, 'readwrite')
  const store = tx.objectStore(name as never) as any
  for (const r of records) store.put(r)
  await tx.done
}

export async function deleteRecord(name: CollectionName, id: string): Promise<void> {
  const db = await getDb()
  await db.delete(name as never, id)
}

export async function clearDatabase(): Promise<void> {
  const db = await getDb()
  for (const name of COLLECTIONS) await db.clear(name as never)
  await db.clear('meta' as never)
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('meta' as never, value as never, key)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDb()
  return (await db.get('meta' as never, key)) as T | undefined
}

export function emptyCollections(): Collections {
  return {
    categories: [], sections: [], locations: [], staff: [], suppliers: [], items: [],
    dishes: [], recipes: [], bills: [], issues: [], production: [], wastage: [],
    sales: [], stocktakes: [], dayCloses: [], movements: [],
  }
}
