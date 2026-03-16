import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Apply saved theme before first render to avoid flash
try {
  const s = JSON.parse(localStorage.getItem('pxadmin_settings') || '{}')
  if (s.accent) {
    const hex = s.accent
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
    const root = document.documentElement.style
    root.setProperty('--accent', hex)
    root.setProperty('--accent-dim',  `rgba(${r},${g},${b},0.12)`)
    root.setProperty('--accent-dim2', `rgba(${r},${g},${b},0.22)`)
  }
  if (s.fontSize) {
    document.documentElement.style.setProperty('--ui-font-size', `${s.fontSize}px`)
  }
} catch {}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
