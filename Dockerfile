# Многоступенчатая сборка: зависимости нужны только для dev.
#
# ВАЖНО: для продакшена статик-серверу НЕ нужны node-hid и ws —
# ими пользуется только dev-сервер (research/dev-server/) и тесты. Поэтому
# ставим только production-зависимости, а их у статики нет вовсе.
#
# Образ получается крошечный: node:alpine + 21 файл.

FROM node:20-alpine AS base
WORKDIR /app

# ─── слой 1: только то, что нужно для запуска ───
FROM base AS runtime

# Статик-сервер не использует внешних пакетов — только стандартную
# библиотеку Node. Значит npm install не нужен вовсе.
COPY src/static-server.js ./src/static-server.js

# Файлы сайта. Список совпадает с белым списком в static-server.js:
# если добавить модуль в белый список, надо добавить COPY и здесь.
COPY web/index.html ./web/index.html
COPY web/app.js ./web/app.js
COPY web/mixer-state.js ./web/mixer-state.js
COPY web/scenes.js ./web/scenes.js

COPY src/transport-core.js ./src/transport-core.js
COPY src/transport-consts.js ./src/transport-consts.js
COPY src/adapter-webhid.js ./src/adapter-webhid.js
COPY src/protocol.js ./src/protocol.js
COPY src/crc16.js ./src/crc16.js

COPY src/eq-hid.js ./src/eq-hid.js
COPY src/eq-hp.js ./src/eq-hp.js
COPY src/comp-hid.js ./src/comp-hid.js
COPY src/reverb-hid.js ./src/reverb-hid.js
COPY src/phantom-hid.js ./src/phantom-hid.js
COPY src/mixer-tags.js ./src/mixer-tags.js
COPY src/mutes-loopback.js ./src/mutes-loopback.js
COPY src/gain-scales.js ./src/gain-scales.js

# ─── запуск от непривилегированного пользователя ───
#
# node:alpine уже содержит пользователя node (uid 1000). Работать
# от root в контейнере не нужно: сервер только читает файлы.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# healthcheck: Docker будет считать контейнер мёртвым, если /health
# не отвечает. Это позволяет платформе перезапустить сервис.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# exec-форма: сигнал SIGTERM дойдёт до node, и он закроется штатно.
CMD ["node", "src/static-server.js"]
