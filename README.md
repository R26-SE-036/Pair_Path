<div align="center">
  <h1>🚀 PairPath</h1>
  <p><strong>An AI-Powered, Adaptive Pair Programming Platform for Novice Coders</strong></p>
  
  [![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
  [![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs)](https://nestjs.com/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma-336791?logo=postgresql)](https://www.postgresql.org/)
  [![XGBoost](https://img.shields.io/badge/ML-XGBoost-orange)](https://xgboost.readthedocs.io/)
</div>

<br />

## 📖 Project Overview

**PairPath** is a collaborative learning environment designed to teach programming to novices through **structured pair programming**. It is the individual research component of the **Code Guru** capstone platform (SLIIT group **R26-SE-036**).

Traditional pair programming often fails when two novices are paired together because neither has the expertise to guide the other out of a struggle (the "blind leading the blind" problem). PairPath addresses this with a **Machine Learning-driven Adaptive Intervention System**.

The platform logs student behaviour in real time (edits by role, run success/failure streaks, discussion activity, idle time, role rotation) and uses an **XGBoost classifier** to label the pair's collaborative state. Non-productive states trigger a targeted UI nudge; a `LOGIC_STRUGGLE` additionally triggers a **retrieval-based hint engine** acting as a "Virtual Tutor," delivering scaffolded concept reminders **without ever revealing the solution**.

### 🎯 Target Audience & Goals
- **Target Audience:** First-year university students learning Java.
- **Goal:** Reinforce healthy collaborative habits (Driver/Navigator rotation, active navigation) and reduce time lost to being stuck.

---

## ⚠️ Current Project Status — Read This First

This repository is **mid-remediation** following a technical audit. Being explicit about what is and isn't validated is a deliberate part of the research contribution.

| Area | Status |
|---|---|
| Platform (editor, sessions, roles, chat, execution, review) | ✅ Working end-to-end |
| Security: socket auth, sandboxed execution | ✅ Implemented |
| ML pipeline: extraction → split → train → serve | ✅ Working, leakage-free |
| **Trained model in `models/`** | ⚠️ **Synthetic demo model only** |
| Human-annotated dataset | ❌ Not yet collected |
| Reported accuracy figures | ❌ **None valid yet** |

**The deployed model is a pipeline demonstration, not a validated classifier.** It is trained on generated sessions from `dev_tools/generate_demo_sessions.py`, and is stamped `demo_synthetic_*` in its model card and in every API response. Its scores (test macro-F1 ≈ 0.84) measure how learnable the generator's patterns are — **they are not model performance and must not be reported as such.**

The previous model and its training data were retired to `/archive` because they failed audit: labels were the model's own prior predictions (circular training), rows were duplicated across the train/test split, and the model expected 33 features while production only ever supplied 8. See [`archive/README.md`](archive/README.md) for the full evidence trail.

**A valid model requires real sessions, hand-labelled by a human.** The tooling for that is built and tested — see [Building a Real Dataset](#-building-a-real-dataset).

---

## ✨ Key Features

- **💻 Real-Time Collaborative Workspace:** Synchronized Monaco editor, live terminal output, and Socket.IO for remote pairing. The navigator's editor is read-only, structurally enforcing the Driver/Navigator split.
- **🧠 ML Behaviour Analysis:** 14 behavioural features computed over a configurable sliding window (default 180 s) to classify the pair's state.
- **🎯 Confidence-Gated Interventions:** Predictions below the confidence threshold stay silent — a mistimed interrupt has real pedagogical cost. Delivered nudges carry only *where* to draw attention and *what* effect to use, never solution content.
- **✨ Positive Reinforcement:** A `PRODUCTIVE` pair receives a brief self-dismissing encouragement toast rather than silence.
- **⏳ Intervention Cooldown:** Redis-backed per-session, per-type cooldown prevents nagging and intervention fatigue.
- **🤖 RAG-lite Virtual Tutor:** Keyword/tag scoring over a curated Java + collaboration corpus, returning a structured `conceptReminder`, `exampleIdea`, and `reflectiveQuestion`.
- **📊 Analytics & Dashboards:** Session timelines, intervention history, and performance metrics for instructor review.

### The five collaboration states

| State | Intervention | UI delivery |
|---|---|---|
| `PRODUCTIVE` | `POSITIVE_REINFORCEMENT` | encouragement toast (auto-dismiss) |
| `DRIVER_DOMINANCE` | `ROLE_SWITCH_SUPPORT` | role-switch button glows |
| `PASSIVE_NAVIGATOR` | `NAVIGATOR_PARTICIPATION_SUPPORT` | chat input pulses |
| `LOGIC_STRUGGLE` | `LOGIC_SUPPORT` + RAG hint | hint panel highlights |
| `DISENGAGED` | `RE_ENGAGEMENT_SUPPORT` | discussion panel glows |

Defined in `ml-service/app/label_mapping.py`, the **single source of truth** for states and interventions. A sixth class, `LOW_QUALITY_REVIEW`, is deferred as documented future work; unknown states resolve to silence, never to praise.

---

## 🏗️ High-Level Architecture

1. **Frontend (`/frontend`)** — **Next.js 14 (React)** with TailwindCSS, Socket.IO client, and Axios.
2. **API Backend (`/api`)** — **NestJS** handling business logic, JWT auth, sandboxed code execution, the Socket.IO gateway, and PostgreSQL via **Prisma**. Also writes an analytics trail to MongoDB and uses Redis for cooldowns.
3. **ML Service (`/ml-service`)** — **FastAPI (Python)** hosting the XGBoost classifier, the canonical feature extractor, and the RAG-lite retriever.

### Request lifecycle

```
Frontend (Socket.IO)          NestJS Gateway                      ml-service (FastAPI :8000)
────────────────────          ──────────────                      ──────────────────────────
code_change / run_code   ──>  logEvent() ─> Postgres SessionEvent
discussion_note / role_switch        │
                              triggers: every 30 events │ 60s sweep │ failed run
                                     │
                                     ├── POST /predict-pair-state ──> extract 14 features
                                     │        (raw events + roles)     XGBoost (5-class)
                                     │<── {state, confidence, features} ──
                              log to MongoDB (analytics only, never labels)
                                     │
                                     ├── POST /recommend-intervention ─> confidence gate
                                     │<── {action, delivery} ──
                              Redis cooldown check ─> Prisma Intervention
   <── emit 'intervention' ───       │
                                     │  if LOGIC_STRUGGLE:
                                     ├── POST /retrieve-hint ────────> RAG-lite retrieval
   <── emit 'rag_hint' ──────        │<── {conceptReminder, ...} ──
   ── 'intervention_response' ─>  Prisma: Intervention.accepted
```

> **Feature extraction happens in exactly one place** (`ml-service/app/features/extractor.py`). The gateway sends *raw events*; the same extractor builds training data offline. This eliminates the train/serve mismatch the audit found, where two hand-written extractors (Python and TypeScript) had drifted apart.

---

## 📂 Folder Structure

```text
PairPath/
├── README.md                    # This file
│
├── archive/                     # 🗄️ Retired invalid data & model (audit evidence)
│   ├── README.md                # Why each artefact was excluded
│   ├── invalid_data/            # Fabricated labels, mock sessions, circular-labelled export
│   ├── invalid_model/           # Model trained on the circular labels
│   └── dev_tools/               # Scripts belonging to the retired pipeline
│
├── api/                         # 🟢 NestJS Backend (Port 3001)
│   ├── .env                     # DATABASE_URL, JWT_SECRET, MONGODB_URI
│   ├── prisma/
│   │   ├── schema.prisma        # User, PairSession, SessionEvent, Intervention, RAGChunk, …
│   │   └── seeds.ts             # Topics, questions, users
│   └── src/
│       ├── main.ts              # Entry point (CORS, global validation)
│       ├── common/              # Prisma, MongoDB, Redis services
│       └── modules/
│           ├── auth/            # JWT authentication
│           ├── code-runner/     # Sandboxed Java execution
│           ├── interventions/   # Intervention tracking
│           ├── ml/              # HTTP bridge to the ML service
│           ├── questions/  topics/  users/
│           ├── reviews/         # Post-session peer review + results
│           ├── sessions/        # Session lifecycle and analytics
│           └── websocket/       # Socket.IO gateway (auth, events, ML trigger)
│
├── frontend/                    # 🔵 Next.js Client (Port 3000)
│   └── src/
│       ├── components/  hooks/  lib/  types/
│       └── app/
│           ├── login/  register/  dashboard/
│           ├── pair/[id]/            # Live collaborative workspace
│           ├── review/[id]/          # Peer review questions
│           ├── results/[id]/         # Scores (live-updates when partner submits)
│           ├── session-history/[id]/ # Past session timeline
│           ├── ml-analytics/         # Historical prediction timelines
│           └── ml-sandbox/           # Feature-slider dev console (⚠️ needs updating)
│
└── ml-service/                  # 🟣 FastAPI & ML Engine (Port 8000)
    ├── Dockerfile               # Containerised deployment
    ├── requirements.txt         # Pinned dependencies
    ├── README.md                # ML-specific documentation
    │
    ├── app/
    │   ├── main.py              # FastAPI routes
    │   ├── label_mapping.py     # ⭐ Single source of truth: states + interventions
    │   ├── features/
    │   │   └── extractor.py     # ⭐ Canonical feature extraction (train + serve)
    │   ├── models/
    │   │   ├── predictor.py     # XGBoost inference + rule-based fallback
    │   │   └── intervention_engine.py
    │   ├── rag/                 # RAG-lite: loader, retriever, hint generator
    │   ├── schemas/             # Pydantic request/response contracts
    │   └── data/rag_knowledge/  # Curated Java + collaboration corpus (9 files)
    │
    ├── data/
    │   ├── demo/                # Synthetic demo dataset (clearly flagged)
    │   ├── raw_sessions/        # ← real exported events go here
    │   ├── extracted/           # ← generated feature windows
    │   └── labels/              # ← human annotations
    │
    ├── dev_tools/
    │   ├── generate_demo_sessions.py  # Synthetic sessions (demo only)
    │   ├── build_windows.py           # Raw events → feature windows
    │   ├── label_windows.py           # Annotation CLI + Cohen's kappa
    │   ├── train_xgboost.py           # Training with audit guards
    │   ├── export_mongo_to_csv.py     # Unlabelled production feature export
    │   └── test_model.py  test_rag.py
    │
    └── models/                  # Serialized model + model_card.json
```

---

## 🚀 Getting Started

Run all three services concurrently.

### Prerequisites
| Requirement | Notes |
|---|---|
| Node.js 18+ | API and frontend |
| Python 3.10+ | ML service |
| PostgreSQL | Primary datastore (`DATABASE_URL`) |
| **Docker** | **Required** for sandboxed code execution |
| MongoDB *(optional)* | Analytics trail; degrades gracefully if absent |
| Redis *(optional)* | Cooldowns; falls back to in-memory |

### 1. API Backend (NestJS)
```bash
cd api
npm install
# Configure .env: DATABASE_URL, JWT_SECRET, MONGODB_URI
npx prisma generate
npm run start:dev
```
*Runs on `http://localhost:3001`*

### 2. ML Service (FastAPI)
```bash
cd ml-service
pip install -r requirements.txt
uvicorn app.main:app --port 8000
# or: docker build -t pairpath-ml . && docker run -p 8000:8000 pairpath-ml
```
*Runs on `http://localhost:8000`*

### 3. Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
```
*Runs on `http://localhost:3000`*

### Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `ML_SERVICE_URL` | `http://localhost:8000` | API → ML service |
| `ML_WINDOW_SECONDS` | `180` | Feature window length |
| `ML_CONFIDENCE_THRESHOLD` | `0.6` | Intervention gate (provisional) |
| `CODE_RUNNER_IMAGE` | `eclipse-temurin:17-jdk-alpine` | Execution sandbox image |
| `CODE_RUNNER_ALLOW_UNSANDBOXED` | *unset* | ⚠️ Dev-only escape hatch — **never** with real participants |
| `JAVA_HOME` | *unset* | Pins compiler + runtime to one JDK when unsandboxed |

---

## 🔒 Security & Ethics

Two fixes were required before any human-participant data collection:

- **Socket authentication** — the Socket.IO handshake verifies the JWT and rejects unauthenticated sockets. User identity is taken from the verified token, never from the message body, and every handler validates room membership against the database. Analytics endpoints are guarded.
- **Sandboxed execution** — submitted Java compiles and runs inside a container with **no network**, capped memory/CPU/process count, `no-new-privileges`, and a read-only workspace at run time. Without Docker, execution is **disabled** unless `CODE_RUNNER_ALLOW_UNSANDBOXED=true` is set explicitly for local development.

Additional commitments for the classroom study: no grading use of collaboration state, pseudonymised analysis, opt-in data reuse, and ethical clearance before recruitment.

---

## 📊 Building a Real Dataset

The pipeline is built and tested; it needs real sessions.

```bash
# 1. Export real SessionEvent rows from Postgres, e.g. via psql:
#    \copy (SELECT json_agg(t) FROM (
#        SELECT "sessionId","userId","eventType","metadata","timestamp"
#        FROM "SessionEvent" ORDER BY "timestamp") t) TO 'events.json'
#    → save to ml-service/data/raw_sessions/

cd ml-service

# 2. Slice into feature windows using the canonical extractor
python dev_tools/build_windows.py \
    --events data/raw_sessions/events.json \
    --out data/extracted/windows.csv

# 3. Annotate by hand (shows each window's event timeline; resume-safe)
python dev_tools/label_windows.py \
    --windows data/extracted/windows.csv \
    --events data/raw_sessions/events.json --rater YOUR_NAME

# 3b. Second rater on an overlapping subset, then measure agreement
python dev_tools/label_windows.py --kappa rater_a.csv rater_b.csv

# 4. Merge features + labels on (session_id, window_start)

# 5. Train
python dev_tools/train_xgboost.py --data data/training/labeled_windows.csv
```

### Guards the trainer enforces

The trainer **refuses to run** rather than silently repeat the audit's mistakes:

| Guard | Behaviour |
|---|---|
| **Human labels only** | Aborts unless every row has `label_source == "human"`. Model predictions and generator targets are not ground truth. |
| **Session-level split** | `GroupShuffleSplit` + grouped k-fold; no window from a held-out session reaches training. |
| **Deduplication** | Within-session duplicates dropped; cross-session identical vectors kept as independent observations. |
| **Class imbalance** | Balanced sample weights — never row replication. |
| **Taxonomy** | Only the five study states are accepted. |
| **Provenance** | Every run writes `model_card.json` (version, dataset hash, split, held-out sessions, metrics). `modelVersion` in API responses reads from it — never a hardcoded string. |

Synthetic data can only be trained on via an explicit `--demo-synthetic` flag, which stamps the model `demo_synthetic_*` everywhere. Mixing human and synthetic rows is rejected outright.

> **Note on Cohen's kappa:** inter-rater agreement is the honest ceiling on any accuracy you can later claim. If two trained humans agree only 75 % of the time, no model can meaningfully exceed that. Measure it before chasing a target number.

---

## 🧪 Demonstration Dashboards

Available from the homepage (`http://localhost:3000`):

- **ML Analytics (`/ml-analytics`)** — chronological timelines of past sessions, showing predictions interleaved with raw collaborative events.
- **Session History (`/session-history/[id]`)** — per-session event and intervention replay.
- **ML Sandbox (`/ml-sandbox`)** — ⚠️ **currently out of date.** Its sliders still send the retired 8-feature `_3m` schema, which the 14-feature model ignores, so every slider position returns the same prediction. Needs updating to the current feature names before use.

---

## 🗺️ Roadmap

Remaining work, in dependency order:

1. **Collect real sessions** — recruit participants; run through the live platform.
2. **Annotate** — apply the labelling rubric; second rater + Cohen's kappa.
3. **Window ablation** — settle the observation window empirically instead of assuming 180 s.
4. **Honest evaluation** — held-out real sessions, compared against the rule-based baseline; report the confusion matrix and per-class metrics, plus confidence calibration.
5. **Classroom study** — experimental vs. control (identical system with the inference path disabled).
6. **RAG upgrade** *(optional)* — evaluate embedding-based retrieval as a **scored comparison** against the RAG-lite baseline, not a silent swap.

---

## 📄 License
This project is licensed under the MIT License.
