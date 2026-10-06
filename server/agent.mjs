// agent.mjs — scenario orchestration: prompt -> tool calls -> grounded JSON -> SSE events.
// The model decides what to do; tools.mjs decides what is true. Every scenario has a mock twin.
//
// Brand anchor: the agent is not a generic assistant. It speaks as Duo 講講 — the natural extension
// of the Duolingo Cantonese course into Hong Kong. Same game, same streak, same owl. New city.
// The model is allowed to be warm and playful (Duolingo voice) but never allowed to relax a
// verification: distance, code value, TTL and single-use are pure functions in tools.mjs.

import { TOOL_SCHEMAS, TOOL_NAMES, runTool, offsetCoord, GEOFENCE_RADIUS_M, progressSnapshot } from './tools.mjs';
import { extractJson } from './llm.mjs';
import {
  DUO_LINES,
  LESSONS,
  MERCHANTS,
  USER_PROFILE,
  distanceMeters,
  getLesson,
  getMerchant,
  pickMerchantForLesson,
  walkMinutes,
} from './store.mjs';
import { buildMockScenario, buildSpotsPanel } from './mock.mjs';

const SYSTEM_BASE = `你是 "Duo 講講"（Cantonese SpeakOut Pass）嘅線下任務智能體（Agent）。

【品牌定位 —— 一定要守住】
Duo 講講 唔係第三方 App，亦唔係新產品，而係 Duolingo 粵語課程嘅自然延伸。
你沿用 Duolingo 現有嘅一切：streak（連擊）、XP、Gems（寶石）、Leaderboard（聯盟排行榜）、
Achievements（成就徽章）、學習路徑（Progress Map）同 Duo 貓頭鷹角色。
你唯一新增嘅係：把學習場景由 App 內延伸到香港真實生活。
記住一句：Duolingo has gamified learning. Duo 講講 gamifies using.

【你嘅職責】
把線上粵語課程變成「必須喺真實世界開口講一次」嘅任務，並喺關鍵節點做驗證、獎勵同推薦。

【文案風格 —— 要似 Duolingo 寫嘅，唔好似營銷團隊寫嘅】
- 面向學員嘅文字：簡短、鼓勵、幽默、帶少少俏皮，唔居高臨下，唔施壓。
- 粵語例句一律用粵語正字（唔該、凍檸茶、八達通得唔得），並提供粵拼 Jyutping。
- English 用喺介面標題同 Duo 嘅對白（Duolingo 本身就係咁），中文用喺解釋。
- 鼓勵而唔係施壓：唔講「你必須完成」，要講「You already know enough. Give it a try.」。
- 失敗都要溫柔：「Didn't speak this time? No worries. Duo will wait for you.」

【工作方式（務必遵守）】
1. 先調用工具獲取事實（Friendly Spot、地理圍欄、動態碼、獎勵、推薦）。工具返回嘅內容先係事實，
   唔准自己編造店名、座標、距離、碼值或者獎勵數字。
2. 呢一輪只負責「取事實」：要麼調用工具，要麼用一兩句講明你已拿到足夠事實。唔好提前輸出最終 JSON。
3. 系統隨後會單獨要求你輸出結果：嗰時只輸出一個合法 JSON 對象，唔要解釋文字、唔要 markdown 代碼塊。
4. 誠實：如果某一步工具報錯或者驗證失敗，喺 JSON 入面如實講，並俾出可執行嘅補救建議。
5. 唔好声称「已驗證學員講得好唔好」。系統驗證嘅係 participation（到店 + 店員核銷），
   唔係 proficiency（發音準唔準）。呢個界線一定要守住。`;

const emitTo = (emit) => (typeof emit === 'function' ? emit : () => {});

/**
 * Run a tool-use loop until the model returns final JSON (or the step budget runs out).
 * @returns {{data: object, toolTrace: Array, usage: object, steps: number, degraded?: string}}
 */
export async function runAgent({
  client,
  system,
  user,
  tools = TOOL_SCHEMAS,
  toolCtx = {},
  maxSteps = 3,
  temperature,
  maxTokens = 1600,
  emit,
  label = 'agent',
  validate,
}) {
  const send = emitTo(emit);
  const toolTrace = [];
  const messages = [
    { role: 'system', content: `${SYSTEM_BASE}\n\n${system}` },
    { role: 'user', content: user },
  ];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const MAX_REPAIRS = 2;

  const addUsage = (u) => {
    if (!u) return;
    usage.prompt_tokens += u.prompt_tokens || 0;
    usage.completion_tokens += u.completion_tokens || 0;
    usage.total_tokens += u.total_tokens || 0;
  };

  /** Debug hook: DSH_DEMO_DEBUG=1 prints every raw model reply (never the key). */
  const trace = (tag, message, finishReason) => {
    if (!process.env.DSH_DEMO_DEBUG) return;
    const calls = (message?.tool_calls || []).map((c) => `${c.function?.name}(${String(c.function?.arguments).slice(0, 220)})`);
    const content = String(message?.content ?? '');
    console.log(
      `[debug ${label}] ${tag}: finish=${finishReason || '-'} tool_calls=[${calls.join(', ')}] content_len=${content.length} content=${content.slice(0, 320).replace(/\n/g, ' ')}`,
    );
  };

  /** Parse + validate a final reply. Returns {ok:true,data} or {ok:false,reason}. */
  const tryFinish = (text) => {
    let parsed;
    try {
      parsed = extractJson(text);
    } catch (err) {
      return { ok: false, reason: `唔係合法 JSON（${err.message.slice(0, 80)}）` };
    }
    if (typeof validate === 'function') {
      try {
        validate(parsed);
      } catch (err) {
        return { ok: false, reason: String(err.message || err).slice(0, 160) };
      }
    }
    return { ok: true, data: parsed };
  };

  /**
   * Phase A — tool probe: the model may only call tools here (no JSON mode, no tools
   * after the budget is spent). DeepSeek reliably emits text after a tool result only
   * when it is not simultaneously constrained by response_format=json_object, so the
   * final structured answer is produced by a separate Phase B call.
   */
  for (let step = 1; step <= maxSteps; step += 1) {
    send({ type: 'step', step, label: `${label} · 第 ${step} 步`, state: 'running' });
    const { message, usage: u, finishReason } = await client.complete({ messages, tools, temperature, maxTokens });
    addUsage(u);
    trace(`step${step}`, message, finishReason);
    messages.push(message);

    const calls = message.tool_calls || [];
    const text = (message.content || '').trim();

    if (!calls.length) {
      // No more facts to gather: the model is done with phase A.
      send({ type: 'step', step, label: `${label} · 第 ${step} 步`, state: 'done', note: '事實收集完成' });
      if (text) {
        const direct = tryFinish(text);
        if (direct.ok) {
          send({ type: 'narration', text: text.slice(0, 200), step });
          return { data: direct.data, toolTrace, usage, steps: step };
        }
      }
      break;
    }

    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      send({ type: 'tool_call', name, args, step });
      let result;
      try {
        result = await runTool(name, args, toolCtx);
      } catch (err) {
        result = { error: String(err.message || err) };
      }
      toolTrace.push({ name, args, result });
      send({ type: 'tool_result', name, result, step });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
    const callNames = calls.map((c) => c.function?.name).filter(Boolean);
    send({ type: 'step', step, label: `${label} · 第 ${step} 步`, state: 'done', note: `調用 ${callNames.join(' → ')}` });
  }

  /**
   * Phase B — structure: one clean JSON-mode call with the tool results in context.
   * Repair loop stays in case the reply is malformed or fails the scenario validator.
   */
  messages.push({
    role: 'user',
    content: '而家只輸出最終 JSON 對象（嚴格按上面要求嘅字段同類型），唔要解釋文字，唔要 markdown 代碼塊，唔好再調用工具。',
  });

  let attemptText = '';
  for (let repairs = 0; repairs <= MAX_REPAIRS; repairs += 1) {
    const final = await client.complete({ messages, json: true, temperature, maxTokens });
    addUsage(final.usage);
    trace(repairs === 0 ? 'phaseB' : `repair${repairs}`, final.message, final.finishReason);
    messages.push(final.message);
    attemptText = final.message?.content || '';
    const attempt = tryFinish(attemptText);
    if (attempt.ok) {
      send({ type: 'step', step: 0, label: `${label} · 結構化輸出`, state: 'done', note: `JSON 校驗通過（${attemptText.length} 字符）` });
      return { data: attempt.data, toolTrace, usage, steps: maxSteps };
    }
    send({ type: 'step', step: 0, label: `${label} · 結構修復 ${repairs + 1}/${MAX_REPAIRS + 1}`, state: 'running', note: attempt.reason });
    messages.push({ role: 'user', content: `上一次輸出不可用：${attempt.reason}。請重新輸出最終 JSON 對象，字段同類型嚴格符合要求，只輸出 JSON。` });
  }

  send({ type: 'step', step: 0, label: `${label} · 結構化輸出`, state: 'error', note: '模型多次未返回可解析 JSON' });
  return { data: null, toolTrace, usage, steps: maxSteps, degraded: 'invalid_json' };
}

function toolWasCalled(toolTrace, list) {
  return toolTrace.some((t) => list.includes(t.name));
}

/**
 * Guardrail: the panel must be grounded in real tool results.
 * Missing facts throw, which makes runScenario fall back to the mock engine
 * instead of rendering a panel the model invented.
 */
function requireTools(toolTrace, required) {
  const missing = required.filter((name) => !toolWasCalled(trace(toolTrace), [name]));
  if (missing.length) throw new Error(`模型冇調用必需嘅工具: ${missing.join(', ')}（拒絕未經驗證嘅結果）`);
}
function trace(t) {
  return t;
}

function planFromTrace(toolTrace, fallback) {
  const plan = [];
  const push = (name, text) => {
    if (toolWasCalled(toolTrace, [name])) plan.push(text);
  };
  push('find_nearby_mission_spots', '搵附近嘅 SpeakOut Friendly Spot');
  push('create_speakout_mission', '生成線下任務卡（SpeakOut Mission）');
  push('build_rehearsal_script', '生成出發前粵語預演');
  push('verify_location', '校驗係咪到達門店（地理圍欄）');
  push('issue_dynamic_code', '簽發一次性動態碼');
  push('redeem_dynamic_code', '商家端核銷動態碼');
  push('issue_city_stamp', '發放 City Stamp + XP + Gems');
  push('generate_share_card', '生成社交分享卡');
  push('recommend_next_lesson', '推薦下一節 Duolingo 粵語課');
  push('get_leaderboard', '讀取聯盟排行榜');
  return plan.length ? plan : fallback;
}

function mockNotice(send, reason) {
  send({ type: 'notice', level: 'warn', text: `已切換到離線 Mock 模式（${reason}）` });
  send({ type: 'step', step: 0, label: 'mock 引擎 · 確定性輸出', state: 'done', note: '唔調用大模型，現場演示嘅 fallback 路徑' });
}

/** Normalize model output: guarantee the fields the UI needs, keep model text when present. */
function normalizeMission(data, merchant, lesson) {
  const m = merchant.mission;
  // Derive walk time from the *real* great-circle distance, never from a hardcoded number:
  // this card is read out loud on stage, and the arrival check will contradict it otherwise.
  const fromHome = distanceMeters(USER_PROFILE.home, merchant);
  return {
    task_id: merchant.id,
    lesson_id: lesson.id,
    lesson_title: lesson.title,
    title: data?.mission_title || data?.title || m.title,
    hook: data?.hook || `你啱啱學完《${lesson.titleZh || lesson.title}》，而家去真實場景講一次。`,
    scenario_line: data?.scenario_line || 'You’re ready to use this outside Duolingo.',
    scene: data?.scene || m.scenario,
    location: {
      merchant_id: merchant.id,
      name: merchant.name,
      district: merchant.district,
      address: merchant.address,
      walk_minutes: walkMinutes(fromHome),
      distance_m: fromHome,
      staff_language: merchant.staffLang,
      staff_note: merchant.staffNote,
      friendly_spot: true,
      sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
    },
    duration_minutes: data?.duration_minutes || 5,
    difficulty: data?.difficulty || 'normal',
    objective: data?.objective || m.objective,
    key_phrases: Array.isArray(data?.key_phrases) && data.key_phrases.length ? data.key_phrases : m.keyPhrases,
    success_criteria:
      Array.isArray(data?.success_criteria) && data.success_criteria.length ? data.success_criteria : m.successCriteria,
    why_this_spot: data?.why_this_spot || data?.why_this_store || merchant.staffNote,
    verification: ['geofence_120m', 'staff_dynamic_code'],
    reward: { xp: 75, gems: 20, stamp_hint: `${merchant.district.split(' · ')[0]} Stamp`, streak_delta: 1 },
    duo_line: DUO_LINES.missionReady,
  };
}

/**
 * Run one demo scenario end to end.
 * @returns {{panel: {type: string, data: object}, mode: 'live'|'mock', toolTrace: Array, usage: object, warning?: string}}
 */
export async function runScenario(scenario, input, { mode = 'auto', client, session = {}, emit } = {}) {
  const send = emitTo(emit);
  const canLive = Boolean(client && client.hasKey) && mode !== 'mock';
  if (canLive) {
    try {
      return await liveScenario(scenario, input || {}, { client, session, send });
    } catch (err) {
      const reason = String(err.message || err).slice(0, 160);
      if (process.env.DSH_DEMO_DEBUG) console.warn(`[duo-jiangjiang] live 場景 ${scenario} 失敗，降級 mock:`, reason, err?.stack?.split('\n')[1] || '');
      send({ type: 'error', message: `live 調用失敗（已降級 Mock）：${reason}` });
      mockNotice(send, reason);
      const mock = await mockScenario(scenario, input || {}, { session, send });
      return { ...mock, warning: reason, mode: 'mock' };
    }
  }
  if (mode === 'auto' && !(client && client.hasKey)) mockNotice(send, '未檢測到 DEEPSEEK_API_KEY');
  else if (mode === 'mock') mockNotice(send, '手動強制 Mock');
  const mock = await mockScenario(scenario, input || {}, { session, send });
  return { ...mock, mode: 'mock' };
}

async function mockScenario(scenario, input, { session, send }) {
  const out = await buildMockScenario(scenario, input, { session });
  for (const ev of out.events) {
    send(ev);
    if (ev.type === 'token') await new Promise((r) => setTimeout(r, 18));
  }
  return { panel: out.panel, mode: 'mock', toolTrace: out.toolTrace || [], usage: out.usage || null };
}

/* ------------------------------------------------------------------ *
 * Scenario 1: Lesson Complete -> Mission Revealed
 * ------------------------------------------------------------------ */
async function scenarioLessonComplete(input, { client, session, send }) {
  const lesson = getLesson(input.lessonId || 'L-01');
  const usedIds = session.missions?.map((m) => m.task_id) || [];
  const merchant = pickMerchantForLesson(lesson.id, usedIds);
  session.lesson = lesson;

  const user = `【事件】學員啱啱喺 Duolingo App 完成咗一節粵語課。
課程：${lesson.id}《${lesson.title}》／${lesson.titleZh}（${lesson.unit}，CEFR ${lesson.cefr}）
正確率：${Math.round((lesson.accuracy ?? 0.9) * 100)}%
本節新學表達：${lesson.vocabLearned.join(' / ')}
薄弱點：${lesson.weakPoints.join(' / ')}
學習時長：${lesson.minutes} 分鐘，獲得 ${lesson.xpEarned ?? 12} XP

【學員畫像】${USER_PROFILE.name}，Duolingo 粵語課程，CEFR ${USER_PROFILE.cefr}，Lv.${USER_PROFILE.level}，
連續學習 ${USER_PROFILE.streakDays} 天 🔥，寶石 ${USER_PROFILE.gems} 💎，${USER_PROFILE.league} 聯盟第 ${USER_PROFILE.leagueRank} 名，
日常活動區域：${USER_PROFILE.campus}，目前座標 ${USER_PROFILE.home.lat}, ${USER_PROFILE.home.lng}。

【任務要求】
1. 先調用 find_nearby_mission_spots 搵合適嘅 Friendly Spot（偏好 category 同課程主題匹配、步行 15 分鐘內）。
2. 揀定一間之後調用 create_speakout_mission 生成任務卡（lesson_id=${lesson.id}）。
3. 最後只輸出 JSON：
{"mission_title":string,"scenario_line":string,"hook":string,"scene":string,"objective":string,"key_phrases":string[],"success_criteria":string[],"why_this_spot":string,"duration_minutes":number,"difficulty":"easy"|"normal"|"stretch"}
其中：
- mission_title 係任務標題，用粵語，要似 Duolingo 嘅任務名（例如「用粵語點一杯凍檸茶」）；
- scenario_line 係一句英文招呼，要係 Duolingo 語氣，建議直接用 "You’re ready to use this outside Duolingo."；
- key_phrases 係 3 條學員到店要講嘅粵語正字句子；
- success_criteria 係 2 條可判定嘅通過標準（唔可以要求「發音準確」，因為系統驗證唔到）。`;

  const { data, toolTrace, usage } = await runAgent({
    client,
    system:
      '當前場景：把啱啱學完嘅粵語課包裝成一張線下真實任務卡，目標係讓學員 15 分鐘內出門開口講粵語。工具調用預算：最多 2 次（find_nearby_mission_spots 一次、create_speakout_mission 一次）。文案要似 Duolingo：簡短、鼓勵、帶少少俏皮。',
    user,
    toolCtx: { session },
    emit: send,
    label: '任務生成',
    maxSteps: 4,
    validate: (d) => {
      if (!d || typeof d !== 'object') throw new Error('必須返回 JSON 對象');
      if (!d.mission_title && !d.title) throw new Error('缺少 mission_title（任務標題）');
      if (!Array.isArray(d.key_phrases) || d.key_phrases.length < 3) throw new Error('key_phrases 必須係不少於 3 條嘅粵語句子數組');
      if (!Array.isArray(d.success_criteria) || d.success_criteria.length < 2) throw new Error('success_criteria 必須係不少於 2 條嘅數組');
    },
  });

  if (!data) throw new Error('模型未返回可解析嘅任務卡 JSON');
  requireTools(toolTrace, ['find_nearby_mission_spots', 'create_speakout_mission']);
  const mission = normalizeMission(data, merchant, lesson);
  const plan = planFromTrace(toolTrace, ['生成任務卡']);

  // 任務地圖：直接由真實工具結果砌出嚟，唔經模型改寫 —— 距離同座標一定要同 verify_location 一致。
  const spotsRaw = toolTrace.filter((t) => t.name === 'find_nearby_mission_spots').pop()?.result;
  const spotsPanel = buildSpotsPanel(spotsRaw, merchant.id, mission.title);
  session.nearby = spotsPanel;

  send({ type: 'panel', panel: { type: 'spots', data: spotsPanel } });
  send({ type: 'panel', panel: { type: 'mission', data: mission } });
  session.missions = [...(session.missions || []), mission];
  session.activeMission = mission;
  return {
    panel: { type: 'mission', data: mission },
    spotsPanel,
    mode: 'live',
    toolTrace,
    usage,
    plan,
    narration: mission.hook,
  };
}

/* ------------------------------------------------------------------ *
 * Scenario 2: Rehearsal (Duo plays the barista)
 * ------------------------------------------------------------------ */
async function scenarioPrerun(input, { client, session, send }) {
  const mission = session.activeMission || normalizeMission({}, MERCHANTS[0], getLesson('L-01'));
  session.activeMission = mission;
  const merchant = getMerchant(mission.location.merchant_id);

  const user = `【場景】學員仲未出門，需要一段粵語「預演對話」嚟降低開口焦慮。Duo 會扮演店員。
任務卡：${mission.title}
場景：${mission.scene}
門店：${merchant.name}（${merchant.district}，店員語言：${merchant.staffLang}）
必須用到嘅句子：${mission.key_phrases.join(' | ')}
通過標準：${mission.success_criteria.join(' | ')}

【要求】
1. 調用 build_rehearsal_script（task_id=${merchant.id}）攞預演骨架同對方可能嘅反問。
2. 然後只輸出 JSON：
{"dialogue":[{"role":"learner"|"staff","yue":string,"jyutping":string,"en":string}],"coach_tips":string[],"pronunciation_focus":string,"duo_line":string}
要求：
- dialogue 4-6 輪，learner 台詞必須覆蓋「必須用到嘅句子」；
- staff 台詞要包含 1-2 個冇預料到嘅反問（例如「凍定熱呀？」「要唔要少甜？」）；
- 每句粵語都要有 jyutping（粵拼）同 en（英文意思），jyutping 用數字聲調（例如 m4 goi1）；
- coach_tips 俾 2-3 條具體可執行嘅建議，用粵語或繁體中文寫；
- pronunciation_focus 寫 1 條粵語聲調／語氣提示；
- duo_line 係 Duo 講嘅一句鼓勵（英文，Duolingo 語氣）。`;

  const { data, toolTrace, usage } = await runAgent({
    client,
    system:
      '當前場景：出發前嘅預演（Rehearsal）。你扮演 Friendly Spot 嘅店員講粵語，同時做教練。記住：預演嘅目的唔係背台詞，而係讓學員知道「被問倒都係正常嘅」。工具調用預算：只調用 build_rehearsal_script 一次。',
    user,
    toolCtx: { session },
    emit: send,
    label: '預演生成',
    maxSteps: 3,
    maxTokens: 2800,
    validate: (d) => {
      const turns = d?.dialogue || d?.turns || d?.lines;
      if (!Array.isArray(turns) || turns.length < 2) {
        throw new Error('dialogue 必須係非空數組，且至少 2 輪，每輪含 role/yue/jyutping/en');
      }
      const bad = turns.filter((t) => !t || (!t.yue && !t.en && !t.text));
      if (bad.length) throw new Error('dialogue 每一輪都必須有 yue（粵語台詞）同 en（英文意思）');
    },
  });

  if (!data) throw new Error('模型未返回可解析嘅預演對話 JSON');
  requireTools(toolTrace, ['build_rehearsal_script']);
  const rawTurns = data.dialogue || data.turns || data.lines || [];
  const panelData = {
    task_id: merchant.id,
    spot_name: merchant.name,
    sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
    focus: mission.key_phrases[0] || '自然開場',
    dialogue: rawTurns.slice(0, 8).map((t, i) => ({
      turn: i + 1,
      role: /staff|npc|clerk|店員|barista/i.test(String(t.role || '')) ? 'staff' : 'learner',
      yue: String(t.yue || t.zh || t.text || ''),
      jyutping: String(t.jyutping || t.jp || ''),
      en: String(t.en || ''),
    })),
    coach_tips: Array.isArray(data.coach_tips) ? data.coach_tips.slice(0, 4) : [],
    pronunciation_focus: data.pronunciation_focus || '',
    duo_line: data.duo_line || DUO_LINES.rehearsalDone,
    staff_note: merchant.staffNote,
    confidence_before: 42,
    confidence_after: 68,
  };
  send({ type: 'panel', panel: { type: 'rehearsal', data: panelData } });
  session.rehearsal = panelData;
  return { panel: { type: 'rehearsal', data: panelData }, mode: 'live', toolTrace, usage, plan: planFromTrace(toolTrace, ['預演對話']) };
}

/* ------------------------------------------------------------------ *
 * Scenario 3: Arrival verification (geofence)
 * ------------------------------------------------------------------ */
/**
 * Resolve the coordinate the app will "report" for the arrival scenario.
 * Shared by the live agent path and the mock engine so both behave identically.
 * gpsScenario: 'enroute' | 'drift' | 'spoofed' | 'arrived'
 */
export function resolveGps(input = {}, merchant) {
  const scenarioKey = input.gpsScenario || 'arrived';
  if (typeof input.lat === 'number' && typeof input.lng === 'number') {
    return { claimed: { lat: input.lat, lng: input.lng }, accuracy: typeof input.accuracy === 'number' ? input.accuracy : 15, scenarioKey: 'real' };
  }
  const base = { lat: merchant.lat, lng: merchant.lng };
  if (scenarioKey === 'enroute') return { claimed: offsetCoord(base, 900, 200), accuracy: 18, scenarioKey };
  if (scenarioKey === 'drift') return { claimed: offsetCoord(base, 260, 300), accuracy: 260, scenarioKey };
  if (scenarioKey === 'spoofed') return { claimed: { ...base }, accuracy: 8, scenarioKey };
  return { claimed: offsetCoord(base, 45, 60), accuracy: 12, scenarioKey };
}

async function scenarioArrive(input, { client, session, send }) {
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id);

  const scenarioKey = input.gpsScenario || 'arrived';
  const { claimed, accuracy } = resolveGps(input, merchant);

  const user = `【事件】學員撳咗「我到了」，App 上報咗座標，需要你做雙重驗證嘅第一道：地理圍欄。
任務：${mission.title}（task_id=${merchant.id}）
門店：${merchant.name}，座標 ${merchant.lat}, ${merchant.lng}，圍欄半徑 ${GEOFENCE_RADIUS_M}m
學員上報座標：${claimed.lat}, ${claimed.lng}（裝置精度 ${accuracy}m）
已知風險：${scenarioKey === 'drift' ? '定位喺度飄，可能被判未到店' : scenarioKey === 'spoofed' ? '座標與門店完全重合，疑似模擬定位' : scenarioKey === 'enroute' ? '學員可能仲喺路上' : '正常到店'}

【要求】
1. 調用 verify_location（task_id、merchant_id、user_lat、user_lng、gps_accuracy_m 都要傳真實值）。
2. 如果通過圍欄校驗，再調用 issue_dynamic_code 簽發動態碼（ttl_seconds=180）。
3. 然後只輸出 JSON：
{"inside_geofence":boolean,"verdict":"passed"|"failed"|"manual_review","distance_m":number,"message":string,"coach_tips":string[],"risk_flags":string[]}
message 係俾學員睇嘅一句話（含下一步做咩），語氣要似 Duolingo：失敗都唔好責備，
例如「仲差 180 米，行多兩分鐘就到，Duo 喺度等你。」；失敗時 coach_tips 俾 2 條補救建議。`;

  const { data, toolTrace, usage } = await runAgent({
    client,
    system:
      '當前場景：O2O 到店驗證嘅第一道關卡。你必須以工具返回嘅距離同圍欄結果為準，不得自行判斷「已到店」，亦唔好重複調用工具。工具調用預算：verify_location 一次；若通過圍欄，再調用 issue_dynamic_code 一次。',
    user,
    toolCtx: { session },
    emit: send,
    label: '到店校驗',
    maxSteps: 4,
  });

  const verified = session.locationCheck;
  if (!verified) throw new Error('工具未返回地理圍欄結果');
  requireTools(toolTrace, ['verify_location']);
  if (verified.inside_geofence && !session.issuedCode) throw new Error('已進入圍欄但模型冇調用 issue_dynamic_code 簽發動態碼');
  const code = session.issuedCode || null;
  const panelData = {
    task_id: merchant.id,
    merchant_name: merchant.name,
    merchant_district: merchant.district,
    inside_geofence: verified.inside_geofence,
    verdict: verified.verdict,
    distance_m: verified.distance_m,
    geofence_radius_m: verified.geofence_radius_m,
    distance_to_go_m: verified.distance_to_go_m,
    gps_accuracy_m: accuracy,
    risk_flags: verified.risk_flags,
    code_invalidated: Boolean(verified.code_invalidated),
    claimed,
    merchant_coord: { lat: merchant.lat, lng: merchant.lng },
    sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
    friendly_spot_note: 'Cantonese Learners Welcome. Take your time.',
    message: data?.message || (verified.inside_geofence ? '已進入門店圍欄，可以出示動態碼喇' : '仲未到店，行多一段'),
    coach_tips: Array.isArray(data?.coach_tips) ? data.coach_tips : [],
    duo_line: verified.inside_geofence ? DUO_LINES.arrive : DUO_LINES.failed,
    code: code
      ? { code: code.code, ttl_seconds: code.ttlSeconds, expires_at: code.expiresAt, single_use: true }
      : null,
    progress: progressSnapshot(),
  };
  send({ type: 'panel', panel: { type: 'arrival', data: panelData } });
  session.arrival = panelData;
  return { panel: { type: 'arrival', data: panelData }, mode: 'live', toolTrace, usage, plan: planFromTrace(toolTrace, ['到店校驗']) };
}

/* ------------------------------------------------------------------ *
 * Scenario 4: staff redeems the dynamic code
 * ------------------------------------------------------------------ */
async function scenarioVerifyCode(input, { client, session, send }) {
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id);
  const submitted = String(input.code || '').trim();
  if (!/^\d{4}$/.test(submitted)) throw new Error('請傳入 4 位數字動態碼');

  const user = `【事件】店員喺商家端輸入咗學員出示嘅動態碼。
任務：${mission.title}（task_id=${merchant.id}）
店員輸入嘅碼：${submitted}

【要求】
1. 調用 redeem_dynamic_code（task_id=${merchant.id}, code="${submitted}"）做核銷校驗。
2. 然後只輸出 JSON：
{"redeemed":boolean,"reason":string,"message":string,"next_step":string}
message 係俾學員睇嘅一句話結果說明；若失敗，next_step 講清點補救（重新簽發 / 核對碼值），
語氣要似 Duolingo 咁溫和，例如「碼唔啱，唔緊要，我哋再試一次。」`;

  const { data, toolTrace, usage } = await runAgent({
    client,
    system:
      '當前場景：動態碼核銷。碼值、時效、一次性都只可以由工具判定，你負責把結果講清楚並俾出下一步。工具調用預算：只調用 redeem_dynamic_code 一次。',
    user,
    toolCtx: { session },
    emit: send,
    label: '動態碼核銷',
    maxSteps: 3,
  });

  const redemption = toolTrace.filter((t) => t.name === 'redeem_dynamic_code').pop()?.result;
  if (!redemption) throw new Error('模型冇調用 redeem_dynamic_code，核銷結果不可信');
  const ok = Boolean(redemption && redemption.redeemed);
  const panelData = {
    task_id: merchant.id,
    merchant_name: merchant.name,
    submitted,
    redeemed: ok,
    reason: redemption?.reason || (ok ? 'ok' : 'unknown'),
    attempts: redemption?.attempts ?? null,
    message: data?.message || redemption?.message || '',
    next_step: data?.next_step || (ok ? '解鎖 City Stamp' : '請學員核對動態碼或重新簽發'),
    verification_summary: {
      geofence: session.locationCheck?.verdict || 'unknown',
      dynamic_code: ok ? 'passed' : 'failed',
    },
    duo_line: ok ? 'Verified! 🎉' : DUO_LINES.failed,
    completed_at: ok ? new Date().toISOString() : null,
  };
  if (ok) session.completed = panelData;
  send({ type: 'panel', panel: { type: 'verified', data: panelData } });
  return { panel: { type: 'verified', data: panelData }, mode: 'live', toolTrace, usage, plan: planFromTrace(toolTrace, ['核銷動態碼']) };
}

/* ------------------------------------------------------------------ *
 * Scenario 5: REWARD — City Stamp + XP + Gems + streak
 * (Duolingo's existing reward system, paid out for a real-world attempt)
 * ------------------------------------------------------------------ */
async function scenarioReward(input, { client, session, send }) {
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id);
  const lesson = getLesson(mission.lesson_id);
  const verified = session.completed?.redeemed === true || input.verified === true;

  const user = `【事件】任務雙重驗證結果出咗，需要發放 Duolingo 獎勵。
任務：${mission.title} @ ${merchant.name}
地理圍欄：${session.locationCheck?.verdict || 'unknown'}
動態碼核銷：${verified ? 'passed' : 'failed'}
課程：${lesson.id}《${lesson.title}》
學員目前：連續 ${USER_PROFILE.streakDays} 天 🔥，寶石 ${USER_PROFILE.gems} 💎，今日 ${USER_PROFILE.xpToday}/${USER_PROFILE.dailyGoalXp} XP，${USER_PROFILE.league} 聯盟第 ${USER_PROFILE.leagueRank} 名

【要求】
1. 調用 issue_city_stamp（task_id=${merchant.id}, verified=${verified}）攞獎勵、City Stamp 同進度。
2. 然後只輸出 JSON：
{"headline":string,"body":string,"duo_line":string,"next_hint":string}
- headline 係獎勵頁大字，英文為主，要似 Duolingo 嘅成功頁（例如 "Verified Real-World Speaking Attempt"）；
- body 用繁體中文一句講清佢做咗咩（講「你用粵語完成咗一次真實對話嘗試」，唔好講「你粵語好叻」）；
- duo_line 係 Duo 講嘅一句（英文，Duolingo 語氣，可以少少幽默）；
- next_hint 用一句話引導去下一課（Learn → Use → Learn）。`;

  const { data, toolTrace, usage } = await runAgent({
    client,
    system:
      '當前場景：發放 City Stamp 同 Duolingo 現有獎勵（XP / Gems / streak）。記住品牌定位：呢啲獎勵唔係新發明，係 Duolingo 現有系統嘅自然延伸，只係由「做練習」變成「真實開口」都可以賺。工具調用預算：只調用 issue_city_stamp 一次。',
    user,
    toolCtx: { session },
    emit: send,
    label: '獎勵發放',
    maxSteps: 3,
  });

  const rewardResult = toolTrace.filter((t) => t.name === 'issue_city_stamp').pop()?.result;
  if (!rewardResult) throw new Error('模型冇調用 issue_city_stamp，獎勵唔可信');
  requireTools(toolTrace, ['issue_city_stamp']);

  const panelData = {
    task_id: merchant.id,
    verified,
    headline: data?.headline || (verified ? 'Verified Real-World Speaking Attempt' : 'Attempt Logged'),
    body:
      data?.body ||
      (verified
        ? 'You used Cantonese in real life. Duo is proud of you.'
        : 'Didn’t speak this time? No worries. Duo will wait for you.'),
    duo_line: data?.duo_line || rewardResult.duo_line,
    next_hint: data?.next_hint || '你已經識講，下一課教你「畀錢」。',
    stamp: rewardResult.stamp,
    rewards: rewardResult.rewards,
    progress: rewardResult.progress,
    map_entry: rewardResult.map_entry,
    verification_scope: rewardResult.verification_scope,
  };
  session.rewardPanel = panelData;
  send({ type: 'panel', panel: { type: 'reward', data: panelData } });
  return { panel: { type: 'reward', data: panelData }, mode: 'live', toolTrace, usage, plan: planFromTrace(toolTrace, ['發放 City Stamp 與獎勵']) };
}

/* ------------------------------------------------------------------ *
 * Scenario 6: SHARE + NEXT LESSON (Learn -> Use -> Learn loop)
 * ------------------------------------------------------------------ */
async function scenarioShareAndNext(input, { client, session, send }) {
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id);
  const lesson = getLesson(mission.lesson_id);
  const learned = Array.isArray(input.learnedPhrases) && input.learnedPhrases.length ? input.learnedPhrases : mission.key_phrases.slice(0, 2);

  const user = `【事件】任務已通過雙重驗證同已發獎勵，而家要生成社交分享卡、推薦下一節課、同埋睇排行榜。
任務：${mission.title} @ ${merchant.name}
課程：${lesson.id}《${lesson.title}》，原本薄弱點：${lesson.weakPoints.join(' / ')}
學員今次真係用咗嘅句子：${learned.join(' | ')}
學員數據：連續 ${USER_PROFILE.streakDays} 天，${USER_PROFILE.league} 聯盟第 ${USER_PROFILE.leagueRank} 名
風格：${input.style || 'playful'}，可見範圍：${input.privacy || 'friends'}

【要求】
1. 調用 generate_share_card（task_id=${merchant.id}，style、privacy 用上面嘅值）。
2. 調用 recommend_next_lesson（completed_lesson_id=${lesson.id}，mission_result={"verified":true,"code_redeemed":true}）。
3. 調用 get_leaderboard（睇本週聯盟排名同 Friend Mission 狀態）。
4. 然後只輸出 JSON：
{"share_card":{"headline":string,"subheadline":string,"body":string,"stats":string[],"hashtags":string[]},"next_lesson":{"lesson_id":string,"title":string,"why_now":string,"carry_over_phrases":string[],"preview_goal":string,"suggested_when":string},"loop_summary":string,"advocacy_line":string}
要求：
- headline 唔超過 16 個字，要似 Duolingo 嘅分享文案（輕鬆、有情緒）；
- body 嘅立場係「我用粵語生活」，唔係「我粵語好好」；
- stats 3 條，用真實數據（學咗幾句、點亮幾多個地點、streak 幾多日）；
- next_lesson.lesson_id 必須嚟自工具返回嘅候選課程，carry_over_phrases 要包含下一課嘅粵語句；
- loop_summary 用一句話講清「學 → 用 → 再學」嘅閉環；
- advocacy_line 係一句俾用戶分享用嘅英文（例如 "Hong Kong is becoming my classroom."）。`;

  const { data, toolTrace, usage } = await runAgent({
    client,
    system:
      '當前場景：任務完成後生成分享卡、推薦下一課、讀排行榜，把線下成功經驗接返課程體系，形成 Learn → Use → Learn 閉環。品牌重點：Share Card 唔係炫耀語言能力，而係展示「我用粵語生活」。工具調用預算：generate_share_card 一次、recommend_next_lesson 一次、get_leaderboard 一次。',
    user,
    toolCtx: { session },
    emit: send,
    label: '分享與推薦',
    maxSteps: 5,
    validate: (d) => {
      if (!d?.share_card) throw new Error('缺少 share_card 對象');
      if (!d.share_card.headline) throw new Error('share_card.headline 唔可以為空');
      if (!d.next_lesson || !d.next_lesson.lesson_id) throw new Error('缺少 next_lesson.lesson_id');
    },
  });

  if (!data || !data.share_card) throw new Error('模型未返回分享卡 JSON');
  requireTools(toolTrace, ['generate_share_card', 'recommend_next_lesson']);
  const card = data.share_card;
  const next = data.next_lesson || {};
  const board = toolTrace.filter((t) => t.name === 'get_leaderboard').pop()?.result || null;
  const reward = session.reward || {};
  const rewardPanel = session.rewardPanel || null;

  const panelData = {
    task_id: merchant.id,
    share_card: {
      headline: card.headline || '我用粵語生活咗一日',
      subheadline: card.subheadline || `${lesson.title} · ${merchant.name}`,
      body: card.body || '',
      stats: Array.isArray(card.stats) ? card.stats.slice(0, 3) : [
        `${mission.key_phrases.length} phrases learned`,
        '4 places unlocked',
        `${USER_PROFILE.streakDays + 1}-day streak 🔥`,
      ],
      hashtags: Array.isArray(card.hashtags) ? card.hashtags.slice(0, 4) : ['#Duo講講', '#Cantonese', '#HKU', '#SpeakOutPass'],
      redemption_code_last4: (session.issuedCode?.code || '0000').slice(-2),
      advocacy_line: data.advocacy_line || 'Hong Kong is becoming my classroom.',
      share_targets: ['RedNote', 'Instagram Story', 'WeChat', '校園群'],
    },
    next_lesson: {
      lesson_id: next.lesson_id || 'L-02',
      title: next.title || 'Paying in 711 · 畀錢',
      why_now: next.why_now || '你啱啱用粵語完成咗點單，下一步最自然就係畀錢。',
      carry_over_phrases: Array.isArray(next.carry_over_phrases) && next.carry_over_phrases.length
        ? next.carry_over_phrases.slice(0, 3)
        : ['八達通得唔得？', '唔使袋，唔該。'],
      preview_goal: next.preview_goal || '可以喺便利店用粵語問付款方式，並完成一次交易。',
      suggested_when: next.suggested_when || '聽日返學途中 8 分鐘',
    },
    loop_summary: data.loop_summary || '線上學粵語 → 線下真開口 → 用真實表現決定下一課，Learn → Use → Learn 閉環完成。',
    streak_after: rewardPanel?.rewards?.streak_after ?? USER_PROFILE.streakDays + 1,
    progress: reward.progress || progressSnapshot(),
    leaderboard: board,
    friend_mission: board?.friend_mission || null,
    duo_line: DUO_LINES.share,
  };
  send({ type: 'panel', panel: { type: 'share', data: panelData } });
  session.share = panelData;
  return { panel: { type: 'share', data: panelData }, mode: 'live', toolTrace, usage, plan: planFromTrace(toolTrace, ['分享卡', '下一課推薦', '排行榜']) };
}

const LIVE = {
  'lesson-complete': scenarioLessonComplete,
  prerun: scenarioPrerun,
  arrive: scenarioArrive,
  'verify-code': scenarioVerifyCode,
  reward: scenarioReward,
  'share-and-next': scenarioShareAndNext,
};

export const SCENARIOS = Object.keys(LIVE);

async function liveScenario(scenario, input, ctx) {
  const fn = LIVE[scenario];
  if (!fn) throw new Error(`未知場景: ${scenario}`);
  return fn(input, ctx);
}

export { walkMinutes, LESSONS, MERCHANTS, TOOL_NAMES, normalizeMission };
