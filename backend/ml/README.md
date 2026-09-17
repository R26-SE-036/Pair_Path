# PairPath ML Service

FastAPI microservice that classifies the **collaboration state** of a live
pair-programming session (not code correctness) and recommends non-invasive
UI interventions. Part of the PairPath component of Code Guru (R26-SE-036).

## Honest status

- **The model that is served was trained entirely on generated sessions.**
  `models/model_card.json` says so itself: `data_provenance` reads
  `SIMULATED_DEMO`, and the human-annotation label policy (L1) is recorded as
  **waived** for it. Its reported macro-F1 of 0.88 describes
  `dev_tools/generate_demo_sessions.py`, not students, and is not a valid
  performance claim. Every response carries `modelVersion:
  "demo_simulated_20260830_..."` so the provenance travels with the prediction.

  This section previously said no model was deployed at all. That stopped being
  true when the demo model was trained, and a README claiming less than the
  service does is the kind of gap nobody notices until someone reports a figure
  from it.

  A model trained on human-annotated real sessions replaces this one. The
  trainer refuses to mix human and simulated rows, and simulated training
  requires an explicit `--demo-simulated` flag — see
  [`docs/ml-pipeline.md`](../../docs/ml-pipeline.md).

- **With no model file present** the service answers with a transparent
  rule-based fallback (`modelVersion: "rule_fallback_v1"`), which is also the
  RQ1 baseline the trained model is compared against.

- **Retrieval is RAG-lite, not embeddings** (L14): keyword and tag scoring over
  a hand-written corpus of **57 entries** in `app/data/rag_knowledge/`, ranked
  by concept tag, primary-topic match, error keyword and code keyword.
  Measured at 100% top-1 retrieval accuracy over the labelled cases in
  `dev_tools/evaluate_rag.py`. This is an architectural guarantee, not a
  placeholder: no corpus document contains the solution to any exercise, so the
  hint system cannot give one away. An embedding-based retriever is Phase 3
  future work, to be evaluated as a scored comparison against this baseline
  with the same output contract either way.

- **Why the previous model was withdrawn** — circular labels, train/test
  leakage, duplicate rows and a train/serve feature mismatch. All four are
  described in
  [`docs/ml-pipeline.md`](../../docs/ml-pipeline.md#why-the-archived-data-was-retired).

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

These currently hold **simulated** data. Provenance is carried inside the
files, not in their names: every labelled row has a `label_source` column,
and the trainer aborts unless all rows are `label_source="human"` — simulated
data trains only under an explicit `--demo-simulated` flag, which stamps the
resulting model `demo_simulated_*`.

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
pip install -r requirements-dev.txt   # service + dev_tools; pinned (L15)
python app/main.py                    # port 8020 locally
# or containerized:
docker build -t pairpath-ml . && docker run -p 8020:8000 pairpath-ml
```

Tests: `python -m unittest discover -s tests -t .`

Env: `ML_WINDOW_SECONDS` (180), `ML_CONFIDENCE_THRESHOLD` (0.6),
`ML_SERVICE_TOKEN` (unset; a shared secret the API sends, warned about at
startup when absent).

**Two requirements files.** `requirements.txt` is what the image installs -
only what answering a request needs. `requirements-dev.txt` adds pandas for
the offline tools and the full `xgboost` for training. The image installs
`xgboost-cpu` instead, which is the same library at the same version without
454MB of bundled CUDA that a CPU container has no use for; the split took the
image from 1.2GB to 424MB with byte-identical predictions.
