import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { firebaseConfigError } from './firebase.js'
import App from './App.jsx'
import './index.css'

// Installable shell cache only — Firebase Auth/Firestore stay NetworkOnly in the SW.
registerSW({ immediate: true })

const root = document.getElementById('root')

if (firebaseConfigError) {
  root.innerHTML = `
    <div style="min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:2rem;text-align:center;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif">
      <h1 style="margin:0;font-size:1.5rem;letter-spacing:-0.04em;text-transform:uppercase">Config missing</h1>
      <p style="margin:0;max-width:28rem;color:rgba(255,255,255,0.65);font-size:0.875rem;line-height:1.5">${firebaseConfigError}</p>
    </div>
  `
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
