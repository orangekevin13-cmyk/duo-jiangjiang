// smoke-flow.mjs — 驗證六個場景「一路撳落去」唔會卡住。
//
// 呢個測試係為咗堵住一類真實出現過嘅 bug：
// panel 顯示佇列嘅「顯示中」鎖冇喺新場景開始時釋放，
// 令上一個場景之後所有 panel 都被排隊而唔顯示 ——
// 症狀係用戶撳「我出發喇」完全冇反應，按鈕好似壞咗。
//
// 做法：把 public/app.js 嘅 panel 顯示邏輯抽成同源實作，然後照住
// 六個場景嘅真實 SSE 事件次序餵入去，逐格斷言畫面有冇前進。
//
//   node scripts/smoke-flow.mjs

import { buildMockScenario } from '../server/mock.mjs';

let checks = 0;
let fails = 0;
const ok = (c, label) => {
  checks += 1;
  if (c) {
    console.log(`  ✓ ${label}`);
  } else {
    fails += 1;
    console.log(`  ✗ ${label}`);
  }
};

/* ============================================================
 * 同 public/app.js 一致嘅 panel 顯示邏輯（刻意保持同步）
 * ============================================================ */
const state = {
  panel: null,
  step: null,
  panelQueue: [],
  showingPanel: false,
  nearbySpots: null,
  missionPanel: null,
  rendered: [],
};

function stepForPanel(panel) {
  if (!panel) return 'idle';
  if (panel.type === 'spots') return 'spots';
  if (panel.type === 'mission') return 'mission';
  if (panel.type === 'rehearsal') return 'prerun';
  if (panel.type === 'arrival') return 'arrival';
  if (panel.type === 'verified') return panel.data?.redeemed ? 'reward' : 'verify';
  if (panel.type === 'reward') return 'reward';
  if (panel.type === 'share') return 'share';
  return 'idle';
}

function panelKey(p) {
  const d = p?.data || {};
  return `${p?.type}:${d.task_id || ''}:${d.submitted || ''}:${d.redeemed ?? ''}`;
}

function applyPanel(panel) {
  if (panel.type === 'spots') state.nearbySpots = panel.data;
  if (panel.type === 'mission') state.missionPanel = panel.data;
  // 去重：SSE 送一次，done payload 又送一次（同 app.js 一致）
  const key = panelKey(panel);
  if (state.panel && panelKey(state.panel) === key) return;
  if (state.panelQueue.some((q) => panelKey(q) === key)) return;
  if (state.showingPanel) {
    state.panelQueue.push(panel);
    return;
  }
  showPanel(panel);
}

function showPanel(panel) {
  state.showingPanel = true;
  state.panel = panel;
  state.step = stepForPanel(panel);
  if (panel.type === 'spots') state.nearbySpots = panel.data;
  if (panel.type === 'mission') state.missionPanel = panel.data;
  state.rendered.push(panel.type);
}

function advancePanelQueue() {
  const next = state.panelQueue.shift();
  if (next) {
    state.showingPanel = false;
    showPanel(next);
  } else {
    state.showingPanel = false;
  }
}

/** 對應 app.js 嘅 runScenario：開始新場景時清佇列並解鎖 */
function beginScenario() {
  state.panelQueue = [];
  state.showingPanel = false;
}

/** 模擬一次場景：真實跑 mock 引擎，再按事件次序餵入前端邏輯 */
async function playScenario(scenario, input = {}) {
  beginScenario();
  const out = await buildMockScenario(scenario, input, { session });
  for (const ev of out.events) {
    if (ev.type === 'panel') applyPanel(ev.panel);
  }
  // done 事件亦會帶一個 panel（伺服器行為），照樣餵入
  if (out.panel) applyPanel(out.panel);
  return out;
}

const session = {};
const mkPanel = (type, data) => ({ type, data });

console.log('Duo 講講 · 六場景流程推進自檢\n');
console.log('（驗證每一格都可以前進，唔會卡住）\n');

/* ---------------- Step 1 · Lesson Complete → 任務地圖 ---------------- */
console.log('1 · 完成 Lesson 01');
const s1 = await playScenario('lesson-complete', { lessonId: 'L-01' });
ok(state.step === 'spots', `應該停在任務地圖，實際 ${state.step}`);
ok(state.panel?.type === 'spots', `畫面應該係地圖，實際 ${state.panel?.type}`);
ok(state.panelQueue.length === 1, `任務卡應該排隊等用戶推進，佇列長度 ${state.panelQueue.length}`);
ok(state.missionPanel?.title === '用粵語點一杯凍檸茶', '任務卡資料應該已快取（否則返唔到去）');
ok(state.showingPanel === true, '顯示鎖應該生效（地圖停留中）');

/* ---------------- Step 2 · 用戶撳「睇任務卡」 ---------------- */
console.log('\n2 · 撳「睇任務卡 · See Mission」');
advancePanelQueue();
ok(state.step === 'mission', `應該切到任務卡，實際 ${state.step}`);
ok(state.panelQueue.length === 0, '佇列應該清空');

/* ---------------- Step 3 · 預演（就係之前卡住嗰步） ---------------- */
console.log('\n3 · 撳「我出發喇 · 開始預演」');
await playScenario('prerun', {});
ok(state.step === 'prerun', `應該前進到預演，實際 ${state.step}`);
ok(state.panel?.type === 'rehearsal', `畫面應該係預演，實際 ${state.panel?.type}`);
ok(state.panel?.data?.dialogue?.length >= 2, '預演應該有對話');
ok(state.panelQueue.length === 0, '唔應該有殘留排隊');

/* ---------------- Step 4 · 到店驗證 ---------------- */
console.log('\n4 · 撳「我到咗 · 驗證位置」');
await playScenario('arrive', { gpsScenario: 'arrived' });
ok(state.step === 'arrival', `應該前進到到店驗證，實際 ${state.step}`);
ok(state.panel?.data?.code?.code, '應該簽發咗動態碼');
const code = state.panel.data.code.code;

/* ---------------- Step 5 · 核銷 ---------------- */
console.log('\n5 · 撳「店員核銷動態碼」');
await playScenario('verify-code', { code });
ok(state.step === 'reward', `核銷成功應該前進到獎勵，實際 ${state.step}`);
ok(state.panel?.data?.redeemed === true, '應該核銷成功');

/* ---------------- Step 6 · City Stamp 獎勵 ---------------- */
console.log('\n6 · 撳「繼續」');
await playScenario('reward', {});
ok(state.step === 'reward', `應該顯示獎勵頁，實際 ${state.step}`);
ok(state.panel?.data?.stamp?.unlocked === true, 'City Stamp 應該解鎖');
ok(state.panel?.data?.rewards?.xp === 75, '應該有 +75 XP');

/* ---------------- Step 7 · 分享與下一課 ---------------- */
console.log('\n7 · 撳「睇吓下一課」');
await playScenario('share-and-next', { style: 'playful', privacy: 'friends' });
ok(state.step === 'share', `應該前進到分享頁，實際 ${state.step}`);
ok(state.panel?.data?.next_lesson?.lesson_id === 'L-02', `下一課應該係 L-02，實際 ${state.panel?.data?.next_lesson?.lesson_id}`);

/* ---------------- 全程序檢查 ---------------- */
console.log('\n8 · 整體');
// 注意：核銷成功會先出 verified（核銷結果頁），再由 reward 場景出 reward（City Stamp 頁），
// 兩個係唔同畫面，所以次序入面兩者都要有。
const expected = ['spots', 'mission', 'rehearsal', 'arrival', 'verified', 'reward', 'share'];
const got = state.rendered;
ok(
  got.length === expected.length && expected.every((t, i) => got[i] === t),
  `畫面推進次序應該係 ${expected.join(' → ')}\n      實際係 ${got.join(' → ')}`,
);
ok(state.panelQueue.length === 0, '流程行完之後唔應該有卡住嘅面板');

/* ---------------- 失敗路徑同樣唔可以卡住 ---------------- */
console.log('\n9 · 失敗路徑（錯動態碼）之後仍然要可以繼續');
session.panelQueue = [];
state.panelQueue = [];
state.showingPanel = false;
const s1b = await playScenario('lesson-complete', { lessonId: 'L-01' });
advancePanelQueue();
await playScenario('prerun', {});
await playScenario('arrive', { gpsScenario: 'arrived' });
const realCode = state.panel.data.code.code;
const wrong = String((Number(realCode[0]) + 1) % 10) + realCode.slice(1);
await playScenario('verify-code', { code: wrong });
ok(state.panel?.data?.redeemed === false, '錯碼應該核銷失敗');
ok(state.step === 'verify', `失敗應該停在 verify 等重試，實際 ${state.step}`);
ok(state.showingPanel === true && state.panelQueue.length === 0, '失敗之後唔應該卡住佇列');
// 重試正確碼
await playScenario('verify-code', { code: realCode });
ok(state.panel?.data?.redeemed === true, '重試正確碼應該成功');
ok(state.step === 'reward', '重試成功之後應該繼續前進');

/* ---------------- 結果 ---------------- */
console.log(`\n${'─'.repeat(56)}`);
if (fails === 0) {
  console.log(`✅ 全部通過：${checks} 項檢查，0 個問題。`);
  console.log('   六個場景由頭到尾都可以撳落去，失敗路徑都可以重試。');
  process.exit(0);
} else {
  console.log(`❌ ${fails} / ${checks} 項檢查失敗。`);
  process.exit(1);
}
