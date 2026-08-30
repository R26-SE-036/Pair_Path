# Deployment

Running PairPath outside a development machine.

> **Status:** not yet deployed. This records what is containerised, what isn't,
> and what must be true before real students use it.

## Blocking prerequisites

Two things must hold before any deployment serving real participants. Both come
from the project's own ethical commitments.

**Sandboxed execution must be active.** Docker must be running on the host and
`CODE_RUNNER_ALLOW_UNSANDBOXED` must be **unset**. With that flag set, student
code executes directly on the host with the API's permissions — including read
access to `.env` and its database credentials.

**Ethical clearance must be in place** before collecting data from students.
Allow weeks; it gates everything downstream and needs no code.

## What is containerised

| Service | Container | Notes |
|---|---|---|
| `ml-service` | ✅ [`Dockerfile`](../ml-service/Dockerfile) | Python 3.12-slim, pinned deps |
| `api` | ❌ | Runs via Node directly |
| `frontend` | ❌ | Standard Next.js build |

```bash
cd ml-service
docker build -t pairpath-ml .
docker run -p 8000:8000 pairpath-ml
```

Note the API also **shells out to Docker** for code execution, so wherever it
runs needs a reachable Docker daemon. Containerising the API therefore means
either mounting the Docker socket or running a separate execution service —
worth deciding deliberately rather than discovering late.

## Building the others

```bash
cd api && npm ci && npm run build && npm run start:prod   # → dist/main
cd frontend && npm ci && npm run build && npm start
```

## Environment

Set these for real deployment; defaults are development-only.

**API — required**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | **Change it.** The default is a literal placeholder |
| `FRONTEND_URL` | Exact origin — CORS allows one, no wildcard |
| `ML_SERVICE_URL` | Internal address; must not be publicly routable |

**API — optional**

`PORT`, `MONGODB_URI`, `REDIS_URL`, `CODE_RUNNER_IMAGE`, `CODE_RUNNER_MEMORY`,
`CODE_RUNNER_CPUS`, `CODE_RUNNER_PIDS`

**ML service:** `ML_WINDOW_SECONDS` (180), `ML_CONFIDENCE_THRESHOLD` (0.6)

**Frontend:** `NEXT_PUBLIC_ML_SERVICE_URL` — only the sandbox page uses it, and
it is exposed to the browser, so it must not point anywhere sensitive.

## Datastores

| Store | Required | If unavailable |
|---|---|---|
| PostgreSQL | **Yes** | API won't function |
| MongoDB | No | Analytics logging skipped silently |
| Redis | No | Cooldowns fall back to in-memory |

The in-memory cooldown fallback is per-process. Behind more than one API
instance, students could receive duplicate interventions — **run Redis if you
run more than one instance.**

Migrations:

```bash
cd api && npx prisma migrate deploy
```

## Networking

Only two services should be publicly reachable:

```
              ┌──────────┐
   internet ──┤ frontend │ :3000
              └────┬─────┘
                   │
              ┌────▼─────┐
   internet ──┤   api    │ :3001   (REST + Socket.IO)
              └────┬─────┘
                   │ private
              ┌────▼──────────┐
              │  ml-service   │ :8000
              └───────────────┘
```

**The ML service must stay private.** It has no authentication and permissive
CORS by design, on the assumption the API sits in front of it.

Socket.IO needs WebSocket upgrades passed through — a proxy that buffers or
strips them will silently downgrade to polling, and real-time collaboration
will feel broken rather than fail loudly.

## Deploying a model

`ml-service/models/` holds the trained artefacts. Without them the service
still runs, answering from rule-based fallbacks and reporting
`modelVersion: "rule_fallback_v1"`.

Check what is actually serving:

```bash
curl -X POST http://ml-service:8000/predict-pair-state \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"x","features":{}}' | jq .modelVersion
```

A `demo_simulated_*` version means the model was trained on generated data.
**Do not run a study against one** — it is a pipeline demonstration.

## Before going live

- [ ] Docker running; unsandboxed override **unset**
- [ ] Ethical clearance obtained
- [ ] `JWT_SECRET` changed from the default
- [ ] `FRONTEND_URL` set to the real origin
- [ ] ML service not publicly routable
- [ ] Redis running if more than one API instance
- [ ] Migrations applied
- [ ] `modelVersion` is **not** `demo_simulated_*` or `rule_fallback_v1`
- [ ] `/health` responding
- [ ] One full pair session run end to end on the deployed stack
