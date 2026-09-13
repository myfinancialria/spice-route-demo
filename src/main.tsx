import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { LedgerProvider } from './data/store'
import { ToastProvider } from './components/ui'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Hash routing so deep links survive GitHub Pages, which has no rewrite rules. */}
    <HashRouter>
      <ToastProvider>
        <LedgerProvider>
          <App />
        </LedgerProvider>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>,
)
