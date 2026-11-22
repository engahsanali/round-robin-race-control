# Runtime image for the VPS. Build first on the host:
#   VITE_BASE=/roundrobin/ VITE_AUTH=local npm run build && npm run build:server
FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 RR_BASE_PATH=/roundrobin RR_STATIC_DIR=/app/public RR_DATA_DIR=/data
WORKDIR /app
COPY dist-server/server.mjs /app/server.mjs
COPY dist/ /app/public/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "/app/server.mjs"]
