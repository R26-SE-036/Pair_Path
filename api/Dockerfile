# PairPath API - NestJS, REST + Socket.IO.
#
# Build from the api directory:
#   docker build -t pairpath-api .
#   docker run --rm -p 3001:3001 \
#     -e DATABASE_URL=... -e JWT_SECRET=... -e ML_SERVICE_URL=http://ml:8020 \
#     -e REDIS_URL=redis://... -e CODE_RUNNER_LAMBDA_FUNCTION=... pairpath-api
#
# The API refuses to start without JWT_SECRET and ML_SERVICE_URL - see
# src/common/env.ts. That is deliberate: both previously had defaults that
# worked, and both defaults were wrong in a way nothing reported.
#
# Note this image contains NO Docker client and needs no Docker socket. Student
# code executes in the code-runner Lambda (../code-runner-lambda), which is why
# this can run on Fargate at all.

# ── build ──
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# The schema must be present before `prisma generate`, and generate must run
# before the TypeScript build: the compiler needs the generated client's types.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── runtime ──
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The generated Prisma client is copied from the build stage rather than
# regenerated: `npm ci --omit=dev` does not install the CLI that generates it,
# and a second generate would be a second chance for the two to differ.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma

USER node

# 3001. 3000 is the frontend's.
ENV PORT=3001
EXPOSE 3001

# Migrations are NOT run here. `prisma migrate deploy` needs the direct
# database URL rather than the pooled one, and running it from every starting
# task means N tasks racing for the same advisory lock on a deploy. Run it once
# as a one-off task before rolling out.
CMD ["node", "dist/main"]
