/**
 * HTTP backend.
 *
 * Set VITE_API_BASE at build time and the app talks to the Node server instead
 * of its own IndexedDB. The domain logic is identical either way — the server
 * runs the same command functions — so this only moves where the records live.
 */
import type { Collections } from './db'
import type { Item, Movement, PurchaseOrder } from '../core/types'

export const API_BASE: string | undefined = import.meta.env.VITE_API_BASE as string | undefined
export const isRemote = !!API_BASE

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export interface RemoteResult {
  movements: Movement[]
  itemPatches: Item[]
  warnings: string[]
  poPatch?: PurchaseOrder
}

export const remote = {
  state: () => request<Collections>('/state'),
  seed: () => request<Collections>('/seed', { method: 'POST' }),
  put: (collection: string, records: unknown[]) =>
    request<{ ok: boolean }>(`/${collection}`, { method: 'POST', body: JSON.stringify(records) }),
  remove: (collection: string, id: string) =>
    request<{ ok: boolean }>(`/${collection}/${id}`, { method: 'DELETE' }),
  command: (name: string, document: unknown) =>
    request<RemoteResult>(`/commands/${name}`, { method: 'POST', body: JSON.stringify(document) }),
  voidDocument: (refType: string, refId: string) =>
    request<RemoteResult>('/void', { method: 'POST', body: JSON.stringify({ refType, refId }) }),
  restore: (data: Collections) =>
    request<{ ok: boolean }>('/restore', { method: 'POST', body: JSON.stringify({ data }) }),
}
