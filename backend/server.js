const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const bcrypt = require('bcrypt');
const { Client: SSHClient } = require('ssh2');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3001;
const CONFIG_PATH        = path.join('/app/config', 'proxmox-hosts.json');
const AUTH_PATH          = path.join('/app/config', 'auth.json');
const SCHEDULER_PATH     = path.join('/app/config', 'scheduler.json');
const UPDATE_CACHE_PATH  = path.join('/app/config', 'update-cache.json');
const UPDATE_HISTORY_PATH = path.join('/app/config', 'update-history.json');
const MAX_HISTORY = 50; // keep last 50 runs

// ── Brute force lockout ──────────────────────────────────────────────────────

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;

function checkLockout(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return null;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const secsLeft = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    return `Too many failed attempts. Try again in ${secsLeft}s.`;
  }
  return null;
}
function recordFailure(ip) {
  const entry = loginAttempts.get(ip) || { attempts: 0, lockedUntil: null };
  entry.attempts += 1;
  if (entry.attempts >= MAX_ATTEMPTS) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  loginAttempts.set(ip, entry);
}
function clearFailures(ip) { loginAttempts.delete(ip); }

// ── Auth persistence ─────────────────────────────────────────────────────────

function loadAuth() {
  try { if (fs.existsSync(AUTH_PATH)) return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8')); } catch {}
  return { passphraseHash: null, totpSecret: null, totpVerified: false };
}
function saveAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
}

// ── Session ──────────────────────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessionMiddleware = session({
  secret: SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000, secure: false },
  name: 'pxadmin_sid',
});

app.use(cors({ origin: false }));
app.use(express.json());
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorised' });
}
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  return requireAuth(req, res, next);
});

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ── Job store ────────────────────────────────────────────────────────────────

const jobs = new Map();
function createJob(id, meta) {
  const job = { id, status: 'running', lines: [], exitCode: null, startedAt: Date.now(), ...meta };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), 3600000);
  return job;
}

// ── WebSocket ────────────────────────────────────────────────────────────────

const upgrading = new WeakSet();
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') { socket.destroy(); return; }
  if (upgrading.has(socket)) return;
  upgrading.add(socket);
  sessionMiddleware(req, {}, () => {
    if (!req.session?.authenticated) { socket.write('HTTP/1.1 401 Unauthorised\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => { upgrading.delete(socket); wss.emit('connection', ws, req); });
  });
});

const subscriptions = new Map();
function broadcast(jobId, msg) {
  const subs = subscriptions.get(jobId);
  if (!subs) return;
  const payload = JSON.stringify(msg);
  for (const ws of subs) { if (ws.readyState === 1) ws.send(payload); }
}

wss.on('connection', (ws) => {
  let subscribedJob = null;
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.subscribe) {
        subscribedJob = msg.subscribe;
        if (!subscriptions.has(subscribedJob)) subscriptions.set(subscribedJob, new Set());
        subscriptions.get(subscribedJob).add(ws);
        const job = jobs.get(subscribedJob);
        if (job) ws.send(JSON.stringify({ type: 'replay', lines: job.lines, status: job.status, exitCode: job.exitCode }));
      }
    } catch {}
  });
  ws.on('close', () => { if (subscribedJob) subscriptions.get(subscribedJob)?.delete(ws); });
});

// ── Config persistence ───────────────────────────────────────────────────────

function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return { hosts: [] };
}
function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── Scheduler config ─────────────────────────────────────────────────────────

function loadScheduler() {
  try { if (fs.existsSync(SCHEDULER_PATH)) return JSON.parse(fs.readFileSync(SCHEDULER_PATH, 'utf8')); } catch {}
  return { enabled: false, hour: 3, minute: 0, concurrency: 1, sshTimeout: 120 };
}
function saveScheduler(s) {
  fs.mkdirSync(path.dirname(SCHEDULER_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULER_PATH, JSON.stringify(s, null, 2));
}

// ── Update history ───────────────────────────────────────────────────────────

function loadHistory() {
  try { if (fs.existsSync(UPDATE_HISTORY_PATH)) return JSON.parse(fs.readFileSync(UPDATE_HISTORY_PATH, 'utf8')); } catch {}
  return [];
}
function appendHistory(entry) {
  const history = loadHistory();
  history.unshift(entry); // newest first
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  fs.mkdirSync(path.dirname(UPDATE_HISTORY_PATH), { recursive: true });
  fs.writeFileSync(UPDATE_HISTORY_PATH, JSON.stringify(history, null, 2));
}

// ── Update cache ─────────────────────────────────────────────────────────────

function loadUpdateCache() {
  try { if (fs.existsSync(UPDATE_CACHE_PATH)) return JSON.parse(fs.readFileSync(UPDATE_CACHE_PATH, 'utf8')); } catch {}
  return { lastRun: null, containers: [] };
}
function saveUpdateCache(cache) {
  fs.mkdirSync(path.dirname(UPDATE_CACHE_PATH), { recursive: true });
  fs.writeFileSync(UPDATE_CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ── Proxmox helpers ──────────────────────────────────────────────────────────

async function getTicket(host) {
  const baseUrl = `https://${host.ip}:${host.port || 8006}/api2/json`;
  const res = await axios.post(`${baseUrl}/access/ticket`, new URLSearchParams({
    username: host.username, password: host.password,
  }), { httpsAgent, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return { ticket: res.data.data.ticket, csrfToken: res.data.data.CSRFPreventionToken, baseUrl };
}
async function proxmoxGet(host, endpoint) {
  const { ticket, baseUrl } = await getTicket(host);
  const res = await axios.get(`${baseUrl}${endpoint}`, { httpsAgent, headers: { Cookie: `PVEAuthCookie=${ticket}` } });
  return res.data.data;
}
async function proxmoxPost(host, endpoint, body = {}) {
  const { ticket, csrfToken, baseUrl } = await getTicket(host);
  const res = await axios.post(`${baseUrl}${endpoint}`, body, {
    httpsAgent, headers: { Cookie: `PVEAuthCookie=${ticket}`, CSRFPreventionToken: csrfToken },
  });
  return res.data.data;
}

// ── SSH streaming ────────────────────────────────────────────────────────────

function sshStream(host, command, jobId, timeoutMs = 120000) {
  const job = jobs.get(jobId);
  return new Promise((resolve) => {
    const conn = new SSHClient();
    let settled = false;
    let timer = null;

    function emit(line, type = 'line') {
      if (job) job.lines.push({ t: type, v: line });
      broadcast(jobId, { type, line });
    }
    function finish(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      resolve(code);
    }

    timer = setTimeout(() => { emit(`Command timed out after ${timeoutMs/1000}s`, 'error'); finish(1); }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) { emit(`SSH exec error: ${err.message}`, 'error'); return finish(1); }
        let buf = '';
        function flush(data) {
          buf += data.toString();
          const parts = buf.split('\n');
          buf = parts.pop();
          for (const line of parts) emit(line);
        }
        stream.on('data', flush);
        stream.stderr.on('data', d => emit(d.toString().trimEnd(), 'stderr'));
        stream.on('close', (code) => { if (buf) emit(buf); finish(code); });
      });
    });
    conn.on('error', (err) => { emit(`SSH error: ${err.message}`, 'error'); finish(1); });
    conn.connect({ host: host.ip, port: host.sshPort || 22, username: host.sshUser || 'root', password: host.password, readyTimeout: 10000 });
  });
}

// ── SSH exec (no job, returns stdout as string) ──────────────────────────────

function sshExec(host, command, timeoutMs = 60000, connSet = null) {
  return new Promise((resolve) => {
    const conn = new SSHClient();
    if (connSet) connSet.add(conn);
    let settled = false;
    let output = '';
    let timer = setTimeout(() => { if (!settled) { settled = true; if (connSet) connSet.delete(conn); conn.end(); resolve({ output, exitCode: 1, timedOut: true }); } }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) { settled = true; clearTimeout(timer); conn.end(); return resolve({ output: '', exitCode: 1 }); }
        stream.on('data', d => { output += d.toString(); });
        stream.stderr.on('data', d => { output += d.toString(); });
        stream.on('close', (code) => {
          if (settled) return;
          settled = true; clearTimeout(timer); if (connSet) connSet.delete(conn); conn.end();
          resolve({ output, exitCode: code });
        });
      });
    });
    conn.on('error', (err) => {
      if (settled) return;
      settled = true; clearTimeout(timer); if (connSet) connSet.delete(conn);
      resolve({ output: `SSH error: ${err.message}`, exitCode: 1 });
    });
    conn.connect({ host: host.ip, port: host.sshPort || 22, username: host.sshUser || 'root', password: host.password, readyTimeout: 10000 });
  });
}

// ── Update check runner ──────────────────────────────────────────────────────

let checkRunning = false;  // lock — prevents concurrent update checks
let upgradeRunning = false; // lock — prevents concurrent upgrade runs
let checkProgress = { current: 0, total: 0, currentName: '' };
let checkCancelled = false; // set to true to abort in-flight check
const activeCheckConns = new Set(); // SSH connections for current check — killed on cancel
let currentCheckTrigger = 'scheduled'; // 'scheduled' or 'manual'

const APT_CHECK_CMD = 'apt-get update -qq 2>&1 && apt-get upgrade --dry-run 2>/dev/null';

async function runUpdateCheck() {
  // Note: checkRunning must be set to true by caller before invoking this function
  // This prevents async race conditions between concurrent HTTP requests
  const startedAt = Date.now();
  console.log('[scheduler] Running update check across all hosts...');
  const config = loadConfig();
  const results = [];

  // Pre-count total running LXCs for progress tracking
  let totalLxcs = 0;
  try {
    for (const host of config.hosts) {
      const nodes = await proxmoxGet(host, '/nodes').catch(() => []);
      for (const node of nodes) {
        const lxcs = await proxmoxGet(host, `/nodes/${node.node}/lxc`).catch(() => []);
        totalLxcs += lxcs.filter(l => l.status === 'running').length;
      }
    }
  } catch {}
  checkProgress = { current: 0, total: totalLxcs, currentName: '' };

  for (const host of config.hosts) {
    try {
      const nodes = await proxmoxGet(host, '/nodes');
      for (const node of nodes) {
        if (checkCancelled) break;
        const lxcs = await proxmoxGet(host, `/nodes/${node.node}/lxc`).catch(() => []);
        const running = lxcs.filter(l => l.status === 'running');

        for (const lxc of running) {
          if (checkCancelled) break;
          checkProgress.current += 1;
          checkProgress.currentName = lxc.name;
          try {
            const cmd = `pct exec ${lxc.vmid} -- sh -c ${JSON.stringify(APT_CHECK_CMD)} </dev/null`;
            const { output, exitCode, timedOut } = await sshExec(host, cmd, 60000, activeCheckConns);

            const packages = output
              .split('\n')
              .filter(l => l.startsWith('Inst '))
              .map(l => l.split(' ')[1].trim())
              .filter(Boolean);

            results.push({
              hostId: host.id,
              hostName: host.name,
              node: node.node,
              vmid: lxc.vmid,
              name: lxc.name,
              packages,
              packageCount: packages.length,
              hasUpdates: packages.length > 0,
              checkedAt: new Date().toISOString(),
              timedOut: !!timedOut,
            });

            console.log(`[scheduler] ${host.name}/${lxc.name}: ${packages.length} updates`);
          } catch (err) {
            console.error(`[scheduler] Failed to check ${lxc.name}: ${err.message}`);
            results.push({
              hostId: host.id, hostName: host.name, node: node.node,
              vmid: lxc.vmid, name: lxc.name,
              packages: [], packageCount: 0, hasUpdates: false,
              checkedAt: new Date().toISOString(), error: err.message,
            });
          }
        }
      }
    } catch (err) {
      console.error(`[scheduler] Failed to reach host ${host.name}: ${err.message}`);
    }
  }

  if (!checkCancelled) {
    const finishedAt = new Date().toISOString();
    const withUpdates = results.filter(r => r.hasUpdates).length;
    saveUpdateCache({ lastRun: finishedAt, containers: results });
    appendHistory({
      startedAt: new Date(startedAt).toISOString(),
      finishedAt,
      durationMs: Date.now() - startedAt,
      checked: results.length,
      withUpdates,
      errors: results.filter(r => r.error).length,
      cancelled: false,
    });
    console.log(`[scheduler] Done. ${withUpdates} containers have updates.`);
    // Push to Home Assistant
    pushHaSensors(results, currentCheckTrigger || 'scheduled').catch(err => console.error('[ha] Push error:', err.message));
  } else {
    appendHistory({
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checked: results.length,
      withUpdates: results.filter(r => r.hasUpdates).length,
      errors: results.filter(r => r.error).length,
      cancelled: true,
    });
    console.log('[scheduler] Check was cancelled.');
  }
  checkProgress = { current: 0, total: 0, currentName: '' };
  checkCancelled = false;
  activeCheckConns.clear();
  checkRunning = false;
  return results;
}

// ── Cron scheduler ───────────────────────────────────────────────────────────

let cronTask = null;

function startCron() {
  if (cronTask) { cronTask.stop(); cronTask = null; }
  const sched = loadScheduler();
  if (!sched.enabled) { console.log('[scheduler] Disabled'); return; }

  const expr = `${sched.minute} ${sched.hour} * * *`;
  console.log(`[scheduler] Starting cron: ${expr}`);
  cronTask = cron.schedule(expr, () => {
    if (checkRunning) { console.log('[scheduler] Cron skipped — check already running'); return; }
    checkRunning = true;
    currentCheckTrigger = 'scheduled';
    runUpdateCheck().catch(err => { console.error('[scheduler] Cron error:', err.message); checkRunning = false; });
  }, { timezone: 'UTC' });
}

// Start cron on boot
startCron();

// ════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/auth/status', (req, res) => {
  const auth = loadAuth();
  res.json({
    configured: !!auth.passphraseHash,
    totpEnabled: !!auth.totpSecret && auth.totpVerified,
    totpPending: !!auth.totpSecret && !auth.totpVerified,
    authenticated: !!req.session?.authenticated,
  });
});

app.post('/api/auth/setup', async (req, res) => {
  const auth = loadAuth();
  if (auth.passphraseHash) return res.status(400).json({ error: 'Already configured' });
  const { passphrase } = req.body;
  if (!passphrase || passphrase.length < 8) return res.status(400).json({ error: 'Passphrase must be at least 8 characters' });
  const passphraseHash = await bcrypt.hash(passphrase, 12);
  const totpSecret = authenticator.generateSecret();
  saveAuth({ passphraseHash, totpSecret, totpVerified: false });
  const otpauth = authenticator.keyuri('admin', 'Proxmox Admin', totpSecret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  res.json({ ok: true, qrDataUrl, totpSecret });
});

app.post('/api/auth/setup/verify-totp', (req, res) => {
  const auth = loadAuth();
  if (!auth.totpSecret) return res.status(400).json({ error: 'No TOTP secret generated' });
  if (auth.totpVerified) return res.status(400).json({ error: 'Already verified' });
  const { token } = req.body;
  if (!authenticator.verify({ token, secret: auth.totpSecret }))
    return res.status(401).json({ error: 'Invalid code — check your authenticator app' });
  saveAuth({ ...auth, totpVerified: true });
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip;
  const locked = checkLockout(ip);
  if (locked) return res.status(429).json({ error: locked });
  const auth = loadAuth();
  if (!auth.passphraseHash) return res.status(400).json({ error: 'Not configured yet' });
  const { passphrase, totpToken } = req.body;
  const ok = await bcrypt.compare(passphrase, auth.passphraseHash);
  if (!ok) {
    recordFailure(ip);
    const entry = loginAttempts.get(ip);
    const remaining = MAX_ATTEMPTS - (entry?.attempts || 0);
    return res.status(401).json({ error: `Wrong passphrase. ${remaining > 0 ? `${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` : 'Account locked.'}` });
  }
  if (auth.totpVerified) {
    if (!totpToken) return res.status(401).json({ error: 'TOTP code required', needsTotp: true });
    if (!authenticator.verify({ token: totpToken, secret: auth.totpSecret })) {
      recordFailure(ip);
      return res.status(401).json({ error: 'Invalid TOTP code', needsTotp: true });
    }
  }
  clearFailures(ip);
  req.session.authenticated = true;
  req.session.loginTime = Date.now();
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.post('/api/auth/reset-totp', (req, res) => {
  if (!req.session?.authenticated) return res.status(401).json({ error: 'Unauthorised' });
  const auth = loadAuth();
  saveAuth({ ...auth, totpSecret: null, totpVerified: false });
  req.session.destroy();
  res.json({ ok: true });
});

app.post('/api/auth/change-passphrase', async (req, res) => {
  if (!req.session?.authenticated) return res.status(401).json({ error: 'Unauthorised' });
  const auth = loadAuth();
  const { currentPassphrase, newPassphrase } = req.body;
  if (!newPassphrase || newPassphrase.length < 8) return res.status(400).json({ error: 'New passphrase must be at least 8 characters' });
  const ok = await bcrypt.compare(currentPassphrase, auth.passphraseHash);
  if (!ok) return res.status(401).json({ error: 'Current passphrase is wrong' });
  saveAuth({ ...auth, passphraseHash: await bcrypt.hash(newPassphrase, 12) });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// SCHEDULER ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/scheduler', (req, res) => {
  res.json(loadScheduler());
});

app.post('/api/scheduler', (req, res) => {
  const { enabled, hour, minute, concurrency } = req.body;
  const sched = {
    enabled: !!enabled,
    hour: Math.max(0, Math.min(23, parseInt(hour) || 3)),
    minute: Math.max(0, Math.min(59, parseInt(minute) || 0)),
    concurrency: ['1','3','5','unlimited'].includes(String(concurrency)) ? concurrency : 1,
    sshTimeout: [60, 120, 300, 600, 900].includes(parseInt(req.body.sshTimeout)) ? parseInt(req.body.sshTimeout) : 120,

  };
  saveScheduler(sched);
  startCron(); // restart with new settings
  res.json({ ok: true, ...sched });
});

// Manual trigger — runs check now
app.post('/api/scheduler/run-now', (req, res) => {
  if (checkRunning) {
    return res.status(409).json({ ok: false, busy: true, message: 'Check already in progress' });
  }
  if (upgradeRunning) {
    return res.status(409).json({ ok: false, busy: true, message: 'Cannot check while upgrade is running' });
  }
  checkRunning = true;
  currentCheckTrigger = 'manual';
  res.json({ ok: true, message: 'Update check started' });
  runUpdateCheck().catch(err => {
    console.error('[scheduler] Manual run error:', err.message);
    checkRunning = false;
  });
});

// Cancel in-flight check
app.delete('/api/scheduler/run-now', (req, res) => {
  if (!checkRunning) return res.json({ ok: true, message: 'No check running' });
  checkCancelled = true;
  // Kill all active SSH connections immediately
  for (const conn of activeCheckConns) { try { conn.end(); } catch {} }
  activeCheckConns.clear();
  res.json({ ok: true, message: 'Check cancelled' });
});

// Check status — lets frontend poll whether a check is running
app.get('/api/scheduler/status', (req, res) => {
  res.json({
    running: checkRunning,
    upgrading: upgradeRunning,
    progress: checkProgress,
  });
});

// Get cached update results
app.get('/api/updates', (req, res) => {
  res.json(loadUpdateCache());
});

// Get check history
app.get('/api/updates/history', (req, res) => {
  res.json(loadHistory());
});

// ════════════════════════════════════════════════════════════════════════════
// UPDATE-ALL ROUTE
// Runs apt-upgrade sequentially or with concurrency limit
// Streams progress via a single broadcast job
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/updates/run-all', (req, res) => {
  if (upgradeRunning) {
    return res.status(409).json({ ok: false, busy: true, message: 'Upgrade already in progress' });
  }
  if (checkRunning) {
    return res.status(409).json({ ok: false, busy: true, message: 'Cannot upgrade while check is running' });
  }
  const { vmids } = req.body;
  if (!Array.isArray(vmids) || vmids.length === 0)
    return res.status(400).json({ error: 'No containers specified' });

  upgradeRunning = true; // set synchronously before any await

  const sched = loadScheduler();
  const concurrency = sched.concurrency === 'unlimited' ? vmids.length : parseInt(sched.concurrency) || 1;

  const jobId = `update-all-${Date.now()}`;
  const job = createJob(jobId, { command: 'update-all', total: vmids.length, done: 0 });
  res.json({ ok: true, jobId });

  const config = loadConfig();
  const APT_UPGRADE_CMD = 'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1';

  function emitGlobal(line, type = 'line') {
    job.lines.push({ t: type, v: line });
    broadcast(jobId, { type, line });
  }

  async function upgradeOne(item) {
    const host = config.hosts.find(h => h.id === item.hostId);
    if (!host) { emitGlobal(`[${item.name}] Host not found`, 'error'); return; }

    emitGlobal(`\n── ${item.name} (${item.hostId}/${item.vmid}) ──`, 'line');
    const cmd = `pct exec ${item.vmid} -- sh -c ${JSON.stringify(APT_UPGRADE_CMD)} </dev/null`;

    // Create a sub-job for individual streaming, pipe to master job too
    const subJobId = `${jobId}-${item.vmid}`;
    const subJob = createJob(subJobId, { command: 'apt-upgrade', vmid: item.vmid });

    // Wrap sshStream to also emit to master job
    const origBroadcast = broadcast;
    const { output, exitCode } = await new Promise((resolve) => {
      const conn = new SSHClient();
      let settled = false;
      let output = '';
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        emitGlobal(`[${item.name}] Timed out`, 'error');
        conn.end(); resolve({ output, exitCode: 1 });
      }, 5 * 60 * 1000);

      conn.on('ready', () => {
        conn.exec(cmd, { pty: false }, (err, stream) => {
          if (err) {
            emitGlobal(`[${item.name}] SSH exec error: ${err.message}`, 'error');
            if (!settled) { settled = true; clearTimeout(timer); conn.end(); resolve({ output, exitCode: 1 }); }
            return;
          }
          let buf = '';
          function flush(data) {
            buf += data.toString();
            output += data.toString();
            const parts = buf.split('\n');
            buf = parts.pop();
            for (const line of parts) {
              subJob.lines.push({ t: 'line', v: line });
              broadcast(subJobId, { type: 'line', line });
              emitGlobal(`  ${line}`);
            }
          }
          stream.on('data', flush);
          stream.stderr.on('data', d => {
            const line = d.toString().trimEnd();
            subJob.lines.push({ t: 'stderr', v: line });
            broadcast(subJobId, { type: 'stderr', line });
            emitGlobal(`  ${line}`, 'stderr');
          });
          stream.on('close', (code) => {
            if (buf) { emitGlobal(`  ${buf}`); }
            if (settled) return; settled = true; clearTimeout(timer); conn.end();
            subJob.status = 'done'; subJob.exitCode = code;
            broadcast(subJobId, { type: 'done', exitCode: code });
            resolve({ output, exitCode: code });
          });
        });
      });
      conn.on('error', (err) => {
        if (settled) return; settled = true; clearTimeout(timer);
        emitGlobal(`[${item.name}] SSH error: ${err.message}`, 'error');
        resolve({ output, exitCode: 1 });
      });
      conn.connect({ host: host.ip, port: host.sshPort || 22, username: host.sshUser || 'root', password: host.password, readyTimeout: 10000 });
    });

    job.done = (job.done || 0) + 1;
    emitGlobal(`── ${item.name} done (exit ${exitCode}) [${job.done}/${vmids.length}] ──`);
  }

  // Run with concurrency limit
  (async () => {
    emitGlobal(`Starting upgrade of ${vmids.length} container${vmids.length !== 1 ? 's' : ''} (concurrency: ${concurrency})`);
    const queue = [...vmids];
    async function worker() {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) await upgradeOne(item);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, vmids.length) }, worker);
    await Promise.all(workers);
    emitGlobal(`\n✓ All updates complete`);
    job.status = 'done'; job.exitCode = 0;
    broadcast(jobId, { type: 'done', exitCode: 0 });
    upgradeRunning = false;

    // Re-run check only if enabled in settings
    const schedSettings = loadScheduler();
    if (schedSettings.recheckAfterUpgrade && !checkRunning) {
      checkRunning = true;
      await runUpdateCheck();
    }
  })();
});

// ════════════════════════════════════════════════════════════════════════════
// PROXMOX ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/hosts', (req, res) => {
  const config = loadConfig();
  const safe = config.hosts.map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password }));
  res.json(safe);
});

app.post('/api/hosts', (req, res) => {
  const { name, ip, port, username, password, sshPort, sshUser } = req.body;
  if (!name || !ip || !username || !password) return res.status(400).json({ error: 'Missing fields' });
  const config = loadConfig();
  const id = Date.now().toString();
  config.hosts.push({ id, name, ip, port: port || 8006, username, password, sshPort: sshPort || 22, sshUser: sshUser || 'root' });
  saveConfig(config);
  res.json({ ok: true, id });
});

app.delete('/api/hosts/:id', (req, res) => {
  const config = loadConfig();
  config.hosts = config.hosts.filter(h => h.id !== req.params.id);
  saveConfig(config);
  res.json({ ok: true });
});

app.post('/api/hosts/:id/test', async (req, res) => {
  const config = loadConfig();
  const host = config.hosts.find(h => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  try {
    const version = await proxmoxGet(host, '/version');
    res.json({ ok: true, version: version.version });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

function pickGuestIp(ifaces) {
  if (!ifaces) return null;
  const candidates = [];
  for (const iface of ifaces) {
    if (iface['ip-addresses']) {
      for (const addr of iface['ip-addresses']) {
        const ip = addr['ip-address'];
        if (!ip || addr['ip-address-type'] !== 'ipv4') continue;
        if (ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
        candidates.push(ip);
      }
    }
    if (iface.inet) {
      const ip = iface.inet.split('/')[0];
      if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) candidates.push(ip);
    }
  }
  const priv = candidates.find(ip =>
    ip.startsWith('10.') || ip.startsWith('192.168.') ||
    (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31)
  );
  return priv || candidates[0] || null;
}

async function fetchGuestIp(host, nodeName, type, vmid, status) {
  if (status !== 'running') return null;
  try {
    if (type === 'lxc') {
      const ifaces = await proxmoxGet(host, `/nodes/${nodeName}/lxc/${vmid}/interfaces`);
      return pickGuestIp(ifaces);
    } else {
      const data = await proxmoxGet(host, `/nodes/${nodeName}/qemu/${vmid}/agent/network-get-interfaces`);
      return pickGuestIp(data?.result || []);
    }
  } catch { return null; }
}

app.get('/api/hosts/:id/scan', async (req, res) => {
  const config = loadConfig();
  const host = config.hosts.find(h => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  try {
    const nodes = await proxmoxGet(host, '/nodes');
    const results = await Promise.all(nodes.map(async (node) => {
      const [vms, lxcs, nodeStatus] = await Promise.all([
        proxmoxGet(host, `/nodes/${node.node}/qemu`).catch(() => []),
        proxmoxGet(host, `/nodes/${node.node}/lxc`).catch(() => []),
        proxmoxGet(host, `/nodes/${node.node}/status`).catch(() => ({})),
      ]);
      const enriched = async (items, type) => Promise.all(items.map(async item => {
        const guestIp = await fetchGuestIp(host, node.node, type, item.vmid, item.status);
        return { ...item, type, node: node.node, hostId: host.id, hostName: host.name, hostIp: host.ip, sshUser: host.sshUser || 'root', sshPort: host.sshPort || 22, guestIp };
      }));
      return { node: node.node, status: node.status, nodeStatus, vms: await enriched(vms, 'vm'), lxcs: await enriched(lxcs, 'lxc') };
    }));
    res.json({ ok: true, nodes: results });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.post('/api/hosts/:id/action', async (req, res) => {
  const { node, vmid, type, action } = req.body;
  const config = loadConfig();
  const host = config.hosts.find(h => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  const allowed = ['start', 'stop', 'reboot', 'shutdown', 'reset', 'suspend', 'resume'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const segment = type === 'lxc' ? 'lxc' : 'qemu';
  try {
    const result = await proxmoxPost(host, `/nodes/${node}/${segment}/${vmid}/status/${action}`);
    res.json({ ok: true, upid: result });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.post('/api/hosts/:id/exec', async (req, res) => {
  const { node, vmid, command } = req.body;
  const config = loadConfig();
  const host = config.hosts.find(h => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  const allowed = ['apt-check', 'apt-upgrade', 'apt-autoremove', 'enable-root-ssh'];
  if (!allowed.includes(command)) return res.status(400).json({ error: 'Command not permitted' });
  const cmds = {
    'apt-check':       'apt-get update -qq 2>&1 && apt-get upgrade --dry-run 2>/dev/null',
    'apt-upgrade':     'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1',
    'apt-autoremove':  'DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1',
    'enable-root-ssh': 'sed -i \'s/^#*\s*PermitRootLogin.*/PermitRootLogin yes/\' /etc/ssh/sshd_config && grep -q \'PermitRootLogin yes\' /etc/ssh/sshd_config || echo \'PermitRootLogin yes\' >> /etc/ssh/sshd_config && (systemctl restart ssh 2>/dev/null || service ssh restart 2>/dev/null || systemctl restart sshd 2>/dev/null) && echo \'Done — root SSH enabled\'',
  };
  const jobId = `${Date.now()}-${vmid}-${command}`;
  const job = createJob(jobId, { command, vmid, node });
  res.json({ ok: true, jobId });
  const pctCmd = `pct exec ${vmid} -- sh -c ${JSON.stringify(cmds[command])}`;
  const schedCfg = loadScheduler();
  const timeoutMs = (schedCfg.sshTimeout || 120) * 1000;
  sshStream(host, pctCmd, jobId, timeoutMs).then((exitCode) => {
    job.status = 'done'; job.exitCode = exitCode;
    broadcast(jobId, { type: 'done', exitCode });
  });
});

app.post('/api/hosts/:id/portscan', async (req, res) => {
  const { node, vmid, type } = req.body;
  const config = loadConfig();
  const host = config.hosts.find(h => h.id === req.params.id);
  if (!host) return res.status(404).json({ error: 'Host not found' });
  const jobId = `${Date.now()}-${vmid}-portscan`;
  const job = createJob(jobId, { command: 'port-scan', vmid, node });
  res.json({ ok: true, jobId });
  const SS_CMD = 'timeout 10 ss -tlnp 2>&1 || timeout 10 netstat -tlnp 2>&1 || echo "ss/netstat not available"';
  if (type === 'lxc') {
    const pctCmd = `pct exec ${vmid} -- sh -c ${JSON.stringify(SS_CMD)} </dev/null`;
    sshStream(host, pctCmd, jobId, 15000).then(exitCode => {
      job.status = 'done'; job.exitCode = exitCode;
      broadcast(jobId, { type: 'done', exitCode });
    });
  } else {
    (async () => {
      function emit(line, t = 'line') { job.lines.push({ t, v: line }); broadcast(jobId, { type: t, line }); }
      try {
        const { ticket, csrfToken, baseUrl } = await getTicket(host);
        const authHdr = { Cookie: `PVEAuthCookie=${ticket}`, CSRFPreventionToken: csrfToken };
        const readHdr = { Cookie: `PVEAuthCookie=${ticket}` };
        const execRes = await axios.post(`${baseUrl}/nodes/${node}/qemu/${vmid}/agent/exec`, { command: ['sh', '-c', SS_CMD] }, { httpsAgent, headers: authHdr });
        const pid = execRes.data.data.pid;
        const start = Date.now();
        let out = null;
        while (Date.now() - start < 30000) {
          await new Promise(r => setTimeout(r, 1000));
          const statusRes = await axios.get(`${baseUrl}/nodes/${node}/qemu/${vmid}/agent/exec-status?pid=${pid}`, { httpsAgent, headers: readHdr });
          const s = statusRes.data.data;
          if (s.exited) { out = s['out-data'] || ''; break; }
        }
        if (out === null) emit('Timed out waiting for guest agent', 'error');
        else { for (const line of out.split('\n')) emit(line); }
      } catch (err) {
        emit(`Guest agent error: ${err.response?.data?.message || err.message}`, 'error');
      }
      job.status = 'done'; job.exitCode = 0;
      broadcast(jobId, { type: 'done', exitCode: 0 });
    })();
  }
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  res.json(job);
});

app.get('/health', (req, res) => res.json({ ok: true }));

server.listen(PORT, () => console.log(`Proxmox Admin running on :${PORT}`));

// ════════════════════════════════════════════════════════════════════════════
// HOME ASSISTANT INTEGRATION
// ════════════════════════════════════════════════════════════════════════════

const HA_CONFIG_PATH = path.join('/app/config', 'ha-config.json');

function loadHaConfig() {
  try { if (fs.existsSync(HA_CONFIG_PATH)) return JSON.parse(fs.readFileSync(HA_CONFIG_PATH, 'utf8')); } catch {}
  return null;
}

function saveHaConfig(cfg) {
  fs.mkdirSync(path.dirname(HA_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(HA_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function sanitiseHostname(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function pushHaSensors(checkResults, trigger = 'manual') {
  const cfg = loadHaConfig();
  if (!cfg?.url || !cfg?.token) return;

  const base = cfg.url.replace(/\/$/, '');
  const headers = {
    'Authorization': `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
  };

  const now = new Date().toISOString();
  const cache = loadUpdateCache();
  const containers = cache.containers || [];

  // Group by host
  const byHost = {};
  for (const c of containers) {
    if (!byHost[c.hostName]) byHost[c.hostName] = [];
    byHost[c.hostName].push(c);
  }

  const pushState = async (entityId, state, attributes = {}) => {
    try {
      await axios.post(`${base}/api/states/${entityId}`, { state, attributes }, { headers, timeout: 10000 });
    } catch (err) {
      console.error(`[ha] Failed to push ${entityId}: ${err.message}`);
    }
  };

  // Per-host sensors
  for (const [hostName, hostContainers] of Object.entries(byHost)) {
    const slug = sanitiseHostname(hostName);
    const withUpdates = hostContainers.filter(c => c.hasUpdates).length;
    const checked = hostContainers.length;

    await pushState(
      `sensor.proxmoxadminpanel_${slug}_containers_with_updates`,
      withUpdates,
      { friendly_name: `Proxmox Admin (${hostName}) — Updates Pending`, unit_of_measurement: 'containers', icon: 'mdi:package-up' }
    );
    await pushState(
      `sensor.proxmoxadminpanel_${slug}_containers_checked`,
      checked,
      { friendly_name: `Proxmox Admin (${hostName}) — Containers Checked`, unit_of_measurement: 'containers', icon: 'mdi:server' }
    );
    await pushState(
      `sensor.proxmoxadminpanel_${slug}_last_check`,
      cache.lastRun || now,
      { friendly_name: `Proxmox Admin (${hostName}) — Last Check`, device_class: 'timestamp', icon: 'mdi:clock-check' }
    );
  }

  // Global rollup sensors
  const totalWithUpdates = containers.filter(c => c.hasUpdates).length;
  const totalChecked = containers.length;
  const history = loadHistory();
  const lastRun = history[0] || {};
  const outcome = lastRun.cancelled ? 'cancelled' : lastRun.errors > 0 ? 'errors' : 'ok';
  const durationSecs = lastRun.durationMs ? Math.round(lastRun.durationMs / 1000) : null;

  await pushState('sensor.proxmoxadminpanel_total_containers_with_updates', totalWithUpdates,
    { friendly_name: 'Proxmox Admin — Total Updates Pending', unit_of_measurement: 'containers', icon: 'mdi:package-up' });

  await pushState('sensor.proxmoxadminpanel_total_containers_checked', totalChecked,
    { friendly_name: 'Proxmox Admin — Total Containers Checked', unit_of_measurement: 'containers', icon: 'mdi:server-network' });

  await pushState('sensor.proxmoxadminpanel_last_check', cache.lastRun || now,
    { friendly_name: 'Proxmox Admin — Last Check', device_class: 'timestamp', icon: 'mdi:clock-check' });

  await pushState('sensor.proxmoxadminpanel_last_check_trigger', trigger,
    { friendly_name: 'Proxmox Admin — Last Check Trigger', icon: 'mdi:calendar-clock' });

  await pushState('sensor.proxmoxadminpanel_last_check_outcome', outcome,
    { friendly_name: 'Proxmox Admin — Last Check Outcome', icon: 'mdi:check-circle' });

  if (durationSecs !== null) {
    await pushState('sensor.proxmoxadminpanel_last_check_duration_seconds', durationSecs,
      { friendly_name: 'Proxmox Admin — Last Check Duration', unit_of_measurement: 's', icon: 'mdi:timer' });
  }

  console.log(`[ha] Pushed ${Object.keys(byHost).length} host(s) + global sensors to Home Assistant`);
}

// ── HA Routes ─────────────────────────────────────────────────────────────────

// Get current HA config (token redacted)
app.get('/api/ha/config', (req, res) => {
  const cfg = loadHaConfig();
  if (!cfg) return res.json({ configured: false });
  res.json({ configured: true, url: cfg.url, tokenHint: '••••••••' + (cfg.token?.slice(-4) || '') });
});

// Save + test HA connection
app.post('/api/ha/connect', async (req, res) => {
  const { url, token } = req.body;
  if (!url || !token) return res.status(400).json({ ok: false, error: 'URL and token are required' });

  const base = url.replace(/\/$/, '');
  try {
    // Test connection by hitting the HA API
    const test = await axios.get(`${base}/api/`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const haVersion = test.data?.version || 'unknown';

    // Save config
    saveHaConfig({ url: base, token });

    // Push current state immediately
    await pushHaSensors(null, 'manual');

    res.json({ ok: true, haVersion });
  } catch (err) {
    const detail = err.response?.status === 401
      ? 'Invalid token — check your Long-Lived Access Token'
      : err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT'
        ? 'Could not reach Home Assistant — check the URL'
        : err.message;
    res.status(502).json({ ok: false, error: detail });
  }
});

// Disconnect / remove HA config
app.delete('/api/ha/config', (req, res) => {
  try { fs.unlinkSync(HA_CONFIG_PATH); } catch {}
  res.json({ ok: true });
});

// Manual push (test button)
app.post('/api/ha/push', async (req, res) => {
  const cfg = loadHaConfig();
  if (!cfg) return res.status(400).json({ ok: false, error: 'Not connected to Home Assistant' });
  await pushHaSensors(null, 'manual');
  res.json({ ok: true });
});
