import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Severity } from '../core/types'
import { SEVERITY_CLASS, initials, trendClass } from '../lib/format'

/* ---------------- basics ---------------- */

export function Card({
  title, sub, actions, children, className = '', flush = false, footer, style,
}: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode
  className?: string; flush?: boolean; footer?: ReactNode; style?: CSSProperties
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={`card-body${flush ? ' flush' : ''}`}>{children}</div>
      {footer && <footer className="card-foot">{footer}</footer>}
    </section>
  )
}

export function Badge({ kind = 'neutral', children }: { kind?: string; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${SEVERITY_CLASS[severity]}`}>{severity}</span>
}

export function Tile({
  label, value, foot, accent, delta, deltaGood = true, deltaUnit = '%', onClick, hint,
}: {
  label: ReactNode; value: ReactNode; foot?: ReactNode; accent?: string
  delta?: number; deltaGood?: boolean; deltaUnit?: string
  onClick?: () => void; hint?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className="tile" onClick={onClick} title={hint} type={onClick ? 'button' : undefined}>
      {accent && <span className="tile-accent" style={{ background: accent }} />}
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-foot">
        {delta !== undefined && Number.isFinite(delta) && (
          <span className={`delta ${trendClass(delta, deltaGood)}`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {Math.abs(delta).toFixed(1)}{deltaUnit}
          </span>
        )}
        {foot}
      </span>
    </Tag>
  )
}

export function Empty({ icon = '🗂', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      {children && <div style={{ fontSize: 13 }}>{children}</div>}
    </div>
  )
}

export function Field({
  label, hint, children, style,
}: { label?: ReactNode; hint?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="field" style={style}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Tabs<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.value} type="button" role="tab" aria-selected={value === o.value}
          className={`tab${value === o.value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pills<T extends string | number>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="pill-row">
      {options.map((o) => (
        <button
          key={String(o.value)} type="button"
          className={`pill${value === o.value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({
  title, sub, onClose, children, footer, size = '',
}: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode
  footer?: ReactNode; size?: '' | 'wide' | 'xwide'
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="sub dim" style={{ fontSize: 12 }}>{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

export function Drawer({
  title, sub, onClose, children, footer,
}: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="drawer-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="drawer">
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="dim" style={{ fontSize: 12 }}>{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body grow scroll-y">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </aside>
    </div>
  )
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar">{initials(name)}</span>
}

export function Bar({ value, max, color = 'var(--brand)' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return <div className="bar"><span style={{ width: `${w}%`, background: color }} /></div>
}

export function Meter({ parts }: { parts: { value: number; color: string; label?: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div className="meter">
      {parts.map((p, i) => (
        <span key={i} title={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  )
}

/* ---------------- toasts ---------------- */

interface Toast { id: number; kind: 'ok' | 'err' | 'warn'; title: string; msg?: string }
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current
    setItems((prev) => [...prev, { ...t, id }])
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.kind === 'err' ? 7000 : 4200)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.msg && <div className="toast-msg">{t.msg}</div>}
            </div>
            <button className="icon-btn" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() { return useContext(ToastCtx) }

/* ---------------- cascading category → item pickers ---------------- */

export interface CascadeOption { id: string; name: string; parentId: string | null }

/**
 * Category → sub-category → item, where each dropdown only appears once the
 * one above it has an answer. Picking a category first cuts a seventy-item
 * list down to five, which is the difference between a chef using the app
 * mid-service and not bothering.
 */
export function CascadeSelect({
  categories, items, value, onChange, itemLabel, placeholder = 'Select item', autoFocus,
}: {
  categories: CascadeOption[]
  items: { id: string; name: string; categoryId: string; subCategoryId: string | null; sku?: string }[]
  value: string | null
  onChange: (id: string | null) => void
  itemLabel?: (item: { id: string; name: string; sku?: string }) => string
  placeholder?: string
  autoFocus?: boolean
}) {
  const selected = items.find((i) => i.id === value)
  const [cat, setCat] = useState<string>(selected?.categoryId ?? '')
  const [sub, setSub] = useState<string>(selected?.subCategoryId ?? '')

  useEffect(() => {
    if (selected) {
      setCat(selected.categoryId)
      setSub(selected.subCategoryId ?? '')
    }
  }, [selected])

  const tops = categories.filter((c) => !c.parentId)
  const subs = categories.filter((c) => c.parentId === cat)
  const pool = items.filter((i) => (!cat || i.categoryId === cat) && (!sub || i.subCategoryId === sub))

  return (
    <div className="cascade">
      <select
        className="select" value={cat} autoFocus={autoFocus}
        onChange={(e) => { setCat(e.target.value); setSub(''); onChange(null) }}
      >
        <option value="">All categories</option>
        {tops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {cat && subs.length > 0 && (
        <select className="select" value={sub} onChange={(e) => { setSub(e.target.value); onChange(null) }}>
          <option value="">All {tops.find((t) => t.id === cat)?.name.toLowerCase()}</option>
          {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{placeholder} ({pool.length})</option>
        {pool.map((i) => (
          <option key={i.id} value={i.id}>{itemLabel ? itemLabel(i) : i.name}</option>
        ))}
      </select>
    </div>
  )
}

/* ---------------- number keypad ---------------- */

export function Keypad({
  value, onChange, onDone, unit,
}: { value: string; onChange: (v: string) => void; onDone?: () => void; unit?: string }) {
  const press = (k: string) => {
    if (k === 'C') return onChange('')
    if (k === '⌫') return onChange(value.slice(0, -1))
    if (k === '.' && value.includes('.')) return
    onChange(value + k)
  }
  return (
    <div>
      <div className="keypad-display">
        {value || '0'}<span className="dim" style={{ fontSize: 15, marginLeft: 6 }}>{unit}</span>
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
          <button key={k} type="button" onClick={() => press(k)}>{k}</button>
        ))}
        <button type="button" onClick={() => press('C')}>C</button>
        <button type="button" className="wide btn-primary" style={{ background: 'var(--brand)', color: '#16120c' }} onClick={onDone}>
          Add
        </button>
      </div>
    </div>
  )
}

/* ---------------- misc ---------------- */

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch { return initial }
  })
  const set = useCallback((next: T) => {
    setV(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage blocked */ }
  }, [key])
  return [v, set]
}

export function Search({
  value, onChange, placeholder = 'Search…', autoFocus,
}: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input
      className="input" value={value} autoFocus={autoFocus} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 300 }}
    />
  )
}

export function Confirm({
  title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel,
}: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Modal
      title={title} onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <div className="muted">{message}</div>
    </Modal>
  )
}
