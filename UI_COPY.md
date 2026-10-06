# Duo 講講 · UI 文案完整版（Duolingo 式文案）

> **文案規則**：簡短、鼓勵、幽默、帶少少俏皮、唔居高臨下。
> 所有文案都要似 Duolingo 寫嘅，唔好似營銷團隊寫嘅。
>
> 呢份文件係**權威文案表**：`server/tools.mjs`、`server/agent.mjs`、`server/mock.mjs`、`public/app.js`
> 入面嘅字串都應該同呢度一致。改文案就改呢份，再同步落代碼。
>
> 記住文案嘅立場：**唔係炫耀「我粵語好好」，而係「我用粵語生活」。**

---

## 1. 任務觸發（Lesson Complete → Mission Revealed）

### 課後頁
```
🎉 Lesson Complete · L-01
Ordering Drinks · 點嘢飲
正確率 90% · 9 分鐘 · +12 XP · 今日 14:20 完成

新學：凍檸茶 · 唔該 · 少甜 · 一杯
要留意：「唔該」同「多謝」用法唔同 / 「少甜」個聲調 siu2 tim4
```

### Duo 對白（課後頁）
> 🦉 **"You're ready to use this outside Duolingo."**

### 任務解鎖提示
```
📍 One SpeakOut Mission available 280m away.
☕ 用粵語點一杯凍檸茶
[ Start Mission ]   [ Maybe Later ]
```

### Duo 催促（俏皮、帶少少威脅）
> 🦉 **"Duo is watching. You promised to speak Cantonese today. 👀"**

### 任務卡
```
SpeakOut Mission · 標準
用粵語點一杯凍檸茶

場景：你喺 Café 半山，想點一杯凍檸茶，順便問吓有冇少甜嘅選擇。
目標：用粵語完成一次點單，並確認杯裝同價錢。

到店要講：
  唔該，我要一杯凍檸茶。   m4 goi1, ngo5 jiu3 jat1 bui1 dung3 ling4 caa4.
  可唔可以少甜？            ho2 m4 ho2 ji5 siu2 tim4?
  唔該晒。                  m4 goi1 saai3.

通過標準：
  ✓ 講出至少一句完整粵語點單句（唔該 / 我要一杯…）
  ✓ 聽得明店員嘅價錢或者取餐指示，並回應一次

點解係呢間店：店員聽得明初學者嘅粵語，唔會轉台講普通話。講錯都照聽。

🎁 +75 XP · 💎 +20 Gems · 🏅 HKU Stamp
```

**品牌強調（呢度一定要講）**：
> 呢一步係 Duolingo 課後頁嘅延伸——同一個位置、同一隻 Duo、同一套獎勵。
> **This is not a third-party app. This is Duolingo's existing gamification system, extended into the real world.**

---

## 2. 預演（Duo 扮你嘅對手）

### Duo 開場
> 🦉 **"I'll be the barista. You order in Cantonese. I won't switch to Mandarin."**

### 對話示例
```
我    唔該，我要一杯凍檸茶。
      m4 goi1, ngo5 jiu3 jat1 bui1 dung3 ling4 caa4.
      One iced lemon tea, please.

店員  你好，想飲啲咩呀？
      nei5 hou2, soeng2 jam2 di1 me1 aa3?
      Hi, what would you like to drink?

我    可唔可以少甜？
      ho2 m4 ho2 ji5 siu2 tim4?
      Could it be less sweet?

店員  凍定熱呀？今日冇燕麥奶喎。      ← 冇預料到嘅反問（故意設計）
      dung3 ding6 jit6 aa3? gam1 jat6 mou5 jin3 maak6 naai5 wo3.
      Iced or hot? We have no oat milk today.

我    唔該晒。
      m4 goi1 saai3.
      Thank you so much.
```

### Duo 教練提示
- 開頭用「唔該」而唔係「多謝」：點單、叫人幫手都用「唔該」。
- 對方語速通常比 App 音頻快，聽到數字先重複一次再答。
- 被問到「凍定熱呀？」唔使緊張，答「凍嘅，唔該」就得。

### 發音重點
> 「少甜」= siu2 tim4，兩個字都係高平／低降，唔好讀成普通話「shao tian」。

### 信心指標
> 開口信心 42% → 68%

### Duo 收尾
> 🦉 **"That was good. Real staff speak faster — you'll be fine."**

---

## 3. 到店（Permission 機制）

### 抵達提示
```
You've arrived at a SpeakOut Friendly Spot.

Cantonese Learners Welcome. Take your time.
歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。
```

### 門店標示（貼紙／立牌，同一句）
> **歡迎學講廣東話！講錯唔緊要，我哋慢慢聽。**

### 圍欄通過
> 已進入 Café 半山 嘅 120m 圍欄（距離 45m），向店員出示動態碼就得。

### Duo 提示
> 🦉 **"You've arrived at a SpeakOut Friendly Spot. Take your time."**

### 動態碼
```
一次性動態碼 · 出示畀店員
  8 3 3 7
有效期 02:58 · 單次使用 · 同本次任務綁定
```

### 店員端（商家介面，只需要做一件事）
> 店員只需要輸入個碼，唔需要評分、唔需要教粵語、唔需要填表。
> 任務只判斷一句：**Learner attempted the mission.**

### 失敗／未到店文案（含補救）
| 情況 | 文案 |
|---|---|
| 仲喺路上 | 「仲差 180 米，行多兩分鐘就到，Duo 喺度等你。」 |
| 定位飄移 | 「而家定位精度較差（±260m），建議行去空曠位置或者開 Wi-Fi 輔助定位再試。」 |
| 模擬定位 | 「座標與門店完全重合，系統標記為疑似模擬定位，真實評分會轉人工覆核。」 |
| Duo 安慰 | 🦉 **"Didn't speak this time? No worries. Duo will wait for you."** |

---

## 4. 驗證成功（Reward）

### 成功頁
```
✅ Verified!
Real-World Speaking Attempt

🏅 HKU Mission Stamp unlocked
You used Cantonese in real life.
Duo is proud of you. 🦉

+75 XP    💎 +20 Gems    🔥 7 Day Streak
```

### Duo 對白
> 🦉 **"You used Cantonese in real life. Duo is proud of you. 🦉"**

### 誠實聲明框（**必須顯示，唔可以隱藏**）
```
系統驗證嘅係 participation，唔係 proficiency。
驗證得到：participation（到店 + 店員核銷）
驗證唔到：proficiency（係咪真係講咗粵語、講得準唔準）
補救機制：App 內語音預演 · 店員友好配合 · 自我報告機制 · Friend Mode 互相見證
```

### Progress Map 點亮
> 🗺️ Progress Map 已點亮：**HKU · Campus** · Coffee Mission

### 核銷失敗
```
⛔ 核銷未通過
碼唔啱，唔緊要，我哋再試一次。
下一步：核對動態碼之後再試，或者重新簽發一個新碼。
```

---

## 5. 下一課推薦（Continue · Learn → Use → Learn）

```
下一課 · L-02 Paying in 711 · 畀錢
你啱啱用粵語完成咗點單，下一步最自然就係畀錢。

帶埋今次用過嘅句子：唔該，我要一杯凍檸茶。 / 可唔可以少甜？
目標：可以用粵語講「八達通得唔得？」，並完成一次完整交易。
建議時間：聽日返學途中 8 分鐘（地鐵上聽兩次音頻）

要帶走嘅粵語句：
  八達通得唔得？      baat3 daat6 tung1 dak1 m4 dak1?
  唔使袋，唔該。      m4 sai2 doi2, m4 goi1.

🔁 線上學《點嘢飲》 → 線下喺 Café 半山 真開口 → 用真實表現決定下一課，
   Learn → Use → Learn 閉環完成。
```

### Duo 對白
> 🦉 **"One lesson done. One city unlocked. Keep going?"**

---

## 6. 分享（Share Card · Advocacy）

### 分享卡內容
```
🦉 Duo 講講                          MISSION VERIFIED

我用粵語生活咗一日
Ordering Drinks · 點嘢飲 · Café 半山（般咸道）

今日學完《點嘢飲》就直接出街實戰。店員問咗我三個問題，
我全部都聽得明——包括最怕嘅「凍定熱呀？」。
原來「唔該，我要一杯凍檸茶。」講出口只需要 3 秒嘅勇氣。

3 phrases learned   ·   4 places unlocked   ·   7-day streak 🔥

#Duo講講  #Cantonese  #HKU  #SpeakOutPass

"Hong Kong is becoming my classroom."

核銷碼尾號 37 · 連續 7 天
```

### 分享渠道
`RedNote` · `Instagram Story` · `WeChat` · `校園群`

### 分享獎勵機制
> ⭐ 設定分享獎勵，鼓勵用戶分享；達到分享次數之後可獲得額外積分。

### Duo 對白
> 🦉 **"3 phrases learned. 3 places unlocked. Hong Kong is becoming my classroom."**

**立場提醒**：分享卡唔係炫耀「我粵語好好」，而係「我用粵語生活」。
所以 headline 用「我用粵語生活咗一日」，唔用「我粵語好叻」。

---

## 7. 排行榜與 Friend Mode

### 聯盟排行榜
```
🏆 Emerald League            仲有 2 日結束 · 前 3 名升級
 1  Ka-yan                     1240 XP
 2  Marco                       990 XP
 3  你 （你）                   855 XP   ← 高亮顯示
 4  阿健                        640 XP
 5  Priya                       520 XP
```

### Friend Mission
```
🤝 Friend Mission · Invite a Friend
雙方 +2× XP，and Duo will be extra proud.
一齊完成任務，雙方都有雙倍獎勵，順便解鎖 Friend Mission Master。

邀請碼：DUO-HK-7742
```

### 文案立場
> 呢一步把「我唔敢講」變成「我哋一齊講」，降低心理壓力，同時帶來自然拉新。

---

## 8. 進度地圖（Progress Map）

```
☕ HKU · Campus          ✅ Coffee Mission
🍜 Central               ✅ Cha Chaan Teng
💳 Causeway Bay          ✅ Payment
🛍️ Mong Kok              ⬜ 未解鎖 · Shopping
🎓 HKU · Campus Bridge   ⬜ 未解鎖 · Campus Talk
```

### 標題
> **Progress Map · My Cantonese Hong Kong**

### 文案立場
> 呢張地圖係用戶嘅粵語進度條，亦係社交展示資產。
> **地圖唔係目的，令用戶把學習轉化成行為，並因此繼續學習，才係目的。**

---

## 9. 成就徽章（Achievements）

| 徽章 | 中文 | 解鎖條件 | 狀態文案 |
|---|---|---|---|
| ☕ Coffee Mission Stamp | 咖啡任務印章 | 完成 SP-001 | 已解鎖 · 2 日前 |
| 🎓 Campus Bridge Stamp | 校園橋樑印章 | 完成 SP-005 | 完成 SP-005 解鎖 |
| 🧭 City Explorer | 城市探索者 | 點亮 5 個地點 | 3 / 5 地點 |
| 🤝 Friend Mission Master | 好友任務大師 | 同朋友一齊完成 1 次 | 同朋友一齊完成 1 次 |

---

## 10. 品牌強調句（介面 + 講稿都要出現）

放喺右側面板、PPT 每個 Part 開頭、講稿每段收尾：

> **Duo 講講 唔係第三方 App，係 Duolingo 粵語課程嘅自然延伸。**
>
> 佢沿用 Duolingo 嘅：
> - 視覺風格（Owl Green、圓角、Duo 貓頭鷹）
> - 遊戲化機制（streak、XP、Gems、Leaderboard、Achievements）
> - 文案風格（簡短、鼓勵、幽默）
> - 品牌調性（輕鬆學習、快樂進步）
>
> 只把學習場景由 App 內延伸到香港真實生活。
>
> ### **Same Duolingo. Same game. New city.**

三句要背死嘅：
1. **Duo 講講 is not a new app. It's Duolingo extending into the city.**
2. **Duolingo has gamified learning. Duo 講講 gamifies using.**
3. **Same Duolingo. Same game. New city.**

講稿中每講完一個場景，加一句：
> "This is not a third-party app. This is Duolingo's existing gamification system, extended into the real world."
>
> "Duo 講講 uses the same streak, XP, gems, leaderboard, and achievements that Duolingo users already know."
>
> "The owl is still with you. Just now, it's in the city."

---

## 11. 文案 Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| "You already know enough. Give it a try." | "你必須完成今日任務" |
| "Didn't speak this time? No worries. Duo will wait for you." | "任務失敗，你嘅 streak 已經中斷" |
| "I'll be the barista. You order in Cantonese." | "系統將評估你嘅粵語水平" |
| "You used Cantonese in real life." | "你粵語講得好好！" |
| "Learner attempted the mission." | "學員粵語發音準確度 87 分" |
| "用粵語生活咗一日" | "我粵語好叻" |
| "Hong Kong is becoming my classroom." | "我已經掌握粵語日常會話" |
| 短句、emoji 克制使用（🦉🔥💎🏅） | 大段營銷式排比句 |
| 講「嘗試」 | 講「掌握」、「精通」 |

**最後一條鐵律**：唔可以声称驗證到「講得好唔好」。
系統驗證嘅係 **participation**，唔係 **proficiency**。
呢個界線喺文案、介面同講稿三處都要守住——誠實承認局限，反而係加分項。
