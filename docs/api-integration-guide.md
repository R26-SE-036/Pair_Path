# API Integration Guide

For teammates integrating with PairPath's backend. Base URL in development is
`http://localhost:3001`.

## Authentication

All endpoints except `/auth/login` and `/auth/register` require a JWT bearer
token.

```bash
curl -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@my.sliit.lk","password":"..."}'
# → { "accessToken": "eyJ...", "user": { ... } }
```

Then on every request:

```
Authorization: Bearer <accessToken>
```

Tokens last 24 hours. `POST /auth/refresh` issues a new one.

**The same token authenticates Socket.IO** — pass it in the handshake, not as a
message field. See [inter-service-events.md](inter-service-events.md).

## CORS

The API allows one origin, from `FRONTEND_URL` (default
`http://localhost:3000`), with credentials enabled. Calling from a different
origin means setting that variable — there is no wildcard.

The ML service allows all origins, because it is not intended to be public.
Don't expose it directly.

## Endpoints

### Auth

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create an account |
| `POST` | `/auth/login` | Exchange credentials for a token |
| `POST` | `/auth/refresh` | Renew a token |
| `GET` | `/auth/profile` | Current user |

### Sessions

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/sessions` | Create a session — returns `id` and `joinCode` |
| `POST` | `/sessions/join` | Join with `{ joinCode }` |
| `GET` | `/sessions/my` | Sessions for the current user |
| `GET` | `/sessions/:id` | One session, with members and question |
| `POST` | `/sessions/:id/end` | End it — accepts `{ finalCode }` |
| `GET` | `/sessions/analytics/all` | Analytics across sessions |
| `GET` | `/sessions/analytics/:id` | Analytics for one session |

Creating a session makes the creator **DRIVER** and the joiner **NAVIGATOR**.
Either can swap afterwards.

### Questions and topics

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/topics` · `/topics/:id` | Topics |
| `POST` | `/topics` | Create a topic |
| `GET` | `/questions` · `/questions/:id` | Questions |
| `GET` | `/questions/topic/:topicId` | Questions in a topic |
| `POST` | `/questions` | Create a question |

Questions carry `conceptTags`, which drive hint retrieval.

### Code execution

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/code-runner/run-java` | Compile and run Java |

```json
{ "code": "public class Main { public static void main(String[] a){ ... } }" }
```

Response:

```json
{ "success": true, "stdout": "...", "stderr": "", "compileError": null }
```

- A class declaration is required; the class name is taken from the source
- Max 10,000 characters in, 5,000 out (truncated with a marker)
- Runs in a container with no network and capped resources
- `compileError` is set for compile failures, `stderr` for runtime failures —
  never both

### Reviews

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/reviews/:sessionId` | Session with review questions |
| `POST` | `/reviews/:sessionId/submit` | Submit `{ answers: boolean[] }` |
| `GET` | `/reviews/:sessionId/result` | Scores and recommendations |

Sessions must be `COMPLETED` before submitting, and each student may submit
once.

**Submitting broadcasts `review_submitted` to the session room**, so a partner
already viewing results sees them update without refreshing.

### Interventions

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/interventions/session/:sessionId` | Interventions delivered in a session |
| `POST` | `/interventions` | Record one |
| `POST` | `/interventions/:id/respond` | Record accept/dismiss |

### ML (direct)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/ml/predict-pair-state` | Classify a window |
| `POST` | `/ml/recommend-intervention` | State → intervention |
| `POST` | `/ml/retrieve-hint` | Retrieve a scaffolded hint |

These proxy to the ML service. During a live session the gateway calls it
automatically — these exist for tooling and testing.

```json
// POST /ml/predict-pair-state
{
  "sessionId": "...",
  "events": [ { "timestamp": "...", "userId": "...", "eventType": "CODE_EDIT", "metadata": "{}" } ],
  "roles": { "userId1": "DRIVER", "userId2": "NAVIGATOR" },
  "lastRoleSwitchAt": 1780000000,
  "sessionStartAt": 1779999000
}
```

Send **raw events**, not features — the ML service extracts them with the same
code used to build training data. Timestamps are epoch seconds or ISO 8601.

### Users

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/users` · `/users/:id` | Users |
| `POST` | `/users` | Create a user |

There is no `/users/me` — use `GET /auth/profile`.

## Errors

Standard NestJS shapes:

| Status | Meaning |
|---|---|
| `400` | Validation failed, or a rule was violated (e.g. review already submitted) |
| `401` | Missing or invalid token |
| `403` | Authenticated, but not a member of that session |
| `404` | Not found |

```json
{ "statusCode": 400, "message": ["email must be an email"], "error": "Bad Request" }
```

`message` is an **array** for validation errors and a **string** otherwise.
Handle both.

## Rate limiting

A global throttler is configured. Expect `429` under sustained load.

## Notes for integrators

**Session membership is enforced everywhere.** Being authenticated is not
enough — you must be a member of the session you're acting on, over both REST
and sockets.

**The ML service is not public.** Route through the API, which handles auth and
context. Nothing in front of `ml-service` authenticates.

**Predictions may be rule-based.** When no trained model is loaded the service
answers from rules and reports `modelVersion: "rule_fallback_v1"`. Check that
field rather than assuming a model is live — and note that a `demo_simulated_*`
version means the model was trained on generated data.
