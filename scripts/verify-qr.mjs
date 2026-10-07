// verify-qr.mjs — 解碼自己產生嘅 QR code，確認內容真係嗰條網址。
//
// 呢個係「唔好只信產生器」嘅做法：用一個獨立嘅解碼庫（jsQR）反讀，
// 確定印出嚟嘅 QR 掃出嚟就係想要嘅內容。
//
//   node scripts/verify-qr.mjs demo-qr.png "https://duo-jiangjiang.onrender.com"

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, '..');

function load(pkg) {
  for (const dir of [
    path.join(PROJECT, 'node_modules'),
    path.join(PROJECT, '..', '_qrtool', 'node_modules'),
  ]) {
    if (!existsSync(dir)) continue;
    try {
      return createRequire(path.join(dir, 'noop.js'))(pkg);
    } catch {
      /* 換下一個 */
    }
  }
  return null;
}

const jsQR = load('jsqr');
const { PNG } = load('pngjs') || {};
if (!jsQR || !PNG) {
  console.error('❌ 需要 jsqr 同 pngjs 先可以驗證。');
  console.error('   cd _qrtool && npm install jsqr pngjs --prefix .');
  process.exit(1);
}

const file = process.argv[2] || 'demo-qr.png';
const expected = process.argv[3] || '';
const target = path.isAbsolute(file) ? file : path.join(PROJECT, file);

if (!existsSync(target)) {
  console.error(`❌ 搵唔到檔案：${target}`);
  process.exit(1);
}

const png = PNG.sync.read(readFileSync(target));
const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

console.log(`檔案：${path.basename(target)}  (${png.width}×${png.height})`);

if (!result) {
  console.error('❌ 解碼失敗 —— 呢個 QR code 掃唔到，唔好拿去用！');
  process.exit(1);
}

console.log(`解出內容：${result.data}`);
console.log(`定位：(${result.location.topLeftCorner.x}, ${result.location.topLeftCorner.y}) 開始`);

if (expected) {
  if (result.data === expected) {
    console.log('');
    console.log('✅ 完全一致 —— QR code 內容正確');
    process.exit(0);
  } else {
    console.log('');
    console.log(`❌ 唔一致！`);
    console.log(`   期望：${expected}`);
    console.log(`   實際：${result.data}`);
    process.exit(1);
  }
}
process.exit(0);
