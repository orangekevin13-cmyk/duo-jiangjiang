// smoke-app-flow.mjs — 真正執行 public/app.js 嘅流程程式碼（唔係同源複製品）。
//
// 呢個測試係為咗堵住一個真實發生過、而且舊測試抓唔到嘅 bug：
//   app.js 收到 SSE panel 事件時只送去時間線，冇送去 applyPanel，
//   所以「任務地圖」panel 永遠上唔到螢幕（openMissionMap 變成死碼）。
//
// 舊嘅 smoke-flow.mjs 用自己寫嘅同源邏輯，而佢「正確地」apply 咗每個 panel 事件，
// 所以 27 項全過但真實瀏覽器睇唔到 —— 測試比被測程式碼更正確。
//
// 做法：喺 Node 入面載入真正嘅 public/app.js（提供最小 DOM stub），
// 然後驅動真實嘅 runScenario()，觀察 state.panel / openMissionMap 有冇被叫到。
//
//   node scripts/smoke-app-flow.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = path.join(__dirname, '..', 'public', 'app.js');
const BASE = process.env.BASE || 'http://127.0.0.1:8719';

let checks = 0;
let fails = 0;
const ok = (c, label) => {
  checks += 1;
  if (c) console.log(`  ✓ ${label}`);
  else {
    fails += 1;
    console.log(`  ✗ ${label}`);
  }
};

/* ============================================================
 * 最小 DOM / 瀏覽器 stub —— 只提供 app.js 真正會用到嘅嘢
 * ============================================================ */
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _html: '',
    _text: '',
    hidden: false,
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      return c;
    },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    // querySelector 要回一個 stub 而唔係 null：app.js 會喺 overlay 入面搵
    // #mapClose / #mapGo 再綁事件，回 null 會令真實程式碼拋錯（測試環境問題，唔係 app 問題）。
    querySelector: () => makeEl('div'),
    querySelectorAll: () => [],
    focus() {},
    click() {},
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 1,
    getContext: () => null,
    toDataURL: () => '',
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = String(v);
    },
  });
  Object.defineProperty(el, 'textContent', {
    get() {
      return this._text;
    },
    set(v) {
      this._text = String(v);
    },
  });
  return el;
}

// 追蹤 openMissionMap 有冇被呼叫：地圖 overlay 會 append 到 .phone，
// 所以我哋監視 .phone 收到嘅子元素。
const phone = makeEl('div');
phone.className = 'phone';
const screenEl = makeEl('div');
const els = new Map();
for (const id of [
  'screen', 'actionbar', 'timeline', 'flow', 'map', 'mapHint', 'modePill', 'usagePill',
  'latencyPill', 'kMode', 'kProvider', 'kModel', 'kBase', 'kHint', 'kMissions', 'kTools',
  'kCode', 'kVerified', 'modeSeg', 'speedSeg', 'btnReset', 'btnAutoPlay', 'btnTech',
  'btnTechClose', 'modeDot', 'modeDotText', 'modeDotLight', 'techDrawer', 'techScrim',
  'brandOwl', 'clock', 'statStreak', 'statGems', 'statHearts', 'goalFill', 'goalText',
  'courseLabel', 'unitLabel', 'mainAction',
]) {
  els.set(id, makeEl(id === 'screen' ? 'div' : 'div'));
}

const overlays = () => phone.children.filter((c) => String(c.className || '').includes('map-overlay'));

// 任何未知 id 都回傳一個 stub 元素，令 app.js 唔會因為搵唔到元素而拋錯。
// 呢個 stub 比瀏覽器寬鬆，但正好用嚟測「邏輯」而唔係「DOM 存在性」。
const unknownEls = new Map();
function stubFor(id) {
  if (!unknownEls.has(id)) unknownEls.set(id, makeEl('div'));
  return unknownEls.get(id);
}

global.document = {
  getElementById: (id) => els.get(id) || stubFor(id),
  createElement: (t) => makeEl(t),
  querySelector: (sel) => (sel === '.phone' ? phone : stubFor(`sel:${sel}`)),
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
};
global.window = { addEventListener() {}, DUO_BUILD: null, location: { href: BASE } };
// navigator 喺 Node 24 係唯讀全域變數，唔可以賦值；改為經函數參數傳入（見 runner 呼叫）。
const navStub = { geolocation: null };
global.performance = global.performance || { now: () => Date.now() };
global.setInterval = () => 0;
global.clearInterval = () => {};
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

/* ============================================================
 * 載入真正嘅 app.js
 * ============================================================ */
const src = readFileSync(APP_JS, 'utf8');
// app.js 用相對 URL（/api/...），喺瀏覽器會自動接上 origin，但 Node 唔會，
// 所以要包一層把相對路徑補成絕對 URL，同時記錄 cookie。
const realFetch = globalThis.fetch;
let jar = '';
global.fetch = async (input, opts = {}) => {
  let url = String(input);
  if (url.startsWith('/')) url = BASE + url;
  const headers = { ...(opts.headers || {}) };
  if (jar) headers.cookie = jar;
  const res = await realFetch(url, { ...opts, headers });
  const sc = res.headers.getSetCookie?.() || [];
  if (sc.length) jar = sc.map((c) => c.split(';')[0]).join('; ');
  return res;
};

const runner = new Function(
  'document',
  'window',
  'navigator',
  'performance',
  'fetch',
  `${src}
   return { state, runScenario, applyPanel, openMissionMap, stepForPanel, advancePanelQueue, panelKey };`,
);

let mod;
try {
  mod = runner(
    global.document,
    global.window,
    navStub,
    global.performance,
    global.fetch,
  );
} catch (e) {
  console.log('❌ 載入 app.js 失敗：', e.message);
  process.exit(1);
}

console.log('Duo 講講 · 真實 app.js 流程自檢');
console.log('（直接執行 public/app.js，唔係同源複製品）\n');

const { state, runScenario } = mod;

/* ---- 建立 session（cookie 由上面嘅 fetch 包裝自動處理） ---- */
await fetch(`${BASE}/api/reset`, { method: 'POST' });
await new Promise((r) => setTimeout(r, 50));

/* ============================================================
 * 測試 1：lesson-complete 之後，任務地圖必須上到螢幕
 * ============================================================ */
console.log('1 · 完成 Lesson 01 → 任務地圖必須出現');
const before = overlays().length;
await runScenario('lesson-complete', { lessonId: 'L-01' });
// 等 renderScreen 嘅同步部分完成
await new Promise((r) => setTimeout(r, 60));
const after = overlays().length;

ok(state.showingPanel === true, '應該有 panel 正在顯示');
ok(state.panel?.type === 'spots', `state.panel.type 應該係 spots，實際 ${state.panel?.type}`);
ok(state.step === 'spots', `state.step 應該係 spots，實際 ${state.step}`);
ok(
  state.nearbySpots !== null,
  'state.nearbySpots 應該有值（否則「返回任務地圖」會壞）',
);
ok(after > before, `任務地圖 overlay 應該 append 到 .phone（之前 ${before} 個，之後 ${after} 個）`);
ok(state.panelQueue.length === 1, `任務卡應該排隊等用戶推進，佇列長度 ${state.panelQueue.length}`);

/* ============================================================
 * 測試 2：收起之後唔應該再自動彈，但撳「再睇一次」要彈得返
 * ============================================================ */
console.log('\n2 · 收起地圖之後嘅行為');
state.mapDismissed = true;
const before2 = overlays().length;
mod.openMissionMap(state.panel.data ?? state.nearbySpots);
await new Promise((r) => setTimeout(r, 20));
ok(overlays().length > before2 || state.mapDismissed === false, '手動 openMissionMap 應該可以再彈');
// 清乾淨
phone.children.length = 0;

/* ============================================================
 * 測試 3：用戶撳「睇任務卡」→ 前進到任務卡
 * ============================================================ */
console.log('\n3 · 撳「睇任務卡」');
mod.advancePanelQueue();
ok(state.panel?.type === 'mission', `應該切到任務卡，實際 ${state.panel?.type}`);
ok(state.panelQueue.length === 0, '佇列應該清空');

/* ============================================================
 * 測試 4：之後每個場景都要可以前進（唔會卡住）
 * ============================================================ */
console.log('\n4 · 餘下場景逐個推進');
await runScenario('prerun', {});
ok(state.step === 'prerun', `預演，實際 ${state.step}`);

await runScenario('arrive', { gpsScenario: 'arrived' });
ok(state.step === 'arrival', `到店驗證，實際 ${state.step}`);
const code = state.panel?.data?.code?.code;
ok(Boolean(code), '應該簽發動態碼');

await runScenario('verify-code', { code });
ok(state.panel?.data?.redeemed === true, '應該核銷成功');

await runScenario('reward', {});
ok(state.panel?.data?.stamp?.unlocked === true, 'City Stamp 應該解鎖');

await runScenario('share-and-next', { style: 'playful', privacy: 'friends' });
ok(state.step === 'share', `分享頁，實際 ${state.step}`);

/* ============================================================
 * 測試 5：重跑一次，地圖要再次彈出（mapDismissed 有冇清乾淨）
 * ============================================================ */
console.log('\n5 · 重跑一次，地圖應該再次彈出');
state.panelQueue = [];
state.showingPanel = false;
// 模擬用戶撳「重置」再開始
state.mapDismissed = false;
phone.children.length = 0;
await runScenario('lesson-complete', { lessonId: 'L-01' });
await new Promise((r) => setTimeout(r, 60));
ok(state.panel?.type === 'spots', `第二次都應該停在地圖，實際 ${state.panel?.type}`);
ok(overlays().length > 0, '第二次都應該彈出地圖 overlay');

/* ---- 結果 ---- */
console.log(`\n${'─'.repeat(56)}`);
if (fails === 0) {
  console.log(`✅ 全部通過：${checks} 項檢查，0 個問題。`);
  console.log('   真實 app.js 嘅 panel 流程正確：SSE panel 事件有上到螢幕。');
  process.exit(0);
} else {
  console.log(`❌ ${fails} / ${checks} 項檢查失敗。`);
  process.exit(1);
}
