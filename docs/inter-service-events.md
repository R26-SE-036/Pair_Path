# Inter-Service Events

Two contracts: **Socket.IO** between browser and API, and **HTTP** between API
and ML service.

## Socket.IO

Connect to the API (`http://localhost:3001`) with the JWT in the handshake:

```js
const socket = io('http://localhost:3001', { auth: { token } })
```

The handshake is verified. An invalid or missing token gets an `auth_error`
and the socket is disconnected immediately.

### Two rules that apply to every message

**Identity comes from the token, never the payload.** Handlers read the
verified `userId` from the socket. A `userId` in the message body is ignored —
you cannot act as another student by changing it.

**Membership is checked.** Every handler verifies the socket has joined that
session's room, and joining requires database membership.

### Client → server

| Event | Payload | Effect |
|---|---|---|
| `join_room` | `{ sessionId }` | Verifies membership, joins the room, logs `JOIN` |
| `watch_session` | `{ sessionId }` | Joins the room **without logging an event** — for post-session views |
| `code_change` | `{ sessionId, code }` | Broadcasts to the partner, logs `CODE_EDIT` |
| `role_switch` | `{ sessionId }` | Swaps roles for both, logs `ROLE_SWITCH` |
| `discussion_note` | `{ sessionId, note, userName? }` | Broadcasts, logs `DISCUSSION_NOTE` |
| `run_code` | `{ sessionId, code }` | Executes, logs `CODE_RUN` and `CODE_RUN_RESULT` |
| `intervention_response` | `{ sessionId, interventionId, accepted }` | Records the response |
| `end_session` | `{ sessionId }` | Tells everyone to move to review |

**Why `watch_session` exists separately:** the results page needs the room to
receive `review_submitted`, but a viewer opening results is not session
activity. Reusing `join_room` would write `JOIN` events after the session
ended, corrupting the behavioural record the model learns from.

### Server → client

| Event | Payload | Meaning |
|---|---|---|
| `auth_error` | `{ message }` | Rejected — bad token or not a member |
| `room_state` | `{ members }` | Current membership after a join |
| `user_joined` / `user_left` | `{ userId }` | Presence |
| `code_update` | `{ code, userId }` | The partner edited |
| `role_switch` | `{ roles }` | New role map, keyed by userId |
| `code_result` | `{ success, stdout, stderr, compileError }` | Execution finished |
| `discussion_note` | `{ note, userId, userName, timestamp }` | A chat message |
| `intervention` | `{ id, state, action, delivery }` | A nudge — **see audience below** |
| `rag_hint` | `{ conceptReminder, exampleIdea, reflectiveQuestion, ... }` | Accompanies logic struggle |
| `review_submitted` | `{ userId }` | Someone submitted; refetch results |
| `session_ended` | `{ sessionId }` | Move to review |

### The intervention payload

```json
{
  "id": "clx...",
  "state": "DRIVER_DOMINANCE",
  "action": "ROLE_SWITCH_SUPPORT",
  "delivery": {
    "type": "combined",
    "uiTarget": "role_switch_button",
    "uiEffect": "glow",
    "message": "You have been in the same roles for a while...",
    "audience": "pair"
  }
}
```

`delivery` carries **where to draw attention and what effect to use — never
solution content**. Pedagogical safety is enforced by the shape of this
contract, not by discipline when writing messages.

| Field | Values |
|---|---|
| `uiTarget` | `role_switch_button`, `chat_input`, `hint_panel`, `discussion_panel`, `toast`, `none` |
| `uiEffect` | `glow`, `pulse`, `highlight`, `toast`, `none` |
| `audience` | `pair` (default), `navigator`, `driver` |
| `autoDismissMs` | Present on self-dismissing deliveries |

### Not every intervention reaches both students

`audience` decides. Most are `pair` and broadcast to the room. The
passive-navigator prompt is `navigator` and is sent **only to whoever currently
holds that role**.

The reason is pedagogical: a quiet student is often quiet because they're
unsure, and telling them to speak up in front of their partner makes that
worse. It matters more when the model is wrong — that prediction is right about
nine times in ten, so broadcasting would occasionally accuse a student who
*had* been contributing.

Two consequences:

- Targeting follows the **current** role, so it survives a mid-session swap
- If the targeted student is disconnected, the intervention **doesn't fire at
  all** rather than firing into the void and burning the cooldown

### State → intervention

| State | Action | Target / effect | Audience |
|---|---|---|---|
| `PRODUCTIVE` | `POSITIVE_REINFORCEMENT` | toast, auto-dismiss 4s | pair |
| `DRIVER_DOMINANCE` | `ROLE_SWITCH_SUPPORT` | role-switch button, glow | pair |
| `PASSIVE_NAVIGATOR` | `NAVIGATOR_PARTICIPATION_SUPPORT` | chat input, pulse | **navigator** |
| `LOGIC_STRUGGLE` | `LOGIC_SUPPORT` + hint | hint panel, highlight | pair |
| `DISENGAGED` | `RE_ENGAGEMENT_SUPPORT` | discussion panel, glow | pair |

Defined in [`ml-service/app/label_mapping.py`](../ml-service/app/label_mapping.py)
— the single source of truth. Do not duplicate this table in code.

## API → ML service (HTTP)

Base URL from `ML_SERVICE_URL` (default `http://localhost:8000`). Every call
has a fallback: if the ML service is unreachable the API degrades rather than
failing the session.

### `POST /predict-pair-state`

```json
{
  "sessionId": "clx...",
  "events": [ { "timestamp": "...", "userId": "...", "eventType": "CODE_EDIT", "metadata": "{}" } ],
  "roles": { "u1": "DRIVER", "u2": "NAVIGATOR" },
  "lastRoleSwitchAt": 1780000000,
  "sessionStartAt": 1779999000
}
```

```json
{
  "sessionId": "clx...",
  "predictedState": "LOGIC_STRUGGLE",
  "confidence": 0.94,
  "modelVersion": "demo_simulated_20260825_2003_2a57adcc",
  "features": { "total_edit_count": 13.0, "...": 0.0 }
}
```

The response **echoes the features used**, so the caller can log the exact
vector a prediction was made on — that record is what later gets hand-labelled.

`sessionStartAt` matters more than it looks. Without it, a pair three minutes
in and a pair twenty minutes in, neither having rotated, are indistinguishable
— and productive pairs get misread as driver-dominant.

A legacy form accepting pre-computed `features` still works, for the sandbox
and tests.

**Fallback on failure:** `PRODUCTIVE` at 0.5, `modelVersion: "fallback_v1"`.

### `POST /recommend-intervention`

```json
{ "sessionId": "...", "predictedState": "DRIVER_DOMINANCE", "confidence": 0.87 }
```

Returns `{ state, action, delivery }`. Below `ML_CONFIDENCE_THRESHOLD` (0.6) it
returns `NO_ACTION`. Unrecognised states also return `NO_ACTION` — never a
default nudge.

**Fallback on failure:** `NO_ACTION`.

### `POST /retrieve-hint` (alias `/rag/hint`)

```json
{
  "sessionId": "...",
  "predictedState": "LOGIC_STRUGGLE",
  "interventionType": "LOGIC_HINT",
  "questionConceptTags": ["arrays", "loops"],
  "recentErrorContext": "",
  "recentCodeSnippet": ""
}
```

```json
{
  "interventionType": "LOGIC_HINT",
  "retrievedConcepts": ["arrays"],
  "conceptReminder": "...",
  "exampleIdea": "...",
  "reflectiveQuestion": "...",
  "sourceChunks": ["java_arrays.txt"],
  "fallbackUsed": false
}
```

Called only for `LOGIC_STRUGGLE`, and only after an intervention passes the
gates. Retrieval is keyword-based over a curated corpus — a deliberate
guarantee that no corpus document contains an exercise solution, not a
placeholder for embeddings.

**Fallback on failure:** a generic hint with `fallbackUsed: true`.

### `GET /health`

```json
{ "status": "healthy", "service": "pair-programming-ml" }
```

Liveness only — it does not report whether a trained model is loaded. For that,
read `modelVersion` from a prediction.
