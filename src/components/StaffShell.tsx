import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useLedger } from '../data/store'
import { ROLE_LABEL } from './nav'
import { Avatar } from './ui'
import { longDate } from '../core/dates'

export interface StaffTab { path: string; label: string; icon: string }

/**
 * The frame for a single-role app: who you are, today's date, two or three
 * big tabs, and a way to hand the device to someone else. Nothing else.
 */
export function StaffShell({ tabs, title, children }: { tabs: StaffTab[]; title: string; children: ReactNode }) {
  const { user, setUser, derived } = useLedger()
  const location = useLocation()
  return (
    <div className="staff">
      <header className="staff-top">
        {user && <Avatar name={user.name} />}
        <div className="grow" style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          <div className="who">{user?.name} · {user ? ROLE_LABEL[user.role] : ''} · {longDate(derived.today)}</div>
        </div>
        <button className="btn btn-sm" onClick={() => setUser(null)} title="Hand the device to someone else">Switch user</button>
      </header>
      <main className="staff-body">{children}</main>
      <nav className="staff-tabs">
        {tabs.map((t) => {
          const active = location.pathname === t.path || location.pathname.startsWith(t.path + '/')
          return (
            <Link key={t.path} to={t.path} className={`staff-tab${active ? ' active' : ''}`}>
              <span className="ico">{t.icon}</span>
              {t.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export function DoneScreen({ title, detail, onDone, doneLabel = 'Done' }: { title: string; detail?: ReactNode; onDone: () => void; doneLabel?: string }) {
  return (
    <div className="done-screen">
      <div className="tick">✓</div>
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      <button className="big-btn primary" style={{ maxWidth: 320, margin: '0 auto' }} onClick={onDone}>{doneLabel}</button>
    </div>
  )
}
