import { useEffect, useState } from 'react'
import { useLedger } from '../data/store'
import { ROLE_LABEL } from '../components/nav'
import { Avatar } from '../components/ui'
import type { Staff } from '../core/types'

/**
 * Who is holding the device. Not a security boundary — the data is on this
 * device already — but it is what decides which app a person sees, and a PIN
 * stops a commis posting a count as the head chef by accident.
 */
export function Lock() {
  const { state, setUser } = useLedger()
  const [person, setPerson] = useState<Staff | null>(null)
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)

  const people = state.staff.filter((s) => s.active)

  useEffect(() => {
    if (!person || pin.length < 4) return
    if (pin === person.pin) {
      setUser(person)
    } else {
      setShake(true)
      setTimeout(() => { setPin(''); setShake(false) }, 350)
    }
  }, [pin, person, setUser])

  useEffect(() => {
    if (!person) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p))
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      if (e.key === 'Escape') { setPerson(null); setPin('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [person])

  return (
    <div className="lock">
      <div className="lock-card">
        <div className="row" style={{ gap: 10, marginBottom: 18, justifyContent: 'center' }}>
          <span className="brand-mark" style={{ width: 40, height: 40, fontSize: 22 }}>🍲</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Kitchen Ledger</div>
            <div className="dim" style={{ fontSize: 12.5 }}>Spice Route Kitchen</div>
          </div>
        </div>

        {!person ? (
          <>
            <div className="big-title center">Who are you?</div>
            <div className="big-sub center">Tap your name</div>
            <div className="lock-grid">
              {people.map((s) => (
                <button key={s.id} className="lock-person" onClick={() => { setPerson(s); setPin('') }}>
                  <Avatar name={s.name} />
                  <span className="n">{s.name}</span>
                  <span className="r">{ROLE_LABEL[s.role]}</span>
                </button>
              ))}
            </div>
            <p className="dim center" style={{ fontSize: 12, marginTop: 18 }}>
              Demo PINs — manager 2222 · chef 3333 · store 4444 · purchase 6666
            </p>
          </>
        ) : (
          <>
            <div className="center" style={{ marginBottom: 6 }}>
              <Avatar name={person.name} />
            </div>
            <div className="big-title center">{person.name}</div>
            <div className="big-sub center">Enter your PIN</div>
            <div className={`pin-dots${shake ? ' shake' : ''}`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={`pin-dot${pin.length > i ? ' on' : ''}`} />)}
            </div>
            <div className="keypad" style={{ maxWidth: 300, margin: '0 auto' }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
                <button key={k} type="button" onClick={() => setPin((p) => (p.length < 4 ? p + k : p))}>{k}</button>
              ))}
              <button type="button" onClick={() => { setPerson(null); setPin('') }} style={{ fontSize: 13 }}>Back</button>
              <button type="button" onClick={() => setPin((p) => (p.length < 4 ? p + '0' : p))}>0</button>
              <button type="button" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
            </div>
            <p className="dim center" style={{ fontSize: 12, marginTop: 16 }}>Demo PIN for {person.name.split(' ')[0]}: {person.pin}</p>
          </>
        )}
      </div>
    </div>
  )
}
