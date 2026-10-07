// make-qr-card.mjs — 產生品牌風格嘅 QR 卡片（黑白 QR ＋ Duolingo 外框）。
//
// 設計取捨：中間嘅 QR 保持純黑白 —— 因為實測發現彩色模組會令嚴格嘅解碼器
// 判斷唔到（亮度對比不足），而中間放圖案亦會增加掃唔到嘅風險。
// 所以品牌風格放喺外框：Owl Green 邊、卡片圓角、標題同網址文字。
// QR 本身一啲都唔改，保證任何手機都掃得到。
//
// 用法：
//   node scripts/make-qr-card.mjs https://duo-jiangjiang.onrender.com
//
// 輸出：demo-qr-card.png（適合放入 PPT）
//
// 依賴：qrcode、pngjs（裝喺專案外嘅 _qrtool）

import { writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(__dirname, '..');

function load(pkg) {
  const dirs = [path.join(PROJECT, 'node_modules'), path.join(PROJECT, '..', '_qrtool', 'node_modules')];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      return createRequire(path.join(dir, 'noop.js'))(pkg);
    } catch {
      /* 換下一個 */
    }
  }
  return null;
}

const QRCode = load('qrcode');
const jsQR = load('jsqr');
const pngjs = load('pngjs');
if (!QRCode || !pngjs) {
  console.error('❌ 需要 qrcode 同 pngjs。');
  console.error('   mkdir _qrtool && cd _qrtool && npm install qrcode pngjs jsqr --prefix .');
  process.exit(1);
}
const { PNG } = pngjs;

const rawUrl = process.argv[2];
if (!rawUrl) {
  console.error('用法：node scripts/make-qr-card.mjs <網址>');
  process.exit(1);
}
let url = rawUrl.trim();
if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
url = url.replace(/\/+$/, '');

/* ---- 品牌色 ---- */
const GREEN = [88, 204, 2];
const GREEN_DEEP = [88, 167, 0];
const INK = [19, 31, 35];
const WOLF = [119, 119, 119];
const SNOW = [247, 247, 247];

/* ---- 1. 產生純黑白 QR（唔加任何裝飾）---- */
// QR_MODULE_PX 越大，成品解析度越高（適合放入 PPT 或印刷）。
const QR_MODULE_PX = 16;
const QUIET = 2;
const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
const n = qr.modules.size;
const qrSide = (n + QUIET * 2) * QR_MODULE_PX;

/* ---- 2. 卡片版面 ---- */
const CARD_PAD = 64;
const HEADER_H = 168;
const FOOTER_H = 170;
const CARD_W = qrSide + CARD_PAD * 2;
const CARD_H = HEADER_H + qrSide + FOOTER_H;

const img = new PNG({ width: CARD_W, height: CARD_H });

/** 填滿整張圖一個顏色 */
const fillAll = (rgb) => {
  for (let i = 0; i < CARD_W * CARD_H; i += 1) {
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = 255;
  }
};
const setPx = (x, y, rgb) => {
  if (x < 0 || y < 0 || x >= CARD_W || y >= CARD_H) return;
  const i = (y * CARD_W + x) * 4;
  img.data[i] = rgb[0];
  img.data[i + 1] = rgb[1];
  img.data[i + 2] = rgb[2];
  img.data[i + 3] = 255;
};
const rect = (x0, y0, w, h, rgb) => {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) setPx(x, y, rgb);
};
/** 圓角矩形 */
const roundRect = (x0, y0, w, h, r, rgb) => {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = Math.min(x, w - 1 - x);
      const dy = Math.min(y, h - 1 - y);
      if (dx < r && dy < r) {
        const d = Math.hypot(r - dx, r - dy);
        if (d > r) continue;
      }
      setPx(x0 + x, y0 + y, rgb);
    }
  }
};

/* ---- 3. 畫卡片 ---- */
fillAll([255, 255, 255]);
// 外框：Owl Green 粗邊 + 底部深色（Duolingo 立體底座）
roundRect(0, 0, CARD_W, CARD_H, 28, GREEN);
roundRect(0, 0, CARD_W, CARD_H - 10, 28, [255, 255, 255]);
roundRect(6, 6, CARD_W - 12, CARD_H - 22, 24, [255, 255, 255]);

// 頂部綠色標題帶
roundRect(CARD_PAD - 16, 28, CARD_W - (CARD_PAD - 16) * 2, 92, 16, GREEN);

/* ---- 4. 貼上 QR（純黑白，原封不動）---- */
const qrX = CARD_PAD;
const qrY = HEADER_H;
// QR 白底（靜區）
rect(qrX, qrY, qrSide, qrSide, [255, 255, 255]);
for (let r = 0; r < n; r += 1) {
  for (let c = 0; c < n; c += 1) {
    if (!qr.modules.data[r * n + c]) continue;
    rect(
      qrX + (c + QUIET) * QR_MODULE_PX,
      qrY + (r + QUIET) * QR_MODULE_PX,
      QR_MODULE_PX,
      QR_MODULE_PX,
      [0, 0, 0],
    );
  }
}

/* ---- 5. 文字（用 5×7 點陣字，唔依賴系統字型）---- */
// 5×7 點陣字型：只做需要嘅字元（大寫字母、數字、常見符號）
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '11100', '10010', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(text, x, y, px, rgb) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) {
      cx += px * 6;
      continue;
    }
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        if (glyph[r][c] === '1') rect(cx + c * px, y + r * px, px, px, rgb);
      }
    }
    cx += px * 6;
  }
  return cx - x;
}

function textWidth(text, px) {
  return text.length * px * 6 - px;
}

/** 自動縮放：令文字啱啱好放入 maxWidth（避免溢出被裁切）*/
function fitText(text, maxWidth, preferredPx) {
  let px = preferredPx;
  while (px > 2 && textWidth(text, px) > maxWidth) px -= 1;
  return px;
}

/** 居中繪字，回傳實際用嘅 px */
function drawCentered(text, y, maxWidth, preferredPx, rgb) {
  const px = fitText(text, maxWidth, preferredPx);
  drawText(text, Math.round((CARD_W - textWidth(text, px)) / 2), y, px, rgb);
  return px;
}

const INNER_W = CARD_W - CARD_PAD * 2;
// 顯示用嘅網址（去掉 https:// 令佢短啲、易讀啲）
const hostText = url.replace(/^https?:\/\//, '');

/* 標題帶上嘅字（白色，自動縮放入綠色帶） */
drawCentered('DUO SPEAKOUT PASS', 46, CARD_W - 120, 9, [255, 255, 255]);

/* 底部：網址 + 提示（自動縮放，確保完整顯示） */
drawCentered(hostText, HEADER_H + qrSide + 26, INNER_W, 8, GREEN_DEEP);
drawCentered('SCAN TO START', HEADER_H + qrSide + 84, INNER_W, 7, WOLF);

/* ---- 6. 寫檔 ---- */
const outPath = path.join(PROJECT, 'demo-qr-card.png');
writeFileSync(outPath, PNG.sync.write(img));

console.log(`✅ demo-qr-card.png  ← 品牌風格卡片（${CARD_W}×${CARD_H}）`);
console.log(`   網址：${url}`);
console.log(`   QR：純黑白 ${n}×${n} 模組，容錯 M —— 冇改動，保證可掃`);

/* ---- 7. 驗證：由成品 PNG 直接解碼 ---- */
if (jsQR) {
  const check = jsQR(new Uint8ClampedArray(img.data), CARD_W, CARD_H);
  if (check && check.data === url) {
    console.log('');
    console.log('✅ 已由成品解碼驗證：掃得到，內容正確');
  } else {
    console.log('');
    console.log(`❌ 成品解碼失敗${check ? `（掃到：${check.data}）` : ''} —— 唔好使用呢個檔案`);
    process.exit(1);
  }
} else {
  console.log('');
  console.log('⚠ 冇 jsqr，跳過解碼驗證');
}
