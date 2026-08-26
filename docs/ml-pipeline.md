# ML Pipeline

Raw session events → feature windows → human labels → trained model, and the
guard at each step.

## The pipeline

```
Postgres SessionEvent
        │  export
        ▼
data/raw_sessions/events.json
        │  build_windows.py          ← sliding windows, canonical extractor
        ▼
data/extracted/windows.csv
        │  label_windows.py          ← a human assigns each window a state
        ▼
data/labels/session_labels.csv
        │  merge on (session_id, window_start)
        ▼
data/extracted/labeled_windows.csv
        │  train_xgboost.py          ← guards below
        ▼
models/  +  model_card.json
```

## Commands

```bash
cd ml-service

# 1. Export SessionEvent rows from Postgres, e.g.
#    \copy (SELECT json_agg(t) FROM (
#        SELECT "sessionId","userId","eventType","metadata","timestamp"
#        FROM "SessionEvent" ORDER BY "timestamp") t) TO 'events.json'
#    → data/raw_sessions/events.json

# 2. Slice into feature windows
python dev_tools/build_windows.py \
    --events data/raw_sessions/events.json \
    --out data/extracted/windows.csv \
    --window-seconds 180 --stride 30

# 3. Annotate (resume-safe — rerun to continue)
python dev_tools/label_windows.py \
    --windows data/extracted/windows.csv \
    --events data/raw_sessions/events.json \
    --rater YOUR_NAME

# 3b. Second rater on an overlapping subset, then measure agreement
python dev_tools/label_windows.py --kappa rater_a.csv rater_b.csv

# 4. Merge features and labels on (session_id, window_start)

# 5. Train
python dev_tools/train_xgboost.py --data data/extracted/labeled_windows.csv --tune
```

## Features

Fifteen, computed over a configurable window (`ML_WINDOW_SECONDS`, default
180 s), defined in
[`app/features/extractor.py`](../ml-service/app/features/extractor.py).

| Group | Features |
|---|---|
| Activity | `total_edit_count`, `driver_edit_count`, `navigator_edit_count`, `edit_balance_ratio`, `idle_ratio`, `active_user_dominance` |
| Execution | `run_attempt_count`, `run_success_rate`, `consecutive_failure_count`, `error_recovery_seconds_avg` |
| Communication | `discussion_note_count`, `navigator_note_count` |
| Roles and time | `role_switch_count`, `seconds_since_role_switch`, `session_elapsed_seconds` |

Names are **window-agnostic** — no `_1m` or `_3m` suffixes — so the window
length can change without renaming anything.

### Two features doing heavy lifting

**`navigator_note_count`** separates driver dominance from a passive navigator.
Both look like "one person typing"; the difference is whether the *other*
student is talking.

**`seconds_since_role_switch`** separates driver dominance from a productive
pair. It is measured from session start when no rotation has happened, not
capped at the window — otherwise a pair three minutes in and one twenty minutes
in look identical. Adding this cut productive-misread-as-dominance from 21
windows to 9.

### One feature that cannot help

`edit_balance_ratio` is structurally near-constant: the navigator's editor is
read-only, so every edit comes from the driver. It's retained because a
mid-window role swap makes it briefly informative, but it carries far less than
its name suggests.

## Extraction happens in one place

`WindowFeatureExtractor` is used by **both** the live service and the offline
dataset builder. At inference the gateway sends raw events and the ML service
extracts; offline, `build_windows.py` imports the same class.

This was not always true. Two hand-written extractors — Python for training,
TypeScript in the gateway — had drifted apart, so the model was trained on
different features than it received in production. That class of bug is silent:
nothing errors, accuracy just quietly degrades.

## Training guards

`train_xgboost.py` **refuses to run** rather than repeat the audit's mistakes.

| Guard | Behaviour |
|---|---|
| **Human labels only** | Aborts unless every row is `label_source == "human"`. Model predictions and generator targets are not ground truth. |
| **Session-level split** | `GroupShuffleSplit` plus grouped k-fold. No window from a held-out session reaches training. |
| **Deduplication** | Within-session duplicates dropped; identical vectors from *different* sessions kept, being independent observations. |
| **Class imbalance** | Balanced sample weights — never row replication. |
| **Taxonomy** | Only the five study states accepted. |
| **Provenance** | Writes `model_card.json`: version, dataset path and hash, split, held-out sessions, metrics, hyperparameters and how they were chosen. |

Synthetic data trains only under an explicit `--demo-synthetic` flag, which
stamps the model `demo_synthetic_*` in the card and in every API response.
**Mixing human and synthetic rows is rejected outright** — no silent blending.

`--tune` selects hyperparameters by grouped cross-validation within
train/validation; the held-out test sessions are never seen during the search.

## Why the archived data was retired

Four defects, all in [`archive/README.md`](../archive/README.md):

1. **Circular labels** — the "ground truth" was the model's own prior
   predictions, exported from MongoDB. The model was trained to agree with
   itself.
2. **Train/test leakage** — row-level splitting put windows from the same
   session on both sides.
3. **Duplicate rows** — inflating apparent volume.
4. **Feature mismatch** — the model expected 33 features; production supplied
   8. The rest were silently zero.

Together these mean any accuracy figure from that model is meaningless. The
guards above exist so each defect is now impossible rather than merely
discouraged.

## The synthetic corpus

`generate_demo_sessions.py` produces sessions per state from a behavioural
regime — inter-edit gap, discussion frequency, navigator participation, run
cadence and success, rotation schedule — randomised per session.

It exists to **demonstrate the pipeline**, not to train a research model. The
labels are correct with respect to the generator's definition of each state,
which is a design assumption, not verified human behaviour.

One known limitation: sessions hold a single state throughout, whereas real
pairs drift between states. There are no boundary windows, which is part of why
`DISENGAGED` scores a perfect 1.000 — see [evaluation.md](evaluation.md).

## Data layout

```
data/raw_sessions/   events.json          session events
data/extracted/      windows.csv          feature windows
                     labeled_windows.csv  windows + labels, ready to train
data/labels/         session_labels.csv   annotations
```

Real and synthetic data share these folders. Provenance lives **inside** the
files — the `label_source` column — not in their names, which is what the
trainer checks.
