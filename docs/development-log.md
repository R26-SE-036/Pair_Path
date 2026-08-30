# Development Log

What was built when, and why. Newest first.

---

## August 2026 — Audit correction and honest evaluation

The phase that changed what the project claims. A technical audit found the
deployed model invalid; this phase corrected the pipeline, hardened the
platform, and produced the first defensible numbers.

### Security — prerequisites for participant data

**Socket authentication.** The Socket.IO gateway had no authentication at all:
any client could connect and act as any student by putting a different `userId`
in the payload. The handshake now verifies the JWT and rejects unauthenticated
sockets, identity is taken from the verified token rather than the message body,
every handler validates room membership, and the two analytics endpoints were
guarded.

**Sandboxed execution.** Submitted Java ran directly on the API host, protected
only by a regex blocklist — trivially bypassable, and the host holds the
database credentials. Execution now happens in a container with no network,
capped memory, CPU and process count, no privilege escalation, and a read-only
workspace. Without Docker, execution is disabled unless explicitly overridden
for local development.

### ML pipeline corrections

**One feature extractor.** Training features came from a Python extractor while
live features came from a separately hand-written TypeScript function. They had
drifted. The gateway now sends raw events and the ML service extracts; the
offline dataset builder imports the same class. The TypeScript version was
deleted.

**Trainer guards.** Rewritten to refuse non-human labels, split by session, use
grouped k-fold, dedupe within sessions, weight classes rather than replicate
rows, reject states outside the taxonomy, and write a model card recording
dataset, split, metrics and how hyperparameters were chosen. Simulated data
trains only under an explicit flag that stamps the resulting model.

**Hyperparameters from data.** Previously hardcoded; a `--tune` flag now selects
them by grouped cross-validation within train/validation.

**Taxonomy correction.** Driver dominance and passive navigator had both been
specified with a near-silent navigator, making them nearly inseparable
(dominance F1 0.523). Redefined dominance as *an engaged navigator who never
receives the keyboard* — matching the intervention each triggers — which raised
macro-F1 from 0.834 to 0.879.

**Role-attribution bug.** Window building only learned who was driving after
seeing a `ROLE_SWITCH`. Driver-dominance sessions never rotate — that is their
defining trait — so for exactly those sessions every role-based feature was
silently zero. The raw logs showed the navigator writing 199 messages; the
training data recorded none. The talking-navigator signal, the thing that
separates dominance from passivity, was being discarded before the model saw
it. Fixed by inferring the initial driver from who emits the first edit, which
works because the navigator's editor is read-only.

**Longer role memory.** `seconds_since_role_switch` was capped at the window
length, so a pair three minutes in and one twenty minutes in — neither having
rotated — looked identical. Measuring from session start and adding
`session_elapsed_seconds` cut productive-misread-as-dominance from 21 windows
to 9 and lifted dominance precision from 0.49 to 0.67, verified by A/B on an
identical corpus.

### Evaluation

Built `evaluate_simulated.py`: session-level three-way split, tuning on
validation only, test touched once, compared against a rule baseline, with
latency measurement. **Accuracy 0.891, macro-F1 0.871, baseline 0.609.**
Reproducible to identical figures.

A confound was caught mid-way: adding a monotonic feature had silently disabled
duplicate removal, so an early comparison used different data on each side.
Duplicates are now defined by behaviour alone, and the comparison was re-run.

### Features

- Encouragement toast for productive pairs — reinforcement rather than
  correction only, with rotating wording so it doesn't read as canned
- Role-addressed interventions: the passive-navigator prompt reaches only the
  navigator, so a quiet student isn't called out in front of their partner.
  Verified end to end, including across a mid-session role swap
- Redis-backed intervention cooldown, finally injected into the gateway

### Fixes

- Results page didn't update when the second student submitted; now pushed over
  the socket. A separate `watch_session` handler was added so post-session
  viewers don't write `JOIN` events into the behavioural record
- Java toolchain mismatch (compiler 25, runtime 8) meant code compiled and then
  refused to run; the runner now detects it and targets the local runtime
- The ML sandbox sent a retired feature schema, so every slider position
  returned the same prediction. Same rot had broken `test_model.py`
- The rule-based fallback encoded the old dominance definition and relied on
  edit share, which can never work

### Documentation and cleanup

Rewrote the root README to match reality; created this `docs/` folder; retired
the invalid model and data to `archive/` with an explanation; removed three
duplicate Prisma clients, an unused hook and seven empty directories;
reorganised datasets by pipeline stage.

---

## July 2026 — Audit

An independent audit of the deployed model found four defects that together
mean **no accuracy figure from it was valid**:

1. **Circular labels** — MongoDB-exported rows were labelled with the model's
   own prior predictions
2. **Train/test leakage** — row-level splitting placed windows from the same
   session on both sides
3. **Duplicate rows** — inflating apparent data volume
4. **Feature mismatch** — the model expected 33 features; production supplied 8

Evidence preserved in [`archive/README.md`](../archive/README.md). Reporting
this honestly is treated as a contribution, not a footnote.

---

## May 2026 — Initial build

- FastAPI ML service with XGBoost predictor and training tools
- Socket.IO gateway for real-time collaboration, event logging, and
  intervention delivery
- Core infrastructure: Redis, MongoDB, Prisma
- RAG-lite hint generation over a curated Java corpus
- Session analytics dashboard and history retrieval
- Review submission flow

---

## Where things stand

The platform works end to end. The classifier is trained on simulated data, so
the pipeline is validated but detection accuracy on real students is unknown.

**Next:** ethics approval, then real sessions, then annotation with a second
rater, then re-run the evaluation on real data. See
[evaluation.md](evaluation.md) for the full list.
