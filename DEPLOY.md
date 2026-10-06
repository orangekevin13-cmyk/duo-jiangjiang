# 部署指南 · 把 Duo 講講 放上一個長期在線嘅網址

**你揀咗：Render 免費層 ＋ 真實模型（live）。**
本項目零 npm 依賴（只用 Node 內建模組），冷啟動即時，所以部署好簡單 —— 但要留意下面兩節。

> 如果你想改用 Fly.io（可以完全唔休眠、有香港節點），睇附錄 A1。
> 如果只係想兩分鐘出一條臨時網址，睇附錄 A2。

---

## 0. 落手之前：兩條一定要知嘅事

### 規則一：必須只跑**一個** instance

會話狀態存喺進程記憶體（每位訪客一個 session，用 `duo_sid` cookie 綁定）。
如果平台開多過一部機，同一個訪客嘅請求會被分流去唔同機器 ——
**佢會見到進度突然消失、跳返第一步、或者動態碼對唔上。**

Render 免費層預設就係一部，所以**唔好加 instance，亦唔好開 autoscaling**。
如果之後真係要水平擴展，必須先把會話搬去 Redis 之類嘅共享存儲。

### 規則二：live 模式即係「任何人拿到網址都可以燒你嘅錢」

| 方案 | 老師會睇到咩 | 你嘅成本 | 風險 |
|---|---|---|---|
| 離線 Mock | 6 個場景、工具調用、圍欄判定、動態碼核銷、City Stamp —— **全部照跑**，只有文案由模板生成 | **¥0** | 幾乎冇 |
| **真實模型 live（你揀咗呢個）** | 同上，但文案由 `deepseek-flash` 即時生成 | 每次完整演示約 **¥0.1–0.3** | 網址一旦流出（貼群、被搜尋引擎收錄），**陌生人會不停燒你嘅額度** |

值得留意：呢個演示嘅核心價值 —— 「工具調用真實發生、驗證判定唔可以造假、獎勵計法一致」——
喺 Mock 模式下**一模一樣**，因為判定同獎勵都係同一套純函數（`tools.mjs` / `store.mjs`），
Mock 只換走咗「模型寫文案」嗰一層。時間線、工具入參返回值、失敗路徑，全部都係真嘅。

**`LIVE_ALLOWED` 就係你嘅保險絲**：設成 `"0"` 之後，即使 `DEMO_MODE` 仍然係 `live`、
即使訪客自己喺介面撳「live」開關，服務器都**絕對唔會**呼叫收費模型。
所以「忘記切換」最壞情況係介面顯示 live 但實際行 mock，唔會產生費用。

---

## 1. 預檢（2 分鐘，唔好跳）

```bash
# 1) 確認本機 6 個場景冇問題（唔需要 API Key）
node scripts/smoke-mock.mjs        # 應該 177 項全過

# 2) 確認真實模型調用鏈正常（會消耗 token，約 ¥0.1-0.3）
node scripts/smoke-live.mjs        # 每個場景應該回 [live]

# 3) 確認 git 有身份（冇設定過就會 commit 失敗）
git config --global user.name   "你的名"
git config --global user.email  "你的email@example.com"
```

---

## 2. 推上 GitHub

```bash
cd speakout-pass-demo
git init
git add .
git commit -m "Duo 講講 · Cantonese SpeakOut Pass demo"

# 先用 GitHub 介面開一個空 repo（唔好勾選加 README），再：
git remote add origin https://github.com/你的帳號/duo-jiangjiang.git
git branch -M main
git push -u origin main
```

> `.gitignore` 已經擋住 `.env*`、`.credentials.yaml`、`**/.dsh/`。
> **憑證同密碼絕對唔可以入 git** —— 我哋會用 Render 介面嘅 secret 功能設定。

---

## 3. 部署到 Render

1. 去 [render.com](https://render.com) → 用 GitHub 帳號登入（免費層唔需要信用卡）
2. **New → Blueprint**
3. 揀你啱啱推上去嘅 repo。Render 會自動讀 `render.yaml`
4. 佢會因為 `sync: false` 而問你兩個 secret 嘅值：
   - **`DEMO_PASSWORD`** —— 你嘅示範密碼（**唔好留空**，否則任何人都可以重置你嘅演示）
   - **`DEEPSEEK_API_KEY`** —— 真實模型嘅 Key（由本機 `~/.dsh/.credentials.yaml` 或 DeepSeek 控制台攞）
5. 撳 **Apply / Create**，等部署完成（零依賴，通常 1-2 分鐘）
6. Render 會俾你一條 `https://duo-jiangjiang.onrender.com` 之類嘅網址

打開之後應該見到 **登入頁**（🦉 Duo 講講 / 請輸入示範密碼）。輸入密碼就入到演示。

> 如果 app 名 `duo-jiangjiang` 已經被占用，Render 會叫你改名，照改就得（`render.yaml` 入面嘅
> `name` 同實際網址唔需要一致）。

---

## 4. 部署之後一定要驗證（唔好假設，要實測）

```bash
APP=https://你嘅app名.onrender.com

# 1) 健康檢查（唔需要密碼）
curl $APP/healthz
# 期望：{"ok":true,"sessions":N,"in_flight":0}

# 2) 未認證要被擋
curl -s -o /dev/null -w "%{http_code}\n" $APP/api/state
# 期望：401

# 3) 確認真係行緊 live，而唔係靜靜降級咗
curl -s -H "x-demo-password: 你嘅示範密碼" $APP/api/state \
  | grep -o '"effective_mode":"[a-z]*"\|"live_ready":[a-z]*'
# 期望："effective_mode":"live" 同 "live_ready":true
# ⚠ 如果回 mock → 即係 DEEPSEEK_API_KEY 冇設成功，去 Render 介面嘅 Environment 檢查

# 4) 多訪客隔離 —— 呢個係 hosted 演示最容易出事嘅地方
BASE=$APP DEMO_PASSWORD=你嘅示範密碼 node scripts/smoke-session.mjs
# 期望：32 項全過，特別係「A 按重置唔會清空 B」
```

第 3 步特別重要：**`effective_mode` 係服務器實際會執行嘅模式**，唔係你填嘅偏好。
如果 Key 打錯或者過期，佢會老實顯示 `mock`，你唔會喺評委面前才發現。

---

## 5. 叫醒服務（免費層最大嘅痛點）

Render 免費層**閒置 15 分鐘會休眠**。老師第一次打開要等約 30 秒 ——
畫面會白一陣，之後自己出。如果佢以為壞咗就閂咗，你就白做。

### 做法一：演示當日開一個心跳（推薦）

用一個免費嘅定時 ping 服務，每 10 分鐘打一次 `/healthz`，令服務唔會休眠：

- [cron-job.org](https://cron-job.org)（免費）→ 新增 job，URL 填 `https://你嘅app名.onrender.com/healthz`，間隔 10 分鐘
- 或者用 GitHub Actions 嘅 `schedule`（但要留意 GitHub 嘅定時任務唔一定準時）

**成本影響**：`/healthz` 唔會呼叫模型（佢只係回一個 JSON），所以心跳本身**零成本**。
但服務唔休眠 = 免費層嘅 750 小時/月額度會被用滿；如果同一個帳號仲有其他免費服務就要留意額度分配。

### 做法二：接受休眠，但要教老師點做

把網址連同一句指示一齊俾老師：

> 「第一次打開要等約 30 秒（免費層會休眠），畫面白一陣之後會自己出登入頁，唔需要重新整理。」

### 做法三：演示前自己先打開一次

你自己先開一次把服務叫醒，等評委打開嗰陣就係熱嘅。最簡單，但唔適合「老師隨時自己睇」。

---

## 6. 成本控制（live 模式必做）

### 6.1 睇實用量

- **DeepSeek 控制台**：睇每日用量同餘額，設定告警
- **Render 介面**：Metrics 睇請求量
- **演示介面右上角**：每次場景完成會顯示 token 用量
- **服務器 log**：Render → Logs

### 6.2 三個旋鈕

| 旋鈕 | 位置 | 建議 |
|---|---|---|
| `RATE_PER_MIN` | `render.yaml` `envVars` | 已預設 12（免費層單機，唔宜太大）。想更保守改 6 |
| `GLOBAL_CONCURRENCY` | 同上 | 已預設 3。想更保守改 2 |
| `DEMO_PASSWORD` | Render 介面 secret | 定期換；換完舊 cookie 即刻失效 |

改 `render.yaml` 要重新部署；改 secret 喺 Render 介面改完會自動重啟。

### 6.3 演示完即刻關掉成本（最重要嘅一步）

去 Render → 你嘅 service → **Environment** → 把 `LIVE_ALLOWED` 改成 `0` → Save。

Render 會自動重啟。之後：訪客一樣睇到完整 6 個場景（工具調用、判定、獎勵全部照跑），
但模型唔會被呼叫，**成本即刻變 ¥0**。介面會顯示 `mock`，唔會呃人。

想再開返：把 `LIVE_ALLOWED` 改返 `1`。

> 更徹底嘅做法係連 `DEMO_MODE` 都改成 `mock`，雙重保險。

---

## 7. 環境變數一覽

| 變數 | 預設 | 作用 |
|---|---|---|
| `HOST` | `127.0.0.1` | 綁定地址。**Render 必須 `0.0.0.0`**（`render.yaml` 已設） |
| `PORT` | `8710` | 端口。Render 會自己注入，代碼會讀 |
| `DEMO_PASSWORD` | 空 | **設咗就開啟密碼保護**。開放去公網必須設 |
| `DEMO_MODE` | `auto` | 新訪客嘅預設模式：`auto` / `live` / `mock` |
| `LIVE_ALLOWED` | `1` | `0` = **即使有 Key 都唔會呼叫收費模型**（成本保險絲） |
| `RATE_PER_MIN` | `20` | 每位訪客每分鐘最多跑幾多個場景 |
| `GLOBAL_CONCURRENCY` | `4` | 同時最多幾個場景在跑 |
| `SESSION_TTL_MINUTES` | `90` | 訪客無活動幾久之後回收會話 |
| `DEEPSEEK_API_KEY` | 空 | live 模式必須 |

---

## 8. 安全須知

1. **一定要設 `DEMO_PASSWORD`**。呢個演示冇帳號系統，冇密碼就等於任何人都可以重置你嘅演示、燒你嘅額度。
2. **密碼同 Key 唔好入 git**，用 Render 介面嘅 secret。`.gitignore` 已經擋住 `.env*` 同憑證檔。
3. **網址會流傳**。預咗評委會轉發俾同學。所以：密碼 + 限流 + `LIVE_ALLOWED` 保險絲，三樣齊備先好開。
4. **會話係單實例記憶體**。見規則一。
5. **Render 免費層會休眠**，呢點順便幫你降低被持續濫用嘅風險 —— 唔完全係壞事。

---

## 9. 疑難排解

| 症狀 | 原因同做法 |
|---|---|
| 部署成功但打開 502 | 平台連唔到服務。九成係 `HOST` 冇設 `0.0.0.0` |
| 打開一片白，等 30 秒先出 | 免費層休眠喚醒，正常。睇第 5 節 |
| 登入頁出到但密碼入唔到 | 檢查 `DEMO_PASSWORD` 有冇多餘空格；Render 介面確認已設定 |
| `/api/state` 回 `effective_mode: mock` 但你想 live | `DEEPSEEK_API_KEY` 冇設成功，或者 `LIVE_ALLOWED` 係 `0` |
| 老師話「進度突然跳返第一步」 | **幾乎肯定係跑咗多過一部 instance**。Render 介面確認 instance 數係 1，亦冇開 autoscaling |
| 跑到一半話「太密啦」 | 觸發限流。等一分鐘，或者調高 `RATE_PER_MIN` |
| 跑到一半話「而家太多人同時用」 | 觸發 `GLOBAL_CONCURRENCY`。等幾秒，或者調高 |
| 想確認而家有冇燒錢 | `curl -H "x-demo-password: 密碼" $APP/api/state` 睇 `effective_mode`；或者睇 DeepSeek 控制台 |
| `curl` 打 `/api/scenario/...` 回 500 或 panel 係 undefined | 會話綁喺 cookie，`curl` 預設唔帶 cookie 就會每個請求開新會話。要加 `-c cookies.txt -b cookies.txt`；`scripts/smoke-http.mjs` 已內建 cookie jar |
| 本機想模擬線上環境 | `DEMO_PASSWORD=x PORT=8721 node server/server.mjs --mock` 之後跑 `BASE=http://127.0.0.1:8721 DEMO_PASSWORD=x node scripts/smoke-session.mjs` |

---

## 附錄 A：其他部署路線

### A1. Fly.io（可以完全唔休眠，有香港節點）

Render 免費層最大缺點係休眠。如果「老師隨時打開都即刻有反應」對你重要，Fly.io 可以鎖住一部機永遠開住：

```bash
iwr https://fly.io/install.ps1 -useb | iex     # 裝 flyctl（裝完開新終端）
fly auth signup                                  # 需要信用卡
fly launch --no-deploy --copy-config             # 讀已準備好嘅 fly.toml
fly secrets set DEMO_PASSWORD=你嘅示範密碼
fly secrets set DEEPSEEK_API_KEY=sk-xxxxxxxx
fly deploy && fly open
```

`fly.toml` 已經鎖死 `min_machines_running = 1` + 唔自動加減（見規則一）。
香港節點 `hkg` 對粵語演示最貼題。缺點：唔休眠就唔屬於免費額度。

### A2. 臨時隧道（兩分鐘出網址，唔算長期在線）

```bash
DEMO_PASSWORD=你嘅密碼 DEMO_MODE=mock LIVE_ALLOWED=0 node server/server.mjs
cloudflared tunnel --url http://127.0.0.1:8710    # 另一終端
```

你部電腦要一直開住，隧道一關網址即失效。**必須設 `DEMO_PASSWORD`**，否則等於把你本機端口開放俾全網。

### A3. 自架 Docker（有自己嘅伺服器 / NAS）

```bash
docker build -t duo-jiangjiang .
docker run -d --name duo-jiangjiang \
  -p 8080:8080 \
  -e DEMO_PASSWORD=你嘅密碼 \
  -e DEMO_MODE=live -e LIVE_ALLOWED=1 \
  -e DEEPSEEK_API_KEY=sk-xxxxxxxx \
  --restart unless-stopped \
  duo-jiangjiang
```

前面加 Nginx / Caddy 做 https，並且**只開一個容器**（見規則一）。

---

## 附錄 B：本機演示（唔部署）

```bash
node server/server.mjs                    # auto：有 Key 走真實模型，失敗自動降級
node server/server.mjs --mock             # 強制離線引擎（斷網保險）
HOST=0.0.0.0 node server/server.mjs       # 俾同一個 Wi-Fi 嘅隊友訪問
```

`HOST=0.0.0.0` 時啟動訊息會直接列出可用嘅區網網址。校園 Wi-Fi 常開 client isolation，
同一個 SSID 都可能互相訪問唔到 —— 咁就用其中一部機開熱點最穩。
