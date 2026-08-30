# Local Setup

Getting all three services running, plus the two problems that will otherwise
cost you an afternoon.

## Prerequisites

| Requirement | Why |
|---|---|
| Node.js 18+ | API and frontend |
| Python 3.10+ | ML service |
| PostgreSQL | Primary datastore — required |
| **Docker** | Sandboxed code execution — required before any real participant |
| MongoDB *(optional)* | Analytics trail; degrades silently if absent |
| Redis *(optional)* | Cooldowns; falls back to in-memory |
| JDK | Running student Java — **one** JDK, see below |

## Start the services

Three terminals.

```bash
# 1. API  →  http://localhost:3001
cd api
npm install
npx prisma generate
npm run start:dev
```

```bash
# 2. ML service  →  http://localhost:8000
cd ml-service
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

```bash
# 3. Frontend  →  http://localhost:3000
cd frontend
npm install
npm run dev
```

Seed the database on first run:

```bash
cd api && npx ts-node prisma/seeds.ts
```

## Environment variables

**`api/.env`** — required:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/codeguru_pair_ai?schema=public"
JWT_SECRET="change-me"
MONGODB_URI="mongodb+srv://..."        # optional
```

Optional, with defaults:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API port |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin |
| `ML_SERVICE_URL` | `http://localhost:8000` | Where the API finds the ML service |
| `REDIS_URL` | `redis://localhost:6379` | Cooldowns |
| `CODE_RUNNER_IMAGE` | `eclipse-temurin:17-jdk-alpine` | Execution sandbox |
| `CODE_RUNNER_MEMORY` | `256m` | Container memory cap |
| `CODE_RUNNER_CPUS` | `0.5` | Container CPU cap |
| `CODE_RUNNER_PIDS` | `64` | Process cap — stops fork bombs |
| `CODE_RUNNER_ALLOW_UNSANDBOXED` | *unset* | ⚠️ See below |
| `JAVA_HOME` | *unset* | Pins the JDK when running unsandboxed |

**ml-service:**

| Variable | Default | Purpose |
|---|---|---|
| `ML_WINDOW_SECONDS` | `180` | Feature window length |
| `ML_CONFIDENCE_THRESHOLD` | `0.6` | Below this, stay silent |

**frontend:**

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ML_SERVICE_URL` | `http://localhost:8000` | Used by the sandbox page only |

## ⚠️ Gotcha 1 — Docker must be running

Student Java executes inside a container with no network and capped resources.
If Docker isn't running, execution is **disabled** and every run returns:

> Code execution is temporarily unavailable (sandbox not running).

For solo development you can bypass it:

```bash
CODE_RUNNER_ALLOW_UNSANDBOXED=true npm run start:dev
```

This runs submitted code **directly on your machine** with your permissions.
Acceptable when you're testing alone. **Never with real participants** — an
accidental infinite loop or `new int[999999999]` is enough to take the host
down, and reading `.env` would expose your database credentials.

## ⚠️ Gotcha 2 — mismatched Java versions

If code compiles but refuses to run:

```
java.lang.UnsupportedClassVersionError: ... class file version 69.0,
this version of the Java Runtime only recognizes class file versions up to 52.0
```

The compiler and runtime are different Java versions. Check:

```bash
javac -version    # e.g. javac 25.0.1
java -version     # e.g. java version "1.8.0_251"
```

The service detects this and compiles down to match the runtime, logging:

> Java toolchain mismatch: javac is 25 but java is 8. Compiling with `--release 8`…

That keeps things working but pins everything to the older Java. To fix
properly, set `JAVA_HOME` to one JDK and put its `bin` ahead of the others on
`PATH`. **Or just start Docker** — the container carries a matched pair and the
problem disappears.

## Verifying it works

```bash
curl http://localhost:8000/health
# {"status":"healthy","service":"pair-programming-ml"}

curl -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}'
```

ML service sanity check — five scenarios through the real serve path:

```bash
cd ml-service && python dev_tools/test_model.py
```

Expect `5/5 scenarios matched`. If no model is loaded you'll see
`rule_fallback_v1` and a warning; the service still runs, using rule-based
predictions.

## Running a pair session locally

You need **two identities**. Use two browser profiles or one normal and one
private window — the same browser signed in twice will share storage and
behave as one student.

1. Sign in as student A, create a session, note the join code
2. Sign in as student B in the other profile, join with the code
3. Both land in the shared editor

To see role-targeted interventions, keep **both windows visible** — some nudges
deliberately reach only one student.
