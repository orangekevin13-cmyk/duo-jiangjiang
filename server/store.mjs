// store.mjs — Duo 講講 demo domain data + deterministic helpers (no network, no LLM).
//
// Brand anchor: this is NOT a third-party app. Everything here is the natural extension of the
// Duolingo Cantonese course into Hong Kong: the same streak / XP / gems / leaderboard /
// achievements the learner already knows, plus a City Stamp for each real-world speaking attempt.
//
// All spots, staff and lesson data are fictional demo data. Coordinates are real Hong Kong
// coordinates so walking distances and times are believable on stage.

const WALK_METERS_PER_MIN = 78;

/** The learner whose phone we mirror on stage. */
export const USER_PROFILE = {
  name: '林小滿',
  handle: '@xiaoman_hk',
  // Duolingo Cantonese course progress — the course the learner is already in.
  course: 'Duolingo 粵語 · Cantonese',
  unitLabel: 'Unit 3 · 飲嘢同埋畀錢',
  cefr: 'A1–A2',
  level: 12,
  xpTotal: 4820,
  xpToday: 60,
  dailyGoalXp: 50,
  streakDays: 6,
  streakFreezeAvailable: 1,
  gems: 120,
  hearts: 4,
  // Duolingo leagues: Bronze → Silver → Gold → Sapphire → Ruby → Emerald → Amethyst → Pearl → Obsidian → Diamond
  league: 'Emerald',
  leagueRank: 3,
  weeklyXp: 780,
  campus: 'HKU · 薄扶林',
  home: { lat: 22.2838, lng: 114.1372, label: 'HKU 大學堂宿舍（薄扶林道）' },
  joinedDaysAgo: 62,
};

/**
 * SpeakOut Friendly Spots —— 願意聽初學者慢慢講嘅合作店。
 * staffNote 是店家對學員的承諾，會直接顯示在任務卡與到店頁上（Permission 機制）。
 */
export const MERCHANTS = [
  {
    id: 'SP-001',
    name: 'Café 半山（般咸道）',
    nameEn: 'Mid-Levels Café',
    category: 'cafe',
    district: 'HKU · 般咸道',
    address: '香港大學站 B2 出口 · 般咸道 12 號',
    lat: 22.28458,
    lng: 114.13592,
    staffLang: 'cantonese',
    staffNote: '店員聽得明初學者嘅粵語，唔會轉台講普通話。講錯都照聽。',
    features: ['Friendly Spot', '有貼紙標示', '校園 5 分鐘可達'],
    mission: {
      title: '用粵語點一杯凍檸茶',
      scenario: '你喺 Café 半山，想點一杯凍檸茶，順便問吓有冇少甜嘅選擇。',
      objective: '用粵語完成一次點單，並確認杯裝同價錢。',
      keyPhrases: ['唔該，我要一杯凍檸茶。', '可唔可以少甜？', '唔該晒。'],
      successCriteria: [
        '講出至少一句完整粵語點單句（唔該 / 我要一杯…）',
        '聽得明店員嘅價錢或者取餐指示，並回應一次',
      ],
    },
  },
  {
    id: 'SP-002',
    name: '姐記茶餐廳（中環）',
    nameEn: 'Jeh Gei Cha Chaan Teng',
    category: 'restaurant',
    district: 'Central · 威靈頓街',
    address: '中環威靈頓街 48 號地下',
    lat: 22.28297,
    lng: 114.15461,
    staffLang: 'cantonese',
    staffNote: '伙記講得快，但你講一句佢會等你講完。可以慢慢講。',
    features: ['Friendly Spot', '茶餐廳場景', '下午茶時段較靜'],
    mission: {
      title: '用粵語喺茶餐廳落單',
      scenario: '下午茶時段，你想點一個菠蘿油加一杯凍奶茶。',
      objective: '落單 + 問一句價錢，全程用粵語，唔用普通話。',
      keyPhrases: ['唔該，一個菠蘿油。', '凍奶茶少甜，唔該。', '幾多錢呀？'],
      successCriteria: ['完成 2 句以上粵語落單表達', '問出價錢並複述確認一次'],
    },
  },
  {
    id: 'SP-003',
    name: '7-Eleven（銅鑼灣駱克道）',
    nameEn: '7-Eleven Lockhart Road',
    category: 'convenience',
    district: 'Causeway Bay · 駱克道',
    address: '銅鑼灣駱克道 517 號地下',
    lat: 22.27995,
    lng: 114.18373,
    staffLang: 'cantonese',
    staffNote: '櫃枱細、排隊短，一句起兩句止就完成，最適合第一次開口。',
    features: ['24 小時', '排隊短', '八達通可用'],
    mission: {
      title: '用粵語講「八達通得唔得？」',
      scenario: '你買咗一支水，想問可唔可以用八達通，同埋要唔要袋。',
      objective: '用粵語問付款方式並完成交易，唔使講英文。',
      keyPhrases: ['八達通得唔得？', '唔使袋，唔該。', '唔該晒。'],
      successCriteria: ['講出付款方式嘅問句', '完成一次完整交易並道謝'],
    },
  },
  {
    id: 'SP-004',
    name: '商務印書館（銅鑼灣）',
    nameEn: 'The Commercial Press',
    category: 'bookstore',
    district: 'Causeway Bay · 怡和街',
    address: '銅鑼灣怡和街 9 號',
    lat: 22.28034,
    lng: 114.18466,
    staffLang: 'cantonese',
    staffNote: '店員願意慢慢答問題，適合練「我想問…」開頭嘅句子。',
    features: ['Friendly Spot', '安靜', '可以問路'],
    mission: {
      title: '用粵語問一本書喺邊',
      scenario: '你想搵一本粵語學習書，但搵唔到，要問店員。',
      objective: '用「我想問…」開頭問一次位置，並聽明指示。',
      keyPhrases: ['我想問，粵語書喺邊？', '係咪呢邊？', '唔該晒你。'],
      successCriteria: ['用粵語問出位置問題', '聽明指示並複述一次方向'],
    },
  },
  {
    id: 'SP-005',
    name: 'HKU Main Building 詢問處',
    nameEn: 'HKU Main Building Enquiry',
    category: 'campus',
    district: 'HKU · 本部大樓',
    address: '香港大學本部大樓地下詢問處',
    lat: 22.28316,
    lng: 114.13756,
    staffLang: 'cantonese',
    staffNote: 'Student ambassador 受過訓練，會用慢速粵語同你講，唔會笑你。',
    features: ['Campus Bridge', '雙語支援', '適合正式少少嘅對話'],
    mission: {
      title: '用粵語問一個校園活動',
      scenario: '你想知今個星期有冇粵語交流活動，要去詢問處問。',
      objective: '由「買嘢」升級到「啟動一段對話」：用粵語問資訊並追問一次。',
      keyPhrases: ['我想問吓，今個星期有冇活動？', '要唔要報名㗎？', '喺邊度舉行呀？'],
      successCriteria: ['主動開口問一條資訊問題', '就答覆追問一次（時間 / 地點 / 報名）'],
    },
  },
];

/**
 * Duolingo Cantonese course lessons. `L-01` is the lesson the learner just finished on stage,
 * `L-02` is the lesson the agent recommends next (Learning → Use → Learning loop).
 */
export const LESSONS = [
  {
    id: 'L-01',
    title: 'Ordering Drinks · 點嘢飲',
    titleZh: '點嘢飲',
    unit: 'Unit 3 · 飲嘢同埋畀錢',
    cefr: 'A1',
    completedAt: '今日 14:20',
    accuracy: 0.9,
    xpEarned: 12,
    vocabLearned: ['凍檸茶', '唔該', '少甜', '一杯'],
    weakPoints: ['「唔該」同「多謝」用法唔同', '「少甜」個聲調（siu2 tim4）'],
    keyPhrases: [
      { yue: '唔該，我要一杯凍檸茶。', jyutping: 'm4 goi1, ngo5 jiu3 jat1 bui1 dung3 ling4 caa4.', en: 'One iced lemon tea, please.' },
      { yue: '可唔可以少甜？', jyutping: 'ho2 m4 ho2 ji5 siu2 tim4?', en: 'Could it be less sweet?' },
      { yue: '唔該晒。', jyutping: 'm4 goi1 saai3.', en: 'Thank you so much.' },
    ],
    minutes: 9,
  },
  {
    id: 'L-02',
    title: 'Paying in 711 · 畀錢',
    titleZh: '畀錢',
    unit: 'Unit 3 · 飲嘢同埋畀錢',
    cefr: 'A1',
    completedAt: '未完成',
    accuracy: null,
    xpEarned: null,
    vocabLearned: ['八達通', '得唔得', '唔使袋'],
    weakPoints: ['「得唔得」語尾語調', '問句唔要講到好似命令'],
    keyPhrases: [
      { yue: '八達通得唔得？', jyutping: 'baat3 daat6 tung1 dak1 m4 dak1?', en: 'Can I use Octopus?' },
      { yue: '唔使袋，唔該。', jyutping: 'm4 sai2 doi2, m4 goi1.', en: 'No bag, thanks.' },
    ],
    minutes: 8,
  },
  {
    id: 'L-03',
    title: 'Asking Where Things Are · 問路',
    titleZh: '問路',
    unit: 'Unit 4 · 出街',
    cefr: 'A2',
    completedAt: '未完成',
    accuracy: null,
    xpEarned: null,
    vocabLearned: ['喺邊', '呢邊', '轉左', '對面'],
    weakPoints: ['「喺邊」同「去邊」混淆', '左右方向反應慢'],
    keyPhrases: [
      { yue: '我想問，洗手間喺邊？', jyutping: 'ngo5 soeng2 man6, sai2 sau2 gaan1 hai2 bin1?', en: 'Where is the toilet?' },
      { yue: '係咪呢邊？', jyutping: 'hai6 mai6 ni1 bin1?', en: 'Is it this way?' },
    ],
    minutes: 10,
  },
  {
    id: 'L-04',
    title: 'Campus Talk · 校園對話',
    titleZh: '校園對話',
    unit: 'Unit 5 · Campus Bridge',
    cefr: 'A2+',
    completedAt: '未完成',
    accuracy: null,
    xpEarned: null,
    vocabLearned: ['報名', '活動', '舉行'],
    weakPoints: ['正式少少嘅開場句', '追問嘅語氣'],
    keyPhrases: [
      { yue: '我想問吓，今個星期有冇活動？', jyutping: 'ngo5 soeng2 man6 haa5, gam1 go3 sing1 kei4 jau5 mou5 wut6 dung6?', en: 'Are there any events this week?' },
      { yue: '要唔要報名㗎？', jyutping: 'jiu3 m4 jiu3 bou3 meng2 gaa3?', en: 'Do I need to sign up?' },
    ],
    minutes: 12,
  },
];

export const LESSON_TO_CATEGORIES = {
  'L-01': ['cafe', 'restaurant'],
  'L-02': ['convenience'],
  'L-03': ['bookstore', 'convenience'],
  'L-04': ['campus'],
};

export const NEXT_LESSON_HINT = {
  'L-01': { lesson_id: 'L-02', reason_hint: '你啱啱用粵語完成咗點單，下一步最自然就係畀錢：八達通得唔得？' },
  'L-02': { lesson_id: 'L-03', reason_hint: '交易型對話已經上手，可以試「問路」呢類要聽指示嘅對話。' },
  'L-03': { lesson_id: 'L-04', reason_hint: '你已經識問路，可以升級去正式少少嘅校園對話。' },
  'L-04': { lesson_id: 'L-05', reason_hint: 'Campus Bridge 完成，下一步開放更多本地場景。' },
};

const TASK_SEQUENCE = ['SP-001', 'SP-002', 'SP-003', 'SP-004', 'SP-005'];

/** Duolingo City Stamps —— 每個真實開口一次就點亮一個。 */
export const STAMPS = [
  { id: 'ST-COFFEE', name: 'Coffee Mission Stamp', nameZh: '咖啡任務印章', icon: '☕', spot: 'SP-001', unlocked: true, unlockedAt: '2 日前' },
  { id: 'ST-CAMPUS', name: 'Campus Bridge Stamp', nameZh: '校園橋樑印章', icon: '🎓', spot: 'SP-005', unlocked: false, hint: '完成 SP-005 解鎖' },
  { id: 'ST-CITY', name: 'City Explorer', nameZh: '城市探索者', icon: '🧭', unlocked: false, progress: '3 / 5 地點' },
  { id: 'ST-FRIEND', name: 'Friend Mission Master', nameZh: '好友任務大師', icon: '🤝', unlocked: false, hint: '同朋友一齊完成 1 次' },
];

/** Progress Map —— 呢張就係用戶嘅粵語進度條，亦係社交展示資產。 */
export const CITY_MAP = [
  { id: 'SP-001', area: 'HKU', label: 'Campus', activity: 'Coffee', unlocked: true, stamp: 'Coffee Mission Stamp' },
  { id: 'SP-002', area: 'Central', label: 'Central', activity: 'Cha Chaan Teng', unlocked: true, stamp: 'Cha Chaan Teng Stamp' },
  { id: 'SP-003', area: 'Causeway Bay', label: 'Causeway Bay', activity: 'Payment', unlocked: true, stamp: 'Payment Stamp' },
  { id: 'SP-004', area: 'Mong Kok', label: 'Mong Kok', activity: 'Shopping', unlocked: false, stamp: '🫥 未解鎖' },
  { id: 'SP-005', area: 'HKU', label: 'Campus Bridge', activity: 'Campus Talk', unlocked: false, stamp: '🫥 未解鎖' },
];

/**
 * Weekly leaderboard — Duolingo league, not a new invention.
 * `you` marks the learner row so the UI can highlight it.
 */
export const LEADERBOARD = [
  { rank: 1, name: 'Ka-yan', xp: 1240, you: false },
  { rank: 2, name: 'Marco', xp: 990, you: false },
  { rank: 3, name: '你', xp: 780, you: true },
  { rank: 4, name: '阿健', xp: 640, you: false },
  { rank: 5, name: 'Priya', xp: 520, you: false },
];

/** Duo the owl — the guide. Lines are Duolingo-voiced: encouraging, a little teasing, never bossy. */
export const DUO_LINES = {
  lessonDone: 'You’re ready to use this outside Duolingo.',
  missionReady: 'Duo is watching. You promised to speak Cantonese today. 👀',
  rehearsal: 'I’ll be the barista. You order in Cantonese. I won’t switch to Mandarin.',
  rehearsalDone: 'That was good. Real staff speak faster — you’ll be fine.',
  arrive: 'You’ve arrived at a SpeakOut Friendly Spot. Take your time.',
  verified: 'You used Cantonese in real life. Duo is proud of you. 🦉',
  failed: 'Didn’t speak this time? No worries. Duo will wait for you.',
  nextLesson: 'One lesson done. One city unlocked. Keep going?',
  share: '3 phrases learned. 3 places unlocked. Hong Kong is becoming my classroom.',
};

/** Great-circle distance in meters. */
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function getLesson(lessonId) {
  return LESSONS.find((l) => l.id === lessonId) || LESSONS[0];
}

export function getMerchant(merchantId) {
  return MERCHANTS.find((m) => m.id === merchantId) || MERCHANTS[0];
}

export function getNextLesson(lessonId) {
  const hint = NEXT_LESSON_HINT[lessonId] || NEXT_LESSON_HINT['L-01'];
  return { lesson: getLesson(hint.lesson_id), reason_hint: hint.reason_hint };
}

/** Pick a Friendly Spot for a lesson, skipping ones already done in this session. */
export function pickMerchantForLesson(lessonId, usedIds = []) {
  const cats = LESSON_TO_CATEGORIES[lessonId] || ['cafe', 'convenience'];
  const pool = MERCHANTS.filter((m) => cats.includes(m.category));
  const usable = pool.filter((m) => !usedIds.includes(m.id));
  const source = usable.length ? usable : pool.length ? pool : MERCHANTS;
  return source[Math.floor(Math.random() * source.length)];
}

export function missionById(taskId) {
  const seq = TASK_SEQUENCE.indexOf(taskId);
  return MERCHANTS.find((m) => m.id === taskId) || MERCHANTS[seq >= 0 ? seq : 0];
}

/**
 * Deterministic 4-digit dynamic code, so a screen-recorded demo can be replayed.
 * Seed = taskId + day + salt.
 *
 * The salt is deliberately scoped *per demo session*, not per process. When this demo is hosted
 * for several people at once, a process-wide salt would hand every visitor the identical code for
 * the same spot — which would make the "one-time code bound to this attempt" claim visibly false
 * the moment two people compared screens.
 *
 * Pass the same salt to get the same code back (that is what makes rehearsal replayable).
 */
export function makeDynamicCode(taskId, ttlSeconds = 180, salt = DEFAULT_CODE_SALT) {
  const day = new Date().toISOString().slice(0, 10);
  const seedStr = `${taskId}|${day}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const code = String(Math.abs(h) % 10000).padStart(4, '0');
  return { code, ttlSeconds, issuedAt: Date.now(), expiresAt: Date.now() + ttlSeconds * 1000 };
}

/** Stable fallback salt for single-user / local runs (deterministic across restarts of a day). */
export const DEFAULT_CODE_SALT = 7742;

/** Fresh salt for a new demo session. */
export function newCodeSalt() {
  return Math.floor(Math.random() * 9000) + 1000;
}

export function walkMinutes(meters) {
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
}

export function nowLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function nearbyMerchants(origin, limit = 4) {
  const from = origin && typeof origin.lat === 'number' ? origin : USER_PROFILE.home;
  return MERCHANTS.map((m) => ({
    merchant: m,
    distanceMeters: distanceMeters(from, m),
  }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/**
 * Duolingo-style reward maths. Pure, deterministic, single source of truth for the UI.
 * Base mission XP 50 · gem bonus 20 · +25 XP when the geofence and the staff code both passed
 * (that bonus is what makes a *verified* real-world attempt worth more than a tap).
 */
export function computeRewards({ verified = false, streakDays = USER_PROFILE.streakDays, xpToday = USER_PROFILE.xpToday } = {}) {
  const xp = verified ? 75 : 50;
  const gems = 20;
  const streakAfter = verified ? streakDays + 1 : streakDays;
  const xpTodayAfter = verified ? xpToday + xp : xpToday;
  return {
    xp,
    gems,
    streak_after: streakAfter,
    streak_kept: verified ? false : streakDays > 0,
    daily_goal_xp: USER_PROFILE.dailyGoalXp,
    xp_today_after: xpTodayAfter,
    daily_goal_met: xpTodayAfter >= USER_PROFILE.dailyGoalXp,
    /** Honest label: the system verifies *participation*, not proficiency. */
    verifies: 'participation',
    does_not_verify: 'proficiency',
  };
}

/** Anti-cheat heuristics used by verify_location. Pure function, easy to unit test. */
export function checkAntiCheat({ taskId, claimed, actual, clientReportedAccuracy, elapsedSeconds }) {
  const distance = distanceMeters(claimed, actual);
  const flags = [];
  if (clientReportedAccuracy != null && clientReportedAccuracy > 200) flags.push('GPS 精度較差（>200m）');
  if (elapsedSeconds != null && elapsedSeconds < 12) flags.push('到店耗時異常短，疑似未真實移動');
  if (distance > 0 && distance < 5) flags.push('座標與門店完全重合，可能係模擬定位');
  // Keep the vocabulary identical to tools.verify_location ('manual_review' | 'passed' | 'failed')
  // so the UI never has to translate between two verdict languages.
  return {
    distance,
    flags,
    verdict: flags.length >= 2 ? 'manual_review' : 'passed',
  };
}
