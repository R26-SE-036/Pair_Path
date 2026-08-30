# Architecture

Three services, each with a single responsibility.

| Service | Stack | Port | Responsibility |
|---|---|---|---|
| `frontend/` | Next.js 14, React, TailwindCSS | 3000 | Editor, chat, role controls, intervention UI |
| `api/` | NestJS, Prisma | 3001 | Auth, sessions, event logging, code execution, Socket.IO gateway |
| `ml-service/` | FastAPI, XGBoost | 8000 | Feature extraction, state classification, intervention selection, hint retrieval |

The frontend never talks to the ML service directly during a session — the API
gateway orchestrates everything. (The sandbox page is the one exception, and it
is a developer tool.)

## What happens during a session

```
Frontend (Socket.IO)          NestJS gateway                    ml-service (FastAPI)
────────────────────          ──────────────                    ────────────────────
code_change / run_code   ──>  logEvent() ─> Postgres SessionEvent
discussion_note / role_switch        │
                              triggers: every 30 events │ 60s sweep │ failed run
                                     │
                                     ├── POST /predict-pair-state ──> extract features
                                     │     (raw events + roles)        XGBoost, 5 classes
                                     │<── {state, confidence, features} ──
                              log to MongoDB (analytics only, never labels)
                                     │
                                     ├── POST /recommend-intervention ─> confidence gate
                                     │<── {action, delivery} ──
                              Redis cooldown ─> resolve audience ─> Prisma Intervention
   <── emit 'intervention' ───       │
                                     │  if LOGIC_STRUGGLE:
                                     ├── POST /retrieve-hint ────────> keyword retrieval
   <── emit 'rag_hint' ──────        │<── {conceptReminder, ...} ──
   ── 'intervention_response' ─>  Prisma: Intervention.accepted
```

### When the model is asked

Three triggers, all in `websocket.gateway.ts`:

- **Every 30 logged events** for a session
- **A 60-second sweep** across every session with members present
- **Immediately after a failed code run** — the fastest path to a prediction

### Before a nudge reaches a student

Four gates, in order:

1. **Confidence** — below `ML_CONFIDENCE_THRESHOLD` (0.6) the engine returns
   `NO_ACTION` and nothing is sent
2. **Audience** — if the intervention is addressed to one role and that student
   isn't connected, it doesn't fire at all
3. **Cooldown** — the same action type is blocked for five minutes per session
4. **Persistence** — surviving interventions are written to Postgres before
   broadcast, so the research record reflects what students actually saw

## Feature extraction lives in exactly one place

`ml-service/app/features/extractor.py` is the only implementation. The gateway
sends **raw events**; the ML service computes features. The offline dataset
builder imports the same class.

This matters because it wasn't always true. Two hand-written extractors — one
Python, one TypeScript — had drifted apart, so the model was trained on
different features than it received in production. See
[ml-pipeline.md](ml-pipeline.md).

## Datastores

| Store | Holds | If unavailable |
|---|---|---|
| **PostgreSQL** | Users, sessions, members, `SessionEvent`, interventions, reviews, questions | Fatal — the API needs it |
| **MongoDB** | Every prediction with the feature vector it used | Degrades silently; analytics only |
| **Redis** | Intervention cooldowns, presence | Falls back to in-memory |

`SessionEvent` is the source of truth for research. Everything the model
learns from is derived from it, and it is the only table that must not be
lossy.

### Why MongoDB is not training data

It stores each prediction alongside its features, which makes it tempting as a
training source. It was used that way once and the labels were the model's own
prior predictions — the model learning to agree with itself. Its legitimate
uses are drift monitoring and choosing which sessions to prioritise for human
annotation.

## Event types

Written to `SessionEvent` by the gateway:

| Event | Emitted when | Metadata |
|---|---|---|
| `JOIN` | A member joins the room | — |
| `CODE_EDIT` | The driver types | `codeLength` |
| `CODE_RUN` | Run is pressed | `codeLength` |
| `CODE_RUN_RESULT` | Execution finishes | `success`, `hasError` |
| `DISCUSSION_NOTE` | Either student sends chat | `note` |
| `ROLE_SWITCH` | Roles are swapped | `newRoles` |
| `INTERVENTION_RESPONSE` | A nudge is accepted or dismissed | `interventionId`, `accepted` |

## Two platform constraints that shape the model

**The navigator's editor is read-only.** Every `CODE_EDIT` comes from whoever
holds the driver role. Edit share therefore carries no signal — it is
structurally always one-sided — which is why driver dominance is identified by
rotation timing, not by who typed more.

**Either partner can take the driver role at any time.** The role-switch
control is not gated. Driver dominance is therefore a *shared failure to
rotate*, not one student blocking another, and the intervention is addressed to
the pair.

## Database models

`User`, `Topic`, `Question`, `PairSession`, `PairSessionMember`, `SessionEvent`,
`CodeSnapshot`, `FeatureWindow`, `PairStatePrediction`, `Intervention`,
`ReviewSubmission`, `RAGDocument`, `RAGChunk`

Full definitions in [`api/prisma/schema.prisma`](../api/prisma/schema.prisma).
`RAGChunk.embedding` is reserved for the Phase 3 embedding comparison and is
currently unused — retrieval is keyword-based.
