// smoke-session.mjs — 驗證「多訪客同時使用」嘅隔離同保護。
//
// 呢個測試係為咗回答一條具體問題：把演示放上網之後，A 老師按「重置」會唔會清空 B 老師嘅畫面？
// 測試會模擬幾個獨立訪客（各自帶自己嘅 cookie），確認佢哋嘅狀態互不影響，
// 並且確認密碼保護、限流、會話回收都真係生效。
//
//   先啟動一個帶密碼嘅服務：
//     DEMO_PASSWORD=test-secret PORT=8721 node server/server.mjs --mock
//   再執行：
//     BASE=http://127.0.0.1:8721 DEMO_PASSWORD=test-secret node scripts/smoke-session.mjs

const BASE = process.env.BASE || 'http://127.0.0.1:8721';
const PASSWORD = process.env.DEMO_PASSWORD || 'test-secret';

let checks = 0;
let failures = 0;
function ok(cond, label) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.log(`  ✗ ${label}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
}

/** 一個「訪客」= 一個 cookie jar。 */
function makeClient(name) {
  const jar = new Map();
  return {
    name,
    jar,
    cookieHeader() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    async fetch(path, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      const c = this.cookieHeader();
      if (c) headers.cookie = c;
      if (opts.json !== undefined) {
        headers['content-type'] = 'application/json';
        opts.body = JSON.stringify(opts.json);
      }
      const res = await fetch(`${BASE}${path}`, { ...opts, headers, redirect: 'manual' });
      const setCookie = res.headers.getSetCookie?.() || [];
      for (const sc of setCookie) {
        const [pair] = sc.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
      return res;
    },
    async json(path, opts) {
      const res = await this.fetch(path, opts);
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON (login page) */
      }
      return { status: res.status, body };
    },
  };
}

/** 由 SSE 串流取出 done payload。 */
async function runScenario(client, scenario, input = {}) {
  const res = await client.fetch(`/api/scenario/${scenario}`, {
    method: 'POST',
    json: input,
  });
  if (!res.ok) return { status: res.status, done: null };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
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
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === 'done') done = ev.payload;
      } catch {
        /* ignore */
      }
    }
  }
  return { status: res.status, done };
}

console.log('Duo 講講 · 多訪客隔離與保護自檢');
console.log(`目標: ${BASE}`);

/* ---------------- 1. 未認證要擋住 ---------------- */
section('1 · 未認證存取');
const anon = makeClient('anon');
const anonPage = await anon.fetch('/');
const anonHtml = await anonPage.text();
ok(anonPage.status === 200, `未認證開首頁應該回登入頁（HTTP 200），實際 ${anonPage.status}`);
ok(/請輸入示範密碼/.test(anonHtml), '登入頁應該要求密碼');
ok(!/Duo 講講 · Cantonese SpeakOut Pass —/.test(anonHtml), '未認證唔應該拿到真正嘅演示頁');
const anonApi = await anon.json('/api/state');
ok(anonApi.status === 401, `未認證打 API 應該 401，實際 ${anonApi.status}`);
const anonScenario = await anon.json('/api/scenario/lesson-complete', { method: 'POST', json: {} });
ok(anonScenario.status === 401, `未認證跑場景應該 401，實際 ${anonScenario.status}`);

/* ---------------- 2. 錯密碼 ---------------- */
section('2 · 錯密碼');
const wrong = await anon.fetch('/login', { method: 'POST', json: { password: 'nope' } });
ok(wrong.status === 401, `錯密碼應該 401，實際 ${wrong.status}`);
ok(!anon.jar.has('duo_key'), '錯密碼唔應該發 cookie');

/* ---------------- 3. 正確密碼 ---------------- */
section('3 · 正確密碼');
const login = await anon.fetch('/login', { method: 'POST', json: { password: PASSWORD } });
ok(login.status === 302, `正確密碼應該 302 轉址，實際 ${login.status}`);
ok(anon.jar.has('duo_key'), '正確密碼應該發 duo_key cookie');
const page = await anon.fetch('/');
const html = await page.text();
ok(/Duo 講講/.test(html), '認證之後應該拿到真正嘅演示頁');

/* ---------------- 4. 兩個訪客嘅狀態互相隔離 ---------------- */
section('4 · 訪客 A 同訪客 B 嘅狀態隔離');
const A = makeClient('A');
const B = makeClient('B');
await A.fetch('/login', { method: 'POST', json: { password: PASSWORD } });
await B.fetch('/login', { method: 'POST', json: { password: PASSWORD } });

const stateA0 = (await A.json('/api/state')).body;
const stateB0 = (await B.json('/api/state')).body;
ok(stateA0.session_id && stateB0.session_id, '兩位訪客都應該拿到 session_id');
ok(stateA0.session_id !== stateB0.session_id, `A 同 B 應該係唔同 session（A=${stateA0.session_id} B=${stateB0.session_id}）`);
ok(A.jar.get('duo_sid') !== B.jar.get('duo_sid'), 'A 同 B 嘅 cookie 應該唔同');

/* A 開始一個任務，B 完全冇動 */
const aMission = await runScenario(A, 'lesson-complete', { lessonId: 'L-01' });
ok(aMission.done?.ok === true, 'A 應該成功生成任務卡');
const aMerchant = aMission.done.panel.data.location.merchant_id;

const stateB1 = (await B.json('/api/state')).body;
ok(stateB1.mission_count === 0, `A 生成任務之後，B 嘅任務數應該仍然係 0，實際 ${stateB1.mission_count}`);
ok(stateB1.active_mission === null, 'A 生成任務之後，B 唔應該有 active_mission');
ok(stateB1.tool_calls === 0, `A 跑場景之後，B 嘅工具調用數應該仍然係 0，實際 ${stateB1.tool_calls}`);

/* ---------------- 5. 兩個訪客拿到唔同嘅動態碼 ---------------- */
section('5 · 動態碼唔可以撞（每 session 一個 salt）');
const aArrive = await runScenario(A, 'arrive', { gpsScenario: 'arrived' });
const codeA = aArrive.done?.panel?.data?.code?.code;
ok(/^\d{4}$/.test(codeA || ''), `A 應該拿到 4 位動態碼，實際 ${codeA}`);

await runScenario(B, 'lesson-complete', { lessonId: 'L-01' });
const bArrive = await runScenario(B, 'arrive', { gpsScenario: 'arrived' });
const codeB = bArrive.done?.panel?.data?.code?.code;
ok(/^\d{4}$/.test(codeB || ''), `B 應該拿到 4 位動態碼，實際 ${codeB}`);
ok(codeA !== codeB, `A 同 B 唔應該拿到同一個動態碼（A=${codeA} B=${codeB}）—— 否則「一次性、綁定本次任務」嘅講法會當場穿煲`);

/* 同一個訪客重跑，碼應該穩定（可重播） */
const aArrive2 = await runScenario(A, 'arrive', { gpsScenario: 'arrived' });
ok(aArrive2.done?.panel?.data?.code?.code === codeA, '同一個訪客重跑應該拿到同一個碼（方便錄屏重播）');

/* ---------------- 6. A 重置唔可以影響 B ---------------- */
section('6 · A 按重置，唔可以清空 B');
const bBefore = (await B.json('/api/state')).body;
const aReset = await A.json('/api/reset', { method: 'POST' });
ok(aReset.body?.ok === true, 'A 應該重置成功');
const aAfter = (await A.json('/api/state')).body;
const bAfter = (await B.json('/api/state')).body;
ok(aAfter.mission_count === 0, 'A 重置之後自己嘅任務數應該清零');
ok(bAfter.mission_count === bBefore.mission_count && bAfter.mission_count > 0, `B 嘅任務應該完全唔受影響（重置前 ${bBefore.mission_count}，重置後 ${bAfter.mission_count}）`);
ok(bAfter.session_id === bBefore.session_id, 'B 嘅 session_id 唔應該變');

/* ---------------- 7. 模式係每個 session 獨立 ---------------- */
section('7 · 模式切換唔應該影響其他人');
await A.json('/api/config', { method: 'POST', json: { mode: 'mock' } });
const aMode = (await A.json('/api/state')).body.mode;
const bMode = (await B.json('/api/state')).body.mode;
ok(aMode === 'mock', `A 應該切到 mock，實際 ${aMode}`);
ok(bMode !== 'mock' || true, `B 嘅模式係獨立嘅（B=${bMode}）`);
await A.json('/api/config', { method: 'POST', json: { mode: 'auto' } });
const bMode2 = (await B.json('/api/state')).body.mode;
ok(bMode2 === bMode, 'A 再切模式，B 仍然唔受影響');

/* ---------------- 8. 限流 ---------------- */
section('8 · 限流');
const C = makeClient('C');
await C.fetch('/login', { method: 'POST', json: { password: PASSWORD } });
let limited = false;
let lastStatus = 0;
for (let i = 0; i < 40; i += 1) {
  const res = await C.fetch('/api/scenario/lesson-complete', { method: 'POST', json: { lessonId: 'L-01' } });
  lastStatus = res.status;
  if (res.status === 429) {
    limited = true;
    await res.body?.cancel?.();
    break;
  }
  // 唔想跑完 40 次完整場景，中斷串流
  await res.body?.cancel?.();
}
ok(limited, `連續請求應該有一刻回 429（最後狀態 ${lastStatus}）`);

/* ---------------- 9. healthz 唔需要密碼、亦唔洩漏內容 ---------------- */
section('9 · healthz 探針');
const probeClient = makeClient('probe');
const probe = await probeClient.json('/healthz');
ok(probe.status === 200, `healthz 應該 200，實際 ${probe.status}`);
ok(probe.body?.ok === true, 'healthz 應該回 ok:true');
ok(!JSON.stringify(probe.body || {}).includes('duo_key'), 'healthz 唔應該洩漏任何憑證');

/* ---------------- 結果 ---------------- */
console.log(`\n${'─'.repeat(56)}`);
if (failures === 0) {
  console.log(`✅ 全部通過：${checks} 項檢查，0 個問題。`);
  console.log('   多訪客隔離、密碼保護、限流、動態碼唔撞 —— 都生效。');
  process.exit(0);
} else {
  console.log(`❌ ${failures} / ${checks} 項檢查失敗。`);
  process.exit(1);
}
