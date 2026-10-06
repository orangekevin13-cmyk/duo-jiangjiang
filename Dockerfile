# Duo 講講 · Cantonese SpeakOut Pass — 演示容器
#
# 本項目零 npm 依賴（只用 Node 內建模組），所以鏡像唔需要 npm install 步驟。
# 亦因為咁，冷啟動係即時嘅——Render / Fly 嘅免費層都夠用。
FROM node:22-alpine

# 非 root 執行
USER node

WORKDIR /app

# 只複製真正需要嘅檔案：伺服器、前端、自檢腳本
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node README.md ./

# 預設值：綁定所有介面（平台需要）、走離線 Mock（唔會燒 API 額度）
ENV HOST=0.0.0.0 \
    PORT=8080 \
    DEMO_MODE=mock \
    LIVE_ALLOWED=0 \
    RATE_PER_MIN=20 \
    GLOBAL_CONCURRENCY=4 \
    SESSION_TTL_MINUTES=90 \
    NODE_ENV=production

EXPOSE 8080

# 平台用嘅健康檢查（唔需要認證）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
