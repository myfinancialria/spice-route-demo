/** All business dates are ISO yyyy-mm-dd strings in local time. */

export function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function addDays(s: string, n: number): string {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)
}

export function monthKey(s: string): string { return s.slice(0, 7) }

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function dayLabel(s: string): string {
  return parseISO(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function longDate(s: string): string {
  return parseISO(s).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

export function dow(s: string): number { return parseISO(s).getDay() }

export function rangeDays(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard++ < 2000) { out.push(cur); cur = addDays(cur, 1) }
  return out
}

export function lastNDays(to: string, n: number): string[] {
  return rangeDays(addDays(to, -(n - 1)), to)
}
