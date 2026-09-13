import type { BaseUnit, Severity } from '../core/types'

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function money(n: number, dp = 0): string {
  if (!Number.isFinite(n)) return '—'
  const v = dp ? INR2.format(Math.abs(n)) : INR.format(Math.round(Math.abs(n)))
  return `${n < 0 ? '−' : ''}₹${v}`
}

/** Indian short form — a manager reads 12.4L faster than 1,240,000. */
export function moneyShort(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}k`
  return `${sign}₹${Math.round(abs)}`
}

export function num(n: number, dp = 0): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n)
}

export function pct(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(dp)}%`
}

export function signedPct(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(dp)}%`
}

export function qty(value: number, unit: BaseUnit, dp = 2): string {
  const abs = Math.abs(value)
  if (unit === 'g') return abs >= 1000 ? `${num(value / 1000, dp)} kg` : `${num(value, abs < 10 ? 1 : 0)} g`
  if (unit === 'ml') return abs >= 1000 ? `${num(value / 1000, dp)} L` : `${num(value, abs < 10 ? 1 : 0)} ml`
  return `${num(value, value % 1 === 0 ? 0 : 1)} pc`
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

export const SEVERITY_CLASS: Record<Severity, string> = {
  OK: 'badge-ok', WATCH: 'badge-watch', HIGH: 'badge-high', CRITICAL: 'badge-critical',
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  OK: 'var(--pos)', WATCH: 'var(--warn)', HIGH: '#f08c3c', CRITICAL: 'var(--neg)',
}

export function severityOfPct(v: number, tolerance = 2.5): Severity {
  const a = Math.abs(v)
  if (a >= tolerance * 3) return 'CRITICAL'
  if (a >= tolerance * 2) return 'HIGH'
  if (a >= tolerance) return 'WATCH'
  return 'OK'
}

/** Green when up is good, red when it is not — never the other way round. */
export function trendClass(delta: number, higherIsBetter = true): string {
  if (Math.abs(delta) < 0.05) return 'dim'
  return (delta > 0) === higherIsBetter ? 'pos' : 'neg'
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  if (!rows.length) return ''
  const cols = headers ?? Object.keys(rows[0])
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n')
}

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
