import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useLedger } from '../data/store'
import { ROLE_LABEL, findNavItem, visibleNav } from './nav'
import { Avatar, Modal, useLocalState } from './ui'
import { longDate } from '../core/dates'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, setUser, state, derived } = useLedger()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const [theme, setTheme] = useLocalState<'dark' | 'light'>('kl.theme', 'dark')
  const navRef = useRef<HTMLDivElement>(null)

  const groups = visibleNav(user?.role)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => { setOpen(null); setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onClick); window.removeEventListener('keydown', onKey) }
  }, [])

  const current = findNavItem(location.pathname)
  const openDay = state.dayCloses.find((d) => d.date === derived.today && d.status !== 'CLOSED')

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">🍲</span>
          <span>
            <span className="brand-text">Kitchen Ledger</span>
            <span className="brand-sub" style={{ display: 'block' }}>Spice Route Kitchen</span>
          </span>
        </Link>

        <nav className="nav" ref={navRef}>
          <Link
            to="/"
            className={`nav-trigger${location.pathname === '/' ? ' active' : ''}`}
          >
            <span>📊</span> Dashboard
          </Link>
          {groups.map((g) => (
            <div key={g.id} className={`nav-group${open === g.id ? ' open' : ''}`}>
              <button
                type="button"
                className={`nav-trigger${current?.group.id === g.id ? ' active' : ''}`}
                aria-expanded={open === g.id}
                onClick={() => setOpen(open === g.id ? null : g.id)}
                onMouseEnter={() => open && setOpen(g.id)}
              >
                <span>{g.icon}</span> {g.label} <span className="chev">▼</span>
              </button>
              {open === g.id && (
                <div className="nav-menu" role="menu">
                  <div className="nav-menu-label">{g.label}</div>
                  {g.items.map((item) => (
                    <Link
                      key={item.path} to={item.path} role="menuitem"
                      className={`nav-item${location.pathname === item.path ? ' active' : ''}`}
                    >
                      <span className="ico">{item.icon}</span>
                      <span className="nav-item-body">
                        {item.label}
                        {item.desc && <span className="sub">{item.desc}</span>}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <button className="icon-btn mobile-only" onClick={() => setMobileOpen(true)} aria-label="Menu">☰</button>

        <div className="topbar-right">
          {openDay && (
            <button className="chip" onClick={() => navigate('/eod/close')} title="The day is still open">
              <span className="dot" style={{ background: 'var(--warn)' }} /> Day open
            </button>
          )}
          <span className="chip date-chip" title="Business date">{longDate(derived.today)}</span>
          <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Switch theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {user && (
            <button className="user-btn" onClick={() => setShowUser(true)}>
              <Avatar name={user.name} />
              <span style={{ textAlign: 'left', lineHeight: 1.15 }}>
                <span style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>{user.name.split(' ')[0]}</span>
                <span style={{ fontSize: 10 }} className="dim">{ROLE_LABEL[user.role]}</span>
              </span>
            </button>
          )}
        </div>
      </header>

      {mobileOpen && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setMobileOpen(false) }}>
          <div className="modal" style={{ maxWidth: 420, maxHeight: '86vh' }}>
            <header className="modal-head">
              <h2>Menu</h2>
              <button className="icon-btn" onClick={() => setMobileOpen(false)}>✕</button>
            </header>
            <div className="modal-body">
              <Link to="/" className="nav-item"><span className="ico">📊</span> Dashboard</Link>
              {groups.map((g) => (
                <div key={g.id} style={{ marginTop: 10 }}>
                  <div className="nav-menu-label">{g.icon} {g.label}</div>
                  {g.items.map((item) => (
                    <Link key={item.path} to={item.path} className={`nav-item${location.pathname === item.path ? ' active' : ''}`}>
                      <span className="ico">{item.icon}</span>
                      <span className="nav-item-body">{item.label}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showUser && (
        <Modal title="Who is using this device?" sub="Entries are attributed to whoever is signed in" onClose={() => setShowUser(false)}>
          <div className="drill">
            {state.staff.filter((s) => s.active).map((s) => (
              <button
                key={s.id} className="drill-row" style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--border)', textAlign: 'left' }}
                onClick={() => { setUser(s); setShowUser(false) }}
              >
                <span className="row">
                  <Avatar name={s.name} />
                  <span>
                    <span style={{ fontWeight: 600, display: 'block' }}>{s.name}</span>
                    <span className="dim" style={{ fontSize: 12 }}>
                      {ROLE_LABEL[s.role]}
                      {s.sectionId && ` · ${state.sections.find((x) => x.id === s.sectionId)?.name}`}
                    </span>
                  </span>
                </span>
                {user?.id === s.id && <span className="badge badge-brand">Signed in</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      <main className="content">{children}</main>
    </div>
  )
}

export function PageHead({
  title, sub, actions, breadcrumb,
}: {
  title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode
  breadcrumb?: { label: string; to?: string }[]
}) {
  return (
    <div className="page-head">
      <div className="page-title">
        {breadcrumb && (
          <div className="breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={i}>
                {b.to ? <Link to={b.to}>{b.label}</Link> : b.label}
                {i < breadcrumb.length - 1 && <span style={{ margin: '0 6px' }}>›</span>}
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}
