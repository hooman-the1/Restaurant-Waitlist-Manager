FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend

COPY backend ./backend
COPY openapi.yaml ./openapi.yaml
RUN npm run build --prefix backend

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN mkdir -p /app/data \
    && chown node:node /app/data

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend \
    && npm cache clean --force \
    && chown -R node:node /app/backend

COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/openapi.yaml ./openapi.yaml

EXPOSE 8000
USER node
CMD ["node", "backend/dist/main.js"]
