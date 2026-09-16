# ---------- 1) 빌드 단계: TypeScript를 JavaScript로 컴파일 ----------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ---------- 2) 운영 의존성만 따로 설치 ----------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# ---------- 3) 실행 단계: 실제로 배포되는 이미지 ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=prod

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
