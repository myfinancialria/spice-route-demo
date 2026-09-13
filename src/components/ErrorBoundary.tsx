import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

const RELOAD_FLAG = 'kl.chunkReload'

/**
 * A lazy chunk that 404s almost always means the app was open across a deploy:
 * the cached entry file is asking for chunk hashes that no longer exist. That
 * is not a bug to show the user, it is a page that needs reloading.
 */
function isStaleChunk(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|Loading chunk|\bCSS chunk\b/i
    .test(error.message ?? '')
}

/**
 * A screen that throws should cost the user that screen, not the whole app —
 * and they should be able to get back to work without losing local data.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isStaleChunk(error) && !sessionStorage.getItem(RELOAD_FLAG)) {
      // Reload once and only once, so a genuinely missing chunk cannot
      // put the page into a refresh loop.
      sessionStorage.setItem(RELOAD_FLAG, '1')
      window.location.reload()
      return
    }
    console.error('Screen failed to render', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) {
      sessionStorage.removeItem(RELOAD_FLAG)
      return this.props.children
    }
    if (isStaleChunk(error)) {
      return (
        <div className="card" style={{ maxWidth: 560, margin: '40px auto', padding: 24 }}>
          <h2 style={{ marginBottom: 8 }}>A newer version is available</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            This page was open while the app was updated. Reload to pick up the new
            version — nothing you have entered is affected.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return (
      <div className="card" style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
        <h2 style={{ marginBottom: 8 }}>This screen hit a problem</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Nothing has been lost — your data is stored on this device and is untouched.
          Go back to the dashboard, or reload to start fresh.
        </p>
        <pre className="mono-sm dim" style={{
          background: 'var(--bg)', padding: 12, borderRadius: 8, overflow: 'auto',
          maxHeight: 180, marginTop: 12,
        }}>
          {error.message}
        </pre>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => { window.location.hash = '#/'; this.setState({ error: null }) }}>
            Back to dashboard
          </button>
          <button className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
