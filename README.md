# Duo 講講 · Cantonese SpeakOut Pass（線下任務 Agent 演示）

> **Duo 講講 唔係第三方 App，亦唔係新產品。佢係 Duolingo 粵語課程嘅自然延伸。**
>
> 沿用 Duolingo 現有嘅一切——Owl Green 視覺語言、Duo 貓頭鷹、streak、XP、Gems、
> Leaderboard、Achievements、學習路徑——只把**學習場景由 App 內延伸到香港真實生活**。
>
> ### Duolingo has gamified learning. Duo 講講 gamifies using.
> ### Same Duolingo. Same game. New city.

一個可現場演示嘅 Web 程序：
**完成粵語 Lesson → Agent 生成香港真實任務 → Duo 扮店員預演 → 到店雙重驗證 → City Stamp 獎勵 → 分享卡 → 推薦下一課**。

後端調用 DeepSeek `deepseek-flash`（OpenAI 兼容接口 + **Tool Calls** + **JSON Output** + **SSE 流式**），前端零構建。
冇 API Key、或者現場斷網時，自動降級到**離線確定性 Mock 引擎**，介面同流程完全唔變。

```bash
# 1) 啟動（需要 Node 20+，本項目零 npm 依賴）
cd speakout-pass-demo
node server/server.mjs            # auto：有 Key 走真實模型，失敗自動降級 Mock
node server/server.mjs --live     # 強制真實模型（失敗即報錯，適合彩排）
node server/server.mjs --mock     # 強制離線引擎（斷網演示保險）

# 2) 打開
http://127.0.0.1:8710
```

> `PORT=9000 node server/server.mjs` 可換端口。
> API Key 讀取順序：環境變量 `DEEPSEEK_API_KEY` → `~/.dsh/.credentials.yaml`（讀取後唔會打印、唔會寫入任何檔案）。

### 4.1 俾其他人訪問（同一個 Wi-Fi / 校園網）

默認只監聽 `127.0.0.1`（只有自己開得到）。要俾同一個網絡嘅隊友由自己部機打開：

```bash
HOST=0.0.0.0 node server/server.mjs          # PowerShell: $env:HOST="0.0.0.0"; node server/server.mjs
```

啟動時會直接列出可以用嘅網址：

```
  ➜  本機        http://127.0.0.1:8710
  ➜  同一個網絡  http://192.168.x.x:8710
```

把「同一個網絡」嗰條 URL 俾隊友就得。注意：

- **雙方要在同一個網段**。校園 Wi-Fi 有時開咗 client isolation（客戶端隔離），同一個 SSID 都互相訪問唔到——如果你哋係校園網，最穩陣係用手機熱點，或者其中一部機開熱點。
- **Windows 防火牆**第一次可能要你授權：彈窗出現時揀「允許存取」。如果隊友連唔到、而你自己開得到，九成係防火牆擋咗。可以喺**管理員 PowerShell** 加一條規則：
  ```powershell
  New-NetFirewallRule -DisplayName "Duo 講講 demo" -Direction Inbound -Protocol TCP -LocalPort 8710 -Action Allow
  ```
- **唔好直接暴露去公網。** 呢個演示冇鑑權、只有一個共享記憶體 session，而且開放咗 `/api/reset` 同 `/api/config`。
  任何連得到端口嘅人都可以操作、**中途重置你嘅演示**、或者切換模型模式。只喺可信網絡分享；
  如果真係要俾校外嘅人睇，用 Cloudflare Tunnel / ngrok 之類嘅隧道之前，先加一層 Basic Auth 或者一次性 token。

---

## 1. 演示嘅 6 個場景

| # | 場景 | 學員端睇到咩 | Agent 實際做咗咩 |
|---|---|---|---|
| 1 | **Lesson Complete → Mission Revealed** | 課後頁（Duo 講 "You're ready to use this outside Duolingo."）→ 任務卡：Friendly Spot 門店、步行時間、3 句要講嘅粵語（連粵拼）、通過標準、獎勵預告 | 調 `find_nearby_mission_spots` 搵匹配門店 → `create_speakout_mission` 生成任務卡（結構化 JSON） |
| 2 | **Rehearsal** | Duo 扮店員嘅 4-6 輪粵語對話（正字 + 粵拼 + 英文）+ 教練提示 + 發音重點 + 開口信心 42%→68% | 調 `build_rehearsal_script` 取預演骨架，再生成對話同提示 |
| 3 | **Verify ① 地理圍欄** | 地圖可視化：學員／門店相對位置、圍欄 120m、實測距離、定位精度、Friendly Spot 門店標示 | 調 `verify_location` 算大圓距離做圍欄判定 + 反作弊標記；通過先 `issue_dynamic_code` |
| 4 | **Verify ② 動態碼核銷** | 4 位一次性動態碼 + 倒數；商家端輸入後顯示核銷結果同雙重驗證鏈 | 調 `redeem_dynamic_code` 校驗碼值／時效／一次性，模型只負責解釋同安撫 |
| 5 | **Reward** | City Stamp 徽章彈入動畫、`+75 XP`、`💎 +20 Gems`、`🔥 streak 6→7`、Progress Map 點亮、**誠實聲明框** | 調 `issue_city_stamp` 發放成就徽章同 Duolingo 現有獎勵 |
| 6 | **Share + Next Lesson** | 分享卡（可導出 PNG）+ 下一課推薦（Paying in 711）+ 聯盟排行榜 + Friend Mission | 調 `generate_share_card` + `recommend_next_lesson` + `get_leaderboard`，把本次薄弱點接返課程體系 |

**失敗路徑同樣可演示**：`仲喺路上`（900m，未進圍欄）、`定位飄移`（±260m 精度差）、
`模擬定位`（座標與門店完全重合 → 標記疑似作弊並**升級做 manual_review，唔會自動通過**）、
以及**故意輸錯動態碼**。離開圍欄後先前簽發嘅動態碼會即時作廢。

---

## 2. 架構

```
瀏覽器（零構建 ESM）
├─ 手機屏：Duolingo 風格 App（頂欄 🔥 streak / 💎 gems / ❤️ hearts / 每日目標條）
│          課後頁 / 任務卡 / 預演 / 到店地圖 / 動態碼 / City Stamp / 分享卡 / 排行榜 / 進度地圖
├─ Agent 時間線：每一步 tool_call（入參可展開）+ tool_result + 結構化輸出校驗
└─ 右側狀態面板：模型連接、地圖、運行指標、品牌定位
        │  POST /api/scenario/:name   （SSE 事件流）
        ▼
Node HTTP 服務（零依賴，server/）
├─ server.mjs   路由 / SSE / 靜態檔案 / 演示會話狀態
├─ agent.mjs    兩階段 Agent 循環 + 每個場景嘅 prompt / JSON 結構校驗 / 降級
├─ tools.mjs    10 個工具嘅真實實現（Friendly Spot、圍欄距離、動態碼簽發與核銷、City Stamp、排行榜、推薦）
├─ store.mjs    領域數據（香港 Friendly Spots / 粵語課程 / 學員畫像）+ 確定性計算
├─ llm.mjs      DeepSeek 客戶端：JSON 模式、Tool Calls、流式、Key 解析
└─ mock.mjs     離線確定性引擎（同一套工具、同一套面板結構）
        ▼
DeepSeek API  https://api.deepseek.com  （model: deepseek-flash）
```

### 10 個工具

| 工具 | 作用 |
|---|---|
| `find_nearby_mission_spots` | 按座標搵附近嘅 SpeakOut Friendly Spot（距離、步行時間、店員語言能力） |
| `create_speakout_mission` | 把課程轉成任務卡（含獎勵預告） |
| `build_rehearsal_script` | 出發前粵語預演骨架 + 對方可能嘅反問 |
| `verify_location` | 地理圍欄判定 + 反作弊標記（純函數） |
| `issue_dynamic_code` | 簽發一次性 4 位動態碼 |
| `redeem_dynamic_code` | 商家端核銷（校驗碼值／時效／一次性） |
| `issue_city_stamp` | 發放 City Stamp 成就徽章 + XP / Gems / streak |
| `generate_share_card` | 生成分享卡文案與配圖數據 |
| `recommend_next_lesson` | 推薦下一節粵語課（Learn → Use → Learn） |
| `get_leaderboard` | 讀取聯盟排行榜同 Friend Mission 狀態 |

### 點解係「兩階段」調用（本項目最重要嘅工程決定）

DeepSeek 嘅 `response_format=json_object` 同 `tool_calls` 同時開啟時，模型喺拿到工具結果後嗰一輪
**經常返回空內容**（實測復現：`finish_reason=length`、`content=""`）。所以 `agent.mjs` 把一次場景拆成：

- **Phase A · 取事實**：帶 `tools`、唔帶 JSON 模式。模型只可以調用工具，直到佢認為事實夠。
- **Phase B · 出結構**：唔帶 `tools`、帶 `response_format=json_object`，把工具結果放喺上下文，要求輸出嚴格 JSON。
- **校驗與自癒**：Phase B 嘅結果要過場景級校驗（字段、類型、條數）。唔合法就把「邊度唔合法」回灌，最多再修 2 次；
  仍然唔合法 → 帶原因降級到 Mock，**絕不把模型編嘅內容渲染俾學員**。

### 可靠性設計（評委會追問嘅地方）

| 風險 | 處理方式 |
|---|---|
| 模型話「你已到店」但實際冇到 | 圍欄距離、碼值、時效、一次性**全部由 `tools.mjs` 嘅純函數判定**；`requireTools()` 保證缺工具就直接失敗降級 |
| 模型返回非法 JSON | JSON 模式 + 圍欄式解析（去 ``` 包圍、取最外層 `{}`）+ 結構校驗 + 最多 2 次修復 |
| 模型掛 / 斷網 / 超時 | `auto` 模式自動降級 Mock；時間線明確打出黃色降級原因，唔偽裝成真實調用 |
| 現場想固定文案 | 切 `mock` 模式；動態碼由 `taskId+日期+進程鹽` 生成，**同一次啟動內可復現**，方便錄屏重放 |
| 風控 | 座標與門店重合 <5m、精度 >200m、耗時異常短都會打標；**任何同「在場」矛盾嘅標記都會令判定轉 `manual_review`，唔會自動通過** |
| 離開圍欄後仲留住個碼 | `verify_location` 判定未通過時即時作廢未核銷嘅動態碼，前端亦同步清走 |
| 品牌漂移 | `scripts/smoke-mock.mjs` 有品牌一致性檢查（唔可以再出現舊文案／舊配色） |

---

## 3. 演示操作

- 手機裏面嘅主按鈕 = 下一步；**空格鍵**同效，**R** 鍵重置。
- 頂部 `▶ 自動演示`：自動跑完 6 個場景（彩排／錄屏用）。
- 頂部 `live / mock / auto`：現場切換模型來源，時間線唔會清空。
- 頂部 `瞬間 / 快 / 慢`：時間線播放速度，講得慢就調慢。
- 場景 3 手機屏下方有 GPS 分段控件：`正常到店 / 仲喺路上 / 定位飄移 / 模擬定位`；亦可以撳「用真實瀏覽器定位重試」（會請求瀏覽器定位權限）。
- 場景 4 彈窗可以撳「填入正確碼」，亦可以**故意輸錯一位**演示失敗路徑同補救建議。
- 場景 6 撳「⬇ 導出分享卡 PNG」（canvas 手繪導出，零依賴）。

成本參考（`deepseek-flash`，2026-09 官方價）：高峰時段輸入 ¥2/百萬 tokens、輸出 ¥8/百萬 tokens，空閒時段減半。
**跑完 6 個場景約 6-7 萬 tokens**，一次完整演示成本約 ¥0.1-0.3。

---

## 4. 檔案清單

| 檔案 | 作用 |
|---|---|
| [server/server.mjs](server/server.mjs) | HTTP 路由、SSE、靜態服務、演示會話 |
| [server/agent.mjs](server/agent.mjs) | 兩階段 Agent 循環、6 個場景嘅 prompt 與結構校驗、降級邏輯 |
| [server/tools.mjs](server/tools.mjs) | 10 個工具嘅 schema + 真實實現 |
| [server/store.mjs](server/store.mjs) | 香港 Friendly Spots / 粵語課程 / 學員畫像 / City Stamp / 排行榜 + 確定性函數 |
| [server/llm.mjs](server/llm.mjs) | DeepSeek 客戶端（JSON / tools / 流式 / Key 解析） |
| [server/mock.mjs](server/mock.mjs) | 離線確定性引擎 |
| [public/index.html](public/index.html) · [public/app.js](public/app.js) · [public/styles.css](public/styles.css) | 演示介面（Duolingo 視覺系統） |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | 現場演示腳本、話術、Q&A 準備、失敗急救步驟 |
| [UI_COPY.md](UI_COPY.md) | Duolingo 式 UI 文案完整版（含 Do / Don't） |
| [DUOLINGO_VISUAL_SPEC.md](DUOLINGO_VISUAL_SPEC.md) | 品牌視覺規範（配色 / 字體 / 形狀 / 動效 / PPT 逐頁對照） |
| [DEPLOY.md](DEPLOY.md) | **部署指南**：放上長期在線網址（Render / Fly / Docker / 隧道）+ 安全須知 |
| [Dockerfile](Dockerfile) · [render.yaml](render.yaml) · [fly.toml](fly.toml) | 現成部署設定 |
| [scripts/smoke-mock.mjs](scripts/smoke-mock.mjs) · [scripts/smoke-flow.mjs](scripts/smoke-flow.mjs) · [scripts/smoke-app-flow.mjs](scripts/smoke-app-flow.mjs) · [scripts/smoke-http.mjs](scripts/smoke-http.mjs) · [scripts/smoke-live.mjs](scripts/smoke-live.mjs) · [scripts/smoke-session.mjs](scripts/smoke-session.mjs) | 彩排自檢腳本（離線契約 / 六場景流程 / 真實前端流程 / HTTP+SSE / 真實模型 / 多訪客隔離） |

彩排前建議各跑一次：

```bash
node scripts/smoke-mock.mjs       # 離線：196 項契約 + 品牌一致性檢查，唔需要 API Key
node scripts/smoke-flow.mjs       # 六場景連續推進 + 失敗重試（27 項）
node scripts/smoke-app-flow.mjs   # 直接執行 public/app.js 嘅真實流程（17 項）★ 需要服務在跑
node scripts/smoke-http.mjs       # 走 HTTP+SSE，驗證前端拿到嘅數據流
node scripts/smoke-session.mjs    # 多訪客隔離：A 按重置唔會清空 B（部署後必跑）
node scripts/smoke-live.mjs       # 直連 DeepSeek，驗證 6 場景 + 失敗路徑（會消耗 token）
```

> ⚠ **限流**：伺服器每位訪客每分鐘最多 20 次場景調用（`RATE_PER_MIN`）。
> `smoke-http.mjs`、`smoke-app-flow.mjs`、`smoke-session.mjs` 都會快速連續打 API，
> **連續跑多個套件會撞到 429**，症狀係場景全部回 `undefined`。
> 唔係程式有問題 —— 等 60 秒再跑，或者用 `RATE_PER_MIN=200` 重啟服務。

### 點解同時有 smoke-flow 同 smoke-app-flow

`smoke-flow.mjs` 用自己寫嘅同源邏輯模擬前端；`smoke-app-flow.mjs` **直接執行 `public/app.js`**
（提供最小 DOM stub）。呢個分別好重要，因為真實出現過一個 bug：
app.js 收到 SSE `panel` 事件時只送去時間線、冇送去 `applyPanel`，
令「任務地圖」永遠上唔到螢幕 —— 而 `smoke-flow.mjs` 因為自己「正確地」apply 咗每個 panel 事件，
所以 27 項全過，但真實瀏覽器完全睇唔到地圖。

**教訓：測試唔應該比被測程式碼更正確。** 涉及畫面流程嘅改動，兩套都要跑。

---

## 4.2 多訪客同 hosted 部署

由「自己部機演示」變成「放上網俾老師評委自己開」嗰陣，架構上有三件事一定要處理，代碼已經做咗：

| 問題 | 處理方式 |
|---|---|
| 老師 A 按「重置」清空老師 B 嘅畫面 | **每位訪客一個 session**（`duo_sid` cookie），`/api/reset` 只影響自己嗰個；90 分鐘無活動自動回收 |
| 兩個訪客拿到同一個動態碼，令「一次性、綁定本次任務」當場穿煲 | 動態碼 salt 改成**每個 session 獨立**（`newCodeSalt()`），重跑同一個 session 仍然可復現（方便錄屏） |
| 陌生人燒你嘅 DeepSeek 額度 | `LIVE_ALLOWED=0` 保險絲：即使服務器有 Key，都唔會呼叫收費模型。另外有每 IP 限流（`RATE_PER_MIN`，預設 20/分鐘）同全域併發上限（`GLOBAL_CONCURRENCY`，預設 4） |
| 演示對外開放 | `DEMO_PASSWORD` 開啟密碼保護：未認證只睇到登入頁，API 一律回 401。密碼用 cookie（HttpOnly）+ timing-safe 比較 |

介面會顯示**實際會執行**嘅模式（`effective_mode`），所以就算你鎖咗 `LIVE_ALLOWED=0`，
訪客撳「live」開關都唔會見到一個呃人嘅 live 徽章。

完整部署步驟同安全須知見 **[DEPLOY.md](DEPLOY.md)**。

---

## 5. 品牌一致性規則（改代碼前先讀）

每一個 component、每一句文案、每一個交互都要問：

> **呢個睇落似 Duolingo 嗎？**

- 按鈕係圓角嗎？有冇 4px 深色立體底座？
- 有 Duo 貓頭鷹嗎？（佢係角色，唔係 logo）
- 有 streak、XP、Gems、Leaderboard、Achievements 嗎？
- 文案係簡短、鼓勵、幽默嗎？（唔可以施壓、唔可以令用戶羞恥）
- 配色係 Owl Green `#58CC02` 嗎？
- 動效係輕鬆、俏皮、有輕微過衝嗎？

詳見 [DUOLINGO_VISUAL_SPEC.md](DUOLINGO_VISUAL_SPEC.md) §10「舊視覺殘留清單」——`#00b96b`、深藍頂欄、
模糊陰影呢啲上一版嘅殘留**唔可以再出現**。

**文案鐵律**：唔可以声称驗證到「講得好唔好」。
系統驗證嘅係 **participation**（到店 + 店員核銷），唔係 **proficiency**（發音準唔準）。
呢個界線喺文案、介面同講稿三處都要守住——誠實承認局限，反而係加分項。

---

## 6. 已知邊界（誠實說明）

- 門店、店員、課程數據係**虛構演示數據**，座標取自香港大學／中環／銅鑼灣一帶真實座標，用於令距離同步行時間可信。
- 地理圍欄只有 120m 單點判定，冇做軌跡、停留時長、Wi-Fi／藍牙信標校驗；真實產品需要同商家端系統對接。
- 動態碼係本地簽發嘅 4 位碼，冇服務端共享存儲與防重放；真實產品必須放喺服務端並做冪等。
- **系統驗證唔到用戶係咪真係講咗粵語、講得準唔準**——呢個係方案核心局限，我哋用 App 內語音預演、
  店員友好配合、自我報告機制同 Friend Mode 互相見證去最大化嘗試概率，並把呢個聲明直接寫喺獎勵頁上。
- 單用戶記憶體態會話，冇資料庫與鑑權；刷新頁面唔會丟服務端狀態，但重啟服務即清空。
- 演示端口默認 `8710`，可用 `PORT` 覆蓋。
