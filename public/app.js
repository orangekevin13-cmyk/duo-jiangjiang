// app.js — Duo 講講 demo front-end. Vanilla ESM, no build step.
//
// Responsibilities:
//   1. drive the 6 scenarios (Lesson Complete → Mission → Rehearsal → Verify → Reward → Share)
//   2. stream the Agent timeline (tool_call / tool_result, expandable)
//   3. render the learner's phone as a *Duolingo* surface: streak / XP / gems / hearts,
//      learning path, City Stamps, league leaderboard, and Duo the owl as a character.
//
// Brand rule for anyone editing this file: if a screen does not look like Duolingo,
// it is a bug. Same Duolingo. Same game. New city.

const $ = (id) => document.getElementById(id);
const api = {
  state: () => fetch('/api/state').then((r) => r.json()),
  config: (mode) =>
    fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) }).then((r) => r.json()),
  reset: () => fetch('/api/reset', { method: 'POST' }).then((r) => r.json()),
  geo: (merchantId) => fetch(`/api/geo/${merchantId}`).then((r) => r.json()),
  scenario: (name, input = {}, onEvent) => streamScenario(name, input, onEvent),
};
const SPEED_MS = { instant: 0, fast: 140, slow: 420 };

/**
 * 介面版本。每次改前端都應該更新，方便一眼確認瀏覽器跑緊邊份程式碼
 * （舊快取係呢個專案反覆出現嘅問題）。
 * 喺 Console 打 `DUO_BUILD` 就睇得到。
 */
const BUILD = 'map-popup-1';
window.DUO_BUILD = BUILD;
const SPOOF_DEG = 0.00035; // 門店座標向西南偏移，用於「座標與門店完全重合」演示

/** Duolingo palette, mirrored from styles.css so the canvas export matches the DOM. */
const DUO = {
  green: '#58cc02',
  greenDeep: '#58a700',
  greenLight: '#89e219',
  greenPale: '#dbf8c5',
  orange: '#ff9600',
  gem: '#ce82ff',
  blue: '#1cb0f6',
  red: '#ff4b4b',
  gold: '#ffc800',
  ink: '#3c3c3c',
  black: '#131f23',
  wolf: '#777777',
  hare: '#afafaf',
  swan: '#e5e5e5',
  snow: '#f7f7f7',
};

const state = {
  step: 'idle', // idle | mission | prerun | arrival | verify | reward | share
  panel: null,
  server: null,
  mode: 'auto',
  speed: 'fast',
  busy: false,
  geo: null,
  gpsScenario: 'arrived',
  pending: [], // 待播放事件
  revealed: 0,
  pumping: false,
  usage: 0,
  elapsed: 0,
  autoplay: false,
  toolCalls: 0,
  lastCode: null,
  // 任務地圖同任務卡係同一次 lesson-complete 出嘅兩個視圖，要留住俾用戶來回睇
  nearbySpots: null,
  missionPanel: null,
  techOpen: false, // 技術面板抽屜：預設收起，正式演示唔會見到
  // 一個場景可能一次送幾個 panel，一次只顯示一個，其餘排隊等用戶推進
  panelQueue: [],
  showingPanel: false,
  mapDismissed: false, // 用戶收起任務地圖之後，唔好再自動彈（但可以手動再開）
};

/* ---------------------------------------------------------------- *
 * SSE
 * ---------------------------------------------------------------- */
async function streamScenario(name, input, onEvent) {
  const res = await fetch(`/api/scenario/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      onEvent(ev);
    }
  }
}

function enqueue(ev) {
  if (ev.type === 'tool_result') state.toolCalls += 1;
  state.pending.push(ev);
  pump();
}

async function pump() {
  if (state.pumping) return;
  state.pumping = true;
  const delay = SPEED_MS[state.speed] ?? 140;
  while (state.revealed < state.pending.length) {
    const ev = state.pending[state.revealed];
    state.revealed += 1;
    renderEvent(ev);
    if (delay > 0) await sleep(delay);
  }
  state.pumping = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- *
 * Duo 貓頭鷹（原創 SVG）—— Duolingo 嘅角色語言：圓身、大眼、綠翼
 * ---------------------------------------------------------------- */
function owlSvg(size = 42, mood = 'happy') {
  return `<svg class="duo-owl ${mood === 'wave' ? 'wave' : ''}" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <g class="body-g">
      <ellipse cx="50" cy="60" rx="31" ry="33" fill="${DUO.green}"/>
      <path d="M27 33 Q30 16 41 26 Q46 20 50 19 Q54 20 59 26 Q70 16 73 33 Q65 41 50 41 Q35 41 27 33Z" fill="${DUO.green}"/>
      <ellipse cx="50" cy="68" rx="19" ry="21" fill="${DUO.greenPale}"/>
      <ellipse class="wing-l" cx="20" cy="62" rx="7" ry="17" fill="${DUO.greenDeep}"/>
      <ellipse class="wing-r" cx="80" cy="62" rx="7" ry="17" fill="${DUO.greenDeep}"/>
      <circle cx="38" cy="48" r="14" fill="#fff"/>
      <circle cx="62" cy="48" r="14" fill="#fff"/>
      <circle class="pupil" cx="39" cy="49" r="7" fill="${DUO.black}"/>
      <circle class="pupil" cx="63" cy="49" r="7" fill="${DUO.black}"/>
      <circle cx="41.5" cy="46" r="2.4" fill="#fff"/>
      <circle cx="65.5" cy="46" r="2.4" fill="#fff"/>
      <path d="M50 55 L59 63 L50 71 L41 63 Z" fill="${DUO.orange}"/>
      <path d="M42 88 l-4 7 M58 88 l4 7" stroke="${DUO.orange}" stroke-width="4" stroke-linecap="round"/>
    </g>
  </svg>`;
}

function duoLine(text, tone = '') {
  if (!text) return '';
  return `<div class="duo-line ${tone}">${owlSvg(42, tone === 'warn' ? 'sad' : 'wave')}<div class="bubble">${esc(text)}</div></div>`;
}

/** 粵語例句：後端可能傳字串（live 正規化）或物件 {yue, jyutping, en}（離線與課程資料）。 */
function phraseList(phrases) {
  const rows = (phrases || []).slice(0, 4).map((p) => {
    if (p && typeof p === 'object') {
      return `<li><span class="yue">${esc(p.yue || '')}</span>${
        p.jyutping ? `<span class="jp">${esc(p.jyutping)}</span>` : ''
      }${p.en ? `<span class="en">${esc(p.en)}</span>` : ''}</li>`;
    }
    return `<li><span class="yue">${esc(p)}</span></li>`;
  });
  return rows.length ? `<ul class="phrases">${rows.join('')}</ul>` : '';
}

function phraseChips(phrases) {
  return (phrases || [])
    .slice(0, 4)
    .map((p) => `<span class="chip">${esc(typeof p === 'object' ? p.yue || '' : p)}</span>`)
    .join('');
}

/* ---------------------------------------------------------------- *
 * 場景驅動
 * ---------------------------------------------------------------- */
async function runScenario(name, input = {}) {
  if (state.busy) return;
  state.busy = true;

  // 開始新場景時一定要清空顯示佇列並解鎖。
  // 否則上一個場景留低嘅「顯示中」鎖會令新場景嘅 panel 被排隊而唔顯示 ——
  // 症狀係用戶撳掣之後畫面完全冇反應（按鈕好似壞咗）。
  // 上一個場景未顯示嘅 panel 本來就係舊嘢，直接丟棄係正確做法。
  state.panelQueue = [];
  state.showingPanel = false;

  renderAction();
  try {
    await api.scenario(name, input, (ev) => {
      if (ev.type === 'done') {
        const p = ev.payload;
        state.server = p.state || state.server;
        state.usage += p.usage?.total_tokens || 0;
        state.elapsed = p.elapsed_ms;
        updateChrome();
        if (p.panel) {
          applyPanel(p.panel);
          enqueue({ type: 'panel', panel: p.panel, _quiet: true });
        }
        if (p.warning) enqueue({ type: 'notice', level: 'warn', text: `真實模型調用失敗，已降級 Mock：${p.warning}` });
        enqueue({ type: 'done', payload: p });
      } else {
        enqueue(ev);
      }
    });
  } catch (err) {
    enqueue({ type: 'error', message: String(err.message || err) });
  } finally {
    state.busy = false;
    renderAction();
  }
}

/** panel.type → step。Keep this map in sync with the 6 scenarios. */
function stepForPanel(panel) {
  if (!panel) return 'idle';
  if (panel.type === 'spots') return 'spots'; // 任務地圖：任務喺邊（Step 2 嘅前半）
  if (panel.type === 'mission') return 'mission';
  if (panel.type === 'rehearsal') return 'prerun';
  if (panel.type === 'arrival') return 'arrival';
  if (panel.type === 'verified') return panel.data?.redeemed ? 'reward' : 'verify';
  if (panel.type === 'reward') return 'reward';
  if (panel.type === 'share') return 'share';
  return 'idle';
}

/**
 * Panel 顯示佇列。
 *
 * 一個場景可能一次過送幾個 panel（例如 lesson-complete 會送「任務地圖」再送「任務卡」）。
 * 如果全部即刻 render，後面嗰個會蓋掉前面嗰個 —— 用戶只會見到最後一版，
 * 中間嘅畫面一閃而過（實際發生過：地圖只顯示 140ms）。
 *
 * 所以規矩係：一次只顯示一個 panel，其餘排隊，等用戶撳掣推進。
 */
/**
 * 面板身份：用嚟分辨「同一個面板重複送」同「同類型但唔同內容嘅面板」。
 * 例如核銷失敗再重試成功，兩次都係 `verified`，但內容唔同 —— 唔可以當重複過濾。
 */
function panelKey(p) {
  const d = p?.data || {};
  return `${p?.type}:${d.task_id || ''}:${d.submitted || ''}:${d.redeemed ?? ''}`;
}

function applyPanel(panel) {
  // 快取一定要喺排隊之前做：排隊嗰個 panel 未經 showPanel，
  // 如果等到顯示先快取，用戶撳「睇任務卡」之前 missionPanel 會係 null。
  if (panel.type === 'spots') state.nearbySpots = panel.data;
  if (panel.type === 'mission') state.missionPanel = panel.data;

  // 去重：伺服器嘅 SSE 送一次 panel，done payload 又送同一個。
  // 唔去重嘅話任務卡會排隊兩次，用戶要撳兩下「睇任務卡」。
  // 只喺「同一個面板」時才過濾，同類型但內容唔同（例如重試核銷）要照樣更新。
  const key = panelKey(panel);
  if (state.panel && panelKey(state.panel) === key) return;
  if (state.panelQueue.some((q) => panelKey(q) === key)) return;

  if (state.showingPanel) {
    state.panelQueue.push(panel);
    return;
  }
  showPanel(panel);
}

/** 真正把一個 panel 放上螢幕 */
function showPanel(panel) {
  state.showingPanel = true;
  state.panel = panel;
  state.step = stepForPanel(panel);

  // 任務地圖同任務卡係兩個視圖，兩邊都要留住，令學員可以來回睇
  if (panel.type === 'spots') state.nearbySpots = panel.data;
  if (panel.type === 'mission') state.missionPanel = panel.data;

  if (panel.type === 'mission') loadGeo(panel.data.location.merchant_id);
  if (panel.type === 'arrival') {
    // 每個任務嘅門店唔同，圍欄 fixture 必須跟住當前門店刷新，否則模擬座標會指向上一間店
    if (state.geo?.merchant?.id !== panel.data.task_id) loadGeo(panel.data.task_id);
    if (panel.data.code) {
      state.lastCode = panel.data.code;
      startCountdown();
    } else {
      // 離開圍欄之後後端會作廢動態碼，前端亦要清走，唔可以留住上一個碼
      state.lastCode = null;
      clearInterval(ttlTimer);
    }
  }
  if (panel.type === 'reward' && panel.data.verified) {
    toast(`🏅 ${panel.data.stamp?.name || 'City Stamp'} unlocked!`);
    popStats();
  }

  renderScreen();
  renderAction();
  renderSide();
  renderChromeStats();
}

/**
 * 顯示佇列入面下一個 panel（如果冇就釋放鎖）。
 * 用戶撳「睇任務卡」時呼叫，令地圖同任務卡成為兩個可以由用戶控制嘅步驟。
 */
function advancePanelQueue() {
  const next = state.panelQueue.shift();
  if (next) {
    state.showingPanel = false;
    showPanel(next);
  } else {
    state.showingPanel = false;
  }
}

function loadGeo(merchantId) {
  api
    .geo(merchantId)
    .then((g) => {
      state.geo = g;
      renderMap();
    })
    .catch(() => {});
}

/* ---------------------------------------------------------------- *
 * 手機屏渲染
 * ---------------------------------------------------------------- */
function renderScreen() {
  renderScreenBase();
  paintFlow();
  const screen = $('screen');

  if (state.panel?.type === 'share') {
    const btn = document.createElement('button');
    btn.className = 'btn ghost wide';
    btn.textContent = '⬇ 導出分享卡 PNG';
    btn.addEventListener('click', downloadShareCard);
    screen.appendChild(btn);

    const targets = document.createElement('div');
    targets.className = 'share-targets';
    targets.innerHTML = (state.panel.data.share_card.share_targets || ['RedNote', 'Instagram Story', 'WeChat'])
      .map((t) => `<button type="button">${esc(t)}</button>`)
      .join('');
    targets.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') toast(`分享到 ${e.target.textContent}（演示）`);
    });
    screen.appendChild(targets);
  }

  // 課後頁一出，任務地圖即刻「彈」出嚟 —— 話你知要去邊間店。
  // 呢個係整個演示最重要嘅一瞬間：把「學完」變成「附近有一個真實任務」。
  if (state.panel?.type === 'spots') {
    const reopen = $('reopenMap');
    if (reopen) reopen.addEventListener('click', () => openMissionMap(state.panel.data));
    if (!state.mapDismissed) openMissionMap(state.panel.data);
  }

  if (state.panel?.type === 'arrival') {
    const seg = document.createElement('div');
    seg.className = 'gps-seg';
    seg.innerHTML = [
      'arrived|正常到店',
      'enroute|仲喺路上',
      'drift|定位飄移',
      'spoofed|模擬定位',
    ]
      .map((s) => {
        const [v, label] = s.split('|');
        return `<button type="button" data-gps="${v}" class="${state.gpsScenario === v ? 'active' : ''}">${label}</button>`;
      })
      .join('');
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.gpsScenario = b.dataset.gps;
      renderScreen();
      renderMap();
    });
    screen.appendChild(seg);

    if (!state.panel.data.inside_geofence) {
      const btn2 = document.createElement('button');
      btn2.className = 'btn ghost wide';
      btn2.textContent = '📡 用真實瀏覽器定位重試';
      btn2.addEventListener('click', async () => {
        try {
          const pos = await realGps();
          await runScenario('arrive', { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, gpsScenario: 'real' });
        } catch (err) {
          enqueue({ type: 'error', message: `瀏覽器定位失敗：${err.message}` });
        }
      });
      screen.appendChild(btn2);
    }
  }
}

function renderScreenBase() {
  const screen = $('screen');
  const p = state.panel;

  /* ---------- Step 1 · Lesson Complete（課後頁） ---------- */
  if (!p) {
    screen.innerHTML = `
      <div class="s-card lesson">
        <div class="duo-line">${owlSvg(46, 'wave')}<div class="bubble">You’re ready to use this outside Duolingo.</div></div>
        <div class="s-tag green">🎉 Lesson Complete · L-01</div>
        <h3>Ordering Drinks · 點嘢飲</h3>
        <p class="s-sub">正確率 90% · 9 分鐘 · +12 XP · 今日 14:20 完成</p>
        <div class="s-chips">${['凍檸茶', '唔該', '少甜', '一杯'].map((w) => `<span class="chip">${w}</span>`).join('')}</div>
        <div class="s-weak"><b>要留意</b>${['「唔該」同「多謝」用法唔同', '「少甜」個聲調 siu2 tim4'].map((w) => `<span>${w}</span>`).join('')}</div>
      </div>
      <div class="s-card">
        <div class="s-tag blue">Unit 3 · 飲嘢同埋畀錢</div>
        <div class="s-note" style="padding:0;text-align:left">
          撳下面嘅按鈕模擬「課程完成」事件，睇吓 Agent 點樣把你啱啱學嘅粵語變成一個香港真實任務。
        </div>
      </div>`;
    return;
  }

  /* ---------- Step 2a · 任務地圖（彈出話你知要去邊間店） ---------- */
  if (p.type === 'spots') {
    const s = p.data;
    screen.innerHTML = `
      <div class="s-card lesson">
        <div class="duo-line">${owlSvg(46, 'wave')}<div class="bubble">You’re ready to use this outside Duolingo.</div></div>
        <div class="s-tag green">🎉 Lesson Complete · ${esc(s.lesson_id || 'L-01')}</div>
        <h3>${esc(s.mission_title || '附近有一個任務')}</h3>
        <p class="s-sub">${esc(s.origin_label || '你目前位置')} 附近有 ${(s.spots || []).length} 個 Friendly Spot</p>
      </div>
      <div class="s-card">
        <div class="s-block" style="margin-bottom:6px"><b>任務地點</b></div>
        <div class="map-entry">🎯 <b>${esc(s.recommended_name || '')}</b> · 步行 ${s.recommended_walk_minutes ?? '—'} 分鐘（${s.recommended_distance_m ?? '—'}m）</div>
        <button class="btn ghost wide" id="reopenMap">🗺️ 再睇一次任務地圖</button>
      </div>`;
    return;
  }

  /* ---------- Step 2 · Mission Revealed（任務卡） ---------- */
  if (p.type === 'mission') {
    const m = p.data;
    screen.innerHTML = `
      <div class="s-card">
        <div class="s-tag green">🎉 Lesson Complete · ${esc(m.lesson_id)}</div>
        <p class="s-sub" style="font-size:13px;color:#3f7a02;font-weight:800">${esc(m.scenario_line || 'You’re ready to use this outside Duolingo.')}</p>
        <div class="s-meta">
          <span>📍 ${esc(m.location.name)}</span>
          <span>🚶 ${m.location.walk_minutes} 分鐘</span>
          <span>📏 ${m.location.distance_m ?? '—'}m</span>
        </div>
      </div>
      ${duoLine(m.duo_line)}
      <div class="s-card mission">
        <div class="s-tag green">SpeakOut Mission · ${m.difficulty === 'stretch' ? '挑戰' : m.difficulty === 'easy' ? '輕鬆' : '標準'}</div>
        <h3>${esc(m.title)}</h3>
        <p class="s-hook">${esc(m.hook || '')}</p>
        <div class="s-block"><b>場景</b><p>${esc(m.scene)}</p></div>
        <div class="s-block"><b>目標</b><p>${esc(m.objective)}</p></div>
        <div class="s-block"><b>到店要講</b>${phraseList(m.key_phrases)}</div>
        <div class="s-block"><b>通過標準</b><ul class="checks">${(m.success_criteria || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
        <div class="s-block why"><b>點解係呢間店</b><p>${esc(m.why_this_spot || m.location.staff_note || '')}</p></div>
        <div class="s-reward">🎁 +${m.reward?.xp ?? 75} XP · 💎 +${m.reward?.gems ?? 20} Gems · 🏅 ${esc(m.reward?.stamp_hint || 'City Stamp')}</div>
      </div>`;
    return;
  }

  /* ---------- Step 3 · Rehearsal（Duo 扮店員） ---------- */
  if (p.type === 'rehearsal') {
    const r = p.data;
    screen.innerHTML = `
      ${duoLine(r.duo_line)}
      <div class="s-card rehearsal">
        <div class="s-tag blue">出發前預演 · ${esc(r.focus)}</div>
        <div class="dialogue">
          ${(r.dialogue || [])
            .map(
              (t) => `<div class="turn ${t.role}">
                <span class="who">${t.role === 'learner' ? '我' : '店員'}</span>
                <div>
                  <p class="yue">${esc(t.yue)}</p>
                  ${t.jyutping ? `<p class="jp">${esc(t.jyutping)}</p>` : ''}
                  ${t.en ? `<p class="en">${esc(t.en)}</p>` : ''}
                </div>
              </div>`,
            )
            .join('')}
        </div>
        <div class="s-block"><b>Duo 教練提示</b><ul class="tips">${(r.coach_tips || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
        <div class="s-block"><b>發音重點</b><p>${esc(r.pronunciation_focus || '—')}</p></div>
        <div class="s-confidence">
          開口信心
          <div class="bar"><i style="width:${r.confidence_before || 42}%"></i></div>
          ${r.confidence_before || 42}% → ${r.confidence_after || 68}%
        </div>
      </div>`;
    return;
  }

  /* ---------- Step 4 · Verify（到店 + 雙重驗證） ---------- */
  if (p.type === 'arrival') {
    const a = p.data;
    const ok = a.inside_geofence;
    screen.innerHTML = `
      <div class="s-card arrival ${ok ? 'ok' : 'bad'}">
        <div class="s-tag ${ok ? 'green' : 'red'}">到店驗證 · 地理圍欄 ${a.geofence_radius_m}m</div>
        <div class="s-mapbox">${mapSvg(a.claimed, a.merchant_coord, a.geofence_radius_m, 390, 210)}</div>
        <div class="s-distance">
          <b>${a.distance_m}m</b>
          <span>${ok ? '已進入圍欄' : `仲差 ${a.distance_to_go_m}m`}</span>
          <em>定位精度 ±${a.gps_accuracy_m}m</em>
        </div>
        ${a.risk_flags?.length ? `<div class="s-flags">⚠️ ${a.risk_flags.join('；')}</div>` : ''}
        <p class="s-msg">${esc(a.message)}</p>
        ${duoLine(a.duo_line, ok ? '' : 'warn')}
        ${
          ok
            ? `<div class="s-block why"><b>Friendly Spot 門店標示</b>
                 <p><b>${esc(a.sign_text || '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。')}</b><br />${esc(a.friendly_spot_note || '')}</p>
               </div>`
            : ''
        }
        ${(a.coach_tips || []).length ? `<div class="s-block"><b>Duo 建議</b><ul class="tips">${a.coach_tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${
          a.code
            ? `<div class="code-box">
                 <span class="code-label">一次性動態碼 · 出示畀店員</span>
                 <div class="code">${a.code.code.split('').map((d) => `<i>${d}</i>`).join('')}</div>
                 <div class="code-ttl">有效期 <b id="ttl">--:--</b> · 單次使用 · 同本次任務綁定</div>
               </div>`
            : `<div class="s-note">未簽發動態碼：要先通過圍欄校驗。</div>`
        }
      </div>`;
    return;
  }

  /* ---------- Step 4b · Verified（核銷結果） ---------- */
  if (p.type === 'verified') {
    const v = p.data;
    screen.innerHTML = `
      <div class="s-card verified ${v.redeemed ? 'ok' : 'bad'}">
        <div class="big-icon">${v.redeemed ? '✅' : '⛔'}</div>
        <h3>${v.redeemed ? 'Verified!' : '核銷未通過'}</h3>
        <p class="s-sub" style="text-transform:uppercase;letter-spacing:.05em">${v.redeemed ? 'Real-World Speaking Attempt' : 'Attempt not verified'}</p>
        <p class="s-msg">${esc(v.message)}</p>
        <div class="verify-chain">
          <div class="${v.verification_summary.geofence === 'passed' ? 'pass' : 'fail'}">地理圍欄<br /><b>${esc(v.verification_summary.geofence)}</b></div>
          <div class="${v.verification_summary.dynamic_code === 'passed' ? 'pass' : 'fail'}">店員核銷<br /><b>${esc(v.verification_summary.dynamic_code)}</b></div>
        </div>
        ${duoLine(v.duo_line, v.redeemed ? '' : 'warn')}
        <div class="s-block"><b>下一步</b><p>${esc(v.next_step)}</p></div>
      </div>`;
    return;
  }

  /* ---------- Step 5 · Reward（City Stamp + XP / Gems / Streak） ---------- */
  if (p.type === 'reward') {
    const r = p.data;
    const rw = r.rewards || {};
    const stamp = r.stamp || {};
    screen.innerHTML = `
      <div class="s-card reward">
        <div class="s-tag ${r.verified ? 'green' : 'red'}">${r.verified ? 'VERIFIED REAL-WORLD SPEAKING ATTEMPT' : 'ATTEMPT LOGGED'}</div>
        <h3>${esc(r.headline)}</h3>
        <p class="s-msg">${esc(r.body)}</p>
        <div class="stamp ${stamp.unlocked ? 'on' : ''}">
          ${esc(stamp.icon || '🏅')}
          ${stamp.unlocked ? `<span class="ribbon">${esc(stamp.name || 'City Stamp')}</span>` : ''}
        </div>
        <p class="s-sub">${stamp.unlocked ? esc(stamp.name_zh || '') : '未解鎖'}</p>
        <div class="reward-row">
          <div class="reward-pill xp"><span class="v">+${rw.xp ?? 0}</span><span class="k">XP</span></div>
          <div class="reward-pill gem"><span class="v">+${rw.gems ?? 0}</span><span class="k">Gems</span></div>
          <div class="reward-pill streak"><span class="v">🔥 ${rw.streak_after ?? 0}</span><span class="k">Day Streak</span></div>
        </div>
        ${duoLine(r.duo_line)}
        ${
          r.map_entry
            ? `<div class="map-entry">🗺️ Progress Map 已點亮：<b>${esc(r.map_entry.label || '')}</b> · ${esc(r.map_entry.activity || '')}</div>`
            : ''
        }
        <div class="s-block" style="margin-top:10px"><b>下一課提示</b><p>${esc(r.next_hint || '')}</p></div>
        <div class="scope-note">
          <b>系統驗證嘅係 participation，唔係 proficiency。</b><br />
          驗證得到：${esc(r.verification_scope?.verifies || '到店 + 店員核銷')}。<br />
          驗證唔到：${esc(r.verification_scope?.does_not_verify || '係咪真係講咗粵語、講得準唔準')}。<br />
          補救機制：${esc((r.verification_scope?.mitigation || []).join(' · '))}
        </div>
      </div>`;
    return;
  }

  /* ---------- Step 6 · Share（分享卡 + 下一課 + 排行榜） ---------- */
  if (p.type === 'share') {
    const s = p.data;
    const sc = s.share_card;
    const board = s.leaderboard;
    screen.innerHTML = `
      ${duoLine(s.duo_line)}
      <div class="s-card share">
        <div class="share-canvas" id="shareCanvas">
          <div class="sc-head">
            <span class="sc-logo">🦉 Duo 講講</span>
            <span class="sc-badge">Mission Verified</span>
          </div>
          <h3>${esc(sc.headline)}</h3>
          <p class="sc-sub">${esc(sc.subheadline)}</p>
          <p class="sc-body">${esc(sc.body)}</p>
          <div class="sc-stats">${(sc.stats || []).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
          <div class="sc-tags">${(sc.hashtags || []).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
          <div class="sc-foot">核銷碼尾號 ${esc(sc.redemption_code_last4)} · 連續 ${s.streak_after} 天</div>
          ${sc.advocacy_line ? `<div class="sc-advocacy">“${esc(sc.advocacy_line)}”</div>` : ''}
        </div>
      </div>
      <div class="s-card">
        <div class="s-block next">
          <b>下一課 · ${esc(s.next_lesson.lesson_id)} ${esc(s.next_lesson.title)}</b>
          <p>${esc(s.next_lesson.why_now)}</p>
          <ul class="checks">
            <li>帶埋今次用過嘅句子：${esc((s.next_lesson.carry_over_phrases || []).join(' / '))}</li>
            <li>目標：${esc(s.next_lesson.preview_goal)}</li>
            <li>建議時間：${esc(s.next_lesson.suggested_when)}</li>
          </ul>
        </div>
        ${s.next_lesson.carry_over_phrases?.length ? `<div class="s-block" style="margin-top:10px"><b>下一課要帶走嘅粵語句</b>${phraseList(s.next_lesson.carry_over_phrases)}</div>` : ''}
      </div>
      ${
        board
          ? `<div class="s-card">
               <div class="league-head"><b>🏆 ${esc(board.league)} League</b><span>仲有 ${board.week_ends_in_days} 日結束 · 前 ${board.promotion_zone} 名升級</span></div>
               <div class="league-table">
                 ${(board.rows || [])
                   .map(
                     (row) => `<div class="league-row ${row.you ? 'you' : ''} ${row.rank <= board.promotion_zone ? 'promo' : ''}">
                       <span class="rank">${row.rank}</span>
                       <span class="name">${esc(row.name)}${row.you ? ' （你）' : ''}</span>
                       <span class="xp">${row.xp} XP</span>
                     </div>`,
                   )
                   .join('')}
               </div>
               ${
                 s.friend_mission
                   ? `<div class="friend-box">
                        <b>🤝 Friend Mission · Invite a Friend</b>
                        <p>${esc(s.friend_mission.bonus)}<br />一齊完成任務，雙方都有雙倍獎勵，順便解鎖 ${esc(s.friend_mission.stamp_hint)}。</p>
                        <span class="code-chip">${esc(s.friend_mission.invite_code)}</span>
                      </div>`
                   : ''
               }
             </div>`
          : ''
      }
      <div class="s-card">
        <div class="s-block" style="margin-bottom:0"><b>Progress Map · My Cantonese Hong Kong</b>${cityPath()}</div>
        <div class="s-loop" style="margin-top:10px">🔁 ${esc(s.loop_summary)}</div>
      </div>`;
    return;
  }
}

/** Progress Map：Duolingo 學習路徑風格嘅城市節點 */
function cityPath() {
  const nodes = [
    { label: 'HKU · Campus', activity: 'Coffee Mission', on: true, icon: '☕' },
    { label: 'Central', activity: 'Cha Chaan Teng', on: true, icon: '🍜' },
    { label: 'Causeway Bay', activity: 'Payment', on: true, icon: '💳' },
    { label: 'Mong Kok', activity: 'Shopping', on: false, icon: '🛍️' },
    { label: 'HKU · Campus Bridge', activity: 'Campus Talk', on: false, icon: '🎓' },
  ];
  return `<div class="path">${nodes
    .map(
      (n, i) => `<div class="path-node ${n.on ? 'on' : 'off'} ${i === 3 ? 'current' : ''}">
        <div class="bubble">${n.icon}</div>
        <div class="meta"><b>${n.label}</b><span>${n.on ? '✅ ' + n.activity : '⬜ 未解鎖 · ' + n.activity}</span></div>
      </div>`,
    )
    .join('')}</div>`;
}

function renderAction() {
  const bar = $('actionbar');
  const disabled = state.busy ? 'disabled' : '';
  const spinner = state.busy ? '<i class="spin"></i>' : '';
  const map = {
    idle: { label: '完成 Lesson 01 · 點嘢飲', fn: 'start' },
    // 任務地圖先出現（任務喺邊），撳一下才睇任務卡（要做咩）
    spots: { label: '睇任務卡 · See Mission', fn: 'seeMission' },
    mission: { label: '我出發喇 · 開始預演', fn: 'prerun' },
    prerun: { label: '我到咗 · 驗證位置', fn: 'arrive' },
    arrival: state.panel?.data?.code
      ? { label: '店員核銷動態碼', fn: 'verify' }
      : { label: '重新檢測位置', fn: 'arrive' },
    verify: { label: '繼續', fn: 'reward' },
    reward: { label: '睇吓下一課', fn: 'share' },
    share: { label: '換一版分享文案', fn: 'share' },
  };
  const action = map[state.step] || map.idle;
  // 任務卡頁加一個「返回地圖」嘅次要按鈕，令兩個視圖可以來回睇
  const back =
    state.step === 'mission' && state.nearbySpots
      ? '<button class="btn ghost wide" id="backToMap">← 返回任務地圖</button>'
      : '';
  bar.innerHTML =
    `<button class="btn primary" id="mainAction" data-fn="${action.fn}" ${disabled}>${spinner}${action.label}</button>` + back;
  $('mainAction').addEventListener('click', onMainAction);
  const backBtn = $('backToMap');
  if (backBtn)
    backBtn.addEventListener('click', () => {
      state.panel = { type: 'spots', data: state.nearbySpots };
      state.step = 'spots';
      renderScreen();
      renderAction();
    });
}

async function onMainAction() {
  if (state.busy) return;
  const fn = $('mainAction').dataset.fn;
  if (fn === 'start') {
    state.panelQueue = [];
    state.showingPanel = false;
    return runScenario('lesson-complete', { lessonId: 'L-01' });
  }
  if (fn === 'seeMission') {
    // 任務卡係地圖之後嘅下一個 panel，由佇列交棒；若佇列空就直接顯示已快取嘅版本
    if (state.panelQueue.length) {
      advancePanelQueue();
    } else if (state.missionPanel) {
      showPanel({ type: 'mission', data: state.missionPanel });
    }
    return;
  }
  if (fn === 'prerun') return runScenario('prerun', {});
  if (fn === 'arrive') return runScenario('arrive', gpsInput());
  if (fn === 'verify') {
    const code = await askCode();
    if (!code) return;
    return runScenario('verify-code', { code });
  }
  if (fn === 'reward') return runScenario('reward', {});
  if (fn === 'share') return runScenario('share-and-next', { style: 'playful', privacy: 'friends' });
}

function gpsInput() {
  const s = state.gpsScenario;
  if (s === 'real') {
    const pos = state.server?.user?.home;
    return { lat: pos?.lat, lng: pos?.lng, accuracy: 15, gpsScenario: 'arrived' };
  }
  if (s === 'spoofed') {
    const m = state.geo?.merchant;
    return { lat: m ? m.lat - SPOOF_DEG : undefined, lng: m ? m.lng - SPOOF_DEG : undefined, accuracy: 8 };
  }
  return { gpsScenario: s };
}

/** 用真實瀏覽器定位（可選，現場有授權時更真） */
function realGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('瀏覽器唔支援定位'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy || 20 }),
      (e) => reject(new Error(e.message)),
      { timeout: 8000 },
    );
  });
}

/* 動態碼輸入：模擬「店員喺商家端輸入」 */
function askCode() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>商家端 · 輸入學員出示嘅動態碼</h3>
        <p class="hint">${
          state.lastCode
            ? '演示時你可以故意輸錯一位，睇 Agent 點樣提示重試；亦可以直接撳「填入正確碼」。'
            : '目前冇有效動態碼（可能未到店或已核銷）。隨便輸 4 位數字，睇 Agent 點解釋失敗原因。'
        }</p>
        <input id="codeInput" inputmode="numeric" maxlength="4" placeholder="4 位數字" />
        <div class="modal-row">
          ${state.lastCode ? '<button class="btn ghost" id="codeFill">填入正確碼</button>' : ''}
          <button class="btn ghost" id="codeCancel">取消</button>
          <button class="btn primary" id="codeOk">確認核銷</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#codeInput');
    input.focus();
    const fill = overlay.querySelector('#codeFill');
    if (fill)
      fill.addEventListener('click', () => {
        input.value = state.lastCode?.code || '';
      });
    overlay.querySelector('#codeCancel').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    overlay.querySelector('#codeOk').addEventListener('click', () => {
      const v = input.value.trim();
      overlay.remove();
      resolve(/^\d{4}$/.test(v) ? v : null);
    });
  });
}

let ttlTimer = null;
function startCountdown() {
  clearInterval(ttlTimer);
  ttlTimer = setInterval(() => {
    const el = document.getElementById('ttl');
    const code = state.lastCode;
    if (!el || !code) return;
    const left = Math.max(0, Math.round((code.expires_at - Date.now()) / 1000));
    el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 30);
    if (left === 0) clearInterval(ttlTimer);
  }, 500);
}

/* 手機內 toast（解鎖 / 分享提示） */
let toastTimer = null;
function toast(text) {
  const phone = document.querySelector('.phone');
  if (!phone) return;
  phone.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  phone.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

function popStats() {
  ['statStreak', 'statGems'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.classList.remove('pop');
    void el.offsetWidth; // 重排以重啟動畫
    el.classList.add('pop');
  });
}

/* ---------------------------------------------------------------- *
 * 手機頂欄（streak / gems / hearts / 每日目標）
 * ---------------------------------------------------------------- */
function renderChromeStats() {
  const user = state.server?.user;
  const rw = state.panel?.type === 'reward' ? state.panel.data.rewards : null;
  const rewardProgress = state.panel?.type === 'reward' ? state.panel.data.progress : null;
  const shareProgress = state.panel?.type === 'share' ? state.panel.data.progress : null;
  const prog = rewardProgress || shareProgress;

  const streak = prog?.streak_days ?? user?.streakDays ?? 6;
  const gems = prog?.gems ?? user?.gems ?? 120;
  const hearts = prog?.hearts ?? user?.hearts ?? 4;
  const xpToday = prog?.xp_today ?? user?.xpToday ?? 60;
  const goal = prog?.daily_goal_xp ?? user?.dailyGoalXp ?? 50;

  if ($('statStreak')) $('statStreak').textContent = `🔥 ${streak}`;
  if ($('statGems')) $('statGems').textContent = `💎 ${gems}`;
  if ($('statHearts')) $('statHearts').textContent = `❤️ ${hearts}`;
  if ($('statStreak')) $('statStreak').title = `連續學習 ${streak} 天（Streak）`;
  if ($('statGems')) $('statGems').title = `寶石 ${gems}（Gems）`;

  const pct = Math.min(100, Math.round((xpToday / Math.max(goal, 1)) * 100));
  if ($('goalFill')) $('goalFill').style.width = `${pct}%`;
  if ($('goalText')) {
    $('goalText').textContent =
      xpToday >= goal ? `今日 ${xpToday} / ${goal} XP · 已達標 ✅` + (rw ? ` (+${rw.xp} XP)` : '') : `今日 ${xpToday} / ${goal} XP`;
  }
  if ($('unitLabel') && user?.unitLabel) $('unitLabel').textContent = user.unitLabel.split(' · ')[0];
  if ($('courseLabel') && user?.course) $('courseLabel').textContent = '粵語';
}

/* ---------------------------------------------------------------- *
 * 時間線
 * ---------------------------------------------------------------- */
function renderEvent(ev) {
  const box = $('timeline');
  const empty = box.querySelector('.empty');
  if (empty) empty.remove();

  if (ev.type === 'step') {
    const note = ev.note ? ` · ${esc(ev.note)}` : '';
    append(
      box,
      `<div class="tl-item step ${ev.state || ''}">
        <span class="dot"></span>
        <div class="tl-body"><b>${esc(ev.label || '')}</b><span class="tl-note">${ev.state === 'running' ? '調用模型…' : note}</span></div>
      </div>`,
    );
  } else if (ev.type === 'plan') {
    append(
      box,
      `<div class="tl-item plan"><span class="dot"></span><div class="tl-body">
        <b>Agent 計劃</b><div class="plan-chips">${ev.plan.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
      </div></div>`,
    );
  } else if (ev.type === 'tool_call') {
    append(
      box,
      `<div class="tl-item tool"><span class="dot"></span><div class="tl-body">
        <b>調用工具 <code>${esc(ev.name)}</code></b>
        <details><summary>入參</summary><pre>${esc(JSON.stringify(ev.args, null, 2))}</pre></details>
      </div></div>`,
    );
  } else if (ev.type === 'tool_result') {
    const r = ev.result || {};
    const badge = r.error ? '<span class="badge bad">error</span>' : '<span class="badge ok">ok</span>';
    append(
      box,
      `<div class="tl-item result"><span class="dot"></span><div class="tl-body">
        <b>工具返回 ${badge} <code>${esc(ev.name)}</code></b>
        <details><summary>結果</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>
      </div></div>`,
    );
  } else if (ev.type === 'narration') {
    append(box, `<div class="tl-item narration"><span class="dot"></span><div class="tl-body"><p>${esc(ev.text)}</p></div></div>`);
  } else if (ev.type === 'token') {
    const last = box.querySelector('.tl-item.stream p');
    if (last) last.textContent += ev.text;
    else append(box, `<div class="tl-item stream"><span class="dot"></span><div class="tl-body"><p>${esc(ev.text)}</p></div></div>`);
  } else if (ev.type === 'notice') {
    append(box, `<div class="tl-item notice ${ev.level || 'info'}"><span class="dot"></span><div class="tl-body"><p>${esc(ev.text)}</p></div></div>`);
  } else if (ev.type === 'panel') {
    if (ev._quiet) {
      /* 已直接渲染到手機，唔重複打時間線 */
    } else {
      append(
        box,
        `<div class="tl-item panel"><span class="dot"></span><div class="tl-body">
          <b>渲染到學員端</b><span class="tl-note">面板類型：${esc(ev.panel.type)}（手機屏已更新）</span>
        </div></div>`,
      );
    }
  } else if (ev.type === 'error') {
    append(box, `<div class="tl-item error"><span class="dot"></span><div class="tl-body"><b>出錯</b><p>${esc(ev.message)}</p></div></div>`);
  } else if (ev.type === 'done') {
    const p = ev.payload || {};
    const usage = p.usage && !p.usage.mock ? ` · tokens ${p.usage.total_tokens}` : '';
    append(
      box,
      `<div class="tl-item done ${p.ok ? '' : 'error'}"><span class="dot"></span><div class="tl-body">
        <b>${p.ok ? '場景完成' : '場景失敗'}</b>
        <span class="tl-note">${esc(p.scenario || '')} · ${p.mode || ''} · ${p.elapsed_ms}ms${usage}${p.error ? ' · ' + esc(p.error) : ''}</span>
      </div></div>`,
    );
    renderSide();
  }
  box.scrollTop = box.scrollHeight;
}

function append(box, html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  box.appendChild(wrap.firstElementChild);
}

/* ---------------------------------------------------------------- *
 * 右側：狀態 / 地圖 / 指標
 * ---------------------------------------------------------------- */
function updateChrome() {
  const s = state.server;
  // 顯示「實際會執行」嘅模式，而唔係用戶揀嘅偏好——hosted 演示可能用 LIVE_ALLOWED=0
  // 鎖住收費模型，嗰時介面唔可以仍然顯示 live 呃人。
  const shownMode = s?.effective_mode || state.mode;
  if ($('modePill')) $('modePill').textContent = shownMode;
  if (state.usage) $('usagePill') && ($('usagePill').textContent = `tokens ${state.usage}`);
  else if ($('usagePill')) $('usagePill').textContent = 'tokens 0';
  if ($('latencyPill')) $('latencyPill').textContent = state.elapsed ? `${state.elapsed} ms` : '— ms';

  // 頂欄嗰個不顯眼嘅小點：綠=真實模型、黃=離線引擎。唔顯示 tokens 之類嘅技術數字。
  const dot = $('modeDot');
  const dotText = $('modeDotText');
  if (dot && dotText) {
    const isLive = shownMode === 'live' || shownMode === 'auto';
    dot.classList.toggle('live', isLive);
    dot.classList.toggle('mock', !isLive);
    dotText.textContent = isLive ? '真實模型' : '離線模式';
    dot.title = isLive
      ? `真實模型（${s?.provider?.model || 'deepseek'}）：每個場景即時生成文案`
      : '離線確定性引擎：同一套工具同判定，文案由模板生成（零成本）';
  }

  if (!s) return;
  if ($('kMode')) $('kMode').textContent = shownMode === s.mode ? s.mode : `${s.mode} → ${shownMode}`;
  if ($('kProvider')) {
    $('kProvider').textContent = s.provider.has_key
      ? s.live_allowed === false
        ? `有 Key，但已停用（LIVE_ALLOWED=0）`
        : `已連接（${s.provider.key_source}）`
      : '未檢測到 Key';
  }
  if ($('kModel')) $('kModel').textContent = s.provider.model;
  if ($('kBase')) $('kBase').textContent = s.provider.base_url.replace('https://', '');
  if ($('kHint')) {
    $('kHint').textContent = !s.provider.has_key
      ? '未檢測到 DEEPSEEK_API_KEY：自動使用離線 Mock 引擎，功能同介面完全一致。'
      : s.live_allowed === false
        ? '呢個部署已鎖定離線 Mock 模式（保護 API 額度）：工具調用、驗證判定、獎勵計算全部照跑，只有文案由模板生成。'
        : '真實模型可用：每個場景 1-3 次調用，工具由本地確定性函數執行。';
  }
  if ($('kMissions')) $('kMissions').textContent = s.mission_count ?? 0;
  if ($('kTools')) $('kTools').textContent = s.tool_calls ?? state.toolCalls;
  if ($('kCode')) $('kCode').textContent = s.has_code ? '已簽發（有效期內）' : state.lastCode ? '已核銷／過期' : '未簽發';
  if ($('kVerified')) $('kVerified').textContent = s.completed ? '通過 ✅' : state.panel?.type === 'arrival' ? '進行中' : '未開始';
}

/* ---------------------------------------------------------------- *
 * 技術面板抽屜（預設收起，正式演示完全唔會見到）
 * ---------------------------------------------------------------- */
function setTechOpen(open) {
  const drawer = $('techDrawer');
  const scrim = $('techScrim');
  if (!drawer) return;
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (scrim) scrim.hidden = !open;
  state.techOpen = open;
  if (open) renderSide();
}

function toggleTech() {
  setTechOpen(!state.techOpen);
}

function renderSide() {
  updateChrome();
  renderMap();
}

/** 任務地圖上每類門店嘅圖示 */
function spotIcon(category) {
  if (category === 'cafe') return '☕';
  if (category === 'restaurant') return '🍜';
  if (category === 'convenience') return '💳';
  if (category === 'bookstore') return '📚';
  if (category === 'campus') return '🎓';
  return '📍';
}

/* ---------------------------------------------------------------- *
 * 任務地圖彈窗（Mission Map popup）
 * 課後頁一出就彈出嚟，大字寫明「去邊間店」，唔使人自己搵。
 * ---------------------------------------------------------------- */
function closeMissionMap() {
  const el = document.getElementById('missionMapOverlay');
  if (el) el.remove();
  state.mapDismissed = true;
}

function openMissionMap(s) {
  const phone = document.querySelector('.phone');
  if (!phone || !s) return;
  document.getElementById('missionMapOverlay')?.remove();
  state.mapDismissed = false;

  const others = (s.spots || []).filter((x) => !x.recommended);
  const overlay = document.createElement('div');
  overlay.className = 'map-overlay';
  overlay.id = 'missionMapOverlay';
  overlay.innerHTML = `
    <div class="map-sheet" role="dialog" aria-label="任務地圖">
      <div class="map-sheet-head">
        <span class="s-tag green" style="margin:0">📍 任務地圖 · Mission Map</span>
        <button class="map-close" id="mapClose" aria-label="收起">✕</button>
      </div>

      <div class="map-dest">
        <div class="map-dest-icon">${spotIcon(s.spots?.find((x) => x.recommended)?.category)}</div>
        <div class="map-dest-text">
          <span class="map-dest-label">你要去呢間店</span>
          <b>${esc(s.recommended_name || '')}</b>
          <span class="map-dest-meta">🚶 步行 ${s.recommended_walk_minutes ?? '—'} 分鐘 · ${s.recommended_distance_m ?? '—'}m</span>
        </div>
      </div>

      <div class="s-mapbox mission-map">${spotsMapSvg(s)}</div>

      <div class="map-legend">
        <span><i class="dot you"></i>你</span>
        <span><i class="dot rec"></i>任務地點</span>
        <span><i class="dot other"></i>其他 Friendly Spot</span>
      </div>

      ${
        others.length
          ? `<div class="map-others">
               <b>附近仲有</b>
               ${others
                 .map(
                   (o) => `<div class="spot-row">
                     <span class="spot-icon">${spotIcon(o.category)}</span>
                     <div><b>${esc(o.name)}</b><span>${esc(o.district || '')} · 步行 ${o.walk_minutes} 分鐘（${o.distance_m}m）</span></div>
                   </div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }

      <div class="map-promise">${esc(s.sign_text || '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。')}</div>
      <button class="btn primary" id="mapGo">知喇 · 睇任務卡</button>
    </div>`;

  phone.appendChild(overlay);
  overlay.querySelector('#mapClose').addEventListener('click', closeMissionMap);
  overlay.querySelector('#mapGo').addEventListener('click', () => {
    closeMissionMap();
    // 直接交棒畀佇列入面嘅任務卡，唔使用戶再撳主按鈕
    if (state.panelQueue.length) advancePanelQueue();
    else if (state.missionPanel) showPanel({ type: 'mission', data: state.missionPanel });
  });
  // 點背景都可以收起
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMissionMap();
  });
}

/**
 * 任務地圖：學員位置 + 附近所有 Friendly Spot，推薦嗰間高亮。
 * 用真實經緯度畫，比例忠實 —— 唔係裝飾圖，距離感同 verify_location 一致。
 */
function spotsMapSvg(s, w = 390, h = 260) {
  const spots = s.spots || [];
  const origin = s.origin;
  if (!origin || !spots.length) {
    return `<svg viewBox="0 0 ${w} ${h}"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${DUO.hare}" font-size="12">暫無附近地點資料</text></svg>`;
  }
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((origin.lat * Math.PI) / 180);

  // 換算成以學員為原點嘅米座標
  const raw = spots.map((sp) => ({
    sp,
    mx: (sp.lng ?? origin.lng) - origin.lng,
    my: (sp.lat ?? origin.lat) - origin.lat,
  }));

  // 後端只回距離，未必回座標；用距離＋方位無從得知，所以若缺座標就改用「距離條」畫法
  const hasCoords = raw.every((r) => Number.isFinite(r.mx) && Number.isFinite(r.my) && (r.mx !== 0 || r.my !== 0));

  if (!hasCoords) {
    // 退化畫法：同心圓 + 沿環擺放（按距離排序），一樣睇得出「邊間最近」
    const maxD = Math.max(...spots.map((sp) => sp.distance_m || 1), 120);
    const cx = w / 2;
    const cy = h / 2 + 14;
    const maxR = Math.min(w, h) / 2 - 30;
    const sorted = [...spots].sort((a, b) => (a.distance_m || 0) - (b.distance_m || 0));
    const rings = [0.33, 0.66, 1].map((f) =>
      `<circle cx="${cx}" cy="${cy}" r="${(maxR * f).toFixed(1)}" fill="none" stroke="${DUO.swan}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
    const label = `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="11" font-weight="800" fill="${DUO.orangeDeep || '#cc7a00'}">你</text>`;
    const dots = sorted
      .map((sp, i) => {
        const ang = (-90 + (360 / Math.max(sorted.length, 1)) * i) * (Math.PI / 180);
        const r = (sp.distance_m / maxD) * maxR;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        return spotMarker(px, py, sp, sp.recommended, elidedName(sp.name));
      })
      .join('');
    return `<svg viewBox="0 0 ${w} ${h}">
      <rect x="0" y="0" width="${w}" height="${h}" fill="${DUO.snow}" rx="12"/>
      ${rings.join('')}
      <circle cx="${cx}" cy="${cy}" r="7" fill="${DUO.orange}" stroke="#fff" stroke-width="2.5"/>
      ${label}${dots}
      <text x="${cx}" y="${h - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="${DUO.hare}">圈 = 距離刻度 · 外圈約 ${Math.round(maxD)}m</text>
    </svg>`;
  }

  // 正常畫法：真實相對座標
  const xs = raw.map((r) => r.mx * lngScale);
  const ys = raw.map((r) => r.my * latScale);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const spanX = Math.max(maxX - minX, 80);
  const spanY = Math.max(maxY - minY, 80);
  const pad = 42;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const toPx = (mx, my) => ({
    px: pad + (mx * lngScale - minX) * scale,
    py: h - pad - (my * latScale - minY) * scale, // 北在上：y 軸反轉
  });
  const me = toPx(0, 0);
  // 兩個地點捱得太近時，標籤會疊住睇唔清。呢度做一次輕量去重疊：
  // 只把捱得太近嘅點沿住原本方向輕輕推開，唔會大改地理位置。
  const points = raw.map((r) => {
    const { px, py } = toPx(r.mx, r.my);
    return { px, py, sp: r.sp };
  });
  separateMarkers(points, w, h, pad);

  const dots = points
    .map((pt) => spotMarker(pt.px, pt.py, pt.sp, pt.sp.recommended, elidedName(pt.sp.name)))
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}">
    <rect x="0" y="0" width="${w}" height="${h}" fill="${DUO.snow}" rx="12"/>
    <g stroke="${DUO.swan}" stroke-width="1">
      ${Array.from({ length: 5 }, (_, i) => `<line x1="0" y1="${((i + 1) * h) / 6}" x2="${w}" y2="${((i + 1) * h) / 6}"/>`).join('')}
      ${Array.from({ length: 6 }, (_, i) => `<line x1="${((i + 1) * w) / 7}" y1="0" x2="${((i + 1) * w) / 7}" y2="${h}"/>`).join('')}
    </g>
    <text x="${w - 8}" y="16" text-anchor="end" font-size="10" font-weight="800" fill="${DUO.hare}">N ↑</text>
    <circle cx="${me.px}" cy="${me.py}" r="7" fill="${DUO.orange}" stroke="#fff" stroke-width="2.5"/>
    <text x="${me.px}" y="${me.py + 22}" text-anchor="middle" font-size="11" font-weight="800" fill="${DUO.orangeDeep || '#cc7a00'}">你</text>
    ${dots}
    <text x="8" y="${h - 6}" font-size="10" font-weight="700" fill="${DUO.hare}">比例忠實 · 網格約 ${Math.round((spanX / 6) / 10) * 10}m</text>
  </svg>`;
}

/**
 * 標籤去重疊：如果兩個標記捱得太近（連標籤一齊計），就沿住兩點連線方向推開。
 * 只推最少嘅距離，最多迭代幾次，並且唔會推出畫布以外。
 */
function separateMarkers(points, w, h, pad) {
  const MIN_GAP = 64; // 標籤闊度連距離文字
  for (let iter = 0; iter < 24; iter += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        let dx = b.px - a.px;
        let dy = b.py - a.py;
        let d = Math.hypot(dx, dy);
        if (d >= MIN_GAP) continue;
        // 兩點完全重合嘅話，俾一個確定性嘅方向，唔用隨機（每次重播都一樣）
        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (MIN_GAP - d) / 2;
        const ux = (dx / d) * push;
        const uy = (dy / d) * push;
        a.px -= ux;
        a.py -= uy;
        b.px += ux;
        b.py += uy;
        moved = true;
      }
    }
    // 夾返入畫布
    for (const p of points) {
      p.px = Math.max(pad - 22, Math.min(w - pad + 22, p.px));
      p.py = Math.max(pad - 10, Math.min(h - 26, p.py));
    }
    if (!moved) break;
  }
}

function elidedName(name) {
  const n = String(name || '');
  return n.length > 9 ? `${n.slice(0, 9)}…` : n;
}

function spotMarker(px, py, spot, recommended, label) {
  const c = recommended ? DUO.green : DUO.hare;
  const edge = recommended ? DUO.greenDeep : '#c9c9c9';
  return `
    <g class="spot-marker ${recommended ? 'rec' : ''}">
      ${recommended ? `<circle cx="${px}" cy="${py}" r="18" fill="none" stroke="${DUO.green}" stroke-width="2.5" class="ping"/>` : ''}
      <line x1="${px}" y1="${py}" x2="${px}" y2="${py - 16}" stroke="${edge}" stroke-width="2"/>
      <circle cx="${px}" cy="${py - 20}" r="${recommended ? 11 : 8}" fill="${c}" stroke="#fff" stroke-width="2.5"/>
      <text x="${px}" y="${py - 16}" text-anchor="middle" font-size="${recommended ? 11 : 9}" dominant-baseline="middle">${spotIcon(spot.category)}</text>
      <text x="${px}" y="${py + 14}" text-anchor="middle" font-size="${recommended ? 10.5 : 9}" font-weight="800" fill="${recommended ? DUO.greenDeep : DUO.wolf}">${label}</text>
      <text x="${px}" y="${py + 25}" text-anchor="middle" font-size="9" font-weight="700" fill="${DUO.hare}">${spot.distance_m}m · ${spot.walk_minutes}分鐘</text>
    </g>`;
}

function mapSvg(claimed, merchant, radius, w = 420, h = 250) {
  if (!claimed || !merchant) {
    return `<svg viewBox="0 0 ${w} ${h}"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${DUO.hare}" font-size="13">暫無位置資料</text></svg>`;
  }
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((merchant.lat * Math.PI) / 180);
  const dx = (claimed.lng - merchant.lng) * lngScale;
  const dy = (merchant.lat - claimed.lat) * latScale;
  const scale = Math.min((w * 0.42) / Math.max(radius * 1.6, 1), 0.55);
  const cx = w / 2;
  const cy = h / 2;
  const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
  const ux = clamp(cx + dx * scale, cx - w / 2 + 14, cx + w / 2 - 14);
  const uy = clamp(cy - dy * scale, 14, h - 14);
  const r = radius * scale;
  return `
    <rect x="0" y="0" width="${w}" height="${h}" fill="${DUO.snow}" rx="10"/>
    <g stroke="${DUO.swan}" stroke-width="1">
      ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${(i + 1) * (h / 8)}" x2="${w}" y2="${(i + 1) * (h / 8)}"/>`).join('')}
      ${Array.from({ length: 9 }, (_, i) => `<line x1="${(i + 1) * (w / 10)}" y1="0" x2="${(i + 1) * (w / 10)}" y2="${h}"/>`).join('')}
    </g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(88,204,2,0.12)" stroke="${DUO.green}" stroke-dasharray="5 4" stroke-width="2"/>
    <text x="${cx}" y="${cy - r - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="${DUO.greenDeep}">圍欄 ${radius}m</text>
    <line x1="${cx}" y1="${cy}" x2="${ux}" y2="${uy}" stroke="${DUO.orange}" stroke-width="2" stroke-dasharray="4 3"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="${DUO.greenDeep}"/>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="10" font-weight="700" fill="${DUO.greenDeep}">門店</text>
    <circle cx="${ux}" cy="${uy}" r="7" fill="${DUO.orange}" stroke="#fff" stroke-width="2"/>
    <text x="${ux}" y="${uy - 12}" text-anchor="middle" font-size="10" font-weight="700" fill="${DUO.orangeDeep || '#cc7a00'}">學員</text>`;
}

function renderMap() {
  const svg = $('map');
  if (!svg) return;
  const a = state.panel?.type === 'arrival' ? state.panel.data : null;
  if (a) {
    svg.innerHTML = mapSvg(a.claimed, a.merchant_coord, a.geofence_radius_m, 420, 250).replace(/^<svg[^>]*>|<\/svg>$/g, '');
    if ($('mapHint')) {
      $('mapHint').textContent = `實測直線距離 ${a.distance_m}m · 圍欄 ${a.geofence_radius_m}m · 判定 ${a.verdict}${
        a.risk_flags?.length ? ' · 風險：' + a.risk_flags.join('；') : ''
      }`;
    }
    return;
  }
  const m = state.geo?.merchant;
  const fixtures = state.geo?.fixtures;
  if (m && fixtures) {
    const f = fixtures[state.gpsScenario === 'real' ? 'arrived' : state.gpsScenario] || fixtures.arrived;
    svg.innerHTML = mapSvg(f.claimed, { lat: m.lat, lng: m.lng }, state.geo.geofence_radius_m, 420, 250).replace(/^<svg[^>]*>|<\/svg>$/g, '');
    if ($('mapHint')) $('mapHint').textContent = `門店：${m.name} · 步行 ${m.walk_minutes} 分鐘 · 目前模擬：${state.gpsScenario}`;
    return;
  }
  svg.innerHTML = `<text x="210" y="125" text-anchor="middle" fill="${DUO.hare}" font-size="12">生成任務卡之後會出現門店座標</text>`;
}

/* ---------------------------------------------------------------- *
 * 分享卡導出 PNG（canvas 手繪，零依賴）
 * ---------------------------------------------------------------- */
function downloadShareCard() {
  const p = state.panel?.type === 'share' ? state.panel.data : null;
  if (!p) return;
  const sc = p.share_card;
  const W = 1080;
  const H = 1440;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  /* Duolingo 綠底 */
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, DUO.green);
  grad.addColorStop(1, '#3ea300');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.beginPath();
  g.arc(W - 60, H - 120, 260, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = 'rgba(255,255,255,0.97)';
  roundRect(g, 60, 110, W - 120, H - 300, 48);
  g.fill();

  /* 頂行：品牌 + 驗證徽章 */
  g.fillStyle = DUO.greenDeep;
  g.font = 'bold 36px system-ui, sans-serif';
  g.fillText('🦉 Duo 講講', 120, 210);
  g.fillStyle = '#6b5200';
  roundRect(g, W - 400, 172, 280, 52, 26);
  g.fillStyle = DUO.gold;
  roundRect(g, W - 400, 172, 280, 52, 26);
  g.fill();
  g.fillStyle = '#6b5200';
  g.font = 'bold 24px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('MISSION VERIFIED', W - 260, 206);
  g.textAlign = 'left';

  /* 標題 */
  g.fillStyle = DUO.black;
  g.font = 'bold 64px system-ui, sans-serif';
  let y = 330;
  wrap(g, sc.headline, W - 260).forEach((l) => {
    g.fillText(l, 120, y);
    y += 78;
  });

  g.fillStyle = DUO.wolf;
  g.font = 'bold 30px system-ui, sans-serif';
  y = wrap(g, sc.subheadline, W - 260).reduce((acc, l) => {
    g.fillText(l, 120, acc);
    return acc + 44;
  }, y + 6);

  g.fillStyle = DUO.ink;
  g.font = '30px system-ui, sans-serif';
  y += 26;
  wrap(g, sc.body, W - 280).forEach((l) => {
    g.fillText(l, 120, y);
    y += 46;
  });

  /* 統計膠囊 */
  y += 34;
  g.font = 'bold 32px system-ui, sans-serif';
  (sc.stats || []).forEach((s) => {
    g.fillStyle = DUO.greenPale;
    roundRect(g, 120, y - 40, W - 240, 66, 33);
    g.fill();
    g.fillStyle = '#3f7a02';
    g.fillText(s, 152, y + 4);
    y += 84;
  });

  /* streak / 聯盟列 */
  const prog = p.progress || {};
  y += 12;
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillStyle = '#8a6a00';
  g.fillText(`🔥 ${p.streak_after}-day streak`, 120, y);
  g.fillStyle = '#7b3fb5';
  g.fillText(`💎 ${prog.gems ?? ''} Gems`, 400, y);
  g.fillStyle = DUO.greenDeep;
  g.fillText(`🏆 ${prog.league || ''} League`, 660, y);

  /* hashtags + 頁腳 */
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillStyle = DUO.greenDeep;
  g.fillText((sc.hashtags || []).join('  '), 120, H - 300);

  g.fillStyle = DUO.ink;
  g.font = 'bold 34px system-ui, sans-serif';
  g.fillText(sc.advocacy_line || 'Hong Kong is becoming my classroom.', 120, H - 236);

  g.fillStyle = DUO.hare;
  g.font = '24px system-ui, sans-serif';
  g.fillText(`核銷碼尾號 ${sc.redemption_code_last4} · 由 Duo 講講 Agent 生成 · Same Duolingo. Same game. New city.`, 120, H - 176);

  const url = c.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `duo-jiangjiang-${Date.now()}.png`;
  a.click();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g, text, maxWidth) {
  const out = [];
  let line = '';
  for (const ch of String(text || '')) {
    const test = line + ch;
    if (g.measureText(test).width > maxWidth && line) {
      out.push(line);
      line = ch;
    } else line = test;
  }
  if (line) out.push(line);
  return out.slice(0, 6);
}

/* ---------------------------------------------------------------- *
 * 互動綁定
 * ---------------------------------------------------------------- */
function bindSeg(id, attr, onPick) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    [...el.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b === btn));
    onPick(btn.dataset[attr]);
  });
}

bindSeg('modeSeg', 'mode', async (mode) => {
  state.mode = mode;
  await api.config(mode);
  state.server = await api.state();
  updateChrome();
  renderChromeStats();
});
bindSeg('speedSeg', 'speed', (speed) => {
  state.speed = speed;
});

if ($('btnReset'))
  $('btnReset').addEventListener('click', async () => {
    state.pending = [];
    state.revealed = 0;
    state.panel = null;
    state.step = 'idle';
    state.usage = 0;
    state.elapsed = 0;
    state.toolCalls = 0;
    state.lastCode = null;
    state.geo = null;
    state.gpsScenario = 'arrived';
    state.nearbySpots = null;
    state.missionPanel = null;
    state.panelQueue = [];
    state.showingPanel = false;
    await api.reset();
    state.server = await api.state();
    if ($('timeline')) {
      $('timeline').innerHTML = `<div class="empty"><strong>已重置</strong><p>再撳一次手機主按鈕，由「完成 Lesson 01 · 點嘢飲」開始。</p></div>`;
    }
    renderScreen();
    renderAction();
    renderSide();
    renderChromeStats();
    paintFlow();
  });

/* 技術面板：撳 ⚙、撳狀態小點、按 T 都可以開關；Esc 收起 */
if ($('btnTech')) $('btnTech').addEventListener('click', toggleTech);
if ($('btnTechClose')) $('btnTechClose').addEventListener('click', () => setTechOpen(false));
if ($('modeDot')) $('modeDot').addEventListener('click', toggleTech);
if ($('techScrim')) $('techScrim').addEventListener('click', () => setTechOpen(false));

if ($('btnAutoPlay'))
  $('btnAutoPlay').addEventListener('click', async () => {
    if (state.autoplay) return;
    state.autoplay = true;
    $('btnAutoPlay').textContent = '自動演示中…';
    const wait = (ms) => sleep(ms);
    try {
      if (state.step === 'idle') await runScenario('lesson-complete', { lessonId: 'L-01' });
      await wait(1600);
      await runScenario('prerun', {});
      await wait(1600);
      await runScenario('arrive', { gpsScenario: 'arrived' });
      await wait(1600);
      if (state.lastCode) await runScenario('verify-code', { code: state.lastCode.code });
      await wait(1200);
      await runScenario('reward', {});
      await wait(1400);
      await runScenario('share-and-next', { style: 'playful', privacy: 'friends' });
    } finally {
      state.autoplay = false;
      $('btnAutoPlay').textContent = '▶ 自動演示';
    }
  });

// 鍵盤快捷鍵：空格=主按鈕，R=重置
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    $('mainAction')?.click();
  }
  if (e.key === 'r' || e.key === 'R') $('btnReset')?.click();
  // T = 開關技術面板（Q&A 時才用），Esc = 收起
  if (e.key === 't' || e.key === 'T') toggleTech();
  if (e.key === 'Escape' && state.techOpen) setTechOpen(false);
});

function paintFlow() {
  // spots（任務地圖）同 mission（任務卡）同屬 Step 2，所以流程條都係第 2 格
  const order = { idle: 0, spots: 2, mission: 2, prerun: 3, arrival: 4, verify: 4, reward: 5, share: 6 };
  const n = order[state.step] ?? 0;
  [...$('flow').children].forEach((li) => {
    const i = Number(li.dataset.step);
    li.classList.toggle('done', i <= n);
    li.classList.toggle('current', i === n && n > 0);
  });
}

function tickClock() {
  const d = new Date();
  if ($('clock')) $('clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

(async function boot() {
  tickClock();
  setInterval(tickClock, 20000);
  if ($('brandOwl')) $('brandOwl').innerHTML = owlSvg(34, 'wave');
  renderScreen();
  renderAction();
  // 技術抽屜預設收起：正式演示時畫面上只有手機
  setTechOpen(false);
  try {
    state.server = await api.state();
    state.mode = state.server.mode;
    [...$('modeSeg').querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  } catch {
    /* server not ready */
  }
  renderSide();
  renderChromeStats();
  paintFlow();
  // 版本標記：方便確認跑緊邊份程式碼（舊快取排查用）
  console.log(`Duo 講講 介面版本 ${BUILD}`);
  const techTitle = document.querySelector('.tech-head h2');
  if (techTitle) techTitle.textContent = `技術面板 · Technical · ${BUILD}`;
  enqueue({ type: 'notice', level: 'info', text: '演示就緒：撳手機主按鈕，或者按空格鍵推進下一步。' });
})();
