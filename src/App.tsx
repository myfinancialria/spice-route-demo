import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { isAdminRole } from './components/nav'
import { useLedger } from './data/store'
import { Lock } from './screens/Lock'

const Dashboard = lazy(() => import('./screens/Dashboard'))
const Alerts = lazy(() => import('./screens/Alerts'))
const Menu = lazy(() => import('./screens/Menu'))
const Purchase = lazy(() => import('./screens/Purchase'))
const Store = lazy(() => import('./screens/Store'))
const Kitchen = lazy(() => import('./screens/Kitchen'))
const Sales = lazy(() => import('./screens/Sales'))
const Eod = lazy(() => import('./screens/Eod'))
const Reports = lazy(() => import('./screens/Reports'))
const Setup = lazy(() => import('./screens/Setup'))
const ChefApp = lazy(() => import('./screens/roles/ChefApp'))
const StoreApp = lazy(() => import('./screens/roles/StoreApp'))
const PurchaseApp = lazy(() => import('./screens/roles/PurchaseApp'))
const ChefRoutes = lazy(() => import('./screens/roles/ChefApp').then((m) => ({ default: m.ChefRoutes })))
const ReceiveRoutes = lazy(() => import('./screens/roles/StoreApp').then((m) => ({ default: m.ReceiveRoutes })))
const StoreCount = lazy(() => import('./screens/roles/StoreApp').then((m) => ({ default: m.StoreCount })))
const PurchaseRoutes = lazy(() => import('./screens/roles/PurchaseApp').then((m) => ({ default: m.PurchaseRoutes })))

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

/**
 * Who you are decides what you get. A chef gets three buttons; a store
 * manager gets two; the purchase manager gets ordering. Managers, owners and
 * accounts get the whole system — including every staff screen, so they can
 * step in and do the job when someone is off.
 */
export default function App() {
  const { ready, status, user } = useLedger()
  if (!ready) return <Loading label={status} />
  if (!user) return <Lock />

  if (user.role === 'CHEF' || user.role === 'HEAD_CHEF') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/chef/*" element={<ChefApp />} />
            <Route path="*" element={<Navigate to="/chef/take" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    )
  }
  if (user.role === 'STORE') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/*" element={<StoreApp />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    )
  }
  if (user.role === 'PURCHASE') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/buy/*" element={<PurchaseApp />} />
            <Route path="*" element={<Navigate to="/buy" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    )
  }
  if (!isAdminRole(user.role)) return <Lock />

  return (
    <Layout>
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/menu/*" element={<Menu />} />
            <Route path="/purchase/*" element={<Purchase />} />
            <Route path="/store/*" element={<Store />} />
            <Route path="/kitchen/*" element={<Kitchen />} />
            <Route path="/sales/*" element={<Sales />} />
            <Route path="/eod/*" element={<Eod />} />
            <Route path="/reports/*" element={<Reports />} />
            <Route path="/setup/*" element={<Setup />} />
            {/* The staff screens, inside the full layout, for when a manager covers a shift. */}
            <Route path="/chef/*" element={<ChefRoutes />} />
            <Route path="/receive/*" element={<ReceiveRoutes />} />
            <Route path="/store-count" element={<StoreCount />} />
            <Route path="/buy/*" element={<PurchaseRoutes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  )
}
