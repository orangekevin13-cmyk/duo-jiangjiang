# 手把手教學 · 從零把 Duo 講講 放上網

呢份文件假設你**未做過部署**。我會先講「為咩要咁做」，再講「點做」，每一步都有**檢查點**——
如果檢查點唔對，唔好繼續行落去，先解決咗佢。

全程大概 20 分鐘，其中 15 分鐘係等 Render 部署。

---

## 第一部分：先理解我哋喺做咩（3 分鐘，唔好跳）

### 1.1 三個角色

```
你部電腦                     GitHub                      Render
（寫代碼、測試）    →      （放代碼）        →      （跑代碼、出網址）
   speakout-pass-demo      duo-jiangjiang          https://xxx.onrender.com
```

- **你部電腦**：代碼喺度。你喺度改嘢、跑測試。但其他人連唔到你部電腦。
- **GitHub**：一個放代碼嘅倉庫。Render 唔識你部電腦，佢只識去 GitHub 攞代碼。
- **Render**：一部永遠開住嘅電腦，幫你跑 `node server/server.mjs`，然後俾你一條 https 網址。

**點解唔可以直接由你部電腦「上傳」去 Render？**
可以，但 Render 需要一個方法去「攞」你嘅代碼。GitHub 就係嗰個標準方法。
而且之後你改咗代碼，只要 `git push`，Render 會自動重新部署——唔需要再手動上傳。

### 1.2 一個關鍵概念：環境變數（Environment Variables）

你嘅代碼入面有兩樣**唔可以寫死喺代碼入面**嘅嘢：

| 名 | 係咩 | 為咩唔可以寫入代碼 |
|---|---|---|
| `DEMO_PASSWORD` | 示範密碼 | 寫入代碼 = 推上 GitHub = 全世界都睇到 |
| `DEEPSEEK_API_KEY` | 你嘅 API Key | 同上。俾人攞到就會用你嘅錢 |

所以我哋用「環境變數」：代碼執行嗰陣，由**外面**餵呢兩個值入去。

打個比喻：代碼係一部機器，環境變數係你插入去嘅鑰匙。
機器嘅設計圖（代碼）可以公開，但鑰匙要自己保管。

**呢個就係為咩 `.gitignore` 要擋住 `.env` 同 `.credentials.yaml`** ——
防止你唔小心把鑰匙連設計圖一齊公開。

### 1.3 你將會設定嘅環境變數

呢啲喺 `render.yaml` 已經寫好，你唔需要自己打，但要知佢哋做咩：

| 變數 | 值 | 作用 |
|---|---|---|
| `HOST` | `0.0.0.0` | 叫服務器聽所有網絡接口。**唔設就等於只聽自己，Render 連唔到 → 502** |
| `DEMO_MODE` | `live` | 用真實模型生成文案 |
| `LIVE_ALLOWED` | `1` | 允許呼叫收費模型。**改成 `0` 就即刻停用（成本保險絲）** |
| `RATE_PER_MIN` | `12` | 每位訪客每分鐘最多跑 12 次，防止有人狂撳燒你額度 |
| `DEMO_PASSWORD` | 你自己填 | 開啟密碼保護 |
| `DEEPSEEK_API_KEY` | 你自己填 | 真實模型嘅鑰匙 |

---

## 第二部分：實際操作

### 步驟 1 · 確認本機一切正常

**點解要先做**：如果連本機都跑唔通，放上網只會更難查。先喺最簡單嘅環境確認冇問題。

```bash
cd speakout-pass-demo
node scripts/smoke-mock.mjs
```

**檢查點 ✅** 你應該見到：

```
✅ 全部通過：177 項檢查，0 個問題。
   離線 Mock 路徑可以完整演示 6 個場景（含失敗路徑）。
```

如果見到紅色 ✗，**停低**，唔好繼續。同我講見到咩。

---

### 步驟 2 · 告訴 git 你係邊個

**點解要**：git 每次「存檔」（commit）都要記錄「係邊個改嘅」。呢個係歷史記錄，唔設定就存唔到檔。

```bash
git config --global user.name "你嘅名"
git config --global user.email "你嘅email@example.com"
```

> `--global` 表示「對呢部電腦所有專案生效」，只需設定一次。
> Email 用你之後註冊 GitHub 嗰個，方便 GitHub 認得係你。

**檢查點 ✅**

```bash
git config --global user.name     # 應該印出你嘅名
git config --global user.email    # 應該印出你嘅 email
```

---

### 步驟 3 · 建立本機倉庫並存檔

**點解要**：`git init` 係「喺呢個資料夾開始記錄歷史」。`git add` 係「揀邊啲檔案要記錄」。
`git commit` 係「確實存一個檔」。

```bash
cd speakout-pass-demo
git init
git add .
git commit -m "Duo 講講 · Cantonese SpeakOut Pass demo"
```

**檢查點 ✅**

```bash
git log --oneline     # 應該見到你啱啱嗰個 commit
git status            # 應該顯示 "nothing to commit, working tree clean"
```

**額外檢查（重要）**：確認憑證冇被記錄

```bash
git ls-files | findstr /i "credential env"     # 應該冇任何輸出
```

如果呢句印出咗 `.credentials.yaml` 或者 `.env`，**停低同我講**——即係 `.gitignore` 冇生效，推上去就會洩漏。

---

### 步驟 4 · 喺 GitHub 開一個空倉庫

1. 去 [github.com](https://github.com) 登入（冇帳號就註冊，免費）
2. 撳右上角 **+** → **New repository**
3. **Repository name**：填 `duo-jiangjiang`
4. **Public / Private**：揀 **Private**（演示代碼唔需要公開）
5. ⚠️ **唔好勾** "Add a README file"、唔好加 .gitignore、唔好加 license
6. 撳 **Create repository**

**點解唔好勾 README**：因為我哋本機已經有檔案。如果 GitHub 都建一個 README，
兩邊就會「唔同步」，第一次 push 會被拒絕（呢個係新手最常撞嘅牆）。

**檢查點 ✅** 你會見到一個頁面寫住 "Quick setup — if you've done this kind of thing before"，
下面有一堆指令。**唔需要抄佢啲指令**，我哋下一步用自己嘅。

---

### 步驟 5 · 把代碼推上 GitHub

**點解要**：`git remote add` 係「記住 GitHub 倉庫喺邊」。`git push` 係「確實傳上去」。

```bash
git remote add origin https://github.com/你嘅帳號/duo-jiangjiang.git
git branch -M main
git push -u origin main
```

> 把 `你嘅帳號` 換成你嘅 GitHub 用戶名。

**會發生咩**：GitHub 會彈出一個視窗叫你登入／授權。
2021 年之後 GitHub 唔收密碼，要用 **Personal Access Token** 或者瀏覽器授權。
最簡單：撳「Sign in with your browser」，跟住指示做。

**檢查點 ✅** 重新整理 GitHub 嗰個倉庫頁面，你應該見到：
`server/`、`public/`、`scripts/` 資料夾，同 `README.md`、`render.yaml` 等檔案。

**如果見到** `src refspec main does not match any`：即係步驟 3 嘅 commit 失敗咗，返去做步驟 2。
**如果見到** `failed to push some refs`：即係步驟 4 勾咗 README，同我講。

---

### 步驟 6 · 喺 Render 部署

1. 去 [render.com](https://render.com) → 撳 **Get Started** → 揀 **GitHub** 登入
2. 授權 Render 讀取你嘅倉庫（可以只授權嗰一個 repo）
3. 撳 **New +** → **Blueprint**
4. 揀你啱啱推上去嘅 `duo-jiangjiang` 倉庫 → **Connect**
5. Render 會讀 `render.yaml`，然後彈出要你填兩個 secret：
   - **`DEMO_PASSWORD`**：自己定一個示範密碼（例如 `duo2026demo`）
     ⚠️ **唔好留空**，留空 = 任何人都可以重置你嘅演示
   - **`DEEPSEEK_API_KEY`**：你嘅 DeepSeek Key
     （喺本機 `C:\Users\orangekevin13\.dsh\.credentials.yaml` 入面嗰個 `sk-...`）
6. 撳 **Apply**
7. 等 1-3 分鐘。你會見到 log 不斷滾動，最後出現你嘅網址

**檢查點 ✅** Render 介面顯示 **Live**（綠色），並俾你一條
`https://duo-jiangjiang-xxxx.onrender.com` 之類嘅網址。

> **Blueprint 係咩**：Render 嘅一個功能，佢會讀你 repo 入面嘅 `render.yaml`，
> 自動幫你設定好服務類型、免費層、環境變數。冇咗佢你就要喺網頁上逐項手動填。

---

### 步驟 7 · 驗證真係得（**唔好跳呢步**）

**點解要**：部署「成功」唔等於「正確」。最常見嘅情況係 Key 設定失敗，
服務器靜靜地降級做 Mock，你以為行緊真實模型，到評委面前才發現。

喺**本機**開一個終端（唔係 Render 介面）：

```bash
# 1) 健康檢查（唔需要密碼）
curl https://你嘅網址.onrender.com/healthz

# 2) 未認證應該被擋
curl -s -o /dev/null -w "%{http_code}\n" https://你嘅網址.onrender.com/api/state

# 3) 確認真係行緊 live
curl -s -H "x-demo-password: 你嘅示範密碼" https://你嘅網址.onrender.com/api/state
```

**檢查點 ✅**

| 指令 | 期望結果 | 如果唔對 |
|---|---|---|
| 1 | `{"ok":true,"sessions":0,...}` | 502 → `HOST` 冇設 `0.0.0.0` |
| 2 | `401` | 回 `200` → 密碼保護冇生效，檢查 `DEMO_PASSWORD` |
| 3 | 入面有 `"effective_mode":"live"` 同 `"live_ready":true` | 回 `mock` → `DEEPSEEK_API_KEY` 設定失敗 |

第 3 步回 `mock` 係最常見嘅問題。去 Render → 你嘅 service →
**Environment** → 確認 `DEEPSEEK_API_KEY` 有值（唔好有前後空格）→ 改完會自動重啟。

---

### 步驟 8 · 用瀏覽器實際打開一次

打開你嘅網址，你應該見到：

1. 🦉 **登入頁**：寫住「Duo 講講 · Cantonese SpeakOut Pass · 請輸入示範密碼」
2. 輸入密碼 → 入到演示主介面
3. **第一次可能等約 30 秒**（免費層休眠喚醒），畫面白一陣之後自己出

跟住撳手機屏主按鈕 `完成 Lesson 01 · 點嘢飲`，睇下係唔係：
- 時間線開始出現工具調用
- 手機屏出現任務卡「用粵語點一杯凍檸茶」
- 右上角模式顯示 `live`

**恭喜，你已經部署完成。** 把網址同密碼俾老師就得。

---

## 第三部分：之後點維護

### 3.1 改咗代碼想更新線上版本

```bash
git add .
git commit -m "改咗咩"
git push
```

Render 會**自動**重新部署（因為 `render.yaml` 入面 `autoDeploy: true`）。
等 1-3 分鐘就生效，唔需要做任何嘢。

### 3.2 演示完想停止燒錢（重要）

Render → 你嘅 service → **Environment** → 把 `LIVE_ALLOWED` 改成 `0` → **Save**

服務會自動重啟，成本即刻變 ¥0。但演示**照樣完整可用**——
6 個場景、工具調用、地理圍欄判定、動態碼核銷、City Stamp 獎勵全部照跑，
只有文案由模型生成改成模板。介面會顯示 `mock`，唔會呃人。

想再開返：把 `LIVE_ALLOWED` 改返 `1`。

### 3.3 換密碼

Render → **Environment** → 改 `DEMO_PASSWORD` → Save。
舊密碼即刻失效（所有人要重新登入）。

### 3.4 睇有冇人喺度用

Render → **Logs**：每個請求都會打出來。
Render → **Metrics**：睇請求量。
DeepSeek 控制台：睇 token 用量同餘額。

### 3.5 免費層會休眠（要同老師講）

閒置 15 分鐘後服務會睡著，之後第一次打開要等約 30 秒。

**兩個做法**：
- **（推薦）** 用 [cron-job.org](https://cron-job.org) 每 10 分鐘 ping 一次
  `https://你嘅網址/healthz` —— `/healthz` 唔會呼叫模型，所以**零成本**，只係令服務唔睡
- 或者接受佢，但把網址俾老師嗰陣加一句：
  「第一次打開要等約 30 秒（免費層休眠），白畫面之後會自己出，唔需要重新整理」

---

## 第四部分：出錯咗點查（按症狀搵）

| 你見到 | 意思 | 點做 |
|---|---|---|
| `src refspec main does not match any` | 冇成功 commit 過 | 返去做步驟 2、3 |
| `failed to push some refs to ...` | GitHub 倉庫唔係空的（勾咗 README） | 刪咗個 GitHub repo 重新開一個空嘅 |
| `Permission denied` / 彈登入窗 | GitHub 要授權 | 撳「Sign in with your browser」跟住做 |
| Render 部署失敗，log 有 `EADDRINUSE` | 端口被占用 | 唔應該發生，同我講 |
| 打開網址 502 | 平台連唔到服務 | 九成係 `HOST` 唔係 `0.0.0.0` |
| 打開一片白，30 秒後正常 | 免費層休眠喚醒 | 正常，見 3.5 |
| 登入頁出到，但密碼入唔到 | `DEMO_PASSWORD` 有空格或未設定 | Render → Environment 檢查 |
| `effective_mode` 回 `mock` 但你想 live | Key 未設定成功 | Render → Environment 檢查 `DEEPSEEK_API_KEY` |
| 老師話「進度突然跳返第一步」 | 開咗多過一部 instance | Render 確認 instance 數係 1 |
| 跑到一半話「太密啦」 | 觸發限流 | 等一分鐘，或調高 `RATE_PER_MIN` |

---

## 第五部分：我幫你做咗啲咩（你可以唔理）

為咗唔使你踩以下嘅坑，呢啲已經喺代碼入面處理好：

1. **`HOST` 預設係 `127.0.0.1`（只聽本機）** —— 安全預設。部署時由 `render.yaml` 設成 `0.0.0.0`。
2. **會話隔離** —— 每位訪客獨立 session，所以老師 A 撳「重置」唔會清空老師 B 嘅畫面。
3. **動態碼每個 session 獨立** —— 兩個訪客唔會拿到同一個碼。
4. **成本保險絲 `LIVE_ALLOWED`** —— 獨立於 `DEMO_MODE`，防止「忘記切換」造成損失。
5. **限流** —— 每 IP 每分鐘上限，同全域併發上限。
6. **錯誤邊界** —— 就算有請求出錯，服務都唔會崩潰（實測過壞 JSON 回 400，服務照活）。
7. **`/healthz` 唔需要密碼** —— 俾 Render 做健康檢查，但唔會洩漏任何內容。
8. **`effective_mode`** —— 介面永遠顯示**實際會執行**嘅模式，唔會呃你。

---

## 附錄：本機演示（唔想部署嘅話）

```bash
node server/server.mjs                 # 本機，只有自己開得到
HOST=0.0.0.0 node server/server.mjs    # 同一個 Wi-Fi 嘅隊友都開得到
```

`HOST=0.0.0.0` 時啟動訊息會直接列出可用嘅區網網址，例如
`http://192.168.x.x:8710`，把佢俾隊友就得。
（校園 Wi-Fi 有時開咗客戶端隔離，同一個 SSID 都互相訪問唔到，咁就用熱點。）
