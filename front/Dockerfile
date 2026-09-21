FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM nginx:alpine AS runtime

COPY --from=build /app/dist/front /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
