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

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3001;
const CONFIG_PATH = path.join('/app/config', 'proxmox-hosts.json');
const AUTH_PATH  = path.join('/app/config', 'auth.json');

// ── Brute force lockout store ────────────────────────────────────────────────
// ip -> { attempts, lockedUntil }
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000; // 15 min

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
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    console.log(`[auth] IP ${ip} locked out for 15 min`);
  }
  loginAttempts.set(ip, entry);
}

function clearFailures(ip) {
  loginAttempts.delete(ip);
}

// ── Auth config persistence ──────────────────────────────────────────────────

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_PATH)) return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {}
  return { passphraseHash: null, totpSecret: null, totpVerified: false };
}

function saveAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
}

// ── Session setup ────────────────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
// Warning: if SESSION_SECRET is not set via env, it rotates on restart (all sessions invalidated)

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24h
    secure: false, // set true if serving over HTTPS
  },
  name: 'pxadmin_sid',
});

app.use(cors({ origin: false })); // lock down - no cross-origin
app.use(express.json());
app.use(sessionMiddleware);

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorised' });
}

// Apply auth to all /api/* routes except /api/auth/*
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

// ── WebSocket auth ───────────────────────────────────────────────────────────

// Wrap WS upgrade to check session before allowing connection
// Single upgrade handler — noServer:true means ws won't auto-handle anything
// We do it manually here with session auth check
const upgrading = new WeakSet();
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') { socket.destroy(); return; }
  if (upgrading.has(socket)) return;
  upgrading.add(socket);

  sessionMiddleware(req, {}, () => {
    if (!req.session?.authenticated) {
      socket.write('HTTP/1.1 401 Unauthorised\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      upgrading.delete(socket);
      wss.emit('connection', ws, req);
    });
  });
});

// ── WebSocket broadcast ──────────────────────────────────────────────────────

const subscriptions = new Map();

function broadcast(jobId, msg) {
  const subs = subscriptions.get(jobId);
  if (!subs) return;
  const payload = JSON.stringify(msg);
  for (const ws of subs) {
    if (ws.readyState === 1) ws.send(payload);
  }
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
        if (job) {
          ws.send(JSON.stringify({ type: 'replay', lines: job.lines, status: job.status, exitCode: job.exitCode }));
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    if (subscribedJob) subscriptions.get(subscribedJob)?.delete(ws);
  });
});

// ── Config persistence ───────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return { hosts: [] };
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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

    // Hard timeout — kills the connection if the command never exits
    timer = setTimeout(() => {
      emit(`Command timed out after ${timeoutMs/1000}s`, 'error');
      finish(1);
    }, timeoutMs);

    conn.on('ready', () => {
      console.log(`[ssh] connected to ${host.ip}, running: ${command.slice(0,80)}...`);
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
        stream.on('close', (code) => { console.log(`[ssh] stream closed, code=${code}, buf=${JSON.stringify(buf.slice(0,50))}`); if (buf) emit(buf); finish(code); });
      });
    });

    conn.on('error', (err) => { emit(`SSH error: ${err.message}`, 'error'); finish(1); });
    conn.connect({ host: host.ip, port: host.sshPort || 22, username: host.sshUser || 'root', password: host.password, readyTimeout: 10000 });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════

// Status — tells the frontend what state we're in
app.get('/api/auth/status', (req, res) => {
  const auth = loadAuth();
  res.json({
    configured: !!auth.passphraseHash,
    totpEnabled: !!auth.totpSecret && auth.totpVerified,
    totpPending: !!auth.totpSecret && !auth.totpVerified,
    authenticated: !!req.session?.authenticated,
  });
});

// First-time setup — set passphrase and generate TOTP secret
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

// Verify TOTP during setup (confirms user scanned it correctly)
app.post('/api/auth/setup/verify-totp', (req, res) => {
  const auth = loadAuth();
  if (!auth.totpSecret) return res.status(400).json({ error: 'No TOTP secret generated' });
  if (auth.totpVerified) return res.status(400).json({ error: 'Already verified' });

  const { token } = req.body;
  if (!authenticator.verify({ token, secret: auth.totpSecret })) {
    return res.status(401).json({ error: 'Invalid code — check your authenticator app' });
  }

  saveAuth({ ...auth, totpVerified: true });
  res.json({ ok: true });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip;
  const locked = checkLockout(ip);
  if (locked) return res.status(429).json({ error: locked });

  const auth = loadAuth();
  if (!auth.passphraseHash) return res.status(400).json({ error: 'Not configured yet' });

  const { passphrase, totpToken } = req.body;

  // Check passphrase
  const ok = await bcrypt.compare(passphrase, auth.passphraseHash);
  if (!ok) {
    recordFailure(ip);
    const entry = loginAttempts.get(ip);
    const remaining = MAX_ATTEMPTS - (entry?.attempts || 0);
    return res.status(401).json({ error: `Wrong passphrase. ${remaining > 0 ? `${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` : 'Account locked.'}` });
  }

  // Check TOTP
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

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Reset TOTP — clears secret, forces re-setup on next login
app.post('/api/auth/reset-totp', (req, res) => {
  if (!req.session?.authenticated) return res.status(401).json({ error: 'Unauthorised' });
  const auth = loadAuth();
  saveAuth({ ...auth, totpSecret: null, totpVerified: false });
  req.session.destroy();
  res.json({ ok: true });
});

// Change passphrase (requires current passphrase + TOTP)
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
// PROXMOX API ROUTES (all protected by requireAuth middleware above)
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

// Pick best IP — handles both LXC (/interfaces) and VM (guest agent) response shapes
// LXC shape:  [{ name, hwaddr, inet: '192.168.1.x/24', inet6: '...' }, ...]
// VM shape:   [{ name, 'ip-addresses': [{ 'ip-address': '...', 'ip-address-type': 'ipv4' }] }, ...]
function pickGuestIp(ifaces) {
  if (!ifaces) return null;
  const candidates = [];

  for (const iface of ifaces) {
    // VM guest agent format
    if (iface['ip-addresses']) {
      for (const addr of iface['ip-addresses']) {
        const ip = addr['ip-address'];
        if (!ip || addr['ip-address-type'] !== 'ipv4') continue;
        if (ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
        candidates.push(ip);
      }
    }
    // LXC format — inet is like '192.168.1.100/24'
    if (iface.inet) {
      const ip = iface.inet.split('/')[0];
      if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) candidates.push(ip);
    }
  }

  // Prefer RFC1918 private ranges
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
      // VM — needs qemu-guest-agent
      const data = await proxmoxGet(host, `/nodes/${nodeName}/qemu/${vmid}/agent/network-get-interfaces`);
      return pickGuestIp(data?.result || []);
    }
  } catch {
    return null; // guest agent not installed or guest stopped
  }
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

      // Fetch IPs in parallel for all guests
      const enriched = async (items, type) => {
        return Promise.all(items.map(async item => {
          const guestIp = await fetchGuestIp(host, node.node, type, item.vmid, item.status);
          return {
            ...item, type, node: node.node, hostId: host.id, hostName: host.name,
            hostIp: host.ip, sshUser: host.sshUser || 'root', sshPort: host.sshPort || 22,
            guestIp, // null if unavailable
          };
        }));
      };

      return {
        node: node.node, status: node.status, nodeStatus,
        vms: await enriched(vms, 'vm'),
        lxcs: await enriched(lxcs, 'lxc'),
      };
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
    'apt-check':        'apt-get update -qq 2>&1 && apt list --upgradable 2>/dev/null',
    'apt-upgrade':      'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y 2>&1',
    'apt-autoremove':   'DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1',
    'enable-root-ssh':  'sed -i \'s/^#*\s*PermitRootLogin.*/PermitRootLogin yes/\' /etc/ssh/sshd_config && grep -q \'PermitRootLogin yes\' /etc/ssh/sshd_config || echo \'PermitRootLogin yes\' >> /etc/ssh/sshd_config && (systemctl restart ssh 2>/dev/null || service ssh restart 2>/dev/null || systemctl restart sshd 2>/dev/null) && echo \'Done — root SSH enabled\'',
  };

  const jobId = `${Date.now()}-${vmid}-${command}`;
  const job = createJob(jobId, { command, vmid, node });
  res.json({ ok: true, jobId });

  const pctCmd = `pct exec ${vmid} -- sh -c ${JSON.stringify(cmds[command])}`;
  sshStream(host, pctCmd, jobId).then((exitCode) => {
    job.status = 'done';
    job.exitCode = exitCode;
    broadcast(jobId, { type: 'done', exitCode });
  });
});


// Port scan — runs ss -tlnp inside the guest
// LXC: SSH to host + pct exec
// VM:  QEMU guest agent exec API
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
    // </dev/null redirects stdin at the pct level, not inside the container shell
    const pctCmd = `pct exec ${vmid} -- sh -c ${JSON.stringify(SS_CMD)} </dev/null`;
    console.log(`[portscan] LXC ${vmid} — SSH to ${host.ip}, cmd: ${pctCmd}`);
    sshStream(host, pctCmd, jobId, 15000).then(exitCode => {
      console.log(`[portscan] LXC ${vmid} done, exit=${exitCode}, lines=${job.lines.length}`);
      job.status = 'done'; job.exitCode = exitCode;
      broadcast(jobId, { type: 'done', exitCode });
    });
  } else {
    // VM: QEMU guest agent exec, then poll for output
    (async () => {
      function emit(line, t = 'line') {
        job.lines.push({ t, v: line });
        broadcast(jobId, { type: t, line });
      }
      try {
        const { ticket, csrfToken, baseUrl } = await getTicket(host);
        const authHdr = { Cookie: `PVEAuthCookie=${ticket}`, CSRFPreventionToken: csrfToken };
        const readHdr = { Cookie: `PVEAuthCookie=${ticket}` };

        // Start agent exec
        const execRes = await axios.post(
          `${baseUrl}/nodes/${node}/qemu/${vmid}/agent/exec`,
          { command: ['sh', '-c', SS_CMD] },
          { httpsAgent, headers: authHdr }
        );
        const pid = execRes.data.data.pid;

        // Poll for completion (max 30s)
        const start = Date.now();
        let out = null;
        while (Date.now() - start < 30000) {
          await new Promise(r => setTimeout(r, 1000));
          const statusRes = await axios.get(
            `${baseUrl}/nodes/${node}/qemu/${vmid}/agent/exec-status?pid=${pid}`,
            { httpsAgent, headers: readHdr }
          );
          const s = statusRes.data.data;
          if (s.exited) { out = s['out-data'] || ''; break; }
        }

        if (out === null) { emit('Timed out waiting for guest agent', 'error'); }
        else {
          for (const line of out.split('\n')) emit(line);
        }
      } catch (err) {
        const detail = err.response?.data?.message || err.message;
        emit(`Guest agent error: ${detail} — is qemu-guest-agent installed and running?`, 'error');
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
