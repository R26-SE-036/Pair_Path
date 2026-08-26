# Archive — invalid data & model artifacts

These files were removed from the active `ml-service` pipeline on 2026-08-13
because they cannot produce a scientifically valid model. They are kept here
(not deleted) as documented evidence for the methodology/limitations
discussion in the research paper, and so the audit trail isn't lost.

## Why each item is invalid

### `invalid_data/manual_window_labels.csv`
Presented (in the old README) as "expert-coded labels from real pilot
sessions." In fact every session (S001–S008) has the identical 6-label
sequence `PRODUCTIVE, PRODUCTIVE, DRIVER_DOMINANCE, PASSIVE_NAVIGATOR,
LOGIC_STRUGGLE, DISENGAGED` at exactly 1-minute intervals. This is a
template, not an annotation of real behavior — there is no evidence real
pilot sessions were ever hand-labeled.

### `invalid_data/mock_training_sessions.json`
Synthetic session event logs with labels assigned by the generator script
(`dev_tools/generate_mock_sessions.py`-style tooling), not derived from real
behavior. Useful only as illustrative/bootstrap data, never as ground truth.

### `invalid_data/pair_state_features_v1.csv`, `train_v1.csv`, `val_v1.csv`, `test_v1.csv`
Feature-extraction and train/val/test split output derived from the mock
session data above. Invalid for the same reason.

### `invalid_data/pair_state_features_mongodb.csv`
Exported from the production `ml_events` MongoDB collection, but the
`label` column was set to `prediction.predictedState` — i.e. the *model's
own prior prediction*, not an independent ground truth. Training on this
data teaches the model to reproduce its own past outputs (circular
training), not to get closer to the real collaboration state. This was the
data source for `invalid_model/`.

### `invalid_model/pair_state_xgboost.joblib` (+ label encoder, feature columns)
The model trained via `dev_tools/train_from_mongo.py` on the file above.
Invalid because its training labels were circular (see above), so its
reported accuracy reflects agreement with its own past predictions, not
correctness against real collaboration states.

### `dev_tools/add_disengaged.py`
Synthetic data augmentation script written against the mock/invalid
pipeline. Kept for reference in case the augmentation *technique* is reused
later against a real labeled dataset — the technique isn't inherently
wrong, only the data it was applied to.

### `dev_tools/train_from_mongo.py`
Trains directly on `invalid_data/pair_state_features_mongodb.csv` (the
circular-labeled export). The trainer class it wraps
(`dev_tools/train_xgboost.py`) is still valid and in active use — only this
specific invocation (pointed at circular-labeled data) was the problem.

## What changed in the active pipeline as a result

- `ml-service/models/` is now empty. `PairStatePredictor` falls back to its
  existing rule-based heuristic (`_fallback_prediction` in
  `app/models/predictor.py`) until a model trained on real, human-labeled
  data is deployed.
- `dev_tools/export_mongo_to_csv.py` was fixed to export raw feature
  vectors only (`data/extracted/pair_state_features_unlabeled.csv`, no
  `label` column) — real production feature data is still valuable, just
  not as a source of labels.
- Dead code with no data-quality implications (`app/model_loader.py`,
  `app/models/rag_retriever.py`, `app/schemas/hints.py`) was deleted
  outright rather than archived, since it was simply unused, not invalid
  evidence.

See the conversation/paper notes for the full path forward: real sessions
recorded → hand-labeled by a human (ideally 2 raters + agreement score) →
features extracted with the same code path production uses → session-level
train/val/test split → train → evaluate against held-out human-labeled
sessions.
