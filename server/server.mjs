// server.mjs — zero-dependency HTTP server for the Duo 講講 (Cantonese SpeakOut Pass) demo.
//   POST /api/scenario/:name   -> run one scenario (SSE event stream by default)
//   GET  /api/state            -> current demo session state
//   POST /api/reset            -> clear session state
//   POST /api/config           -> switch live / mock / auto mode
//   GET  /api/geo/:merchantId  -> demo GPS simulator fixtures

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, resolveApiKey, DEFAULT_MODEL, DEEPSEEK_BASE_URL } from './llm.mjs';
import { runScenario, SCENARIOS, resolveGps } from './agent.mjs';
import { GEOFENCE_RADIUS_M } from './tools.mjs';
import { USER_PROFILE, getMerchant, makeDynamicCode, newCodeSalt } from './store.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_PORT = Number(process.env.PORT || 8710);

/**
 * Bind address. Default stays loopback (safe: nobody else on the network can reach the demo).
 * Set HOST=0.0.0.0 to let other people open the demo from their own device on the same LAN:
 *   HOST=0.0.0.0 node server/server.mjs
 */
const HOST = process.env.HOST || '127.0.0.1';
const IS_PUBLIC = HOST !== '127.0.0.1' && HOST !== 'localhost';

/**
 * Hosted-demo hardening. All three are opt-in so local presenting stays frictionless.
 *
 *   DEMO_PASSWORD   shared password for a hosted demo. Also accepts a full URL:
 *                   DEMO_PASSWORD=https://duo.example.com/?k=SECRET
 *                   (the password is asked for once, then stored in a cookie)
 *   DEMO_MODE       default model mode for new sessions: auto | live | mock
 *   LIVE_ALLOWED    0 = never call the paid model, even if a key exists (recommended when public)
 *   RATE_PER_MIN    max scenario runs per client per minute (default 20)
 *   GLOBAL_CONCURRENCY  max scenario runs in flight at once (default 4)
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '';
const AUTH_REQUIRED = Boolean(DEMO_PASSWORD);
const DEFAULT_MODE = process.env.DEMO_MODE || (process.argv.includes('--mock') ? 'mock' : process.argv.includes('--live') ? 'live' : 'auto');
const LIVE_ALLOWED = process.env.LIVE_ALLOWED !== '0';
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN || 20);
const GLOBAL_CONCURRENCY = Number(process.env.GLOBAL_CONCURRENCY || 4);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MINUTES || 90) * 60 * 1000;

const credential = resolveApiKey();
const client = createClient({});

/* ------------------------------------------------------------------ *
 * Demo sessions — one per visitor, so nobody can reset anybody else's run.
 * ------------------------------------------------------------------ */
function newSession(id) {
  return {
    id,
    startedAt: Date.now(),
    lastSeen: Date.now(),
    mode: DEFAULT_MODE, // auto | live | mock
    // Per-session salt → two concurrent visitors never receive the same dynamic code.
    codeSalt: newCodeSalt(),
    missions: [],
    activeMission: null,
    events: [],
    toolCalls: 0,
    issuedCode: null,
    locationCheck: null,
    arrival: null,
    rehearsal: null,
    completed: null,
    share: null,
    reward: null,
    rewardPanel: null,
  };
}

/** @type {Map<string, ReturnType<typeof newSession>>} */
const sessions = new Map();
const sessionId = () => `S-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  s.lastSeen = Date.now();
  return s;
}

function createSession() {
  const s = newSession(sessionId());
  sessions.set(s.id, s);
  return s;
}

/** Drop idle sessions so a long-running hosted demo cannot grow memory forever. */
function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) sessions.delete(id);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

/**
 * Resolve (or create) the session for this request and keep the cookie in sync.
 * The caller has already established that the request is authenticated — do NOT re-check here,
 * or header-authenticated callers (scripts, curl) end up with a null session.
 */
function resolveSession(req, res) {
  const existing = readCookie(req, 'duo_sid');
  let s = getSession(existing);
  if (!s) {
    s = createSession();
    res.setHeader('set-cookie', `duo_sid=${s.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  }
  return s;
}

/* ---------------------------- auth ---------------------------- */
const crypto = await import('node:crypto');

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isAuthed(req) {
  if (!AUTH_REQUIRED) return true;
  const token = readCookie(req, 'duo_key');
  return Boolean(token) && timingSafeEqual(token, DEMO_PASSWORD);
}

function isAuthedHeader(req) {
  // Also accept the password as a header/basic auth so scripts can drive a hosted demo.
  const h = req.headers['x-demo-password'];
  if (h && timingSafeEqual(h, DEMO_PASSWORD)) return true;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      if (timingSafeEqual(pass, DEMO_PASSWORD)) return true;
    } catch {
      /* malformed header → not authenticated */
    }
  }
  return false;
}

/** Minimal HTML login page. No assets, no framework, no external requests. */
function loginPage(error = '') {
  return `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Duo 講講 · 需要密碼</title>
<style>
  :root { --green:#58cc02; --green-deep:#58a700; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f7f7f7;
         font-family:'Nunito','Varela Round','Microsoft JhengHei UI','PingFang HK',system-ui,sans-serif; color:#3c3c3c; }
  .card { background:#fff; border:2px solid #e5e5e5; border-bottom:4px solid #e5e5e5; border-radius:16px;
          padding:28px; width:380px; max-width:92vw; text-align:center; }
  h1 { font-size:24px; font-weight:800; color:#131f23; margin:0 0 6px; }
  p { font-size:13px; color:#777; font-weight:700; margin:0 0 18px; }
  input { width:100%; font:inherit; font-weight:800; text-align:center; padding:13px;
          border:2px solid #e5e5e5; border-radius:12px; margin-bottom:14px; }
  input:focus { outline:none; border-color:#1cb0f6; box-shadow:0 0 0 3px rgba(28,176,246,.2); }
  button { width:100%; font:inherit; font-size:15px; font-weight:800; letter-spacing:.03em;
           text-transform:uppercase; color:#fff; background:var(--green);
           border:none; border-bottom:4px solid var(--green-deep); border-radius:16px;
           padding:14px; cursor:pointer; }
  button:active { transform:translateY(4px); border-bottom-width:0; }
  .err { background:#ffe3e3; color:#cc3b3b; border-radius:12px; padding:9px; font-size:12px; font-weight:800; margin-bottom:12px; }
</style></head><body>
  <form class="card" method="POST" action="/login">
    <div style="font-size:44px;line-height:1">🦉</div>
    <h1>Duo 講講</h1>
    <p>Cantonese SpeakOut Pass · 請輸入示範密碼</p>
    ${error ? `<div class="err">${error}</div>` : ''}
    <input type="password" name="password" placeholder="Demo password" autofocus autocomplete="current-password" />
    <button type="submit">開始示範</button>
  </form>
</body></html>`;
}

/* -------------------------- rate limiting -------------------------- */
/** @type {Map<string, number[]>} */
const hits = new Map();
let inFlight = 0;

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function rateLimited(req) {
  const now = Date.now();
  const key = clientKey(req);
  const list = (hits.get(key) || []).filter((t) => now - t < 60_000);
  if (list.length >= RATE_PER_MIN) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function publicState(session) {
  if (!session) {
    return {
      session_id: null,
      mode: DEFAULT_MODE,
      auth_required: AUTH_REQUIRED,
      authenticated: false,
      scenarios: SCENARIOS,
    };
  }
  return {
    session_id: session.id,
    mode: session.mode,
    // What will *actually* run. On a hosted demo the owner can set LIVE_ALLOWED=0, and a visitor
    // who flips the switch to "live" must not be shown a "live" badge while mock output is served.
    effective_mode: effectiveMode(session),
    auth_required: AUTH_REQUIRED,
    authenticated: true,
    live_allowed: LIVE_ALLOWED,
    provider: {
      has_key: client.hasKey,
      key_source: credential.source,
      base_url: DEEPSEEK_BASE_URL,
      model: client.model,
      // `live_ready` is what the UI should trust: a hosted demo can have a key but still refuse
      // to spend the owner's tokens.
      live_ready: client.hasKey && LIVE_ALLOWED,
    },
    user: USER_PROFILE,
    geofence_radius_m: GEOFENCE_RADIUS_M,
    active_mission: session.activeMission,
    mission_count: session.missions.length,
    tool_calls: session.toolCalls,
    has_code: Boolean(session.issuedCode && !session.issuedCode.redeemed && Date.now() < session.issuedCode.expiresAt),
    code_expires_at: session.issuedCode?.expiresAt || null,
    completed: Boolean(session.completed),
    scenarios: SCENARIOS,
  };
}

/** Effective mode for a session: honour LIVE_ALLOWED so a public demo cannot burn the API key. */
function effectiveMode(session) {
  if (session.mode === 'mock') return 'mock';
  if (!LIVE_ALLOWED) return 'mock';
  if (session.mode === 'live' && !client.hasKey) return 'mock';
  return session.mode;
}

async function runScenarioRequest(name, input, res, session) {
  const wantsStream = String(input.__stream ?? '1') !== '0';
  const collected = [];
  let closed = false;

  const emit = (ev) => {
    const stamped = { ...ev, ts: Date.now() };
    collected.push(stamped);
    if (stamped.type === 'tool_result') session.toolCalls += 1;
    if (!wantsStream || closed) return;
    try {
      res.write(`data: ${JSON.stringify(stamped)}\n\n`);
    } catch {
      closed = true;
    }
  };

  if (wantsStream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
  }

  const t0 = Date.now();
  let result;
  let error = null;
  inFlight += 1;
  try {
    result = await runScenario(name, input, { mode: effectiveMode(session), client, session, emit });
  } catch (err) {
    error = err;
    emit({ type: 'error', message: String(err.message || err) });
  } finally {
    inFlight -= 1;
  }
  const elapsedMs = Date.now() - t0;

  const payload = error
    ? { ok: false, scenario: name, error: String(error.message || error), elapsed_ms: elapsedMs }
    : {
        ok: true,
        scenario: name,
        mode: result.mode,
        warning: result.warning || null,
        panel: result.panel,
        plan: result.plan || null,
        narration: result.narration || null,
        usage: result.usage || null,
        elapsed_ms: elapsedMs,
        state: publicState(session),
      };

  session.events.push({ name, at: new Date().toISOString(), elapsedMs, ok: !error, mode: result?.mode });

  if (wantsStream && !closed) {
    emit({ type: 'done', payload });
    res.end();
  } else if (!wantsStream) {
    sendJson(res, error ? 500 : 200, { ...payload, events: collected });
  } else {
    res.end();
  }
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found', path: rel });
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer(handleRequest);

/**
 * Error boundary. A hosted demo must never die because one request hit an unexpected path —
 * an unhandled throw in the handler would take the whole process down mid-presentation.
 */
async function handleRequest(req, res) {
  try {
    await route(req, res);
  } catch (err) {
    const msg = String(err?.message || err);
    console.error(`[duo-jiangjiang] 請求處理失敗 ${req.method} ${req.url} ::`, msg);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: `伺服器內部錯誤：${msg}` });
    } else {
      try {
        res.end();
      } catch {
        /* socket already gone */
      }
    }
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  /* ---------------- auth ---------------- */
  if (pathname === '/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const pass = String(body.password || '').trim();
      if (timingSafeEqual(pass, DEMO_PASSWORD)) {
        res.writeHead(302, {
          location: '/',
          'set-cookie': `duo_key=${encodeURIComponent(pass)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
        });
        res.end();
      } else {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage('密碼唔啱，再試一次。'));
      }
    } catch {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(loginPage('請求格式有問題。'));
    }
    return;
  }

  if (pathname === '/healthz') {
    // Unauthenticated liveness probe for hosting platforms. Deliberately leaks nothing but "up".
    sendJson(res, 200, { ok: true, sessions: sessions.size, in_flight: inFlight });
    return;
  }

  const authed = isAuthed(req) || (AUTH_REQUIRED && isAuthedHeader(req));

  if (AUTH_REQUIRED && !authed) {
    if (pathname.startsWith('/api/')) {
      sendJson(res, 401, { ok: false, error: 'auth required', auth_required: true });
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(loginPage());
    }
    return;
  }

  /* ------------- API: session-scoped ------------- */
  if (pathname === '/api/health') {
    const session = resolveSession(req, res);
    sendJson(res, 200, { ok: true, ...publicState(session) });
    return;
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    const session = resolveSession(req, res);
    sendJson(res, 200, publicState(session));
    return;
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    const session = resolveSession(req, res);
    session.missions = [];
    session.activeMission = null;
    session.issuedCode = null;
    session.locationCheck = null;
    session.arrival = null;
    session.rehearsal = null;
    session.completed = null;
    session.share = null;
    session.reward = null;
    session.rewardPanel = null;
    session.toolCalls = 0;
    session.events = [];
    session.codeSalt = newCodeSalt();
    sendJson(res, 200, { ok: true, state: publicState(session) });
    return;
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    const session = resolveSession(req, res);
    try {
      const body = await readBody(req);
      if (body.mode && ['auto', 'live', 'mock'].includes(body.mode)) session.mode = body.mode;
      sendJson(res, 200, { ok: true, state: publicState(session) });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err.message || err) });
    }
    return;
  }

  if (pathname.startsWith('/api/geo/') && req.method === 'GET') {
    const session = resolveSession(req, res);
    const merchant = getMerchant(pathname.split('/').pop());
    const fixtures = {
      arrived: resolveGps({ gpsScenario: 'arrived' }, merchant),
      enroute: resolveGps({ gpsScenario: 'enroute' }, merchant),
      drift: resolveGps({ gpsScenario: 'drift' }, merchant),
      spoofed: resolveGps({ gpsScenario: 'spoofed' }, merchant),
    };
    sendJson(res, 200, {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        district: merchant.district,
        address: merchant.address,
        lat: merchant.lat,
        lng: merchant.lng,
        walk_minutes: merchant.walkMinutes,
      },
      geofence_radius_m: GEOFENCE_RADIUS_M,
      fixtures,
      // Preview must use this session's salt, otherwise the demo contradicts itself.
      preview_code: makeDynamicCode(merchant.id, 180, session.codeSalt).code,
    });
    return;
  }

  if (pathname.startsWith('/api/scenario/') && req.method === 'POST') {
    const name = pathname.slice('/api/scenario/'.length);
    if (!SCENARIOS.includes(name)) {
      sendJson(res, 404, { ok: false, error: `unknown scenario: ${name}`, scenarios: SCENARIOS });
      return;
    }
    if (rateLimited(req)) {
      sendJson(res, 429, { ok: false, error: `太密啦：每分鐘最多 ${RATE_PER_MIN} 次，等一等再試。` });
      return;
    }
    if (inFlight >= GLOBAL_CONCURRENCY) {
      sendJson(res, 503, { ok: false, error: '而家太多人同時用，請等幾秒再試。' });
      return;
    }
    const session = resolveSession(req, res);
    try {
      const body = await readBody(req);
      await runScenarioRequest(name, body || {}, res, session);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err.message || err) });
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, error: `no such api: ${pathname}` });
    return;
  }

  serveStatic(req, res, pathname);
}

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`[speakout-pass] 端口 ${port} 被占用，尝试 ${port + 1}`);
      listen(port + 1, attempt + 1);
    } else {
      console.error('[speakout-pass] 启动失败:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const lanIps = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address);
    console.log('');
    console.log('  Duo 講講 · Cantonese SpeakOut Pass');
    console.log('  Duolingo 粵語課程嘅城市延伸 · 線下任務 Agent 演示');
    console.log(`  ➜  本機        http://127.0.0.1:${port}`);
    if (IS_PUBLIC && lanIps.length) {
      for (const ip of lanIps) console.log(`  ➜  同一個網絡  http://${ip}:${port}`);
      console.log('');
      if (!AUTH_REQUIRED) {
        console.log('  ⚠ 已綁定外部地址，但冇設 DEMO_PASSWORD：所有人都可以操作同重置。');
        console.log('    只喺可信網絡分享。要開放去公網，必須咁樣啟動：');
        console.log(`      DEMO_PASSWORD=你的密碼 DEMO_MODE=mock LIVE_ALLOWED=0 node server/server.mjs`);
      } else {
        console.log(`  🔒 已啟用密碼保護（DEMO_PASSWORD 已設定）`);
      }
    } else if (!IS_PUBLIC) {
      console.log('  ℹ 只監聽本機。要俾同一個 Wi-Fi 嘅人開，用：HOST=0.0.0.0 node server/server.mjs');
    }
    console.log(`  綁定地址: ${HOST}:${port}`);
    console.log(`  模型: ${DEFAULT_MODEL} @ ${DEEPSEEK_BASE_URL}`);
    console.log(`  API Key: ${client.hasKey ? `已检测到（${credential.source}）` : '未检测到 → 默认走离线 Mock 模式'}`);
    console.log(`  預設模式: ${DEFAULT_MODE}${LIVE_ALLOWED ? '' : '（LIVE_ALLOWED=0：即使有 Key 都唔會呼叫收費模型）'}`);
    console.log(`  限流: 每位訪客每分鐘 ${RATE_PER_MIN} 次 · 同時最多 ${GLOBAL_CONCURRENCY} 個場景`);
    console.log(`  會話: 每位訪客獨立（${SESSION_TTL_MS / 60000} 分鐘無活動自動回收）`);
    console.log('  品牌: Duolingo has gamified learning. Duo 講講 gamifies using.');

    // Misconfiguration warnings — better to shout at startup than to discover this on stage.
    if (!client.hasKey && (DEFAULT_MODE === 'live' || DEFAULT_MODE === 'auto')) {
      console.log('');
      console.log(`  ⚠ 預設模式係 ${DEFAULT_MODE}，但搵唔到 DEEPSEEK_API_KEY：`);
      console.log('    所有場景會走離線 Mock。要開真實模型就要設 DEEPSEEK_API_KEY。');
      console.log('    （Fly: fly secrets set DEEPSEEK_API_KEY=sk-...）');
    }
    if (!LIVE_ALLOWED) {
      console.log('');
      console.log('  ℹ LIVE_ALLOWED=0：即使有 Key 都唔會呼叫收費模型（成本保險絲生效）。');
      console.log(`    介面會顯示實際執行模式為 mock。想開真實模型：LIVE_ALLOWED=1`);
    }
    if (!AUTH_REQUIRED && IS_PUBLIC) {
      console.log('');
      console.log('  ⚠ 冇設 DEMO_PASSWORD 但已經對外綁定：任何人都可以重置演示。');
    }
    console.log('');
  });
}

pruneSessions();
setInterval(pruneSessions, 15 * 60 * 1000).unref();

listen(DEFAULT_PORT);
