import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

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
    console.error('Screen failed to render', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
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
