import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({})

  const groups = visibleNav(user?.role)
  const openGroupData = groups.find((g) => g.id === open)

  const MENU_WIDTH = 268

  /**
   * The dropdown is rendered into document.body rather than inside the bar.
   * The bar scrolls horizontally on narrower screens, and any scroll container
   * clips on both axes — which silently swallowed every menu.
   */
  const openGroup = useCallback((id: string | null) => {
    if (!id) { setOpen(null); setMenuPos(null); return }
    const button = triggers.current[id]
    if (!button) return
    const r = button.getBoundingClientRect()
    setMenuPos({
      top: r.bottom + 6,
      // Keep it on screen when the trigger sits near the right edge.
      left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)),
    })
    setOpen(id)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => { setOpen(null); setMenuPos(null); setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      // The menu lives in a portal, so it is not inside navRef. Without this
      // check it would unmount on mousedown and the click would never land.
      if (navRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(null)
      setMenuPos(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(null); setMenuPos(null) }
    }
    // A fixed-position menu would drift away from its trigger.
    const onReflow = () => { setOpen(null); setMenuPos(null) }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [])

  const current = findNavItem(location.pathname)
  const openDay = state.dayCloses.find((d) => d.date === derived.today && d.status !== 'CLOSED')

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">🍲</span>
          <span className="brand-lines">
            <span className="brand-text">Kitchen Ledger</span>
            <span className="brand-sub">Spice Route Kitchen</span>
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
                ref={(el) => { triggers.current[g.id] = el }}
                className={`nav-trigger${current?.group.id === g.id ? ' active' : ''}`}
                aria-expanded={open === g.id}
                aria-haspopup="menu"
                onClick={() => openGroup(open === g.id ? null : g.id)}
                onMouseEnter={() => { if (open && open !== g.id) openGroup(g.id) }}
              >
                <span>{g.icon}</span> {g.label} <span className="chev">▼</span>
              </button>
            </div>
          ))}
        </nav>

        {openGroupData && menuPos && createPortal(
          <div
            className="nav-menu" role="menu" ref={menuRef}
            style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
          >
            <div className="nav-menu-label">{openGroupData.label}</div>
            {openGroupData.items.map((item) => (
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
          </div>,
          document.body,
        )}

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
