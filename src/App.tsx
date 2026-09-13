import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { useLedger } from './data/store'

const Dashboard = lazy(() => import('./screens/Dashboard'))
const Menu = lazy(() => import('./screens/Menu'))
const Purchase = lazy(() => import('./screens/Purchase'))
const Store = lazy(() => import('./screens/Store'))
const Kitchen = lazy(() => import('./screens/Kitchen'))
const Sales = lazy(() => import('./screens/Sales'))
const Eod = lazy(() => import('./screens/Eod'))
const Reports = lazy(() => import('./screens/Reports'))
const Setup = lazy(() => import('./screens/Setup'))

function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="splash">
      <div>
        <div className="spinner" />
        <div className="muted">{label}</div>
      </div>
    </div>
  )
}

export default function App() {
  const { ready, status } = useLedger()
  if (!ready) return <Loading label={status} />

  return (
    <Layout>
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/menu/*" element={<Menu />} />
            <Route path="/purchase/*" element={<Purchase />} />
            <Route path="/store/*" element={<Store />} />
            <Route path="/kitchen/*" element={<Kitchen />} />
            <Route path="/sales/*" element={<Sales />} />
            <Route path="/eod/*" element={<Eod />} />
            <Route path="/reports/*" element={<Reports />} />
            <Route path="/setup/*" element={<Setup />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  )
}
