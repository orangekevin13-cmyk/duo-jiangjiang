// tools.mjs — the "real world API" exposed to the model as function-call tools.
// Schema is OpenAI-compatible; every handler is deterministic and offline-capable.
//
// Brand note: these tools are Duolingo systems extended into the city. Nothing here invents a new
// currency or a new progress bar — XP, gems, streak, stamps and the leaderboard are the ones the
// learner already has in the Duolingo app. What is new is that a *verified real-world attempt*
// is now what pays them out.

import {
  CITY_MAP,
  DEFAULT_CODE_SALT,
  DUO_LINES,
  LEADERBOARD,
  MERCHANTS,
  STAMPS,
  USER_PROFILE,
  computeRewards,
  distanceMeters,
  getLesson,
  getMerchant,
  getNextLesson,
  makeDynamicCode,
  missionById,
  nearbyMerchants,
  walkMinutes,
} from './store.mjs';

export const GEOFENCE_RADIUS_M = 120;

/** Move a coordinate `meters` away on a given bearing (demo helper for the GPS simulator). */
export function offsetCoord(origin, meters, bearingDeg = 45) {
  const R = 6371000;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(meters / R) + Math.cos(lat1) * Math.sin(meters / R) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(meters / R) * Math.cos(lat1),
      Math.cos(meters / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: Number(((lat2 * 180) / Math.PI).toFixed(5)),
    lng: Number(((lng2 * 180) / Math.PI).toFixed(5)),
  };
}

/** Shared shape so the phone header, mission card and reward page always agree. */
export function progressSnapshot(extra = {}) {
  return {
    streak_days: USER_PROFILE.streakDays,
    streak_freeze_available: USER_PROFILE.streakFreezeAvailable,
    gems: USER_PROFILE.gems,
    hearts: USER_PROFILE.hearts,
    xp_total: USER_PROFILE.xpTotal,
    xp_today: USER_PROFILE.xpToday,
    daily_goal_xp: USER_PROFILE.dailyGoalXp,
    league: USER_PROFILE.league,
    league_rank: USER_PROFILE.leagueRank,
    weekly_xp: USER_PROFILE.weeklyXp,
    level: USER_PROFILE.level,
    ...extra,
  };
}

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'find_nearby_mission_spots',
      description:
        '查詢學員附近嘅 SpeakOut Friendly Spot（願意聽初學者講粵語嘅合作店），返回距離、步行時間、店員語言能力同該店可執行嘅任務主題。',
      parameters: {
        type: 'object',
        properties: {
          origin_lat: { type: 'number', description: '學員目前緯度' },
          origin_lng: { type: 'number', description: '學員目前經度' },
          category: {
            type: 'string',
            enum: ['cafe', 'restaurant', 'convenience', 'bookstore', 'campus'],
            description: '可選：只搵某一類店',
          },
          limit: { type: 'integer', description: '返回店數，默認 3' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_speakout_mission',
      description:
        '把一節啱啱學完嘅 Duolingo 粵語課轉成一張線下真實任務卡（SpeakOut Mission），寫清場景、目標、要講嘅粵語句同通過標準。',
      parameters: {
        type: 'object',
        properties: {
          lesson_id: { type: 'string', description: '啱啱完成嘅課程 ID，例如 L-01' },
          lesson_title: { type: 'string', description: '課程標題' },
          merchant_id: { type: 'string', description: '任務發生嘅 Friendly Spot ID' },
          difficulty: { type: 'string', enum: ['easy', 'normal', 'stretch'] },
        },
        required: ['lesson_id', 'merchant_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_rehearsal_script',
      description:
        '出發前生成一段粵語預演對話骨架（學員 vs 店員），包含學員台詞、對方可能嘅反問同粵拼提示。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          turns: { type: 'integer', description: '對話輪數，默認 4' },
          focus: { type: 'string', description: '本次預演要重點練嘅表達' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_location',
      description:
        '校驗學員上報座標係咪已到達 Friendly Spot（地理圍欄），並返回反作弊風險標記。呢個係任務完成嘅第一個必要條件。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          merchant_id: { type: 'string' },
          user_lat: { type: 'number' },
          user_lng: { type: 'number' },
          gps_accuracy_m: { type: 'number', description: '裝置上報嘅定位精度（米）' },
        },
        required: ['task_id', 'merchant_id', 'user_lat', 'user_lng'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'issue_dynamic_code',
      description:
        '學員進入圍欄後簽發一次性動態碼（4 位，短時效）。店員喺商家端輸入呢個碼先算任務完成。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          merchant_id: { type: 'string' },
          ttl_seconds: { type: 'integer', description: '有效期秒數，默認 180' },
        },
        required: ['task_id', 'merchant_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'redeem_dynamic_code',
      description: '商家端核銷學員出示嘅動態碼。校驗碼值、時效同呢個碼係咪為當前任務簽發。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          code: { type: 'string', description: '店員輸入嘅 4 位碼' },
        },
        required: ['task_id', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'issue_city_stamp',
      description:
        '雙重驗證通過後，發放 City Stamp 成就徽章、XP、寶石同 streak 更新（Duolingo 現有獎勵系統）。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          verified: { type: 'boolean', description: '地理圍欄 + 動態碼係咪都通過' },
        },
        required: ['task_id', 'verified'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_share_card',
      description:
        '任務完成後生成社交分享卡文案（標題、副標題、正文、hashtag）同分享圖數據。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          style: { type: 'string', enum: ['playful', 'minimal', 'story'] },
          privacy: { type: 'string', enum: ['public', 'friends', 'private'] },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend_next_lesson',
      description:
        '基於學員嘅課程完成情況、薄弱點同啱啱線下任務嘅表現，推薦下一節課並俾出理由同複習清單。',
      parameters: {
        type: 'object',
        properties: {
          completed_lesson_id: { type: 'string' },
          mission_result: {
            type: 'object',
            description: '啱啱線下任務嘅結果，例如 { verified: true, code_redeemed: true }',
            properties: {
              verified: { type: 'boolean' },
              code_redeemed: { type: 'boolean' },
            },
          },
        },
        required: ['completed_lesson_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_leaderboard',
      description: '讀取本週 Duolingo 聯盟排行榜（League）同好友任務狀態，用於分享頁嘅社交比較。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.function.name);

/**
 * Execute a tool by name.
 * @param {string} name
 * @param {object} input
 * @param {{session: object, useRealGps?: boolean}} ctx
 */
export async function runTool(name, input, ctx = {}) {
  const session = ctx.session || {};
  const args = input || {};
  switch (name) {
    case 'find_nearby_mission_spots': {
      const origin =
        typeof args.origin_lat === 'number' && typeof args.origin_lng === 'number'
          ? { lat: args.origin_lat, lng: args.origin_lng }
          : USER_PROFILE.home;
      let list = nearbyMerchants(origin, Math.min(args.limit || 3, MERCHANTS.length));
      if (args.category) {
        const filtered = list.filter((x) => x.merchant.category === args.category);
        if (filtered.length) list = filtered;
      }
      return {
        origin,
        origin_label: USER_PROFILE.home.label,
        friendly_spots_only: true,
        spots: list.map(({ merchant, distanceMeters: d }) => ({
          merchant_id: merchant.id,
          name: merchant.name,
          category: merchant.category,
          district: merchant.district,
          address: merchant.address,
          distance_m: d,
          walk_minutes: walkMinutes(d),
          staff_language: merchant.staffLang,
          staff_note: merchant.staffNote,
          features: merchant.features,
          mission_topic: merchant.mission.title,
          sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
        })),
      };
    }

    case 'create_speakout_mission': {
      const merchant = getMerchant(args.merchant_id);
      const lesson = getLesson(args.lesson_id);
      const m = merchant.mission;
      const fromHome = distanceMeters(USER_PROFILE.home, merchant);
      const rewards = computeRewards({ verified: true });
      const card = {
        task_id: merchant.id,
        lesson_id: lesson.id,
        lesson_title: lesson.title,
        title: m.title,
        scene: m.scenario,
        location: {
          merchant_id: merchant.id,
          name: merchant.name,
          district: merchant.district,
          address: merchant.address,
          walk_minutes: walkMinutes(fromHome),
          distance_m: fromHome,
          staff_language: merchant.staffLang,
          friendly_spot: true,
          sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
        },
        duration_minutes: 5,
        difficulty: args.difficulty || 'normal',
        objective: m.objective,
        key_phrases: m.keyPhrases,
        success_criteria: m.successCriteria,
        verification: ['geofence_120m', 'staff_dynamic_code'],
        reward: {
          xp: rewards.xp,
          gems: rewards.gems,
          stamp_id: `ST-${merchant.category.toUpperCase()}`,
          stamp_hint: `${merchant.district.split(' · ')[0]} Stamp`,
          streak_delta: 1,
        },
        duo_line: DUO_LINES.missionReady,
      };
      session.activeMission = card;
      return card;
    }

    case 'build_rehearsal_script': {
      const merchant = missionById(args.task_id) || getMerchant(args.task_id);
      const m = merchant.mission;
      const turns = Math.max(2, Math.min(args.turns || 4, 6));
      const focus = args.focus || '把關鍵句講得自然，同埋聽得明對方嘅反問';
      return {
        task_id: merchant.id,
        spot_name: merchant.name,
        focus,
        // The model supplies the actual lines; this is the deterministic skeleton.
        skeleton: Array.from({ length: turns }, (_, i) => ({
          turn: i + 1,
          expected_role: i % 2 === 0 ? 'learner' : 'staff',
        })),
        must_use: m.keyPhrases,
        likely_pushback: [
          '凍定熱呀？',
          '要唔要少甜？',
          '仲要啲咩呀？',
          '八達通定現金？',
        ],
        staff_note: merchant.staffNote,
        duo_line: DUO_LINES.rehearsal,
      };
    }

    case 'verify_location': {
      const merchant = getMerchant(args.merchant_id || session.activeMission?.location?.merchant_id);
      const claimed = { lat: args.user_lat, lng: args.user_lng };
      const distance = distanceMeters(claimed, { lat: merchant.lat, lng: merchant.lng });
      const inside = distance <= GEOFENCE_RADIUS_M;
      const flags = [];
      if (typeof args.gps_accuracy_m === 'number' && args.gps_accuracy_m > 200) {
        flags.push('GPS 精度較差（>200m），建議重測');
      }
      // distance === 0 means the reported point is *exactly* the merchant's own coordinate,
      // which no real GPS fix ever produces — that is the strongest spoofing signal we have.
      if (distance < 5) flags.push('座標與門店幾乎完全重合，疑似模擬定位');
      if (distance > 2000) flags.push('上報位置與任務門店相距過遠');
      // A flag that directly contradicts being at the spot (spoofed fix, unusable accuracy)
      // must never sit next to a green "passed" verdict — escalate instead of auto-passing.
      const contradictory = flags.some((f) => f.includes('模擬定位') || f.includes('精度較差'));
      const result = {
        task_id: merchant.id,
        merchant_id: merchant.id,
        merchant_name: merchant.name,
        distance_m: distance,
        geofence_radius_m: GEOFENCE_RADIUS_M,
        inside_geofence: inside,
        distance_to_go_m: inside ? 0 : distance - GEOFENCE_RADIUS_M,
        verdict: !inside ? 'failed' : contradictory || flags.length >= 2 ? 'manual_review' : 'passed',
        risk_flags: flags,
        sign_text: '歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。',
        checked_at: new Date().toISOString(),
      };
      session.locationCheck = result;
      // Leaving the geofence invalidates any outstanding code: otherwise a learner standing
      // outside the shop could keep showing a code issued earlier, and the staff code would
      // no longer mean "this person is here now".
      if (!inside && session.issuedCode) {
        session.issuedCode = null;
        result.code_invalidated = true;
        result.risk_flags = [...flags, '已離開圍欄，先前的動態碼已作廢'];
      }
      return result;
    }

    case 'issue_dynamic_code': {
      const merchant = getMerchant(args.merchant_id || session.activeMission?.location?.merchant_id);
      const ttl = Math.max(60, Math.min(args.ttl_seconds || 180, 900));
      // Salt comes from the demo session, so two concurrent visitors never see the same code.
      const issued = makeDynamicCode(merchant.id, ttl, session.codeSalt ?? DEFAULT_CODE_SALT);
      session.issuedCode = { ...issued, taskId: merchant.id, redeemed: false, attempts: 0 };
      return {
        task_id: merchant.id,
        merchant_id: merchant.id,
        merchant_name: merchant.name,
        code: issued.code,
        ttl_seconds: issued.ttlSeconds,
        expires_in_seconds: ttl,
        display_hint: '請向店員出示呢 4 位數字，店員喺商家端輸入後任務即完成',
        staff_action: '店員只需要輸入個碼，唔需要評分、唔需要教粵語、唔需要填表。',
        single_use: true,
      };
    }

    case 'redeem_dynamic_code': {
      const live = session.issuedCode;
      if (!live || live.taskId !== args.task_id) {
        return { task_id: args.task_id, redeemed: false, reason: 'no_active_code', message: '當前冇為呢個任務簽發嘅動態碼' };
      }
      live.attempts += 1;
      const expired = Date.now() > live.expiresAt;
      if (expired) {
        return { task_id: args.task_id, redeemed: false, reason: 'expired', message: '動態碼已過期，請重新簽發' };
      }
      if (live.redeemed) {
        return { task_id: args.task_id, redeemed: false, reason: 'already_used', message: '呢個動態碼已經核銷過（一次性）' };
      }
      if (String(args.code).trim() !== live.code) {
        return { task_id: args.task_id, redeemed: false, reason: 'code_mismatch', attempts: live.attempts, message: '動態碼唔啱' };
      }
      live.redeemed = true;
      session.codeRedeemedAt = Date.now();
      return {
        task_id: args.task_id,
        redeemed: true,
        verified_by: 'staff_dynamic_code',
        message: '核銷成功，任務判定完成',
        redeemed_at: new Date().toISOString(),
      };
    }

    case 'issue_city_stamp': {
      const mission = session.activeMission || {};
      const merchant = getMerchant(args.merchant_id || mission.location?.merchant_id);
      const verified = Boolean(args.verified);
      const rewards = computeRewards({ verified });
      const stamp = {
        id: `ST-${merchant.category.toUpperCase()}`,
        name: `${merchant.district.split(' · ')[0]} Mission Stamp`,
        name_zh: `${merchant.mission.title}印章`,
        icon: merchant.category === 'cafe' ? '☕' : merchant.category === 'convenience' ? '💳' : merchant.category === 'campus' ? '🎓' : '📍',
        unlocked: verified,
        unlocked_at: verified ? new Date().toISOString() : null,
      };
      const mapEntry = CITY_MAP.find((c) => c.id === merchant.id);
      session.reward = {
        verified,
        stamp,
        rewards,
        progress: progressSnapshot({
          xp_total: USER_PROFILE.xpTotal + rewards.xp,
          xp_today: rewards.xp_today_after,
          gems: USER_PROFILE.gems + rewards.gems,
          streak_days: rewards.streak_after,
          weekly_xp: USER_PROFILE.weeklyXp + rewards.xp,
        }),
        map_entry: mapEntry
          ? { ...mapEntry, unlocked: verified }
          : { id: merchant.id, label: merchant.district, activity: merchant.mission.title, unlocked: verified },
        duo_line: verified ? DUO_LINES.verified : DUO_LINES.failed,
        /** Honest boundary, stated in the product itself — not a hidden limitation. */
        verification_scope: {
          verifies: 'participation（到店 + 店員核銷）',
          does_not_verify: 'proficiency（係咪真係講咗粵語、講得準唔準）',
          mitigation: ['App 內語音預演', '店員友好配合', '自我報告機制', 'Friend Mode 互相見證'],
        },
      };
      return session.reward;
    }

    case 'generate_share_card': {
      const mission = session.activeMission || {};
      const reward = session.reward || {};
      const merchant = getMerchant(mission.location?.merchant_id);
      const unlocked = CITY_MAP.filter((c) => c.unlocked).length + (reward.verified ? 1 : 0);
      return {
        task_id: args.task_id,
        style: args.style || 'playful',
        privacy: args.privacy || 'friends',
        image: { theme: 'duo_stamp_card', accent: '#58cc02', size: '1080x1440' },
        template: {
          headline_hint: reward.verified ? '我用粵語生活咗一日' : '今日試過開口講粵語',
          stats_hint: [
            `${unlocked} places unlocked`,
            `${USER_PROFILE.streakDays + (reward.verified ? 1 : 0)}-day streak 🔥`,
            `${USER_PROFILE.league} League · Rank ${USER_PROFILE.leagueRank}`,
          ],
          // Duolingo tone: not "my Cantonese is great", but "I'm living in Cantonese".
          tone_note: '唔係炫耀「我粵語好好」，而係「我用粵語生活」。',
          spot_name: merchant.name,
        },
        progress: progressSnapshot(),
      };
    }

    case 'recommend_next_lesson': {
      const { lesson, reason_hint } = getNextLesson(args.completed_lesson_id);
      return {
        completed_lesson_id: args.completed_lesson_id,
        mission_result: args.mission_result || null,
        next_lesson: {
          lesson_id: lesson.id,
          title: lesson.title,
          title_zh: lesson.titleZh,
          unit: lesson.unit,
          key_phrases: lesson.keyPhrases,
          minutes: lesson.minutes,
          reason_hint,
        },
        candidate_lessons: [
          { lesson_id: lesson.id, title: lesson.title, reason_hint },
          { lesson_id: 'L-04', title: 'Campus Talk · 校園對話', reason_hint: 'Campus Bridge：由交易型對話升級到正式少少嘅對話' },
        ],
        srs_hint: getLesson(args.completed_lesson_id)?.weakPoints || [],
        streak_note: '完成下一課可以保住 streak，亦係 Learn → Use → Learn 嘅下一步。',
      };
    }

    case 'get_leaderboard': {
      const reward = session.reward || {};
      const youXp = 780 + (reward.verified ? reward.rewards?.xp || 0 : 0);
      const rows = LEADERBOARD.map((r) => (r.you ? { ...r, xp: youXp } : r))
        .sort((a, b) => b.xp - a.xp)
        .map((r, i) => ({ ...r, rank: i + 1 }));
      return {
        league: USER_PROFILE.league,
        week_ends_in_days: 2,
        promotion_zone: 3,
        rows,
        you: rows.find((r) => r.you),
        friend_mission: {
          available: true,
          invite_code: 'DUO-HK-7742',
          bonus: '雙方 +2× XP，and Duo will be extra proud.',
          stamp_hint: 'Friend Mission Master',
        },
        stamps: STAMPS,
      };
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
