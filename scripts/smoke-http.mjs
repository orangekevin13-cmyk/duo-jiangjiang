// smoke-http.mjs — 像浏览器一样通过 HTTP+SSE 驱动已启动的服务。
//   先启动：node server/server.mjs --mock（或 --live）
//   再运行：node scripts/smoke-http.mjs
//   失败路径：BAD_CODE=1 node scripts/smoke-http.mjs
//
// 注意：會話係綁喺 cookie 上嘅（每位訪客獨立），所以呢個腳本要自己帶 cookie jar，
// 否則每個請求都會開一個新會話，場景之間嘅狀態就接唔上。
// 如果服務開咗密碼保護：DEMO_PASSWORD=xxx node scripts/smoke-http.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8710';
const PASSWORD = process.env.DEMO_PASSWORD || '';

const jar = new Map();
function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
function absorbCookies(res) {
  for (const sc of res.headers.getSetCookie?.() || []) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function raw(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const c = cookieHeader();
  if (c) headers.cookie = c;
  if (PASSWORD) headers['x-demo-password'] = PASSWORD;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  absorbCookies(res);
  return res;
}

async function call(scenario, input = {}) {
  const res = await raw(`/api/scenario/${scenario}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) {
    console.error('未通過認證：呢個服務開咗密碼保護，請用 DEMO_PASSWORD=xxx 再跑。');
    process.exit(1);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let events = 0;
  let done = null;
  while (true) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const f of frames) {
      const line = f.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const ev = JSON.parse(line.slice(5).trim());
      events += 1;
      if (ev.type === 'done') done = ev.payload;
    }
  }
  return { events, done };
}

const reset = await (await raw('/api/reset', { method: 'POST' })).json();
console.log('reset:', reset.ok, 'mode:', reset.state.mode, '| session:', reset.state.session_id);

const seq = [
  ['lesson-complete', { lessonId: 'L-01' }],
  ['prerun', {}],
  ['arrive', { gpsScenario: 'arrived' }],
  ['verify-code', {}],
  ['reward', {}],
  ['share-and-next', { style: 'playful', privacy: 'friends' }],
];

let code = null;
for (const [name, input] of seq) {
  if (name === 'verify-code') input.code = process.env.BAD_CODE ? '0000' : code;
  const { events, done } = await call(name, input);
  const d = done?.panel?.data || {};
  console.log(
    `${name.padEnd(16)} ok=${done?.ok} mode=${done?.mode} events=${events} ${done?.elapsed_ms}ms :: ` +
      (name === 'lesson-complete'
        ? d.title
        : name === 'prerun'
          ? `${d.dialogue?.length} turns, tips ${d.coach_tips?.length}`
          : name === 'arrive'
            ? `inside=${d.inside_geofence} dist=${d.distance_m} code=${d.code?.code}`
            : name === 'verify-code'
              ? `redeemed=${d.redeemed} reason=${d.reason}`
              : name === 'reward'
                ? `verified=${d.verified} stamp="${d.stamp?.name}" +${d.rewards?.xp}XP +${d.rewards?.gems}G streak=${d.rewards?.streak_after}`
                : `headline="${d.share_card?.headline}" next=${d.next_lesson?.lesson_id} league=${d.leaderboard?.league}`),
  );
  if (name === 'arrive') code = d.code?.code;
}

const state = await (await raw('/api/state')).json();
console.log('final state:', {
  session: state.session_id,
  missions: state.mission_count,
  tool_calls: state.tool_calls,
  completed: state.completed,
  has_code: state.has_code,
});

// ---- 到店验证的四种 fixture：确认"同一个按钮，结果不同" ---------------
if (process.env.SKIP_GPS_MATRIX) process.exit(0);
console.log('\n-- GPS fixture matrix (场景 3 的四种现实情况) --');
const EXPECT = {
  arrived: { inside: true, verdict: 'passed' },
  enroute: { inside: false, verdict: 'failed' },
  drift: { inside: false, verdict: 'failed' },
  spoofed: { inside: true, verdict: 'manual_review' },
};
let matrixOk = true;
for (const [scenario, want] of Object.entries(EXPECT)) {
  const { done } = await call('arrive', { gpsScenario: scenario });
  const d = done?.panel?.data || {};
  const ok =
    d.inside_geofence === want.inside &&
    d.verdict === want.verdict &&
    (scenario !== 'spoofed' || (d.risk_flags || []).some((f) => f.includes('重合')));
  matrixOk = matrixOk && ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${scenario.padEnd(8)} inside=${d.inside_geofence} verdict=${d.verdict} ` +
      `dist=${d.distance_m}m acc=±${d.gps_accuracy_m}m code=${d.code?.code || '-'} flags=[${(d.risk_flags || []).join('；')}]`,
  );
}
console.log(matrixOk ? '\nGPS matrix: ALL PASS' : '\nGPS matrix: FAILURES ABOVE');
process.exit(matrixOk ? 0 : 1);
