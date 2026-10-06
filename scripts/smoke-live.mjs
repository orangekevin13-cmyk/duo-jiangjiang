// smoke-live.mjs — 直连 DeepSeek 的自检：跑完 6 个场景 + 失败路径。
//   node scripts/smoke-live.mjs          （加 DSH_DEMO_DEBUG=1 可看每次原始回复）
import { createClient } from '../server/llm.mjs';
import { runScenario } from '../server/agent.mjs';

const client = createClient({});
console.log('has_key:', client.hasKey);

const session = {};
const scenes = [
  ['lesson-complete', { lessonId: 'L-01' }],
  ['prerun', {}],
  ['arrive', { gpsScenario: 'arrived' }],
  ['verify-code', { code: '0000' }], // 故意输错，验证失败路径
  ['verify-code', { code: 'AUTO' }], // 正确码
  ['reward', {}],
  ['share-and-next', { style: 'playful', privacy: 'friends' }],
  ['arrive', { gpsScenario: 'enroute' }], // 未到店路径
];

for (const [name, input] of scenes) {
  const t0 = Date.now();
  if (input.code === 'AUTO') {
    if (!session.issuedCode) {
      console.log('verify-code(correct) -> SKIPPED (no issued code)');
      continue;
    }
    input.code = session.issuedCode.code;
  }
  try {
    const res = await runScenario(name, input, { mode: 'live', client, session, emit: () => {} });
    if (res.warning) console.log(`     WARNING(live->mock): ${res.warning}`);
    const data = res.panel?.data || {};
    const summary =
      name === 'lesson-complete'
        ? data.title
        : name === 'prerun'
          ? `${data.dialogue?.length} turns`
          : name === 'arrive'
            ? `inside=${data.inside_geofence} dist=${data.distance_m} code=${data.code?.code}`
            : name === 'verify-code'
              ? `submitted=${data.submitted} redeemed=${data.redeemed} reason=${data.reason}`
              : name === 'reward'
                ? `verified=${data.verified} stamp=${data.stamp?.name} +${data.rewards?.xp}XP streak=${data.rewards?.streak_after}`
                : `headline=${data.share_card?.headline} next=${data.next_lesson?.lesson_id} league=${data.leaderboard?.league}`;
    console.log(`OK   ${name} [${res.mode}] ${Date.now() - t0}ms tok=${res.usage?.total_tokens} :: ${summary}`);
    console.log(`     tools: ${res.toolTrace.map((t) => t.name).join(' -> ')}`);
  } catch (err) {
    console.log(`FAIL ${name} [${Date.now() - t0}ms] :: ${err.message}`);
  }
}
