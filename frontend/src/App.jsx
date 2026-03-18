import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Server, Plus, Trash2, RefreshCw, Terminal, Power, RotateCcw as RotateCcwIcon,
  Square, Play, ChevronDown, ChevronRight, Cpu, MemoryStick, HardDrive,
  Wifi, WifiOff, AlertCircle, CheckCircle, Clock, Settings, X, Eye,
  EyeOff, Zap, Monitor, Box, Activity, ExternalLink, Loader, Search, Tag, LogOut,
  Shield, Palette, Wrench, ChevronLeft, Save, Key, RefreshCw as Reset,
  PackageCheck, Calendar, Home, Link, Unlink
} from 'lucide-react'

// ── API helpers ──────────────────────────────────────────────────────────────

const api = {
  get: (url) => fetch(url).then(r => r.json()),
  post: (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  del: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
  cancel: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
}

// ── Theme / Settings ─────────────────────────────────────────────────────────

const ACCENT_PRESETS = [
  { name: 'Teal',   value: '#00d4aa' },
  { name: 'Blue',   value: '#4d9fff' },
  { name: 'Purple', value: '#b57bff' },
  { name: 'Amber',  value: '#ffb347' },
  { name: 'Red',    value: '#ff5555' },
  { name: 'Green',  value: '#50fa7b' },
]

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `${r},${g},${b}`
}

function applyTheme(settings) {
  const r = document.documentElement.style
  const accent = settings.accent || '#00d4aa'
  const rgb = hexToRgb(accent)
  r.setProperty('--accent', accent)
  r.setProperty('--accent-dim',  `rgba(${rgb},0.12)`)
  r.setProperty('--accent-dim2', `rgba(${rgb},0.22)`)
  const fs = settings.fontSize || 14
  // Set the CSS variable — body and inputs inherit from it via index.css
  r.setProperty('--ui-font-size', `${fs}px`)
}

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('pxadmin_settings') || '{}') } catch { return {} }
}

function saveSettings(s) {
  localStorage.setItem('pxadmin_settings', JSON.stringify(s))
  applyTheme(s)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

function fmtUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function pct(used, total) {
  if (!total) return 0
  return Math.round((used / total) * 100)
}

function statusColor(status) {
  switch (status) {
    case 'running': return 'var(--green)'
    case 'stopped': return 'var(--red)'
    case 'paused': case 'suspended': return 'var(--amber)'
    default: return 'var(--text3)'
  }
}

function statusBg(status) {
  switch (status) {
    case 'running': return 'var(--green-dim)'
    case 'stopped': return 'var(--red-dim)'
    case 'paused': case 'suspended': return 'var(--amber-dim)'
    default: return 'var(--bg3)'
  }
}

// Termius deep link: termius://app/host/{host}
// Falls back to ssh:// which Termius also intercepts
function termiusLink(ip, user, port) {
  return `ssh://${user}@${ip}:${port}`
}

// ── Mini components ──────────────────────────────────────────────────────────

function Pill({ status }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 20,
      background: statusBg(status),
      color: statusColor(status),
      fontSize: 'var(--fs-xs)', fontWeight: 500, fontFamily: 'var(--font-mono)',
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor(status), flexShrink: 0 }} />
      {status}
    </span>
  )
}

function Bar({ value, max, color = 'var(--accent)' }) {
  const p = pct(value, max)
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--bg3)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${p}%`, borderRadius: 2,
          background: p > 85 ? 'var(--red)' : p > 65 ? 'var(--amber)' : color,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

function Btn({ children, onClick, variant = 'default', size = 'sm', loading, disabled, title }) {
  const styles = {
    default: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)' },
    accent: { background: 'var(--accent-dim2)', color: 'var(--accent)', border: '1px solid rgba(0,212,170,0.3)' },
    danger: { background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(255,85,85,0.3)' },
    ghost: { background: 'transparent', color: 'var(--text2)', border: '1px solid transparent' },
    blue: { background: 'var(--blue-dim)', color: 'var(--blue)', border: '1px solid rgba(77,159,255,0.3)' },
  }
  const pad = size === 'xs' ? '4px 8px' : size === 'sm' ? '6px 12px' : '9px 18px'
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      style={{
        ...styles[variant],
        padding: pad,
        borderRadius: 'var(--radius)',
        fontSize: size === 'xs' ? 'var(--fs-xs)' : 'var(--fs-sm)',
        fontWeight: 500,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {loading && <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />}
      {children}
    </button>
  )
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="px-modal-wrap" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div className="px-modal-box" style={{
        background: 'var(--bg1)', border: '1px solid var(--border-hi)',
        borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 520,
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column',
        maxHeight: 'calc(100vh - 48px)',
      }}>
        {/* Title bar — always visible */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>{title}</span>
          <Btn variant="ghost" size="xs" onClick={onClose}><X size={16} /></Btn>
        </div>
        {/* Scrollable body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>{children}</div>
        {/* Optional sticky footer */}
        {footer && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add Host Form ────────────────────────────────────────────────────────────

function AddHostModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', ip: '', port: '8006', username: 'root@pam', password: '', sshPort: '22', sshUser: 'root' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit() {
    setLoading(true); setErr('')
    const res = await api.post('/api/hosts', { ...form, port: +form.port, sshPort: +form.sshPort })
    setLoading(false)
    if (res.ok) { onAdded(); onClose() }
    else setErr(res.error || 'Failed to add host')
  }

  const field = (label, key, type = 'text', placeholder = '') => (
    <div style={{ marginBottom: 14 }}>
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input type={type === 'password' ? (showPw ? 'text' : 'password') : type}
          value={form[key]} onChange={set(key)} placeholder={placeholder} />
        {type === 'password' && (
          <button onClick={() => setShowPw(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--text3)', cursor: 'pointer' }}>
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  )

  return (
    <Modal title="Add Proxmox Host" onClose={onClose}>
      {field('Host Name', 'name', 'text', 'e.g. homelab-pve')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12, marginBottom: 14 }}>
        <div><label>IP Address</label><input value={form.ip} onChange={set('ip')} placeholder="192.168.1.100" /></div>
        <div><label>API Port</label><input value={form.port} onChange={set('port')} /></div>
      </div>
      {field('Username', 'username', 'text', 'root@pam')}
      {field('Password / API Token', 'password', 'password')}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4, marginBottom: 14 }}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>SSH / Termius Settings</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
          <div><label>SSH User</label><input value={form.sshUser} onChange={set('sshUser')} placeholder="root" /></div>
          <div><label>SSH Port</label><input value={form.sshPort} onChange={set('sshPort')} /></div>
        </div>
      </div>
      {err && <div style={{ color: 'var(--red)', fontSize: 'var(--fs-xs)', marginBottom: 12, padding: '8px 12px', background: 'var(--red-dim)', borderRadius: 'var(--radius)' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="accent" onClick={submit} loading={loading}><Plus size={14} /> Add Host</Btn>
      </div>
    </Modal>
  )
}


// ── Exec / Updates Modal ──────────────────────────────────────────────────────

function useExecJob(hostId, guest) {
  const [lines, setLines] = useState([])
  const [status, setStatus] = useState('idle')
  const [exitCode, setExitCode] = useState(null)
  const jobIdRef = useRef(null)   // ref so closures always see latest value
  const wsRef = useRef(null)
  const autoScrollRef = useRef(true)
  const outputRef = useRef(null)

  useEffect(() => {
    const el = outputRef.current
    if (!el || !autoScrollRef.current) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  function onScroll() {
    const el = outputRef.current
    if (!el) return
    autoScrollRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 32
  }

  function connectWs(jId) {
    wsRef.current?.close()
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`)
    wsRef.current = ws
    autoScrollRef.current = true

    ws.onopen = () => ws.send(JSON.stringify({ subscribe: jId }))

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'replay') {
        // Backend sends full job state — use it directly, don't assume running
        setLines(msg.lines || [])
        setStatus(msg.status === 'done' ? 'done' : 'running')
        setExitCode(msg.exitCode ?? null)
        // If already done, close WS — nothing more is coming
        if (msg.status === 'done') ws.close()
      } else if (msg.type === 'line' || msg.type === 'stderr' || msg.type === 'error') {
        setLines(prev => [...prev, { t: msg.type, v: msg.line }])
      } else if (msg.type === 'done') {
        setStatus('done')
        setExitCode(msg.exitCode)
        ws.close()
      }
    }

    ws.onerror = () => setLines(prev => [...prev, { t: 'error', v: 'WebSocket error' }])
    ws.onclose = () => {}
  }

  // Returns jobId so callers can track it without relying on state timing
  async function run(command, onStarted) {
    wsRef.current?.close()
    setLines([])
    setStatus('running')
    setExitCode(null)
    autoScrollRef.current = true

    const res = await fetch(`/api/hosts/${hostId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: guest.node, vmid: guest.vmid, command }),
    }).then(r => r.json())

    if (!res.ok) {
      setLines([{ t: 'error', v: res.error || 'Failed to start job' }])
      setStatus('done')
      return null
    }

    jobIdRef.current = res.jobId
    if (onStarted) onStarted(res.jobId)
    connectWs(res.jobId)
    return res.jobId
  }

  function reconnect(jId) {
    jobIdRef.current = jId
    setLines([])
    setExitCode(null)
    // Don't pre-set status — let the replay message set it correctly
    setStatus('running')
    connectWs(jId)
  }

  useEffect(() => () => wsRef.current?.close(), [])

  return { lines, status, exitCode, run, reconnect, outputRef, onScroll }
}

function UpdatesModal({ guest, hostId, onClose, activeJob, onJobStart }) {
  const exec = useExecJob(hostId, guest)

  const upgradable = exec.lines
    .filter(l => l.v && l.v.includes('upgradable'))
    .map(l => l.v.split('/')[0].trim())
    .filter(Boolean)

  const busy = exec.status === 'running'

  useEffect(() => {
    if (activeJob) {
      exec.reconnect(activeJob)
    } else {
      exec.run('apt-check', onJobStart)
    }
  }, [])

  function startCommand(command) {
    exec.run(command, onJobStart)
  }

  const lineColor = { line: 'var(--text2)', stderr: 'var(--amber)', error: 'var(--red)' }

  return (
    <Modal title={`Updates — ${guest.name || guest.vmid}`} onClose={() => onClose(exec.status === 'done')}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" size="xs" onClick={() => startCommand('apt-check')} disabled={busy}>
            <RefreshCw size={12} /> Refresh
          </Btn>
          {upgradable.length > 0 && exec.status === 'done' && (
            <Btn variant="accent" size="xs" onClick={() => startCommand('apt-upgrade')} disabled={busy}>
              <Zap size={12} /> Upgrade All
            </Btn>
          )}
          <Btn variant="ghost" size="xs" onClick={() => startCommand('apt-autoremove')} disabled={busy}>
            <Trash2 size={12} /> Autoremove
          </Btn>
        </div>
      }
    >
      {exec.status === 'done' && (
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          {upgradable.length > 0 ? (
            <span style={{ padding: '4px 12px', borderRadius: 20, background: 'var(--amber-dim)', color: 'var(--amber)', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
              {upgradable.length} package{upgradable.length !== 1 ? 's' : ''} upgradable
            </span>
          ) : (
            <span style={{ padding: '4px 12px', borderRadius: 20, background: 'var(--green-dim)', color: 'var(--green)', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
              Up to date
            </span>
          )}
          {exec.exitCode !== 0 && exec.exitCode !== null && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--red)' }}>exit {exec.exitCode}</span>
          )}
        </div>
      )}

      {upgradable.length > 0 && exec.status === 'done' && (
        <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {upgradable.map(pkg => (
            <span key={pkg} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', padding: '2px 8px', background: 'var(--bg3)', borderRadius: 4, color: 'var(--text2)' }}>
              {pkg}
            </span>
          ))}
        </div>
      )}

      {/* Terminal output */}
      <div
        ref={exec.outputRef}
        onScroll={exec.onScroll}
        style={{
          background: 'var(--bg0)', borderRadius: 'var(--radius)',
          border: `1px solid ${exec.status === 'done' ? (exec.exitCode === 0 ? 'rgba(80,250,123,0.3)' : 'rgba(255,85,85,0.3)') : 'var(--border)'}`,
          padding: 12, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
          height: 260, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          lineHeight: 1.7, transition: 'border-color 0.3s',
        }}
      >
        {busy && exec.lines.length === 0 && (
          <span style={{ color: 'var(--accent)' }}>Connecting...</span>
        )}
        {exec.lines.map((l, i) => (
          <div key={i} style={{ color: lineColor[l.t] || 'var(--text2)' }}>{l.v}</div>
        ))}
        {busy && (
          <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> running
          </span>
        )}
        {exec.status === 'done' && (
          <div style={{
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${exec.exitCode === 0 ? 'rgba(80,250,123,0.2)' : 'rgba(255,85,85,0.2)'}`,
            color: exec.exitCode === 0 ? 'var(--green)' : 'var(--red)',
            display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600,
          }}>
            {exec.exitCode === 0
              ? <><CheckCircle size={13} /> Done</>
              : <><AlertCircle size={13} /> Finished with errors (exit {exec.exitCode})</>
            }
          </div>
        )}
      </div>

    </Modal>
  )
}


// ── Port Scanner Modal ────────────────────────────────────────────────────────

function parseSSOutput(lines) {
  // ss -tlnp output:
  // State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
  // LISTEN 0      128    0.0.0.0:22          0.0.0.0:*         users:(("sshd",pid=123,fd=3))
  const portMap = new Map() // port -> entry (deduplicate)

  for (const line of lines) {
    if (!line.startsWith('LISTEN')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 5) continue
    const localAddr = parts[3] || ''
    const colonIdx = localAddr.lastIndexOf(':')
    if (colonIdx === -1) continue
    const addr = localAddr.slice(0, colonIdx)
    const port = localAddr.slice(colonIdx + 1)
    if (!port || isNaN(parseInt(port))) continue

    const portNum = parseInt(port)
    const isWildcard = addr === '0.0.0.0' || addr === '[::]' || addr === '::' || addr === '*'
    const isLoopback = addr === '127.0.0.1' || addr === '[::1]' || addr === '::1'

    // Extract process name
    const processRaw = parts.slice(5).join(' ')
    const procMatch = processRaw.match(/\(\("([^"]+)"/)
    const process = procMatch ? procMatch[1] : '—'

    const existing = portMap.get(portNum)
    if (!existing) {
      const display = isWildcard ? 'all' : isLoopback ? 'localhost' : addr
      portMap.set(portNum, { port: portNum, addr: display, process, wildcardSeen: isWildcard })
    } else {
      // If we see a wildcard version, upgrade to 'all'
      if (isWildcard) portMap.set(portNum, { ...existing, addr: 'all', wildcardSeen: true })
    }
  }

  return [...portMap.values()].sort((a, b) => a.port - b.port)
}

// Known port → service name map
const KNOWN_PORTS = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 465: 'SMTPS',
  587: 'SMTP', 993: 'IMAPS', 995: 'POP3S', 1883: 'MQTT', 2375: 'Docker',
  2376: 'Docker TLS', 3000: 'Web App', 3001: 'Web App', 3306: 'MySQL',
  5432: 'PostgreSQL', 5672: 'AMQP', 6379: 'Redis', 6881: 'BitTorrent',
  8006: 'Proxmox', 8080: 'HTTP Alt', 8443: 'HTTPS Alt', 8888: 'Jupyter',
  9000: 'Web App', 9090: 'Prometheus', 9100: 'Node Exporter',
  2283: 'Immich', 2342: 'PhotoPrism', 8096: 'Jellyfin', 8920: 'Jellyfin (HTTPS)',
  27017: 'MongoDB', 32400: 'Plex', 51413: 'BitTorrent',
}

function PortsModal({ guest, hostId, onClose }) {
  const [lines, setLines] = useState([])
  const [status, setStatus] = useState('running')
  const [ports, setPorts] = useState([])
  const wsRef = useRef(null)

  useEffect(() => {
    fetch(`/api/hosts/${hostId}/portscan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: guest.node, vmid: guest.vmid, type: guest.type }),
    }).then(r => r.json()).then(res => {
      if (!res.ok) { setLines([{ t: 'error', v: res.error }]); setStatus('done'); return }
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => ws.send(JSON.stringify({ subscribe: res.jobId }))
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'replay') {
          setLines(msg.lines || [])
          if (msg.status === 'done') setStatus('done')
        } else if (msg.type === 'line' || msg.type === 'stderr' || msg.type === 'error') {
          setLines(prev => [...prev, { t: msg.type, v: msg.line }])
        } else if (msg.type === 'done') {
          setStatus('done'); ws.close()
        }
      }
      ws.onerror = () => { setLines(prev => [...prev, { t: 'error', v: 'WebSocket error' }]); setStatus('done') }
    })
    return () => wsRef.current?.close()
  }, [])


  // Parse ports whenever lines update
  useEffect(() => {
    if (lines.length > 0) setPorts(parseSSOutput(lines.map(l => l.v)))
  }, [lines])

  const busy = status === 'running'
  const errors = lines.filter(l => l.t === 'error')

  return (
    <Modal title={`Open Ports — ${guest.name || guest.vmid}`} onClose={onClose}>
      {busy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text3)', fontSize: 'var(--fs-sm)', marginBottom: 16 }}>
          <Loader size={13} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
          Scanning...
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--red-dim)', borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 'var(--fs-xs)' }}>
          {errors.map((e, i) => <div key={i}>{e.v}</div>)}
        </div>
      )}

      {!busy && ports.length === 0 && errors.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text3)', fontSize: 'var(--fs-sm)' }}>
          No listening ports found
        </div>
      )}

      {ports.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Port', 'Service', 'Process', 'Address'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 12px', color: 'var(--text3)', fontSize: 'var(--fs-xs)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ports.map((p, i) => {
                const service = KNOWN_PORTS[p.port]
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent)' }}>{p.port}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {service
                        ? <span style={{ padding: '2px 8px', borderRadius: 20, background: 'var(--blue-dim)', color: 'var(--blue)', fontSize: 'var(--fs-xs)', fontWeight: 500 }}>{service}</span>
                        : <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text2)', fontSize: 'var(--fs-xs)' }}>{p.process}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text3)', fontSize: 'var(--fs-xs)' }}>{p.addr}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
          {ports.length > 0 ? `${ports.length} port${ports.length !== 1 ? 's' : ''} listening` : ''}
        </span>
        <Btn variant="ghost" size="xs" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  )
}

// ── VM / LXC Card ────────────────────────────────────────────────────────────

function GuestCard({ guest, hostId, onAction, updatePending }) {
  const [expanded, setExpanded] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [showUpdates, setShowUpdates] = useState(false)
  const [activeJobId, setActiveJobId] = useState(null)
  const [showPorts, setShowPorts] = useState(false)

  const isVM = guest.type === 'vm'
  const running = guest.status === 'running'

  async function doAction(action) {
    setActionLoading(action)
    await onAction(hostId, guest.node, guest.vmid, guest.type, action)
    setActionLoading(null)
  }

  const cpuPct = Math.round((guest.cpu || 0) * 100)
  const memPct = pct(guest.mem, guest.maxmem)
  const diskPct = pct(guest.disk, guest.maxdisk)

  // Use guest's own IP if we got it from the agent, fall back to Proxmox host IP
  const sshIp = guest.guestIp || guest.hostIp
  const sshLink = termiusLink(sshIp, guest.sshUser || 'root', guest.sshPort || 22)
  const sshLabel = guest.guestIp ? guest.guestIp : `via host`

  return (
    <div style={{
      background: 'var(--bg1)',
      border: `1px solid ${updatePending ? 'rgba(255,179,71,0.3)' : running ? 'rgba(80,250,123,0.15)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>

      {/* Row 1 — icon + name + status (clickable to expand) */}
      <div
        style={{ padding: '12px 16px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isVM ? 'var(--blue-dim)' : 'var(--purple-dim)',
            color: isVM ? 'var(--blue)' : 'var(--purple)',
          }}>
            <GuestIcon name={guest.name} type={guest.type} size={20} hostId={guest.hostId} vmid={guest.vmid} />
          </div>
          {updatePending && (
            <span style={{
              position: 'absolute', top: -3, right: -3,
              width: 10, height: 10, borderRadius: '50%',
              background: 'var(--amber)', border: '2px solid var(--bg1)',
            }} title="Updates available" />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', fontFamily: 'var(--font-mono)' }}>
              {guest.name || `${isVM ? 'vm' : 'ct'}-${guest.vmid}`}
            </span>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>#{guest.vmid}</span>
            <Pill status={guest.status} />
            <span style={{ fontSize: 'var(--fs-xs)', background: isVM ? 'var(--blue-dim)' : 'var(--purple-dim)', padding: '2px 7px', borderRadius: 10, color: isVM ? 'var(--blue)' : 'var(--purple)' }}>
              {isVM ? 'VM' : 'LXC'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            {running && (
              <>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                  CPU <span style={{ color: cpuPct > 80 ? 'var(--red)' : 'var(--text2)' }}>{cpuPct}%</span>
                </span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                  RAM <span style={{ color: memPct > 80 ? 'var(--red)' : 'var(--text2)' }}>{memPct}%</span>
                </span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>Up {fmtUptime(guest.uptime)}</span>
              </>
            )}
            {!running && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>{fmtBytes(guest.maxmem)} RAM · {fmtBytes(guest.maxdisk)} disk</span>}
          </div>
        </div>

        {/* Expand chevron — far right */}
        <span style={{ color: 'var(--text3)', display: 'flex', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>

      {/* Row 2 — action buttons toolbar */}
      <div
        style={{ padding: '6px 12px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* SSH */}
        <a href={sshLink} title={`SSH: ${guest.sshUser || 'root'}@${sshIp}:${guest.sshPort || 22}`}
          style={{ textDecoration: 'none', display: 'inline-flex' }}>
          <Btn variant={guest.guestIp ? "blue" : "ghost"} size="xs">
            <Terminal size={12} /> {sshLabel}
          </Btn>
        </a>
        {/* Updates — LXC only */}
        {!isVM && (
          <Btn variant={activeJobId ? "accent" : "ghost"} size="xs" onClick={() => setShowUpdates(true)} title="Check for apt updates">
            <RefreshCw size={12} style={{ animation: activeJobId ? 'spin 1.5s linear infinite' : 'none' }} />
            {activeJobId ? 'Running...' : 'Updates'}
          </Btn>
        )}
        {/* Ports */}
        <Btn variant="ghost" size="xs" onClick={() => setShowPorts(true)} title="Scan open ports">
          <Wifi size={12} /> Ports
        </Btn>

        <div style={{ flex: 1 }} />

        {/* Power actions — pushed to the right */}
        {running ? (
          <>
            <Btn variant="ghost" size="xs" onClick={() => doAction('reboot')} loading={actionLoading === 'reboot'} title="Reboot">
              <RotateCcwIcon size={12} />
            </Btn>
            <Btn variant="ghost" size="xs" onClick={() => doAction('shutdown')} loading={actionLoading === 'shutdown'} title="Shutdown">
              <Power size={12} />
            </Btn>
            <Btn variant="danger" size="xs" onClick={() => doAction('stop')} loading={actionLoading === 'stop'} title="Force stop">
              <Square size={12} />
            </Btn>
          </>
        ) : (
          <Btn variant="accent" size="xs" onClick={() => doAction('start')} loading={actionLoading === 'start'} title="Start">
            <Play size={12} />
          </Btn>
        )}
      </div>

      {/* Updates modal */}
      {showPorts && <PortsModal guest={guest} hostId={hostId} onClose={() => setShowPorts(false)} />}
      {showUpdates && <UpdatesModal guest={guest} hostId={hostId}
        onClose={(jobDone) => { setShowUpdates(false); if (jobDone) setActiveJobId(null) }}
        activeJob={activeJobId}
        onJobStart={(jId) => setActiveJobId(jId)} />}

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>CPU</span><span style={{ color: 'var(--text2)' }}>{cpuPct}% of {guest.cpus || 1} core{guest.cpus > 1 ? 's' : ''}</span>
              </div>
              <Bar value={guest.cpu || 0} max={1} color="var(--blue)" />
            </div>
            <div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Memory</span><span style={{ color: 'var(--text2)' }}>{fmtBytes(guest.mem)} / {fmtBytes(guest.maxmem)}</span>
              </div>
              <Bar value={guest.mem} max={guest.maxmem} color="var(--purple)" />
            </div>
            <div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Disk</span><span style={{ color: 'var(--text2)' }}>{fmtBytes(guest.disk)} / {fmtBytes(guest.maxdisk)}</span>
              </div>
              <Bar value={guest.disk} max={guest.maxdisk} color="var(--amber)" />
            </div>
            <div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Net I/O</span><span style={{ color: 'var(--text2)' }}>↑{fmtBytes(guest.netout || 0)} ↓{fmtBytes(guest.netin || 0)}</span>
              </div>
              <Bar value={0} max={1} color="var(--green)" />
            </div>
          </div>

          <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text2)', display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
            <span>Node: <span style={{ color: 'var(--accent)' }}>{guest.node}</span></span>
            <span>Host: <span style={{ color: 'var(--accent)' }}>{guest.hostName}</span></span>
            <span>SSH: <span style={{ color: 'var(--accent)' }}>{guest.sshUser || 'root'}@{sshIp}:{guest.sshPort || 22}</span>
              {!guest.guestIp && <span style={{ color: 'var(--amber)', marginLeft: 6, fontSize: 'var(--fs-xs)' }}>no guest IP (via host)</span>}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Node section ─────────────────────────────────────────────────────────────

// ── Tag grouping & sorting helpers ──────────────────────────────────────────

function parseTags(guest) {
  if (!guest.tags) return []
  return guest.tags.split(';').map(t => t.trim()).filter(Boolean)
}

function sortGuests(guests) {
  return [...guests].sort((a, b) => {
    // Running first
    const aRun = a.status === 'running' ? 0 : 1
    const bRun = b.status === 'running' ? 0 : 1
    if (aRun !== bRun) return aRun - bRun
    // Then alphabetical by name
    return (a.name || '').localeCompare(b.name || '')
  })
}

function groupByTags(guests) {
  const groups = new Map()  // tag -> guests[]
  const untagged = []

  for (const guest of guests) {
    const tags = parseTags(guest)
    if (tags.length === 0) {
      untagged.push(guest)
    } else {
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, [])
        groups.get(tag).push(guest)
      }
    }
  }

  const result = []
  // Sorted tag groups first
  for (const [tag, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    result.push({ tag, guests: sortGuests(members) })
  }
  // Untagged at the end
  if (untagged.length > 0) result.push({ tag: null, guests: sortGuests(untagged) })
  return result
}

// Tag colour — deterministic from string
const TAG_COLOURS = [
  ['rgba(0,212,170,0.15)', 'var(--accent)'],
  ['rgba(77,159,255,0.15)', 'var(--blue)'],
  ['rgba(181,123,255,0.15)', 'var(--purple)'],
  ['rgba(255,179,71,0.15)', 'var(--amber)'],
  ['rgba(255,85,85,0.15)', 'var(--red)'],
  ['rgba(80,250,123,0.15)', 'var(--green)'],
]
function tagColour(tag) {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffffffff
  return TAG_COLOURS[Math.abs(h) % TAG_COLOURS.length]
}

// ── Tag Group ────────────────────────────────────────────────────────────────

function TagGroup({ tag, guests, hostId, onAction, hideHeader, collapseAll, updateVmids }) {
  const [collapsed, setCollapsed] = useState(true)

  // Sync with external collapse/expand all — only when prop changes
  useEffect(() => {
    if (collapseAll === true)  setCollapsed(true)
    if (collapseAll === false) setCollapsed(false)
  }, [collapseAll])
  const [showStopped, setShowStopped] = useState(false)

  const [bgCol, fgCol] = tag ? tagColour(tag) : ['transparent', 'var(--text3)']
  const runningGuests = guests.filter(g => g.status === 'running')
  const stoppedGuests = guests.filter(g => g.status !== 'running')
  const visibleGuests = showStopped ? guests : runningGuests

  return (
    <div>
      {/* Group header */}
      {!hideHeader && (
        <div
          onClick={() => setCollapsed(c => !c)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : 8,
            cursor: 'pointer', userSelect: 'none', padding: '3px 2px',
          }}
        >
          {/* Collapse chevron */}
          <span style={{ color: 'var(--text3)', display: 'flex', transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <ChevronDown size={13} />
          </span>

          {/* Tag pill or "untagged" label */}
          {tag ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20,
              background: bgCol, color: fgCol,
              fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 0.4,
              border: `1px solid ${fgCol}33`,
            }}>
              <Tag size={10} /> {tag}
            </span>
          ) : (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', letterSpacing: 0.4 }}>untagged</span>
          )}

          {/* Running count */}
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
            {runningGuests.length}/{guests.length} running
          </span>

          <div style={{ flex: 1 }} />

          {/* Show stopped toggle — only show if there are stopped guests */}
          {stoppedGuests.length > 0 && !collapsed && (
            <span
              onClick={e => { e.stopPropagation(); setShowStopped(s => !s) }}
              style={{
                fontSize: 'var(--fs-xs)', fontWeight: 500, padding: '2px 9px', borderRadius: 20, cursor: 'pointer',
                background: showStopped ? 'var(--bg3)' : 'transparent',
                color: showStopped ? 'var(--text2)' : 'var(--text3)',
                border: '1px solid var(--border)',
                transition: 'all 0.15s',
              }}
            >
              {showStopped ? `hide stopped` : `+${stoppedGuests.length} stopped`}
            </span>
          )}
        </div>
      )}

      {/* When header is hidden (single untagged), show stopped toggle inline */}
      {hideHeader && stoppedGuests.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <span
            onClick={() => setShowStopped(s => !s)}
            style={{
              fontSize: 'var(--fs-xs)', fontWeight: 500, padding: '2px 9px', borderRadius: 20, cursor: 'pointer',
              background: showStopped ? 'var(--bg3)' : 'transparent',
              color: showStopped ? 'var(--text2)' : 'var(--text3)',
              border: '1px solid var(--border)',
            }}
          >
            {showStopped ? `hide stopped` : `+${stoppedGuests.length} stopped`}
          </span>
        </div>
      )}

      {/* Cards */}
      {!collapsed && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          paddingLeft: (tag && !hideHeader) ? 4 : 0,
          borderLeft: (tag && !hideHeader) ? `2px solid ${fgCol}33` : 'none',
          marginLeft: (tag && !hideHeader) ? 6 : 0,
        }}>
          {visibleGuests.length === 0 && stoppedGuests.length > 0 && (
            <div
              onClick={() => setShowStopped(true)}
              style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', padding: '8px 12px', cursor: 'pointer',
                background: 'var(--bg2)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)',
                textAlign: 'center',
              }}
            >
              {stoppedGuests.length} stopped — click to show
            </div>
          )}
          {visibleGuests.map(g => (
            <GuestCard key={`${g.type}-${g.vmid}`} guest={g} hostId={hostId} onAction={onAction} updatePending={updateVmids?.has(String(g.vmid))} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Node section ──────────────────────────────────────────────────────────────

function NodeSection({ nodeData, hostId, onAction, filter, search, collapseAll, updateCache }) {
  const ns = nodeData.nodeStatus || {}
  const cpuPct = ns.cpu ? Math.round(ns.cpu * 100) : 0
  const memPct = pct(ns.memory?.used, ns.memory?.total)
  const allGuests = [...(nodeData.vms || []), ...(nodeData.lxcs || [])]
  const running = allGuests.filter(g => g.status === 'running').length

  // Build set of vmids with pending updates for fast lookup
  const updateVmids = new Set((updateCache?.containers || []).filter(c => c.hasUpdates).map(c => String(c.vmid)))

  // Apply type filter (updates filter shows only LXCs with pending updates)
  const typeFiltered = filter === 'updates'
    ? allGuests.filter(g => g.type === 'lxc' && updateVmids.has(String(g.vmid)))
    : filter === 'all' ? allGuests : allGuests.filter(g => g.type === filter)

  // Apply search filter
  const q = search.trim().toLowerCase()
  const searched = q
    ? typeFiltered.filter(g => (g.name || '').toLowerCase().includes(q) || String(g.vmid).includes(q))
    : typeFiltered

  if (searched.length === 0) return null

  const groups = groupByTags(searched)
  const singleUntaggedGroup = groups.length === 1 && groups[0].tag === null

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Node header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
        <Server size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{nodeData.node}</span>
        <Pill status={nodeData.status} />
        <div style={{ flex: 1 }} />
        <div className="px-node-stats" style={{ display: 'flex', gap: 12 }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>CPU <span style={{ color: 'var(--text2)' }}>{cpuPct}%</span></span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>RAM <span style={{ color: 'var(--text2)' }}>{memPct}%</span></span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>{running}/{allGuests.length} running</span>
        </div>
      </div>

      {/* Tag groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map(({ tag, guests }) => (
          <TagGroup
            key={tag || '__untagged__'}
            tag={tag}
            guests={guests}
            hostId={hostId}
            onAction={onAction}
            hideHeader={singleUntaggedGroup}
            collapseAll={collapseAll}
            updateVmids={updateVmids}
          />
        ))}
      </div>
    </div>
  )
}


// ── Delete Host Modal ─────────────────────────────────────────────────────────

function DeleteHostModal({ host, onClose, onConfirm }) {
  const [typed, setTyped] = useState('')
  const matches = typed.toLowerCase() === host.name.toLowerCase()

  function handleKey(e) { if (e.key === 'Enter' && matches) onConfirm() }

  return (
    <Modal title="Remove host" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 14px', background: 'var(--red-dim)', border: '1px solid rgba(255,85,85,0.25)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertCircle size={15} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--red)' }}>
              This will remove <strong>{host.name}</strong> from the panel. Your Proxmox host itself won't be affected.
            </div>
          </div>
        </div>
        <label>Type <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>{host.name}</span> to confirm</label>
        <input
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={handleKey}
          placeholder={host.name}
          autoFocus
          style={{ borderColor: typed.length > 0 ? (matches ? 'var(--green)' : 'var(--red)') : undefined }}
        />
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" onClick={onConfirm} disabled={!matches}>
          <Trash2 size={13} /> Remove host
        </Btn>
      </div>
    </Modal>
  )
}

// ── Host Panel ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 30000

function HostPanel({ host, onDelete, onAction, filter, search, updateCache }) {
  // Load cached scan data immediately so cards show on mount
  const cached = loadScanCache(host.id)
  const [scanData, setScanData] = useState(cached?.nodes || null)
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(cached?.savedAt ? new Date(cached.savedAt) : null)
  const [collapseAll, setCollapseAll] = useState(null)
  const [showDelete, setShowDelete] = useState(false)
  const intervalRef = useRef(null)
  const hasScanned = useRef(false)

  function triggerCollapse(val) {
    setCollapseAll(val)
    setTimeout(() => setCollapseAll(null), 100)
  }

  async function scan(silent = false) {
    if (!silent) setScanning(true)
    setScanErr('')
    const res = await api.get(`/api/hosts/${host.id}/scan`)
    if (!silent) setScanning(false)
    if (res.ok) {
      pruneScanCache(host.id, res.nodes)  // clear icons for deleted guests
      saveScanCache(host.id, res.nodes)   // persist fresh results
      setScanData(res.nodes)
      setLastRefresh(new Date())
    }
    else if (!silent) setScanErr(res.error || 'Scan failed')
  }

  useEffect(() => {
    if (!hasScanned.current) { hasScanned.current = true; scan() }
    intervalRef.current = setInterval(() => scan(true), REFRESH_INTERVAL)
    return () => clearInterval(intervalRef.current)
  }, [host.id])

  async function testConn() {
    setTesting(true); setTestResult(null)
    const res = await api.post(`/api/hosts/${host.id}/test`)
    setTesting(false)
    setTestResult(res)
  }

  const totalGuests = scanData ? scanData.reduce((a, n) => a + n.vms.length + n.lxcs.length, 0) : 0
  const runningGuests = scanData ? scanData.reduce((a, n) => a + [...n.vms, ...n.lxcs].filter(g => g.status === 'running').length, 0) : 0

  return (
    <div style={{ marginBottom: 32 }}>
      {/* Host header */}
      <div style={{ marginBottom: 16, background: 'var(--bg2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-hi)', overflow: 'hidden' }}>

        {/* Row 1 — host identity + stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: testResult?.ok ? 'var(--green)' : testResult?.error ? 'var(--red)' : 'var(--text3)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{host.name}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
              {host.ip}:{host.port}
              {testResult?.version && <span style={{ color: 'var(--accent)', marginLeft: 8 }}>PVE {testResult.version}</span>}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {scanData && (
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{runningGuests}</span>/{totalGuests} running
              </span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{scanData.length}</span> node{scanData.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Row 2 — collapse/expand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderTop: '1px solid var(--border)' }}>
          <Btn size="xs" variant="ghost" onClick={() => triggerCollapse(false)} title="Expand all groups">
            <ChevronDown size={12} /> Expand all
          </Btn>
          <Btn size="xs" variant="ghost" onClick={() => triggerCollapse(true)} title="Collapse all groups">
            <ChevronRight size={12} /> Collapse all
          </Btn>
        </div>

        {/* Row 3 — scan / test / delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px 10px', borderTop: '1px solid var(--border)' }}>
          <Btn size="xs" variant="ghost" onClick={testConn} loading={testing} title="Test connection">
            <Wifi size={12} /> Test
          </Btn>
          {lastRefresh && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <Btn size="xs" variant="accent" onClick={() => scan(false)} loading={scanning}>
            <RefreshCw size={12} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} /> Scan
          </Btn>
          <Btn size="xs" variant="danger" onClick={() => setShowDelete(true)} title="Remove host">
            <Trash2 size={12} />
          </Btn>
        </div>

      </div>

      {showDelete && (
        <DeleteHostModal
          host={host}
          onClose={() => setShowDelete(false)}
          onConfirm={() => { setShowDelete(false); onDelete(host.id) }}
        />
      )}

      {scanErr && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--red-dim)', border: '1px solid rgba(255,85,85,0.2)', borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 'var(--fs-xs)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertCircle size={14} /> {scanErr}
        </div>
      )}

      {!scanData && !scanErr && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text3)' }}>
          <Server size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
          <p style={{ fontSize: 'var(--fs-sm)' }}>Scanning...</p>
        </div>
      )}

      {scanData && scanData.map(node => (
        <NodeSection key={node.node} nodeData={node} hostId={host.id} onAction={onAction} filter={filter} search={search} collapseAll={collapseAll} updateCache={updateCache} />
      ))}
    </div>
  )
}



// ── Scan result cache ─────────────────────────────────────────────────────────

function loadScanCache(hostId) {
  try { return JSON.parse(localStorage.getItem(`scan:${hostId}`) || 'null') } catch { return null }
}

function saveScanCache(hostId, nodes) {
  try { localStorage.setItem(`scan:${hostId}`, JSON.stringify({ nodes, savedAt: Date.now() })) } catch {}
}

function clearScanCache(hostId) {
  try { localStorage.removeItem(`scan:${hostId}`) } catch {}
}

// Prune VMIDs from cache that no longer appear in fresh scan
function pruneScanCache(hostId, freshNodes) {
  const fresh = new Set()
  for (const node of freshNodes) {
    for (const g of [...(node.vms || []), ...(node.lxcs || [])]) {
      fresh.add(String(g.vmid))
    }
  }
  // Clear icon slugs for deleted guests
  const keys = Object.keys(localStorage)
  for (const key of keys) {
    if (key.startsWith(`icon:${hostId}:`)) {
      const vmid = key.split(':')[2]
      if (vmid && !fresh.has(vmid)) {
        localStorage.removeItem(key)
        console.log(`[cache] cleared icon for deleted guest ${vmid}`)
      }
    }
  }
}

function loadIconCache(hostId, vmid) {
  try { return localStorage.getItem(`icon:${hostId}:${vmid}`) || null } catch { return null }
}

function saveIconCache(hostId, vmid, slug) {
  try { localStorage.setItem(`icon:${hostId}:${vmid}`, slug) } catch {}
}

// ── selfh.st icon lookup ──────────────────────────────────────────────────────

const ICON_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons/webp'

// Map common self-hosted app names → selfh.st icon slug
// Name matching is case-insensitive substring match against guest name
const SELFHST_ICONS = {
  // Media
  'plex': 'plex', 'jellyfin': 'jellyfin', 'emby': 'emby',
  'navidrome': 'navidrome', 'airsonic': 'airsonic',
  // *arr stack
  'sonarr': 'sonarr', 'radarr': 'radarr', 'lidarr': 'lidarr',
  'readarr': 'readarr', 'prowlarr': 'prowlarr', 'bazarr': 'bazarr',
  'whisparr': 'whisparr', 'sabnzbd': 'sabnzbd', 'nzbget': 'nzbget',
  'qbittorrent': 'qbittorrent', 'transmission': 'transmission',
  'deluge': 'deluge', 'rtorrent': 'rtorrent', 'overseerr': 'overseerr',
  'requestrr': 'requestrr', 'ombi': 'ombi',
  // Home automation
  'homeassistant': 'home-assistant', 'home-assistant': 'home-assistant',
  'mosquitto': 'mosquitto', 'mqtt': 'mosquitto',
  'nodered': 'node-red', 'node-red': 'node-red',
  'zigbee2mqtt': 'zigbee2mqtt', 'zwavejs': 'zwave-js',
  'esphome': 'esphome', 'frigate': 'frigate',
  // Networking
  'pihole': 'pi-hole', 'adguard': 'adguard-home',
  'unifi': 'unifi-network', 'nginx': 'nginx-proxy-manager',
  'traefik': 'traefik', 'caddy': 'caddy',
  'wireguard': 'wireguard', 'tailscale': 'tailscale',
  'cloudflared': 'cloudflare', 'cloudflare': 'cloudflare',
  // Dashboards & monitoring
  'grafana': 'grafana', 'prometheus': 'prometheus',
  'portainer': 'portainer', 'dashy': 'dashy',
  'homepage': 'homepage', 'heimdall': 'heimdall',
  'uptime-kuma': 'uptime-kuma', 'uptimekuma': 'uptime-kuma',
  'netdata': 'netdata', 'influxdb': 'influxdb',
  // Comms & social
  'matrix': 'matrix', 'synapse': 'matrix',
  'mastodon': 'mastodon', 'misskey': 'misskey',
  'element': 'element', 'signal': 'signal',
  'ntfy': 'ntfy', 'gotify': 'gotify',
  // Dev & infra
  'gitea': 'gitea', 'gitlab': 'gitlab', 'github': 'github',
  'woodpecker': 'woodpecker-ci', 'drone': 'drone',
  'vaultwarden': 'vaultwarden', 'bitwarden': 'bitwarden',
  'nextcloud': 'nextcloud', 'seafile': 'seafile',
  'syncthing': 'syncthing', 'restic': 'restic',
  // Databases
  'postgres': 'postgresql', 'postgresql': 'postgresql',
  'mysql': 'mysql', 'mariadb': 'mariadb',
  'redis': 'redis', 'mongodb': 'mongodb',
  // Productivity
  'immich': 'immich', 'photoprism': 'photoprism',
  'paperless': 'paperless-ngx', 'bookstack': 'bookstack',
  'wikijs': 'wiki-js', 'wiki': 'wiki-js',
  'freshrss': 'freshrss', 'miniflux': 'miniflux',
  'mealie': 'mealie', 'grocy': 'grocy',
  'n8n': 'n8n', 'activepieces': 'activepieces',
  'openwebui': 'open-webui', 'ollama': 'ollama',
  // Download & files
  'filebrowser': 'file-browser', 'duplicati': 'duplicati',
  'minio': 'minio',
}

function getIconSlug(name) {
  if (!name) return null
  const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [key, slug] of Object.entries(SELFHST_ICONS)) {
    const cleanKey = key.replace(/[^a-z0-9]/g, '')
    if (lower.includes(cleanKey) || cleanKey.includes(lower)) return slug
  }
  return null
}

function GuestIcon({ name, type, size = 15, hostId, vmid }) {
  // Check cache first, then do name lookup
  const cached = hostId && vmid ? loadIconCache(hostId, vmid) : null
  const computed = cached !== null ? (cached || null) : getIconSlug(name)

  // Persist computed slug to cache if not already there
  useEffect(() => {
    if (hostId && vmid && cached === null && computed) {
      saveIconCache(hostId, vmid, computed)
    } else if (hostId && vmid && cached === null && !computed) {
      saveIconCache(hostId, vmid, '') // cache the miss too so we don't re-lookup
    }
  }, [computed])

  const [imgErr, setImgErr] = useState(false)

  if (computed && !imgErr) {
    return (
      <img
        src={`${ICON_BASE}/${computed}.webp`}
        alt={name}
        onError={() => setImgErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 3 }}
      />
    )
  }
  const isVM = type === 'vm'
  return isVM ? <Monitor size={size} /> : <Box size={size} />
}

// ── Auth screens ─────────────────────────────────────────────────────────────

function AuthInput({ label, type = 'text', value, onChange, placeholder, autoFocus, onKeyDown }) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <label>{label}</label>}
      <div style={{ position: 'relative' }}>
        <input
          type={isPassword && !show ? 'password' : 'text'}
          value={value} onChange={onChange} placeholder={placeholder}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          style={{ width: '100%', paddingRight: isPassword ? 36 : 12 }}
        />
        {isPassword && (
          <button onClick={() => setShow(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}

function AuthCard({ children, title, subtitle }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg0)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent-dim2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Activity size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--fs-lg)' }}>proxmox<span style={{ color: 'var(--accent)' }}>.admin</span></div>
          {subtitle && <p style={{ color: 'var(--text3)', fontSize: 'var(--fs-sm)', marginTop: 6 }}>{subtitle}</p>}
        </div>
        <div style={{ background: 'var(--bg1)', border: '1px solid var(--border-hi)', borderRadius: 'var(--radius-lg)', padding: 28 }}>
          {title && <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, marginBottom: 20, color: 'var(--text)' }}>{title}</h2>}
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Setup screen ──────────────────────────────────────────────────────────────

function SetupScreen({ onDone }) {
  const [step, setStep] = useState('passphrase') // passphrase | qr | verify
  const [passphrase, setPassphrase] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function submitPassphrase() {
    if (passphrase.length < 8) return setErr('Must be at least 8 characters')
    setLoading(true); setErr('')
    const res = await fetch('/api/auth/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    }).then(r => r.json())
    setLoading(false)
    if (!res.ok) return setErr(res.error)
    setQrDataUrl(res.qrDataUrl)
    setTotpSecret(res.totpSecret)
    setStep('qr')
  }

  async function verifyTotp() {
    setLoading(true); setErr('')
    const res = await fetch('/api/auth/setup/verify-totp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    }).then(r => r.json())
    setLoading(false)
    if (!res.ok) return setErr(res.error)
    onDone()
  }

  if (step === 'passphrase') return (
    <AuthCard title="Create passphrase" subtitle="First-time setup">
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)', marginBottom: 20 }}>
        Choose a strong passphrase. You'll need this every time you log in.
      </p>
      <AuthInput label="Passphrase" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="min. 8 characters" autoFocus />
      {err && <div style={{ color: 'var(--red)', fontSize: 'var(--fs-xs)', marginBottom: 12 }}>{err}</div>}
      <Btn variant="accent" onClick={submitPassphrase} loading={loading} style={{ width: '100%' }}>
        Continue
      </Btn>
    </AuthCard>
  )

  if (step === 'qr') return (
    <AuthCard title="Set up authenticator" subtitle="Scan with Google Authenticator, Aegis, etc.">
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)', marginBottom: 16 }}>
        Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
      </p>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <img src={qrDataUrl} alt="TOTP QR" style={{ width: 200, height: 200, borderRadius: 8, background: 'white', padding: 8 }} />
      </div>
      <div style={{ marginBottom: 16, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text3)', textAlign: 'center', wordBreak: 'break-all' }}>
        Manual key: <span style={{ color: 'var(--accent)' }}>{totpSecret}</span>
      </div>
      <Btn variant="ghost" onClick={() => setStep('verify')} style={{ width: '100%' }}>
        I've scanned it →
      </Btn>
    </AuthCard>
  )

  return (
    <AuthCard title="Confirm authenticator code" subtitle="Setup — step 2 of 2">
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)', marginBottom: 20 }}>
        Enter the 6-digit code from your authenticator app to confirm setup.
      </p>
      <AuthInput label="6-digit code" value={verifyToken} onChange={e => setVerifyToken(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="000000" autoFocus />
      {err && <div style={{ color: 'var(--red)', fontSize: 'var(--fs-xs)', marginBottom: 12 }}>{err}</div>}
      <Btn variant="accent" onClick={verifyTotp} loading={loading} disabled={verifyToken.length !== 6}>
        Verify & finish setup
      </Btn>
    </AuthCard>
  )
}

// ── Login screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [passphrase, setPassphrase] = useState('')
  const [totpToken, setTotpToken] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setLoading(true); setErr('')
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, totpToken: totpToken || undefined }),
    }).then(r => r.json())
    setLoading(false)
    if (res.ok) return onLogin()
    if (res.needsTotp) { setNeedsTotp(true); setErr('') }
    else setErr(res.error)
  }

  function onKey(e) { if (e.key === 'Enter') submit() }

  return (
    <AuthCard title="Sign in" subtitle="Proxmox Admin Panel">
      <AuthInput label="Passphrase" type="password" value={passphrase}
        onChange={e => setPassphrase(e.target.value)} onKeyDown={onKey} autoFocus />
      {needsTotp && (
        <div style={{ marginBottom: 16 }}>
          <label>Authenticator code</label>
          <input
            value={totpToken} onChange={e => setTotpToken(e.target.value.replace(/\D/g, '').slice(0,6))}
            placeholder="000000" autoFocus
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: 6, textAlign: 'center', fontSize: 'var(--fs-xl)' }}
            onKeyDown={onKey}
          />
        </div>
      )}
      {err && (
        <div style={{ color: 'var(--red)', fontSize: 'var(--fs-xs)', marginBottom: 14, padding: '8px 10px', background: 'var(--red-dim)', borderRadius: 'var(--radius)' }}>
          {err}
        </div>
      )}
      <Btn variant="accent" onClick={submit} loading={loading} style={{ width: '100%' }}>
        {needsTotp ? 'Verify' : 'Sign in'}
      </Btn>
    </AuthCard>
  )
}

// ── Auth gate ─────────────────────────────────────────────────────────────────

function AuthGate({ children }) {
  const [authState, setAuthState] = useState(null) // null = loading

  async function checkAuth() {
    const res = await fetch('/api/auth/status').then(r => r.json())
    setAuthState(res)
  }

  useEffect(() => { checkAuth() }, [])

  if (!authState) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg0)', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
      loading...
    </div>
  )

  if (!authState.configured) return <SetupScreen onDone={checkAuth} />
  if (!authState.authenticated) return <LoginScreen onLogin={checkAuth} />
  return children({ onLogout: () => { fetch('/api/auth/logout', { method: 'POST' }); checkAuth() } })
}

// ── Main App ─────────────────────────────────────────────────────────────────


// ── Admin Page ────────────────────────────────────────────────────────────────

function AdminSection({ title, icon, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</span>
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

function AdminPage({ onBack, onLogout, hosts }) {
  const [settings, setSettings] = useState(loadSettings)
  const [msg, setMsg] = useState(null) // { text, type }

  // Security state
  const [curPass, setCurPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [passLoading, setPassLoading] = useState(false)

  // LXC tools state
  const [selectedHostId, setSelectedHostId] = useState('')
  const [lxcList, setLxcList] = useState([])
  const [selectedVmid, setSelectedVmid] = useState('')
  const [sshLoading, setSshLoading] = useState(false)
  const [sshOutput, setSshOutput] = useState('')

  // Home Assistant state
  const [ha, setHa] = useState(null) // null = loading
  const [haUrl, setHaUrl] = useState('')
  const [haToken, setHaToken] = useState('')
  const [haConnecting, setHaConnecting] = useState(false)
  const [haPushing, setHaPushing] = useState(false)
  const [haMsg, setHaMsg] = useState(null)

  useEffect(() => {
    api.get('/api/ha/config').then(res => {
      setHa(res)
      if (res.configured) setHaUrl(res.url)
    })
  }, [])

  async function connectHa() {
    if (!haUrl || !haToken) return
    setHaConnecting(true); setHaMsg(null)
    const res = await api.post('/api/ha/connect', { url: haUrl, token: haToken })
    setHaConnecting(false)
    if (res.ok) {
      setHa({ configured: true, url: haUrl, tokenHint: '••••••••' + haToken.slice(-4) })
      setHaToken('')
      setHaMsg({ type: 'success', text: `Connected to Home Assistant ${res.haVersion} — sensors pushed` })
    } else {
      setHaMsg({ type: 'error', text: res.error || 'Connection failed' })
    }
  }

  async function disconnectHa() {
    await api.cancel('/api/ha/config')
    setHa({ configured: false })
    setHaUrl(''); setHaToken('')
    setHaMsg({ type: 'success', text: 'Disconnected from Home Assistant' })
  }

  async function pushHa() {
    setHaPushing(true); setHaMsg(null)
    const res = await api.post('/api/ha/push')
    setHaPushing(false)
    if (res.ok) setHaMsg({ type: 'success', text: 'Sensors pushed to Home Assistant' })
    else setHaMsg({ type: 'error', text: res.error || 'Push failed' })
  }

  // Scheduler state
  const [sched, setSched] = useState({ enabled: false, hour: 3, minute: 0, concurrency: 1, sshTimeout: 120 })
  const [schedLoading, setSchedLoading] = useState(false)
  const [schedSaved, setSchedSaved] = useState(false)
  const [checkRunning, setCheckRunning] = useState(false)
  const [history, setHistory] = useState([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const checkPollRef = useRef(null)

  useEffect(() => {
    api.get('/api/scheduler').then(res => setSched(res))
    api.get('/api/updates/history').then(res => { if (Array.isArray(res)) setHistory(res) })
    // Poll status every 5s so button stays disabled across all windows
    const syncStatus = () => api.get('/api/scheduler/status').then(res => setCheckRunning(res.running))
    syncStatus()
    const statusPoll = setInterval(syncStatus, 5000)
    return () => { clearInterval(checkPollRef.current); clearInterval(statusPoll) }
  }, [])

  async function triggerCheckNow() {
    // Always ask the server — it's the single source of truth across all windows
    const res = await api.post('/api/scheduler/run-now')
    if (res.busy) {
      flash('A check is already in progress', 'error')
      setCheckRunning(true) // sync local state
      return
    }
    setCheckRunning(true)
    flash('Update check started — results will appear on the Updates page')
    clearInterval(checkPollRef.current)
    checkPollRef.current = setInterval(async () => {
      const status = await api.get('/api/scheduler/status')
      if (!status.running) {
        clearInterval(checkPollRef.current)
        setCheckRunning(false)
        flash('Update check complete')
      }
    }, 3000)
  }

  async function saveScheduler() {
    setSchedLoading(true)
    const res = await api.post('/api/scheduler', sched)
    setSchedLoading(false)
    if (res.ok) { setSchedSaved(true); setTimeout(() => setSchedSaved(false), 3000); flash('Scheduler saved') }
    else flash(res.error || 'Failed', 'error')
  }

  function flash(text, type = 'success') {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  function updateSetting(key, value) {
    const next = { ...settings, [key]: value }
    setSettings(next)
    saveSettings(next)
  }

  // Load LXCs when host selected
  useEffect(() => {
    if (!selectedHostId) { setLxcList([]); setSelectedVmid(''); return }
    api.get(`/api/hosts/${selectedHostId}/scan`).then(res => {
      if (res.ok) {
        const lxcs = res.nodes.flatMap(n => n.lxcs).filter(l => l.status === 'running')
        setLxcList(lxcs)
        setSelectedVmid(lxcs[0]?.vmid || '')
      }
    })
  }, [selectedHostId])

  async function changePassphrase() {
    if (newPass.length < 8) return flash('New passphrase must be at least 8 characters', 'error')
    setPassLoading(true)
    const res = await api.post('/api/auth/change-passphrase', { currentPassphrase: curPass, newPassphrase: newPass })
    setPassLoading(false)
    if (res.ok) { setCurPass(''); setNewPass(''); flash('Passphrase updated') }
    else flash(res.error || 'Failed', 'error')
  }

  async function resetTotp() {
    if (!confirm('This will delete your 2FA setup and redirect you to re-configure it. Continue?')) return
    await fetch('/app/config/auth.json', { method: 'DELETE' }).catch(() => {})
    // Actually call a proper reset endpoint
    const res = await api.post('/api/auth/reset-totp')
    if (res.ok) { flash('2FA reset — you will be logged out'); setTimeout(() => onLogout(), 2000) }
    else flash(res.error || 'Failed', 'error')
  }

  async function enableRootSsh() {
    if (!selectedVmid || !selectedHostId) return
    setSshLoading(true); setSshOutput('')
    const lxc = lxcList.find(l => String(l.vmid) === String(selectedVmid))
    if (!lxc) return
    const res = await api.post(`/api/hosts/${selectedHostId}/exec`, {
      node: lxc.node, vmid: selectedVmid, command: 'enable-root-ssh'
    })
    setSshLoading(false)
    if (res.ok) {
      // Poll job via REST since we want inline output here without WS
      let attempts = 0
      const poll = setInterval(async () => {
        const job = await api.get(`/api/jobs/${res.jobId}`)
        if (job.status === 'done' || attempts++ > 60) {
          clearInterval(poll)
          const out = (job.lines || []).map(l => l.v).join('\n')
          setSshOutput(out)
          if (job.exitCode === 0) flash('Root SSH enabled and sshd restarted')
          else flash('Command finished with errors — check output', 'error')
        }
      }, 1000)
    } else {
      setSshOutput(res.error || 'Failed')
      flash(res.error || 'Failed', 'error')
    }
  }

  const msgColors = { success: 'var(--green)', error: 'var(--red)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {/* Nav */}
      <header className="px-main-header" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg1)', padding: '0 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14, height: 56 }}>
          <Btn variant="ghost" size="xs" onClick={onBack}><ChevronLeft size={14} /> Back</Btn>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>Admin</span>
          </div>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" size="xs" onClick={onLogout}><LogOut size={13} /> Sign out</Btn>
        </div>
      </header>

      <main className="px-admin-content" style={{ flex: 1, padding: '32px 24px', maxWidth: 860, margin: '0 auto', width: '100%' }}>

        {msg && (
          <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 'var(--radius)', background: msg.type === 'error' ? 'var(--red-dim)' : 'var(--green-dim)', border: `1px solid ${msgColors[msg.type || 'success']}33`, color: msgColors[msg.type || 'success'], fontSize: 'var(--fs-sm)' }}>
            {msg.text}
          </div>
        )}

        {/* ── Security ── */}
        <AdminSection title="Security" icon={<Shield size={15} />}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 14 }}>Change your login passphrase. You'll need your current one to confirm.</p>
              <div style={{ marginBottom: 10 }}>
                <label>Current passphrase</label>
                <input type="password" value={curPass} onChange={e => setCurPass(e.target.value)} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label>New passphrase</label>
                <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="min. 8 characters" />
              </div>
              <Btn variant="accent" size="sm" onClick={changePassphrase} loading={passLoading}><Save size={12} /> Update passphrase</Btn>
            </div>
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 14 }}>Reset two-factor authentication. You'll be logged out and taken through setup again.</p>
              <Btn variant="danger" size="sm" onClick={resetTotp}><Reset size={12} /> Reset 2FA</Btn>
            </div>
          </div>
        </AdminSection>

        {/* ── Appearance ── */}
        <AdminSection title="Appearance" icon={<Palette size={15} />}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div>
              <label style={{ marginBottom: 10 }}>Accent colour</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {ACCENT_PRESETS.map(p => (
                  <button key={p.value} onClick={() => updateSetting('accent', p.value)} title={p.name} style={{
                    width: 28, height: 28, borderRadius: '50%', background: p.value, border: 'none',
                    cursor: 'pointer', outline: settings.accent === p.value ? `3px solid ${p.value}` : '3px solid transparent',
                    outlineOffset: 2, transition: 'outline 0.15s',
                  }} />
                ))}
              </div>
              <label style={{ marginBottom: 6 }}>Custom colour</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={settings.accent || '#00d4aa'} onChange={e => updateSetting('accent', e.target.value)}
                  style={{ width: 40, height: 32, padding: 2, cursor: 'pointer', borderRadius: 6, background: 'var(--bg2)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>{settings.accent || '#00d4aa'}</span>
              </div>
            </div>
            <div>
              <label style={{ marginBottom: 10 }}>Font size — {settings.fontSize || 14}px</label>
              <input type="range" min="14" max="28" step="1"
                value={Math.min(28, Math.max(14, settings.fontSize || 14))}
                onChange={e => updateSetting('fontSize', parseInt(e.target.value))}
                style={{ width: '100%', marginBottom: 16 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                {[14,16,18,20,24,28].map(s => (
                  <button key={s} onClick={() => updateSetting('fontSize', s)} style={{
                    padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)', cursor: 'pointer',
                    background: (settings.fontSize||14) === s ? 'var(--accent-dim2)' : 'var(--bg3)',
                    color: (settings.fontSize||14) === s ? 'var(--accent)' : 'var(--text3)',
                    border: '1px solid var(--border)', fontWeight: 500,
                  }}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        </AdminSection>

        {/* ── LXC Tools ── */}
        <AdminSection title="LXC Tools" icon={<Wrench size={15} />}>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 16 }}>
            Run privileged operations inside a running LXC via the Proxmox host.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label>Proxmox host</label>
              <select value={selectedHostId} onChange={e => setSelectedHostId(e.target.value)}>
                <option value="">— select host —</option>
                {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div>
              <label>LXC container</label>
              <select value={selectedVmid} onChange={e => setSelectedVmid(e.target.value)} disabled={!lxcList.length}>
                {!lxcList.length ? <option value="">— select host first —</option> :
                  lxcList.map(l => <option key={l.vmid} value={l.vmid}>{l.name || l.vmid} (#{l.vmid})</option>)}
              </select>
            </div>
          </div>

          {/* Enable root SSH */}
          <div style={{ padding: 16, background: 'var(--bg2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: 4 }}>Enable root SSH login</div>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', maxWidth: 420 }}>
                  Sets <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>PermitRootLogin yes</code> in <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>/etc/ssh/sshd_config</code> and restarts sshd.
                </p>
              </div>
              <Btn variant="danger" size="sm" onClick={enableRootSsh} loading={sshLoading} disabled={!selectedVmid}>
                <Key size={12} /> Enable
              </Btn>
            </div>
            {sshOutput && (
              <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--bg0)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text3)', whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
                {sshOutput}
              </div>
            )}
          </div>
        </AdminSection>

        {/* ── Scheduler ── */}
        <AdminSection title="Update Scheduler" icon={<Calendar size={16} />}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: 4 }}>Automatic update checks</div>
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                Runs apt-get update and checks all LXC containers for pending upgrades daily at the specified time (UTC).
              </p>
            </div>
            <button
              onClick={() => setSched(s => ({ ...s, enabled: !s.enabled }))}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: sched.enabled ? 'var(--accent)' : 'var(--bg3)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: sched.enabled ? 22 : 3,
                width: 18, height: 18, borderRadius: '50%', background: 'white',
                transition: 'left 0.2s',
              }} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 16, opacity: sched.enabled ? 1 : 0.4, pointerEvents: sched.enabled ? 'auto' : 'none' }}>
            <div>
              <label>Run at (UTC hour)</label>
              <select value={sched.hour} onChange={e => setSched(s => ({ ...s, hour: parseInt(e.target.value) }))}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <div>
              <label>Concurrency (Update All)</label>
              <select value={sched.concurrency} onChange={e => setSched(s => ({ ...s, concurrency: e.target.value }))}>
                <option value="1">1 at a time (safest)</option>
                <option value="3">3 at a time</option>
                <option value="5">5 at a time</option>
                <option value="unlimited">All at once (fastest)</option>
              </select>
            </div>
            <div>
              <label>Update terminal timeout</label>
              <select value={sched.sshTimeout} onChange={e => setSched(s => ({ ...s, sshTimeout: parseInt(e.target.value) }))}>
                <option value="60">60 seconds</option>
                <option value="120">120 seconds (default)</option>
                <option value="300">5 minutes</option>
                <option value="600">10 minutes</option>
                <option value="900">15 minutes</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Btn variant="accent" size="sm" onClick={saveScheduler} loading={schedLoading}>
              <Save size={13} /> Save
            </Btn>
            {schedSaved && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--green)' }}>✓ Saved</span>}
            <div style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={triggerCheckNow} loading={checkRunning} disabled={checkRunning}>
              <RefreshCw size={13} style={{ animation: checkRunning ? 'spin 1s linear infinite' : 'none' }} />
              {checkRunning ? 'Running...' : 'Run Check Now'}
            </Btn>
          </div>
        </AdminSection>

        {/* ── Home Assistant ── */}
        <AdminSection title="Home Assistant" icon={<Home size={16} />}>
          {haMsg && (
            <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
              background: haMsg.type === 'error' ? 'var(--red-dim)' : 'var(--green-dim)',
              color: haMsg.type === 'error' ? 'var(--red)' : 'var(--green)',
              border: `1px solid ${haMsg.type === 'error' ? 'rgba(255,85,85,0.3)' : 'rgba(80,250,123,0.3)'}`,
            }}>
              {haMsg.text}
            </div>
          )}

          {ha?.configured ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--bg2)', borderRadius: 'var(--radius)', border: '1px solid rgba(80,250,123,0.2)', marginBottom: 16 }}>
                <Link size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--green)' }}>Connected</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{ha.url} · {ha.tokenHint}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="ghost" size="sm" onClick={pushHa} loading={haPushing}>
                  <RefreshCw size={13} /> Push sensors now
                </Btn>
                <Btn variant="danger" size="sm" onClick={disconnectHa}>
                  <Unlink size={13} /> Disconnect
                </Btn>
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Sensors created</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {[
                    'total_containers_with_updates',
                    'total_containers_checked',
                    'last_check',
                    'last_check_trigger',
                    'last_check_outcome',
                    'last_check_duration_seconds',
                  ].map(s => (
                    <span key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', padding: '2px 7px', background: 'var(--bg3)', borderRadius: 4, color: 'var(--text3)' }}>
                      proxmoxadminpanel_{s}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)', marginBottom: 16 }}>
                Connect to Home Assistant to automatically push update sensors after every check.
                Generate a Long-Lived Access Token in your HA profile settings.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label>Home Assistant URL</label>
                  <input value={haUrl} onChange={e => setHaUrl(e.target.value)} placeholder="http://192.168.4.x:8123" />
                </div>
                <div>
                  <label>Long-Lived Access Token</label>
                  <input type="password" value={haToken} onChange={e => setHaToken(e.target.value)} placeholder="eyJ0eXAiOiJKV1Qi..." />
                </div>
              </div>
              <Btn variant="accent" size="sm" onClick={connectHa} loading={haConnecting} disabled={!haUrl || !haToken}>
                <Link size={13} /> Connect
              </Btn>
            </>
          )}
        </AdminSection>

        {/* ── Check History ── */}
        <AdminSection title="Check History" icon={<Clock size={16} />}>
          {history.length === 0 ? (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)' }}>No checks run yet.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(historyExpanded ? history : history.slice(0, 5)).map((h, i) => {
                  const dur = h.durationMs < 60000
                    ? `${Math.round(h.durationMs / 1000)}s`
                    : `${Math.floor(h.durationMs / 60000)}m ${Math.round((h.durationMs % 60000) / 1000)}s`
                  const date = new Date(h.startedAt)
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                      padding: '8px 12px', background: 'var(--bg2)', borderRadius: 'var(--radius)',
                      border: `1px solid ${h.cancelled ? 'rgba(255,179,71,0.2)' : h.errors > 0 ? 'rgba(255,85,85,0.2)' : 'var(--border)'}`,
                      fontSize: 'var(--fs-xs)',
                    }}>
                      <span style={{ color: h.cancelled ? 'var(--amber)' : h.errors > 0 ? 'var(--red)' : 'var(--green)', display: 'flex' }}>
                        {h.cancelled || h.errors > 0 ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
                      </span>
                      <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', minWidth: 130 }}>
                        {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ color: 'var(--text3)' }}>
                        <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{h.checked}</span> checked
                      </span>
                      <span style={{ color: h.withUpdates > 0 ? 'var(--amber)' : 'var(--text3)' }}>
                        <span style={{ fontWeight: 600 }}>{h.withUpdates}</span> with updates
                      </span>
                      {h.errors > 0 && <span style={{ color: 'var(--red)' }}>{h.errors} error{h.errors !== 1 ? 's' : ''}</span>}
                      {h.cancelled && <span style={{ color: 'var(--amber)' }}>cancelled</span>}
                      <div style={{ flex: 1 }} />
                      <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{dur}</span>
                    </div>
                  )
                })}
              </div>
              {history.length > 5 && (
                <button
                  onClick={() => setHistoryExpanded(e => !e)}
                  style={{ marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {historyExpanded ? 'Show less' : `Show all ${history.length} runs`}
                </button>
              )}
            </>
          )}
        </AdminSection>

      </main>
    </div>
  )
}



export default function Root() {
  return (
    <AuthGate>
      {({ onLogout }) => <Router onLogout={onLogout} />}
    </AuthGate>
  )
}

function Router({ onLogout }) {
  const getInitialPage = () => window.location.hash === '#/admin' ? 'admin' : 'main'
  const [page, setPage] = useState(getInitialPage)
  const [hosts, setHosts] = useState([])
  const [updateCache, setUpdateCache] = useState({ containers: [] })

  useEffect(() => { applyTheme(loadSettings()) }, [])
  useEffect(() => {
    api.get('/api/hosts').then(res => { if (Array.isArray(res)) setHosts(res) })
    api.get('/api/updates').then(res => { if (res.containers) setUpdateCache(res) })
  }, [])

  function goAdmin() { window.location.hash = '#/admin'; setPage('admin') }
  function goMain()  { window.location.hash = '#/';      setPage('main') }

  if (page === 'admin') return <AdminPage onBack={goMain} onLogout={onLogout} hosts={hosts} />
  return <App onLogout={onLogout} onAdmin={goAdmin} hosts={hosts} setHosts={setHosts} updateCache={updateCache} setUpdateCache={setUpdateCache} />
}

function App({ onLogout, onAdmin, hosts, setHosts, updateCache, setUpdateCache }) {
  const [showAdd, setShowAdd] = useState(false)
  const [toast, setToast] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [checkRunning, setCheckRunning] = useState(false)
  const [checkProgress, setCheckProgress] = useState({ current: 0, total: 0 })
  const toastRef = useRef()

  const updateCount = (updateCache?.containers || []).filter(c => c.hasUpdates).length

  function showToast(msg, type = 'info') {
    setToast({ msg, type })
    clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3500)
  }

  async function loadHosts() {
    const res = await api.get('/api/hosts')
    if (Array.isArray(res) && setHosts) setHosts(res)
  }

  async function deleteHost(id) {
    await api.del(`/api/hosts/${id}`)
    showToast('Host removed', 'warn')
    loadHosts()
  }

  async function doAction(hostId, node, vmid, type, action) {
    const res = await api.post(`/api/hosts/${hostId}/action`, { node, vmid, type, action })
    if (res.ok) showToast(`${action} sent to ${type} ${vmid}`, 'success')
    else showToast(res.error || 'Action failed', 'error')
  }

  useEffect(() => {
    loadHosts()
    const wasRunningRef = { current: false }
    const syncStatus = async () => {
      const res = await api.get('/api/scheduler/status')
      setCheckRunning(res.running)
      if (res.progress) setCheckProgress(res.progress)
      if (!res.running && wasRunningRef.current) {
        // check just finished — refresh update cache
        api.get('/api/updates').then(r => { if (r.containers) setUpdateCache(r) })
      }
      wasRunningRef.current = res.running
    }
    syncStatus()
    const poll = setInterval(syncStatus, 2000)
    return () => clearInterval(poll)
  }, [])

  async function triggerCheck() {
    const res = await api.post('/api/scheduler/run-now')
    if (res.busy) showToast('A check is already in progress', 'warn')
    else showToast('Update check started', 'info')
  }

  async function cancelCheck() {
    await api.cancel('/api/scheduler/run-now')
    setCheckRunning(false)
  }

  const toastColors = { success: 'var(--green)', error: 'var(--red)', warn: 'var(--amber)', info: 'var(--accent)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Inject spin keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Top nav */}
      <header className="px-main-header" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg1)', padding: '0 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div className="px-nav-row" style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-dim2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 'var(--fs-md)', fontFamily: 'var(--font-mono)' }}>proxmox<span style={{ color: 'var(--accent)' }}>.admin</span></span>
          </div>

          <div className="px-nav-search" style={{ flex: 1, maxWidth: 320, margin: '0 16px', position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name..."
              style={{ paddingLeft: 30, height: 32, fontSize: 'var(--fs-sm)', borderRadius: 'var(--radius)', width: '100%' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}>
                <X size={12} />
              </button>
            )}
          </div>

          <div className="px-nav-filter" style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 'var(--radius)', padding: 3 }}>
            {['all', 'vm', 'lxc', 'updates'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 'var(--fs-xs)', fontWeight: 500,
                background: filter === f ? (f === 'updates' ? 'var(--amber-dim)' : 'var(--bg3)') : 'transparent',
                color: filter === f ? (f === 'updates' ? 'var(--amber)' : 'var(--text)') : 'var(--text3)',
                cursor: 'pointer', border: 'none', textTransform: 'uppercase', letterSpacing: 0.5,
                position: 'relative',
              }}>
                {f === 'all' ? 'All' : f === 'vm' ? 'VMs' : f === 'lxc' ? 'LXCs' : `Updates${updateCount > 0 ? ` (${updateCount})` : ''}`}
              </button>
            ))}
          </div>

          <div className="px-nav-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Btn variant="accent" onClick={() => setShowAdd(true)}><Plus size={14} /> Add Host</Btn>
            {checkRunning ? (
              <>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} />
                  {checkProgress.total > 0 ? `${checkProgress.current}/${checkProgress.total}` : 'Checking...'}
                </span>
                <Btn variant="danger" size="xs" onClick={cancelCheck}><X size={12} /></Btn>
              </>
            ) : (
              <Btn variant="ghost" size="sm" onClick={triggerCheck} title="Check for updates">
                <PackageCheck size={14} />
              </Btn>
            )}
            <Btn variant="ghost" size="sm" onClick={onAdmin} title="Admin"><Settings size={14} /></Btn>
            <Btn variant="ghost" onClick={onLogout} title="Sign out"><LogOut size={14} /></Btn>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-main-content" style={{ flex: 1, padding: '28px 24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {hosts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text3)' }}>
            <Server size={48} style={{ marginBottom: 16, opacity: 0.2 }} />
            <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text2)', marginBottom: 8 }}>No Proxmox hosts yet</h2>
            <p style={{ marginBottom: 24, fontSize: 'var(--fs-md)' }}>Add your first Proxmox host to get started</p>
            <Btn variant="accent" size="md" onClick={() => setShowAdd(true)}><Plus size={16} /> Add Proxmox Host</Btn>
          </div>
        ) : (
          hosts.map(host => (
            <HostPanel key={host.id} host={host} onDelete={deleteHost} onAction={doAction} filter={filter} search={search} updateCache={updateCache} />
          ))
        )}
      </main>

      {/* Modals */}
      {showAdd && <AddHostModal onClose={() => setShowAdd(false)} onAdded={() => { loadHosts(); showToast('Host added!', 'success') }} />}

      {/* Toast */}
      {toast && (
        <div className="px-toast" style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 200,
          background: 'var(--bg2)', border: `1px solid ${toastColors[toast.type]}33`,
          borderLeft: `3px solid ${toastColors[toast.type]}`,
          borderRadius: 'var(--radius)', padding: '10px 16px',
          fontSize: 'var(--fs-sm)', color: 'var(--text)', display: 'flex', gap: 10, alignItems: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'slideIn 0.2s ease',
        }}>
          <span style={{ color: toastColors[toast.type], display: 'flex' }}>
            {toast.type === 'success' ? <CheckCircle size={15} /> : toast.type === 'error' ? <AlertCircle size={15} /> : <Zap size={15} />}
          </span>
          {toast.msg}
        </div>
      )}

      <style>{`@keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
