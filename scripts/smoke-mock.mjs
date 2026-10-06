// smoke-mock.mjs — offline self-check for the Duo 講講 panel contract.
//
// Runs all 6 scenarios through the deterministic mock engine (no network, no API key) and
// asserts the exact fields the UI reads. This is the check to run before a live demo:
// if the mock path is broken, the on-stage fallback is broken too.
//
//   node scripts/smoke-mock.mjs

import { buildMockScenario } from '../server/mock.mjs';
import { SCENARIOS } from '../server/agent.mjs';
import { USER_PROFILE } from '../server/store.mjs';

const session = {};
let failures = 0;
let checks = 0;

function ok(cond, label) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.log(`  ✗ ${label}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function assertShape(panel, type, fields) {
  ok(panel?.type === type, `panel.type 應該係 ${type}，實際係 ${panel?.type}`);
  for (const f of fields) {
    const v = f.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), panel.data);
    ok(v !== undefined && v !== null && v !== '', `panel.data.${f} 缺失`);
  }
}

async function run(name, input = {}) {
  const out = await buildMockScenario(name, input, { session });
  ok(Array.isArray(out.events) && out.events.length > 0, `${name}: 應該有 SSE 事件`);
  ok(out.panel && typeof out.panel.type === 'string', `${name}: 應該有 panel`);
  const hasPanelEv = out.events.some((e) => e.type === 'panel');
  ok(hasPanelEv, `${name}: 事件流入面應該有 panel 事件`);
  return out;
}

console.log('Duo 講講 · 離線 Mock 契約自檢');
console.log(`場景清單：${SCENARIOS.join(', ')}`);
ok(SCENARIOS.length === 6, `應該有 6 個場景，實際 ${SCENARIOS.length}`);
ok(SCENARIOS.includes('reward'), '場景清單應該包含 reward（City Stamp 獎勵頁）');
ok(typeof USER_PROFILE.streakDays === 'number', 'USER_PROFILE.streakDays 應該存在');

/* ---------------- 1. Lesson Complete → Mission ---------------- */
section('1 · Lesson Complete → Mission Revealed');
const s1 = await run('lesson-complete', { lessonId: 'L-01' });
assertShape(s1.panel, 'mission', [
  'task_id',
  'title',
  'hook',
  'scene',
  'objective',
  'location.name',
  'location.walk_minutes',
  'location.distance_m',
  'location.sign_text',
  'duration_minutes',
  'key_phrases',
  'success_criteria',
  'reward.xp',
  'reward.gems',
  'reward.stamp_hint',
  'duo_line',
]);
ok(Array.isArray(s1.panel.data.key_phrases) && s1.panel.data.key_phrases.length >= 3, 'key_phrases 至少 3 句');
const tools1 = s1.toolTrace.map((t) => t.name);
ok(tools1.includes('find_nearby_mission_spots'), '應該調用 find_nearby_mission_spots');
ok(tools1.includes('create_speakout_mission'), '應該調用 create_speakout_mission');
ok(s1.panel.data.reward.xp === 75, `任務獎勵 XP 應該係 75，實際 ${s1.panel.data.reward.xp}`);
ok(!('exp' in s1.panel.data.reward), '唔應該再出現舊欄位 reward.exp');

/* ---------------- 2. Rehearsal ---------------- */
section('2 · Rehearsal（Duo 扮店員）');
const s2 = await run('prerun', {});
assertShape(s2.panel, 'rehearsal', ['task_id', 'dialogue', 'coach_tips', 'pronunciation_focus', 'confidence_before', 'confidence_after']);
const turns = s2.panel.data.dialogue;
ok(turns.length >= 2, 'dialogue 至少 2 輪');
ok(
  turns.every((t) => t.role && t.yue),
  '每輪都要有 role 同 yue（粵語台詞）',
);
const learnerTurns = turns.filter((t) => t.role === 'learner');
ok(learnerTurns.length >= 2, '應該有學員台詞');
ok(learnerTurns.some((t) => t.jyutping), '學員台詞應該帶粵拼 jyutping');

/* ---------------- 3. Arrival / geofence ---------------- */
section('3 · Verify ① 地理圍欄');
const s3 = await run('arrive', { gpsScenario: 'arrived' });
assertShape(s3.panel, 'arrival', [
  'task_id',
  'merchant_name',
  'inside_geofence',
  'verdict',
  'distance_m',
  'geofence_radius_m',
  'gps_accuracy_m',
  'claimed',
  'merchant_coord',
  'message',
  'code.code',
  'sign_text',
]);
ok(s3.panel.data.inside_geofence === true, '正常到店應該通過圍欄');
ok(s3.panel.data.verdict === 'passed', 'verdict 應該係 passed');
ok(s3.panel.data.code.single_use === true, '動態碼應該係一次性');
ok(/^\d{4}$/.test(s3.panel.data.code.code), '動態碼應該係 4 位數字');

section('3b · Verify 失敗路徑（仲喺路上 / 定位飄移 / 模擬定位）');
for (const [key, label] of [
  ['enroute', '仲喺路上'],
  ['drift', '定位飄移'],
  ['spoofed', '模擬定位'],
]) {
  const s = await run('arrive', { gpsScenario: key });
  if (key === 'enroute') ok(s.panel.data.inside_geofence === false, `${label}: 應該未通過圍欄`);
  if (key === 'drift') ok(s.panel.data.risk_flags.length > 0, `${label}: 應該有風險標記`);
  if (key === 'spoofed') {
    ok(s.panel.data.risk_flags.some((f) => f.includes('模擬定位')), `${label}: 應該標記疑似模擬定位`);
    // 關鍵：座標就算落入圍欄，只要有「疑似模擬定位」標記就唔可以自動通過
    ok(s.panel.data.verdict === 'manual_review', `${label}: 有作弊標記時 verdict 應該轉 manual_review，實際 ${s.panel.data.verdict}`);
  }
  ok(s.panel.data.coach_tips.length > 0 || s.panel.data.inside_geofence === false, `${label}: 應該有補救建議`);
}

/* 離開圍欄：先前簽發嘅動態碼必須作廢 */
const s3b = await run('arrive', { gpsScenario: 'arrived' });
const goodCode = s3b.panel.data.code.code;
const s3c = await run('arrive', { gpsScenario: 'enroute' });
ok(s3c.panel.data.inside_geofence === false, '離開圍欄後應該判定未通過');
ok(s3c.panel.data.code === null, '離開圍欄後唔應該再帶住動態碼');
ok(s3c.panel.data.code_invalidated === true, '離開圍欄後應該明確標示先前嘅碼已作廢');
const s3d = await run('verify-code', { code: goodCode });
ok(s3d.panel.data.redeemed === false, '作廢之後個碼唔應該核銷到');
const s3b2 = await run('arrive', { gpsScenario: 'arrived' });
const freshCode = s3b2.panel.data.code.code;
ok(/^\d{4}$/.test(freshCode), '重新進入圍欄應該簽發新碼');

/* ---------------- 4. Dynamic code ---------------- */
section('4 · Verify ② 店員核銷動態碼');
const wrong = String((Number(goodCode[0]) + 1) % 10) + goodCode.slice(1);
const s4bad = await run('verify-code', { code: wrong });
ok(s4bad.panel.data.redeemed === false, '錯碼應該核銷失敗');
ok(s4bad.panel.data.reason === 'code_mismatch', `失敗原因應該係 code_mismatch，實際 ${s4bad.panel.data.reason}`);
ok(s4bad.panel.data.verification_summary.dynamic_code === 'failed', '失敗時 dynamic_code 應該係 failed');

const s4 = await run('verify-code', { code: goodCode });
assertShape(s4.panel, 'verified', ['redeemed', 'message', 'next_step', 'verification_summary.geofence', 'verification_summary.dynamic_code']);
ok(s4.panel.data.redeemed === true, '正確碼應該核銷成功');
ok(s4.panel.data.verification_summary.geofence === 'passed', '地理圍欄應該係 passed');
ok(s4.panel.data.verification_summary.dynamic_code === 'passed', '動態碼應該係 passed');

/* 一次性：同一個碼唔可以核銷兩次 */
const s4again = await run('verify-code', { code: goodCode });
ok(s4again.panel.data.redeemed === false, '同一個碼唔可以核銷兩次（一次性）');
ok(s4again.panel.data.reason === 'already_used', `重複核銷原因應該係 already_used，實際 ${s4again.panel.data.reason}`);

/* ---------------- 5. Reward / City Stamp ---------------- */
section('5 · Reward — City Stamp + XP / Gems / Streak');
const s5 = await run('reward', {});
assertShape(s5.panel, 'reward', [
  'verified',
  'headline',
  'body',
  'duo_line',
  'stamp.name',
  'stamp.icon',
  'stamp.unlocked',
  'rewards.xp',
  'rewards.gems',
  'rewards.streak_after',
  'rewards.xp_today_after',
  'rewards.daily_goal_met',
  'rewards.verifies',
  'rewards.does_not_verify',
  'progress.streak_days',
  'progress.gems',
  'verification_scope.mitigation',
  'map_entry.label',
]);
ok(s5.panel.data.verified === true, '核銷成功之後獎勵頁應該係 verified');
ok(s5.panel.data.stamp.unlocked === true, 'City Stamp 應該解鎖');
ok(s5.panel.data.rewards.xp === 75, `驗證通過應該係 75 XP，實際 ${s5.panel.data.rewards.xp}`);
ok(s5.panel.data.rewards.streak_after === USER_PROFILE.streakDays + 1, 'streak 應該 +1');
ok(s5.panel.data.rewards.gems === 20, '應該 +20 Gems');
ok(s5.panel.data.rewards.verifies === 'participation', '獎勵標籤應該誠實標明只驗證 participation');
ok(s5.toolTrace.some((t) => t.name === 'issue_city_stamp'), '應該調用 issue_city_stamp');
ok(s5.events.some((e) => e.type === 'token'), '離線路徑應該有模擬 streaming token');

/* ---------------- 6. Share + next lesson + leaderboard ---------------- */
section('6 · Share + Next Lesson + Leaderboard');
const s6 = await run('share-and-next', { style: 'playful', privacy: 'friends' });
assertShape(s6.panel, 'share', [
  'share_card.headline',
  'share_card.body',
  'share_card.stats',
  'share_card.hashtags',
  'share_card.advocacy_line',
  'next_lesson.lesson_id',
  'next_lesson.title',
  'next_lesson.why_now',
  'next_lesson.carry_over_phrases',
  'loop_summary',
  'streak_after',
  'leaderboard.league',
  'leaderboard.rows',
  'friend_mission.invite_code',
]);
ok(s6.panel.data.share_card.stats.length === 3, '分享卡應該有 3 條統計');
ok(s6.panel.data.next_lesson.lesson_id === 'L-02', `下一課應該係 L-02，實際 ${s6.panel.data.next_lesson.lesson_id}`);
ok(
  (s6.panel.data.next_lesson.carry_over_phrases || []).some((p) => String(p).includes('八達通')),
  '下一課應該帶走「八達通得唔得？」',
);
const rows = s6.panel.data.leaderboard.rows;
ok(rows.some((r) => r.you === true), '排行榜應該有「你」呢一行');
ok(rows[0].rank === 1 && rows[0].xp >= rows[1].xp, '排行榜應該按 XP 由高到低排');
const tools6 = s6.toolTrace.map((t) => t.name);
for (const t of ['generate_share_card', 'recommend_next_lesson', 'get_leaderboard']) {
  ok(tools6.includes(t), `應該調用 ${t}`);
}

/* ---------------- 品牌一致性 ---------------- */
section('品牌一致性檢查');
const allCopy = JSON.stringify([s1.panel, s2.panel, s5.panel, s6.panel]);
ok(!/SpeakOut Pass/.test(allCopy) || /SpeakOut Mission|SpeakOut Friendly Spot/.test(allCopy), '品牌應該係 Duo 講講 / SpeakOut Mission，唔係舊嘅 SpeakOut Pass');
ok(!/English/.test(JSON.stringify([s1.panel, s6.panel])), '唔應該再出現「學英文」相關文案');
ok(/粵語|廣東話|凍檸茶|八達通|唔該/.test(allCopy), '文案應該係粵語內容');

/* ---------------- 結果 ---------------- */
console.log(`\n${'─'.repeat(56)}`);
if (failures === 0) {
  console.log(`✅ 全部通過：${checks} 項檢查，0 個問題。`);
  console.log('   離線 Mock 路徑可以完整演示 6 個場景（含失敗路徑）。');
  process.exit(0);
} else {
  console.log(`❌ ${failures} / ${checks} 項檢查失敗。`);
  process.exit(1);
}
