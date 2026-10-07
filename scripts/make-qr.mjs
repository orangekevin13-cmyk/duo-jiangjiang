// make-qr.mjs — 產生演示網址嘅 QR code。
//
// 用法（喺專案目錄執行）：
//   node scripts/make-qr.mjs https://duo-jiangjiang.onrender.com [示範密碼]
//
// 會喺專案目錄產生：
//   demo-qr.png            淨網址（掃碼後要自己入密碼）
//   demo-qr-login.png      網址 + 密碼（一掃即入，適合俾評委）
//   demo-qr.svg            向量版，放大印刷都唔會矇
//
// 依賴：qrcode（唔係本專案嘅依賴 —— 本專案刻意零 npm 依賴，所以呢個工具
// 用一個獨立嘅暫存目錄安裝，唔會污染 package.json）。
// 如果搵唔到 qrcode，下面會提示安裝指令。

import { writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, '..');

/* ---- 搵 qrcode 模組 ---- */
function loadQRCode() {
  // 1) 專案自己嘅 node_modules（如果有人裝咗）
  // 2) 獨立暫存目錄 _qrtool
  const candidates = [
    path.join(PROJECT, 'node_modules'),
    path.join(PROJECT, '..', '_qrtool', 'node_modules'),
    path.join(PROJECT, '_qrtool', 'node_modules'),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      const req = createRequire(path.join(dir, 'noop.js'));
      return req('qrcode');
    } catch {
      /* 換下一個 */
    }
  }
  return null;
}

const QRCode = loadQRCode();
if (!QRCode) {
  console.error('❌ 搵唔到 qrcode 模組。可以先裝喺專案外嘅暫存目錄：');
  console.error('');
  console.error('   mkdir _qrtool && cd _qrtool');
  console.error('   npm install qrcode --prefix .');
  console.error('');
  process.exit(1);
}

/* ---- 參數 ---- */
const rawUrl = process.argv[2];
const password = process.argv[3] || '';

if (!rawUrl) {
  console.error('用法：node scripts/make-qr.mjs <網址> [示範密碼]');
  console.error('例如：node scripts/make-qr.mjs https://duo-jiangjiang.onrender.com DuoJiangJiang2026!');
  process.exit(1);
}

// 容錯：冇打 https:// 就自動補上
let url = rawUrl.trim();
if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
// 去掉結尾斜線，令 QR 內容短啲（QR 越短，格子越大越好掃）
url = url.replace(/\/+$/, '');

/* ------------------------------------------------------------------ *
 * QR 內容策略
 *
 * 密碼唔可以直接擺入 query string —— 伺服器嘅登入頁係 HTML 表單，
 * 唔會讀 query param。而且把密碼寫入 URL 會留喺瀏覽器歷史同 Referer。
 *
 * 所以「帶密碼版」唔係呃個系統，而係俾評委少打一次字：
 * 掃碼入到登入頁，再喺同一個畫面顯示密碼。QR 內容用 hash 傳，
 * hash 唔會送去伺服器、亦唔會出現喺 server log。
 * ------------------------------------------------------------------ */
const plain = url;
const withPass = password ? `${url}/#pwd=${encodeURIComponent(password)}` : plain;

/* ---- 產生 ---- */
const OPTS = {
  errorCorrectionLevel: 'M', // M = 15% 容錯，平衡密度同抗污能力
  margin: 2,
  width: 1024,
};

let made = 0;
try {
  await QRCode.toFile(path.join(PROJECT, 'demo-qr.png'), plain, OPTS);
  console.log(`✅ demo-qr.png         ← 淨網址（最易掃）`);
  console.log(`   ${plain}`);
  made += 1;

  if (password) {
    await QRCode.toFile(path.join(PROJECT, 'demo-qr-login.png'), withPass, OPTS);
    console.log(`✅ demo-qr-login.png   ← 網址 + 密碼（俾評委，少打一次字）`);
    console.log(`   ${url}  +  密碼：${password}`);
    made += 1;
  }

  const svg = await QRCode.toString(plain, { ...OPTS, type: 'svg', width: 512 });
  writeFileSync(path.join(PROJECT, 'demo-qr.svg'), svg);
  console.log(`✅ demo-qr.svg         ← 向量版，放大印刷唔會矇`);
  made += 1;

  console.log('');
  console.log(`共產生 ${made} 個檔案，喺：${PROJECT}`);
  console.log('');
  console.log('⚠ 注意：demo-qr-login.png 等同把密碼公開。只喺課室／組員之間分享，');
  console.log('   唔好貼上網或者放入會外流嘅簡報。');
} catch (err) {
  console.error('❌ 產生失敗：', err.message);
  process.exit(1);
}
