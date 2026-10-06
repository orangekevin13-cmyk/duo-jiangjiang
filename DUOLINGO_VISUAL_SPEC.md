# Duolingo 風格視覺規範（PPT + 演示介面共用）

> **一句話原則：每一個 component 都要問「呢個睇落似唔似 Duolingo？」似唔到就改到似為止。**
>
> 呢份規範同時服務兩個對象：**PPT** 同 **Web 演示介面**。兩者必須係同一套視覺語言，
> 否則評委會覺得「演示係一個 App、PPT 係另一個品牌」。

---

## 1. 配色（唯一權威來源）

### 主色
| 名稱 | Hex | 角色 |
|---|---|---|
| **Owl Green** | `#58CC02` | 品牌主色、主要 CTA、正確答案、成功狀態。**佔版面 30% 以上** |
| Owl Green Deep | `#58A700` | 按下／立體底座、深色文字 |
| Owl Green Light | `#89E219` | Hover、淺色填充 |
| Owl Green Pale | `#DBF8C5` | 淺色底、成功橫幅、Duo 對白泡 |
| Owl Green Tint | `#F0FBE4` | 卡片淺底（例如「課後頁」） |

### 輔助色（每個色都帶意義，唔係裝飾）
| 名稱 | Hex | 角色 |
|---|---|---|
| **Streak Orange** | `#FF9600` | 連擊火焰 🔥、streak 相關 |
| Streak Orange Deep | `#CC7A00` | 按下狀態 |
| **Gem Purple** | `#CE82FF` | 寶石 💎、Super 相關、Friend Mission |
| **Macaw Blue** | `#1CB0F6` | 提示、info、次要動作（例如「預演」標籤） |
| Macaw Blue Pale | `#DDF4FF` | info 淺底 |
| **Cardinal Red** | `#FF4B4B` | 錯誤、心心 ❤️、失敗狀態 |
| **Bee Gold** | `#FFC800` | 成就徽章 🏅、City Stamp、XP |

### 表面與文字
| 名稱 | Hex | 角色 |
|---|---|---|
| Snow | `#FFFFFF` | 主背景 |
| Eel | `#F7F7F7` | 次級表面、區塊分隔 |
| Swan | `#E5E5E5` | 標準 2px 邊框、disabled |
| Swan Deep | `#D7D7D7` | 卡片底座 |
| Hare | `#AFAFAF` | Placeholder、禁用文字、小標籤 |
| Wolf | `#777777` | 次要文字、說明 |
| Eel Black | `#3C3C3C` | 主要文字 |
| Duo Black | `#131F23` | 標題、最高對比 |

**禁止事項**：唔好用模糊陰影做深度（要用實色底座）；唔好把色調「高級化」變灰；
唔好把圓角改細；唔好出現純黑 `#000`。

---

## 2. 字體

| 層級 | 字級 | 字重 | 行高 | 用途 |
|---|---|---|---|---|
| Display | 56px | 800 | 1.05 | PPT 封面、口號 |
| H1 | 32px | 800 | 1.15 | 頁面標題 |
| H2 | 24px | 800 | 1.2 | 段落標題 |
| H3 | 18px | 800 | 1.25 | 卡片標題 |
| Body Large | 17px | 500 | 1.5 | 內文 |
| Body | 15px | 400 | 1.5 | 說明 |
| Caption | 13px | 700 | 1.4 | XP／Gems 計數、metadata |
| Button | 15–16px | 800 | 1.2 | **大寫 + 字距 0.03em** |

- 字體堆疊：`'din-round', 'Feather Bold', 'DIN Round Pro', Nunito, 'Varela Round'`，
  繁體中文落到 `'Microsoft JhengHei UI', 'PingFang HK', 'Noto Sans HK'`。
- **800 係預設**：Duolingo 冇幼字重，700 都嫌弱。
- 字體要圓潤、無襯線；標題大、粗、有節奏感。
- PPT 上嘅英文標題一律用大寫 + 字距（例如 `SPEAKOUT MISSION`）。

---

## 3. 形狀與深度（最易出錯嘅地方）

| 元素 | 規格 |
|---|---|
| 卡片 | 白底 · `2px` Swan 邊 · `border-bottom: 4px` Swan · 圓角 `16px` · padding `14–16px` |
| 主按鈕 | Owl Green 底 · 白字 · 圓角 `16px` · **`border-bottom: 4px solid #58A700`** · `:active` 下移 4px 並收縮底座 |
| 次要按鈕 | 白底 · Wolf 字 · `2px` Swan 邊 + `4px` Swan 底座 |
| 輸入框 | 白底 · `2px` Swan 邊 · 圓角 `12px` · focus 轉 Macaw Blue + 3px 光環 |
| 進度條 | 軌道 Swan · 填充 Owl Green（streak 用 Orange）· **高度 16px** · 圓角 `9999px` |
| 學習路徑節點 | 直徑 `58–80px` 圓形 · `border-bottom: 6px` 深色 · 當前節點 `1.0 → 1.06` 脈動 |
| 徽章（City Stamp） | 直徑 `108px` 圓形 · 金色漸層 · 解鎖時 `scale(0.3) rotate(-24°)` 彈入 |

**核心規則**：深度 = **實色底座**（`border-bottom` 或 `0 2px 0`），唔係 Gaussian blur。
呢個「可以撳落去」嘅感覺就係 Duolingo 嘅簽名特徵。

---

## 4. 動效

| 動作 | 時長 | 曲線 |
|---|---|---|
| 按鈕按下 | 100–180ms | linear / ease-out |
| 徽章解鎖 | 720ms | `cubic-bezier(0.34, 1.56, 0.64, 1)`（back-out，輕微過衝） |
| 學習節點解鎖 | 320ms | 同上 |
| 當前節點脈動 | 1.6s 無限循環 | ease-in-out |
| Duo 浮動 | 3.4s 無限循環 | ease-in-out |
| Duo 眨眼 | 每 5s | — |
| 獎勵數字彈入 | 600ms，逐個延遲 80/200/320ms | back-out |

**要遵守**：`prefers-reduced-motion: reduce` 時全部動效關閉。

---

## 5. Duo 貓頭鷹嘅角色規範

Duo **唔係 logo，係角色**。佢一定要出現喺有情緒嘅節點：

| 出現位置 | 講咩（Duolingo 語氣） |
|---|---|
| 課後頁 | "You're ready to use this outside Duolingo." |
| 任務提示 | "Duo is watching. You promised to speak Cantonese today. 👀" |
| 預演 | "I'll be the barista. You order in Cantonese. I won't switch to Mandarin." |
| 預演完成 | "That was good. Real staff speak faster — you'll be fine." |
| 到店 | "You've arrived at a SpeakOut Friendly Spot. Take your time." |
| 驗證成功 | "You used Cantonese in real life. Duo is proud of you. 🦉" |
| 失敗 | "Didn't speak this time? No worries. Duo will wait for you." |
| 分享 | "3 phrases learned. 3 places unlocked. Hong Kong is becoming my classroom." |

**語氣規則**：鼓勵而唔係施壓。唔講「你必須完成」，講「You already know enough. Give it a try.」。
可以俏皮、可以少少「威脅」（Duo is watching），但**唔可以令用戶覺得羞恥**。

---

## 6. 遊戲化機制對照表（PPT 直接用）

| 機制 | 喺演示入面點體現 | Duolingo 原有？ |
|---|---|---|
| **Streak** 🔥 | 手機頂欄 `🔥 6`，完成任務後變 `🔥 7` 並彈跳 | ✅ 沿用 |
| **XP** | 頂欄每日目標條 `今日 60 / 50 XP`；獎勵頁 `+75 XP` | ✅ 沿用 |
| **Gems** 💎 | 頂欄 `💎 120`；獎勵頁 `+20 Gems` | ✅ 沿用 |
| **Hearts** ❤️ | 頂欄 `❤️ 4` | ✅ 沿用 |
| **Leaderboard** 🏆 | Emerald League 排行榜、前 3 名升級、用戶排第 3 | ✅ 沿用 |
| **Achievements** 🏅 | City Stamp 圓形徽章（Coffee / Payment / Campus Bridge） | ✅ 沿用（城市版） |
| **Learning Path** | Progress Map：HKU → Central → Causeway Bay → Mong Kok → Campus Bridge | ✅ 沿用（城市版） |
| **Friend Mission** 🤝 | 邀請碼 `DUO-HK-7742`、雙方雙倍獎勵 | ✅ 延伸 |
| **City Stamp** | 每個真實任務解鎖一個城市印章 | 🆕 新增（建立在成就徽章之上） |
| **SpeakOut Mission** | 把 Lesson 變成一個香港真實任務 | 🆕 新增（建立在課程與獎勵之上） |

**記住**：🆕 只有兩項，而且兩項都係建立喺 ✅ 之上。
呢個就係「唔係新 App」嘅證據，PPT 一定要標出嚟。

---

## 7. PPT 逐頁品牌元素對照

| 頁 | 必備品牌元素 | 主色調 |
|---|---|---|
| Cover | Duolingo Green 底、Duo 貓頭鷹、`Duo 講講` + slogan、英文大寫標題 | Owl Green |
| Why Duolingo | Duo 細圖、戰略關鍵詞以 pill 呈現（speaking / engagement / retention / gamification） | 綠 + 灰 |
| The Learn–Use Gap | 兩條路徑用 Progress Map 節點風格畫（Learn → Leave App vs Learn → Use → Learn） | 綠 vs 灰（未解鎖） |
| Consumer Research | 數據卡用 Swan 邊 + 實色底座；百分比用 Owl Green 進度條 | 綠 + 白 |
| Insight | 三大障礙（Context / Confidence / Permission）用三張卡片，各配一個 emoji 圓徽章 | 綠 + 藍 |
| Target & Objectives | 目標用 `checks` 勾選列表風格 | 綠 |
| **Digital Solution** | 核心公式 `Learn → Mission → Speak → Verify → Reward → Learn Again` 用 **學習路徑節點** 畫成一條路 | Owl Green |
| **Step 1–11** | 每一步配 Duolingo 圖示、streak / XP / gems / stamp 標記 | 綠 + 金 + 紫 |
| Gamification & Social | 中心環繞圖：中心係 Duo，外圈係 streak / XP / gems / league / stamp / friend | 全色系 |
| Funnel & Storyboard | Storyboard 分鏡框用圓角卡片；每個分鏡角落放 Duo 或 City Stamp | 綠 + 白 |
| KPI Dashboard | 用 Duolingo 數據面板風格：`kv` 表 + 進度條 + 徽章 | 綠 + 灰 |
| RCT Design | 兩組對比用兩張卡片（Treatment 綠 / Control 灰） | 綠 vs 灰 |
| Feasibility & Risks | 風險卡用 Cardinal Red 左邊條；緩解措施用綠勾 | 紅 + 綠 |
| Future Development | Phase 1–4 用學習路徑節點，逐個點亮 | Owl Green |
| **結尾** | 大字：**"Duolingo has gamified learning. Duo 講講 gamifies using."** | Owl Green 滿版 |

---

## 8. 三句必須反覆出現嘅品牌強調句

放喺封面、每個 Part 開頭、結尾：

> ### 1. Duo 講講 is not a new app. It's Duolingo extending into the city.
> ### 2. Duolingo has gamified learning. Duo 講講 gamifies using.
> ### 3. Same Duolingo. Same game. New city.

---

## 9. PPT 製作檢查清單

- [ ] 每一頁都有綠色（唔好有全灰／全白頁）
- [ ] 所有按鈕／卡片都有實色底座，冇模糊陰影
- [ ] 圓角全部 ≥ 12px
- [ ] 標題字重 ≥ 800
- [ ] 英文標題大寫 + 字距
- [ ] Duo 至少出現喺封面、Step 流程、結尾三處
- [ ] streak / XP / gems / league / stamp 五個機制至少各出現一次
- [ ] 城市節點圖（Progress Map）至少出現一次
- [ ] 三句品牌強調句至少各出現一次
- [ ] 冇出現 `#00B96B` 之類嘅舊綠色（見 §10）

---

## 10. 舊視覺殘留清單（要清乾淨）

上一版演示用嘅係通用 SaaS 配色，**唔可以再出現**：

| 舊值 | 應該改成 |
|---|---|
| `#00b96b` / `#0b7d4f`（teal 綠） | `#58CC02` / `#58A700` |
| `#0e1726` / `#172236`（深藍頂欄） | `#58CC02`（綠頂欄） |
| `#1f6feb`（藍） | `#1CB0F6` |
| `#f0913a`（橙） | `#FF9600` |
| `#e5484d`（紅） | `#FF4B4B` |
| `#e3e8ef`（冷灰邊） | `#E5E5E5` |
| 14px 基準字、`Segoe UI` | 15px 基準、圓潤字體堆疊 |
| 模糊陰影 `0 8px 24px rgba(...)` | 實色底座 `border-bottom: 4px` |
