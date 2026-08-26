# PairPath ML Service

FastAPI microservice that classifies the **collaboration state** of a live
pair-programming session (not code correctness) and recommends non-invasive
UI interventions. Part of the PairPath component of Code Guru (R26-SE-036).

## Honest status

- **There is currently no trained model deployed.** The previous model was
  retired because its training data failed audit (circular labels, duplicate
  leakage, train/serve feature mismatch — see `/archive/README.md` at the
  repo root). Until a model trained on human-annotated real sessions exists,
  the service answers with a transparent **rule-based fallback**
  (`modelVersion: "rule_fallback_v1"`), which also serves as the RQ1
  baseline.
- **Retrieval is RAG-lite, not embeddings** (L14): keyword/tag scoring over
  a curated corpus in `app/data/rag_knowledge/`. This is a deliberate
  architectural guarantee — no corpus document contains the solution to any
  exercise — not a placeholder for "real" RAG. An embedding-based retriever
  is Phase 3 future work, to be evaluated as a scored comparison against
  this baseline (same output contract either way).

## The five states (L7)

`PRODUCTIVE`, `DRIVER_DOMINANCE`, `PASSIVE_NAVIGATOR`, `LOGIC_STRUGGLE`,
`DISENGAGED` — defined in `app/label_mapping.py`, which is the **single
source of truth** (L12) for states, descriptions, and intervention
mappings. `LOW_QUALITY_REVIEW` is deferred as documented future work.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /predict-pair-state` | Preferred: send raw `events` + `roles`; features are computed here by the canonical extractor. Legacy: send pre-computed `features`. Returns state, confidence, `modelVersion`, and the exact feature vector used. |
| `POST /recommend-intervention` | State → intervention action + UI delivery (target/effect/message only — never solution content). Confidence-gated (`ML_CONFIDENCE_THRESHOLD`, default 0.6, provisional pending Phase 2 calibration). |
| `POST /retrieve-hint` (alias `/rag/hint`) | RAG-lite scaffolded hint: conceptReminder / exampleIdea / reflectiveQuestion. |
| `GET /health` | Health check. |

## Feature extraction (L5)

`app/features/extractor.py` is the **only** feature implementation — the
NestJS gateway sends raw session events at inference time, and the offline
dataset builder imports the same class. 15 window-agnostic features
(edits by role, run success/failure streaks, error recovery time, idle
ratio, discussion counts, role-switch timing, activity dominance) over a
configurable window (`ML_WINDOW_SECONDS`, default 180 — to be settled by
the window-length ablation, RQ2).

## Training pipeline (dev_tools/)

Data is organised by pipeline stage:

```
data/raw_sessions/   raw session events   (events.json)
data/extracted/      feature windows      (windows.csv, labeled_windows.csv)
data/labels/         annotations          (session_labels.csv)
```

These currently hold **synthetic** data. Provenance is carried inside the
files, not in their names: every labelled row has a `label_source` column,
and the trainer aborts unless all rows are `label_source="human"` — synthetic
data trains only under an explicit `--demo-synthetic` flag, which stamps the
resulting model `demo_synthetic_*`.

```
1. Export real SessionEvent rows from Postgres  →  data/raw_sessions/events.json
2. python build_windows.py --events ../data/raw_sessions/events.json \
       --out ../data/extracted/windows.csv
3. python label_windows.py --windows ../data/extracted/windows.csv \
       --events ../data/raw_sessions/events.json --rater YOU
     (second rater on an overlap subset, then: label_windows.py --kappa A.csv B.csv)
4. Merge features + labels on (session_id, window_start)
5. python train_xgboost.py --data ../data/extracted/labeled_windows.csv
```

The trainer enforces the audit corrections and refuses to run otherwise:

- **L1** — labels must carry `label_source == "human"`; model predictions
  and generator targets are rejected as ground truth.
- **L2** — session-level `GroupShuffleSplit` + grouped k-fold CV; no window
  from a held-out session ever reaches training.
- **L3** — within-session duplicates dropped; imbalance handled with
  balanced sample weights, never row replication.
- **L4** — metrics (macro-F1, per-class report, confusion matrix) and a
  `model_card.json` (version, dataset hash, split, test sessions) are
  persisted with every trained model. `modelVersion` in API responses comes
  from the model card, never a hardcoded string.
- **L7** — five-state taxonomy enforced.

## Running

```bash
pip install -r requirements.txt   # pinned (L15)
uvicorn app.main:app --port 8000
# or containerized:
docker build -t pairpath-ml . && docker run -p 8000:8000 pairpath-ml
```

Env: `ML_WINDOW_SECONDS` (180), `ML_CONFIDENCE_THRESHOLD` (0.6).
