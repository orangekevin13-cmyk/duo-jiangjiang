// mock.mjs — offline deterministic engine. Same panel shapes as the live agent path,
// so the UI cannot tell the difference (this is the on-stage fallback when the API is down).
//
// Important: this is the *demo* fallback, not a fake agent. It runs the very same real tool
// handlers (Friendly Spot 查詢、地理圍欄、動態碼、City Stamp) and only replaces the model's
// wording with Duolingo-voiced templates.

import {
  DUO_LINES,
  LESSONS,
  USER_PROFILE,
  getLesson,
  getMerchant,
  walkMinutes,
} from './store.mjs';
import { TOOL_SCHEMAS, runTool, progressSnapshot } from './tools.mjs';
import { resolveGps } from './agent.mjs';

const NARRATION = {
  'lesson-complete': '偵測到課程完成事件，正喺度把《{lesson}》轉成一張線下任務卡……',
  prerun: '任務卡已就緒，Duo 準備扮演店員，同你預演一次粵語對話……',
  arrive: '收到到店上報，正喺度做地理圍欄校驗同反作弊檢查……',
  'verify-code': '店員已輸入動態碼，正喺度核銷（校驗碼值、時效、一次性）……',
  reward: '雙重驗證通過，正喺度發放 City Stamp 同 Duolingo 獎勵……',
  'share-and-next': '任務通過雙重驗證，正喺度生成分享卡、下一課推薦同排行榜……',
};

const TOKENS = {
  'lesson-complete': ['已配對', '步行 5 分鐘內嘅 Friendly Spot', '，把你嘅課程薄弱點', '變成必須開口嘅真實任務', '。'],
  prerun: ['預演腳本已生成', '，共 5 輪對話', '，重點練「少甜」同「唔該」', '兩個表達', '。'],
  arrive: ['圍欄校驗完成', '，距離門店 ', '{distance}m', '，', '{verdict}', '。'],
  'verify-code': ['核銷結果：', '{verdict}', '，雙重驗證鏈已經行完', '。'],
  reward: ['City Stamp 已解鎖', '，+{xp} XP', '、+{gems} Gems', '，streak 更新為 {streak} 日 🔥', '。'],
  'share-and-next': ['分享卡已生成', '，並基於本次薄弱點', '推薦咗下一節粵語課', '。'],
};

const VERDICT_ZH = { passed: '校驗通過', failed: '未進入圍欄', manual_review: '轉人工覆核' };

function tokensFor(scenario, dict) {
  return (TOKENS[scenario] || []).map((t) =>
    t
      .replace('{distance}', dict.distance ?? '')
      .replace('{verdict}', dict.verdict ?? '')
      .replace('{xp}', dict.xp ?? '')
      .replace('{gems}', dict.gems ?? '')
      .replace('{streak}', dict.streak ?? ''),
  );
}

function pushToolEvents(events, name, args, result) {
  events.push({ type: 'tool_call', name, args, step: 1, mock: true });
  events.push({ type: 'tool_result', name, result, step: 1, mock: true });
}

async function call(name, args, session) {
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === name);
  const result = await runTool(name, args, { session });
  return { name, args, result, schema };
}

/* ---------------------------------- 1 ---------------------------------- */
async function mockLessonComplete(input, session) {
  const events = [];
  const lesson = getLesson(input.lessonId || 'L-01');
  session.lesson = lesson;
  const usedIds = (session.missions || []).map((m) => m.task_id);

  const origin = USER_PROFILE.home;
  const near = await call('find_nearby_mission_spots', { origin_lat: origin.lat, origin_lng: origin.lng, limit: 3 }, session);
  pushToolEvents(events, near.name, near.args, near.result);

  const categoriesByLesson = { 'L-01': 'cafe', 'L-02': 'convenience', 'L-03': 'bookstore', 'L-04': 'campus' };
  const wanted = categoriesByLesson[lesson.id];
  const chosen =
    near.result.spots.find((m) => m.category === wanted && !usedIds.includes(m.merchant_id)) ||
    near.result.spots.find((m) => !usedIds.includes(m.merchant_id)) ||
    near.result.spots[0];
  const merchant = getMerchant(chosen.merchant_id);

  const card = await call(
    'create_speakout_mission',
    { lesson_id: lesson.id, lesson_title: lesson.title, merchant_id: merchant.id, difficulty: 'normal' },
    session,
  );
  pushToolEvents(events, card.name, card.args, card.result);

  const mission = {
    ...card.result,
    hook: `你啱啱學完《${lesson.titleZh || lesson.title}》，正確率 ${Math.round((lesson.accuracy ?? 0.9) * 100)}%。而家去 ${merchant.name}，把「${lesson.weakPoints[0] || lesson.vocabLearned[0]}」真正講出口。`,
    scenario_line: 'You’re ready to use this outside Duolingo.',
    why_this_spot: `${merchant.staffNote} 步行 ${walkMinutes(chosen.distance_m)} 分鐘（${chosen.distance_m}m）。`,
    knowledge_link: lesson.vocabLearned,
    weak_point_target: lesson.weakPoints[0] || '',
    duo_line: DUO_LINES.missionReady,
  };
  session.activeMission = mission;
  session.missions = [...(session.missions || []), mission];

  events.push({ type: 'plan', plan: ['搵附近嘅 SpeakOut Friendly Spot', '生成線下任務卡（SpeakOut Mission）'] });
  events.push({ type: 'narration', text: NARRATION['lesson-complete'].replace('{lesson}', lesson.titleZh || lesson.title) });
  for (const t of tokensFor('lesson-complete', {})) events.push({ type: 'token', text: t });
  events.push({ type: 'panel', panel: { type: 'mission', data: mission } });

  return { events, panel: { type: 'mission', data: mission }, toolTrace: [near, card], plan: ['搵附近 Friendly Spot', '生成任務卡'] };
}

/* ---------------------------------- 2 ---------------------------------- */
const STAFF_LINES = [
  { yue: '你好，想飲啲咩呀？', jyutping: 'nei5 hou2, soeng2 jam2 di1 me1 aa3?', en: 'Hi, what would you like to drink?' },
  { yue: '凍定熱呀？今日冇燕麥奶喎。', jyutping: 'dung3 ding6 jit6 aa3? gam1 jat6 mou5 jin3 maak6 naai5 wo3.', en: 'Iced or hot? We have no oat milk today.' },
  { yue: '好呀，要唔要少甜？', jyutping: 'hou2 aa3, jiu3 m4 jiu3 siu2 tim4?', en: 'Sure — less sweet?' },
  { yue: '一共 32 蚊，唔該。', jyutping: 'jat1 gung6 saam1 sap6 ji6 man1, m4 goi1.', en: 'That comes to 32 dollars, thanks.' },
];

async function mockPrerun(input, session) {
  const events = [];
  const mission =
    session.activeMission ||
    {
      task_id: 'SP-001',
      lesson_id: 'L-01',
      title: '用粵語點一杯凍檸茶',
      key_phrases: ['唔該，我要一杯凍檸茶。', '可唔可以少甜？', '唔該晒。'],
      success_criteria: ['講出至少一句完整粵語點單句', '聽得明價錢或取餐指示並回應一次'],
      location: { merchant_id: 'SP-001' },
    };
  session.activeMission = mission;
  const merchant = getMerchant(mission.location.merchant_id || mission.task_id);

  const skeleton = await call('build_rehearsal_script', { task_id: merchant.id, turns: 5, focus: '把關鍵句講得自然' }, session);
  pushToolEvents(events, skeleton.name, skeleton.args, skeleton.result);

  const learner = mission.key_phrases.slice(0, 3);
  const jyutpingMap = {
    '唔該，我要一杯凍檸茶。': 'm4 goi1, ngo5 jiu3 jat1 bui1 dung3 ling4 caa4.',
    '可唔可以少甜？': 'ho2 m4 ho2 ji5 siu2 tim4?',
    '唔該晒。': 'm4 goi1 saai3.',
  };
  const dialogue = [];
  for (let i = 0; i < 5; i += 1) {
    if (i % 2 === 0) {
      const line = learner[Math.floor(i / 2)] || '唔該晒！';
      dialogue.push({
        turn: i + 1,
        role: 'learner',
        yue: line,
        jyutping: jyutpingMap[line] || '',
        en: `學員台詞（關鍵句 ${Math.floor(i / 2) + 1}）`,
      });
    } else {
      const line = STAFF_LINES[Math.min(Math.floor(i / 2), STAFF_LINES.length - 1)];
      dialogue.push({ turn: i + 1, role: 'staff', yue: line.yue, jyutping: line.jyutping, en: line.en });
    }
  }

  const panel = {
    task_id: merchant.id,
    spot_name: merchant.name,
    sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
    focus: '少甜 + 唔該',
    dialogue,
    coach_tips: [
      '開頭用「唔該」而唔係「多謝」：點單、叫人幫手都用「唔該」。',
      '對方語速通常比 App 音頻快，聽到數字先重複一次再答。',
      '被問到「凍定熱呀？」唔使緊張，答「凍嘅，唔該」就得。',
    ],
    pronunciation_focus: '「少甜」= siu2 tim4，兩個字都係高平／低降，唔好讀成普通話「shao tian」。',
    duo_line: 'I’ll be the barista. You order in Cantonese. I won’t switch to Mandarin. 🦉',
    staff_note: merchant.staffNote,
    confidence_before: 42,
    confidence_after: 68,
  };
  session.rehearsal = panel;

  events.push({ type: 'plan', plan: ['生成出發前粵語預演對話'] });
  events.push({ type: 'narration', text: NARRATION.prerun });
  for (const t of tokensFor('prerun', {})) events.push({ type: 'token', text: t });
  events.push({ type: 'panel', panel: { type: 'rehearsal', data: panel } });
  return { events, panel: { type: 'rehearsal', data: panel }, toolTrace: [skeleton], plan: ['預演對話'] };
}

/* ---------------------------------- 3 ---------------------------------- */
async function mockArrive(input, session) {
  const events = [];
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id || mission.task_id);
  const scenarioKey = input.gpsScenario || 'arrived';

  // Same fixture logic as the live path: import from agent.mjs so the two paths can never drift.
  const { claimed, accuracy } = resolveGps(input, merchant);

  const check = await call(
    'verify_location',
    { task_id: merchant.id, merchant_id: merchant.id, user_lat: claimed.lat, user_lng: claimed.lng, gps_accuracy_m: accuracy },
    session,
  );
  pushToolEvents(events, check.name, check.args, check.result);

  let issued = null;
  if (check.result.inside_geofence) {
    issued = await call('issue_dynamic_code', { task_id: merchant.id, merchant_id: merchant.id, ttl_seconds: 180 }, session);
    pushToolEvents(events, issued.name, issued.args, issued.result);
  }

  const tips = [];
  let message;
  if (check.result.inside_geofence) {
    message = `已進入 ${merchant.name} 嘅 ${check.result.geofence_radius_m}m 圍欄（距離 ${check.result.distance_m}m），向店員出示動態碼就得。`;
    tips.push('遞手機俾店員之前，先講一句「唔該，我係嚟做 SpeakOut Mission 嘅」，讓開口由呢一刻開始。');
    if (check.result.risk_flags.length) tips.push(`系統提示：${check.result.risk_flags.join('；')}，真實使用時請確保定位正常。`);
  } else {
    message = `仲差 ${check.result.distance_to_go_m}m 先到，未通過圍欄校驗。`;
    tips.push(`繼續向 ${merchant.address} 方向行約 ${walkMinutes(check.result.distance_to_go_m || 300)} 分鐘。`);
    if (check.result.risk_flags.some((f) => f.includes('精度'))) tips.push('而家定位精度較差，建議行去空曠位置或者開 Wi-Fi 輔助定位再試。');
    if (scenarioKey === 'spoofed') tips.push('座標與門店完全重合，系統標記為疑似模擬定位，真實評分會轉人工覆核。');
  }

  const panel = {
    task_id: merchant.id,
    merchant_name: merchant.name,
    merchant_district: merchant.district,
    inside_geofence: check.result.inside_geofence,
    verdict: check.result.verdict,
    distance_m: check.result.distance_m,
    geofence_radius_m: check.result.geofence_radius_m,
    distance_to_go_m: check.result.distance_to_go_m,
    gps_accuracy_m: accuracy,
    risk_flags: check.result.risk_flags,
    code_invalidated: Boolean(check.result.code_invalidated),
    claimed,
    merchant_coord: { lat: merchant.lat, lng: merchant.lng },
    sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
    friendly_spot_note: 'Cantonese Learners Welcome. Take your time.',
    message,
    coach_tips: tips,
    duo_line: check.result.inside_geofence ? DUO_LINES.arrive : DUO_LINES.failed,
    code: issued
      ? { code: issued.result.code, ttl_seconds: issued.result.ttl_seconds, expires_at: session.issuedCode.expiresAt, single_use: true }
      : null,
    progress: progressSnapshot(),
  };
  session.arrival = panel;

  events.push({ type: 'plan', plan: ['校驗地理圍欄', ...(issued ? ['簽發一次性動態碼'] : [])] });
  events.push({ type: 'narration', text: NARRATION.arrive });
  const dict = { distance: check.result.distance_m, verdict: VERDICT_ZH[check.result.verdict] || check.result.verdict };
  for (const t of tokensFor('arrive', dict)) events.push({ type: 'token', text: t });
  events.push({ type: 'panel', panel: { type: 'arrival', data: panel } });
  return { events, panel: { type: 'arrival', data: panel }, toolTrace: [check, issued].filter(Boolean), plan: ['到店校驗', ...(issued ? ['簽發動態碼'] : [])] };
}

/* ---------------------------------- 4 ---------------------------------- */
async function mockVerifyCode(input, session) {
  const events = [];
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id || mission.task_id);
  const submitted = String(input.code || '').trim();
  if (!/^\d{4}$/.test(submitted)) throw new Error('請傳入 4 位數字動態碼');

  const redeemed = await call('redeem_dynamic_code', { task_id: merchant.id, code: submitted }, session);
  pushToolEvents(events, redeemed.name, redeemed.args, redeemed.result);
  const ok = Boolean(redeemed.result.redeemed);

  const panel = {
    task_id: merchant.id,
    merchant_name: merchant.name,
    submitted,
    redeemed: ok,
    reason: redeemed.result.reason || 'ok',
    attempts: redeemed.result.attempts ?? null,
    message: ok
      ? `核銷成功！${merchant.name} 嘅店員已確認你完成咗「${mission.title}」。`
      : `核銷未通過：${redeemed.result.message || '動態碼唔啱'}。`,
    next_step: ok ? '解鎖 City Stamp，睇吓今次賺咗幾多 XP 同 Gems。' : '核對動態碼之後再試，或者重新簽發一個新碼。',
    verification_summary: {
      geofence: session.locationCheck?.verdict || 'passed',
      dynamic_code: ok ? 'passed' : 'failed',
    },
    duo_line: ok ? 'Verified! 🎉' : DUO_LINES.failed,
    completed_at: ok ? new Date().toISOString() : null,
  };
  if (ok) session.completed = panel;

  events.push({ type: 'plan', plan: ['商家端核銷動態碼'] });
  events.push({ type: 'narration', text: NARRATION['verify-code'] });
  for (const t of tokensFor('verify-code', { verdict: ok ? '核銷成功' : '核銷失敗' })) events.push({ type: 'token', text: t });
  events.push({ type: 'panel', panel: { type: 'verified', data: panel } });
  return { events, panel: { type: 'verified', data: panel }, toolTrace: [redeemed], plan: ['核銷動態碼'] };
}

/* ---------------------------------- 5 ---------------------------------- */
async function mockReward(input, session) {
  const events = [];
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id || mission.task_id);
  const verified = session.completed?.redeemed === true || input.verified === true;

  const stampCall = await call('issue_city_stamp', { task_id: merchant.id, verified }, session);
  pushToolEvents(events, stampCall.name, stampCall.args, stampCall.result);
  const r = stampCall.result;

  const panel = {
    task_id: merchant.id,
    verified,
    headline: verified ? 'Verified Real-World Speaking Attempt' : 'Attempt Logged',
    body: verified
      ? 'You used Cantonese in real life. Duo is proud of you.'
      : 'Didn’t speak this time? No worries. Duo will wait for you.',
    duo_line: r.duo_line,
    next_hint: '你已經識講，下一課教你「畀錢」。',
    stamp: r.stamp,
    rewards: r.rewards,
    progress: r.progress,
    map_entry: r.map_entry,
    verification_scope: r.verification_scope,
  };
  session.reward = r;
  session.rewardPanel = panel;

  events.push({ type: 'plan', plan: ['發放 City Stamp 成就徽章', '更新 XP / Gems / Streak'] });
  events.push({ type: 'narration', text: NARRATION.reward });
  const dict = {
    xp: r.rewards.xp,
    gems: r.rewards.gems,
    streak: r.rewards.streak_after,
    verdict: verified ? '通過' : '未通過',
  };
  for (const t of tokensFor('reward', dict)) events.push({ type: 'token', text: t });
  events.push({ type: 'panel', panel: { type: 'reward', data: panel } });
  return { events, panel: { type: 'reward', data: panel }, toolTrace: [stampCall], plan: ['發放 City Stamp 與獎勵'] };
}

/* ---------------------------------- 6 ---------------------------------- */
async function mockShareAndNext(input, session) {
  const events = [];
  const mission = session.activeMission;
  if (!mission) throw new Error('仲未有進行中嘅任務，請先完成場景 1');
  const merchant = getMerchant(mission.location.merchant_id || mission.task_id);
  const lesson = getLesson(mission.lesson_id || 'L-01');
  const learned = Array.isArray(input.learnedPhrases) && input.learnedPhrases.length ? input.learnedPhrases : mission.key_phrases.slice(0, 2);
  const style = input.style || 'playful';
  const privacy = input.privacy || 'friends';

  const share = await call('generate_share_card', { task_id: merchant.id, style, privacy }, session);
  pushToolEvents(events, share.name, share.args, share.result);
  const nextCall = await call(
    'recommend_next_lesson',
    { completed_lesson_id: lesson.id, mission_result: { verified: true, code_redeemed: true } },
    session,
  );
  pushToolEvents(events, nextCall.name, nextCall.args, nextCall.result);
  const boardCall = await call('get_leaderboard', {}, session);
  pushToolEvents(events, boardCall.name, boardCall.args, boardCall.result);

  const candidate = nextCall.result.candidate_lessons.find((c) => c.lesson_id !== lesson.id) || nextCall.result.candidate_lessons[0];
  const nextLesson = LESSONS.find((l) => l.id === candidate.lesson_id) || LESSONS[1];
  const reward = session.reward || {};
  const rewardPanel = session.rewardPanel || null;
  const streakAfter = rewardPanel?.rewards?.streak_after ?? USER_PROFILE.streakDays + 1;

  const panel = {
    task_id: merchant.id,
    share_card: {
      headline: '我用粵語生活咗一日',
      subheadline: `${lesson.title} · ${merchant.name}`,
      body: `今日學完《${lesson.titleZh || lesson.title}》就直接出街實戰。店員問咗我三個問題，我全部都聽得明——包括最怕嘅「凍定熱呀？」。原來「${learned[0]}」講出口只需要 3 秒嘅勇氣。`,
      stats: [
        `${(mission.key_phrases || []).length} phrases learned`,
        '4 places unlocked',
        `${streakAfter}-day streak 🔥`,
      ],
      hashtags: ['#Duo講講', '#Cantonese', '#HKU', '#SpeakOutPass'],
      redemption_code_last4: (session.issuedCode?.code || '0000').slice(-2),
      advocacy_line: 'Hong Kong is becoming my classroom.',
      share_targets: ['RedNote', 'Instagram Story', 'WeChat', '校園群'],
    },
    next_lesson: {
      lesson_id: nextLesson.id,
      title: nextLesson.title,
      why_now: `${candidate.reason_hint}；今次任務你已經喺真實場景用過「${learned[0] || ''}」，下一課把它擴展成完整對話。`,
      carry_over_phrases: (nextLesson.keyPhrases || []).map((p) => p.yue).slice(0, 3),
      preview_goal: `可以用粵語講「${(nextLesson.keyPhrases?.[0] || {}).yue || '八達通得唔得？'}」，並完成一次完整交易。`,
      suggested_when: nextLesson.id === 'L-02' ? '聽日返學途中 8 分鐘（地鐵上聽兩次音頻）' : '今晚睡前 10 分鐘',
    },
    loop_summary: `線上學《${lesson.titleZh || lesson.title}》 → 線下喺 ${merchant.name} 真開口 → 用真實表現（${(lesson.weakPoints || [])[0] || '聲調'}）決定下一課，Learn → Use → Learn 閉環完成。`,
    streak_after: streakAfter,
    progress: reward.progress || progressSnapshot(),
    leaderboard: boardCall.result,
    friend_mission: boardCall.result.friend_mission,
    duo_line: DUO_LINES.share,
  };
  session.share = panel;

  events.push({ type: 'plan', plan: ['生成社交分享卡', '推薦下一節粵語課', '讀取聯盟排行榜'] });
  events.push({ type: 'narration', text: NARRATION['share-and-next'] });
  for (const t of tokensFor('share-and-next', {})) events.push({ type: 'token', text: t });
  events.push({ type: 'panel', panel: { type: 'share', data: panel } });
  return { events, panel: { type: 'share', data: panel }, toolTrace: [share, nextCall, boardCall], plan: ['分享卡', '下一課推薦', '排行榜'] };
}

const MOCK = {
  'lesson-complete': mockLessonComplete,
  prerun: mockPrerun,
  arrive: mockArrive,
  'verify-code': mockVerifyCode,
  reward: mockReward,
  'share-and-next': mockShareAndNext,
};

export async function buildMockScenario(scenario, input = {}, { session = {} } = {}) {
  const fn = MOCK[scenario];
  if (!fn) throw new Error(`未知場景: ${scenario}`);
  const out = await fn(input, session);
  return { ...out, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, mock: true } };
}
