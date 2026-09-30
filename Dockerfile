# syntax=docker/dockerfile:1

# Builds the static quiz (apps/quiz) and serves it with Caddy on :8080.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# The quiz and every workspace package it needs, including @pt/cli for `pt bundle`.
RUN pnpm --filter "@pt/quiz-app..." build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/quiz/build /srv
EXPOSE 8080
