# chatbot-be의 Dockerfile을 따름 (인포팀 공통 패턴)
FROM oven/bun:1 AS base
WORKDIR /app

# ---------- 의존성 설치 ----------
# dev(빌드에 필요) / prod(실행에만 필요)를 따로 설치해서
# 최종 이미지에는 prod 의존성만 들어가게 한다.
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# ---------- 빌드 (TypeScript -> JavaScript) ----------
FROM base AS build
COPY --from=install /temp/dev/node_modules node_modules
COPY . .
RUN bun run build

# ---------- 실제 배포되는 이미지 ----------
FROM base AS release
ENV NODE_ENV=prod

COPY --from=install /temp/prod/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/package.json .

# Drizzle을 붙이면 여기에 추가한다 (chatbot-be 참고):
#   COPY --from=build /app/drizzle drizzle
#   COPY --from=build /app/drizzle.config.ts .
#   COPY --from=build /app/scripts scripts
#   RUN chmod +x /app/scripts/start.sh
#   CMD ["/app/scripts/start.sh"]   <- 마이그레이션 후 서버 시작

EXPOSE 3000
CMD ["bun", "run", "dist/main.js"]
