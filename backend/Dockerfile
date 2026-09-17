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

# Prisma probes the system's OpenSSL to decide which query engine to load. With
# no openssl present it gives up, warns "failed to detect the libssl/openssl
# version to use", and falls back to the 1.1 engine - which then cannot load
# on Alpine, because Alpine ships OpenSSL 3:
#
#   Error loading shared library libssl.so.1.1: No such file or directory
#
# Listing linux-musl-openssl-3.0.x in schema.prisma puts the right engine in
# the image; this is what makes Prisma actually pick it. Both halves are
# needed, and having only one looks exactly like having neither.
RUN apk add --no-cache openssl

# ================== A JDK, ONLY WHEN ASKED FOR ==================
# Off by default, and the default is the one that ships.
#
# In a deployed environment student code runs in the code-runner Lambda, so
# this image needs no Java at all - putting a compiler in it would be several
# hundred megabytes of attack surface for a capability nothing here uses.
#
# The local compose stack is the exception, and not by choice: a container has
# no Docker daemon, so the `docker` execution mode is impossible inside one,
# and there is no Lambda on a laptop. That leaves running code in this
# container, which needs javac present - without it the service reported
# "Sandboxed execution" mode and then failed every single Run with
# "javac: not found", which is how this was missed.
#
# 17 to match the Lambda's Corretto 17 and the eclipse-temurin:17 sandbox
# image, so a program that compiles in one compiles in the others.
#
# The stack that sets this to true also sets NODE_ENV to development, because
# unsandboxed execution is refused outright in production - see
# assertRequiredEnv in src/common/env.ts.
# ================================================================
ARG INCLUDE_JDK=false
RUN if [ "$INCLUDE_JDK" = "true" ]; then \
      apk add --no-cache openjdk17-jdk && javac -version && java -version; \
    fi

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
#
# --ignore-scripts, because the only postinstall that matters here is
# @prisma/engines downloading the query engines - and the two lines below
# overwrite node_modules/@prisma with the build stage's copy immediately
# afterwards. So the download was several hundred megabytes of work whose
# result is discarded, and it put a network call on the critical path of
# every image build:
#
#   npm error path /app/node_modules/@prisma/engines
#   Error: aborted ... code: 'ECONNRESET'
#
# after five minutes. Nothing else in the runtime dependency set has a
# postinstall it needs - bcryptjs is pure JavaScript, and there is no
# native module in the tree.
#
# The BUILD stage deliberately keeps its scripts: `npx prisma generate`
# there does need the engines.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

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
