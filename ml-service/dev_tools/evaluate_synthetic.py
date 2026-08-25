"""Reproducible evaluation of the PairPath classifier on a SYNTHETIC corpus.

SCOPE OF THE CLAIM (read before quoting any number):
    This measures whether the pipeline can recover generator-planted
    collaboration states from window features. The labels are correct by
    construction *with respect to the generator's definition of each state*,
    not with respect to verified human behaviour. These numbers therefore
    characterise the feature space and the pipeline — they are NOT an
    estimate of real-world accuracy on student pairs.

Protocol:
    1. Generate N sessions per state (fixed seed).
    2. Extract sliding windows with the production feature extractor.
    3. Split by SESSION into train / validation / test (no window from a
       test session appears anywhere in training or tuning).
    4. Grid-search hyperparameters, selecting on VALIDATION macro-F1.
    5. Refit the winning configuration on train+validation.
    6. Touch the test set ONCE: per-class P/R/F1, accuracy, confusion.
    7. Compare against the deployed rule-based baseline on the same test set.
    8. Benchmark end-to-end inference latency.

Usage:
    python evaluate_synthetic.py                    # defaults used in the paper
    python evaluate_synthetic.py --per-state 40 --seed 20260824
"""

import argparse
import itertools
import json
import os
import sys
import time
from collections import Counter

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (accuracy_score, classification_report,
                             confusion_matrix, f1_score)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_sample_weight

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.features import FEATURE_COLUMNS, WindowFeatureExtractor  # noqa: E402
from app.features.extractor import _to_epoch_seconds  # noqa: E402
from app.models.predictor import PairStatePredictor  # noqa: E402
from generate_demo_sessions import STATES, gen_session, SESSION_SECONDS  # noqa: E402

WINDOW_SECONDS = 180
STRIDE_SECONDS = 30
MIN_EVENTS = 3

# Session-clock features. They rise monotonically through a session, so every
# window is unique on them — including them in the duplicate test would silently
# disable dedupe and change the corpus. Duplicates are therefore defined by
# identical *behaviour*, independent of which features the model consumes.
CLOCK_COLUMNS = ["seconds_since_role_switch", "session_elapsed_seconds"]
DEDUPE_COLUMNS = [c for c in FEATURE_COLUMNS if c not in CLOCK_COLUMNS]


def build_corpus(per_state, seed):
    """Generate sessions and slice them into labelled feature windows."""
    import random
    rng = random.Random(seed)
    extractor = WindowFeatureExtractor(window_seconds=WINDOW_SECONDS)

    rows = []
    base_t = 1_780_000_000.0
    for state in STATES:
        for i in range(per_state):
            session_id = f"{state.lower()}_{i:03d}"
            events = gen_session(session_id, state, base_t, rng)
            base_t += SESSION_SECONDS + 3600

            stamped = sorted(
                ((_to_epoch_seconds(e["timestamp"]), e) for e in events),
                key=lambda p: p[0],
            )
            roles = {"U1": "DRIVER", "U2": "NAVIGATOR"}
            last_switch = None
            t = stamped[0][0] + WINDOW_SECONDS
            while t <= stamped[-1][0] + STRIDE_SECONDS:
                win = [e for ts, e in stamped if t - WINDOW_SECONDS < ts <= t]
                cur_roles = dict(roles)
                for ts, e in stamped:
                    if ts <= t and e["eventType"] == "ROLE_SWITCH":
                        last_switch = ts if last_switch is None else max(last_switch, ts)
                        nr = json.loads(e["metadata"]).get("newRoles")
                        if isinstance(nr, dict):
                            cur_roles = dict(nr)
                if len(win) >= MIN_EVENTS:
                    feats = extractor.extract(
                        win, roles=cur_roles, window_end=t,
                        last_role_switch_at=last_switch,
                        session_start_at=stamped[0][0],
                    )
                    rows.append({"session_id": session_id, "label": state, **feats})
                t += STRIDE_SECONDS
    return pd.DataFrame(rows)


def three_way_split(df, seed):
    """Session-level train / validation / test (60 / 20 / 20)."""
    groups = df["session_id"].to_numpy()
    idx = np.arange(len(df))

    s1 = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=seed)
    devi, testi = next(s1.split(idx, groups=groups))

    dev_groups = groups[devi]
    s2 = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=seed)  # 0.25*0.8 = 0.20
    tri, vai = next(s2.split(devi, groups=dev_groups))
    traini, vali = devi[tri], devi[vai]

    # Hard guarantee: no session appears in more than one partition.
    for a, b in itertools.combinations([traini, vali, testi], 2):
        assert not (set(groups[a]) & set(groups[b])), "session leaked across splits"
    return traini, vali, testi


def rule_baseline_predict(df):
    """The deployed rule-based fallback, evaluated on the same rows."""
    predictor = PairStatePredictor.__new__(PairStatePredictor)  # skip model loading
    return np.array([
        predictor._fallback_prediction(row._asdict())["state"]
        for row in df[FEATURE_COLUMNS].itertuples(index=False)
    ])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-state", type=int, default=40)
    ap.add_argument("--seed", type=int, default=20260824)
    ap.add_argument("--without-clock", action="store_true",
                    help="Ablation: withhold the session-clock features from the "
                         "model. Corpus and splits are identical either way, so "
                         "this isolates their contribution.")
    args = ap.parse_args()

    active_features = ([c for c in FEATURE_COLUMNS if c not in CLOCK_COLUMNS]
                       if args.without_clock else FEATURE_COLUMNS)

    print("=" * 74)
    print("  SYNTHETIC-CORPUS EVALUATION — measures generator separability,")
    print("  NOT real-world accuracy on student pairs.")
    print("=" * 74)

    df = build_corpus(args.per_state, args.seed)
    before = len(df)
    df = df.drop_duplicates(subset=["session_id", *DEDUPE_COLUMNS], keep="first")
    print(f"\nCorpus: {df['session_id'].nunique()} sessions, {len(df)} windows "
          f"({before - len(df)} within-session duplicates dropped)")
    print("Windows per state:", dict(Counter(df["label"]).most_common()))
    print(f"Model features: {len(active_features)}"
          + ("  [ABLATION: session-clock features withheld]" if args.without_clock else ""))

    X = df[active_features].to_numpy()
    enc = LabelEncoder()
    y = enc.fit_transform(df["label"])

    traini, vali, testi = three_way_split(df, args.seed)
    for name, ix in [("train", traini), ("validation", vali), ("test", testi)]:
        print(f"  {name:<11} {df.iloc[ix]['session_id'].nunique():>3} sessions, {len(ix):>4} windows")

    # ---------- hyperparameter search, selected on VALIDATION ----------
    grid = {
        "max_depth": [3, 4, 6],
        "learning_rate": [0.05, 0.1, 0.2],
        "n_estimators": [100, 200, 400],
        "subsample": [0.8, 1.0],
        "colsample_bytree": [0.8, 1.0],
    }
    combos = [dict(zip(grid, v)) for v in itertools.product(*grid.values())]
    print(f"\nGrid search: {len(combos)} configurations, selected on validation macro-F1")

    w_train = compute_sample_weight("balanced", y[traini])
    best = (-1.0, None)
    for params in combos:
        m = xgb.XGBClassifier(objective="multi:softprob", num_class=len(enc.classes_),
                              eval_metric="mlogloss", random_state=args.seed, **params)
        m.fit(X[traini], y[traini], sample_weight=w_train)
        score = f1_score(y[vali], m.predict(X[vali]), average="macro")
        if score > best[0]:
            best = (score, params)
    val_f1, best_params = best
    print(f"Best validation macro-F1: {val_f1:.4f}")
    print(f"Best configuration: {best_params}")

    # ---------- refit on train+validation, evaluate ONCE on test ----------
    devi = np.concatenate([traini, vali])
    w_dev = compute_sample_weight("balanced", y[devi])
    final = xgb.XGBClassifier(objective="multi:softprob", num_class=len(enc.classes_),
                              eval_metric="mlogloss", random_state=args.seed, **best_params)
    final.fit(X[devi], y[devi], sample_weight=w_dev)

    y_true = enc.inverse_transform(y[testi])
    y_pred = enc.inverse_transform(final.predict(X[testi]))

    print("\n" + "=" * 74)
    print("  HELD-OUT TEST RESULTS (test sessions never used in training/tuning)")
    print("=" * 74)
    rep = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
    print(f"\n{'State':<20}{'Precision':>10}{'Recall':>9}{'F1':>8}{'Support':>9}")
    for s in STATES:
        if s in rep:
            r = rep[s]
            print(f"{s:<20}{r['precision']:>10.3f}{r['recall']:>9.3f}"
                  f"{r['f1-score']:>8.3f}{int(r['support']):>9}")
    acc = accuracy_score(y_true, y_pred)
    print(f"\n{'Overall accuracy':<20}{acc:>10.3f}")
    print(f"{'Macro F1':<20}{rep['macro avg']['f1-score']:>10.3f}")
    print(f"{'Weighted F1':<20}{rep['weighted avg']['f1-score']:>10.3f}")

    labels_sorted = sorted(set(y_true) | set(y_pred))
    cm = confusion_matrix(y_true, y_pred, labels=labels_sorted)
    print("\nConfusion matrix (rows = true, cols = predicted):")
    print(f"{'':<20}" + "".join(f"{s[:9]:>11}" for s in labels_sorted))
    for i, s in enumerate(labels_sorted):
        print(f"{s:<20}" + "".join(f"{v:>11}" for v in cm[i]))

    off = [(labels_sorted[i], labels_sorted[j], int(cm[i][j]))
           for i in range(len(labels_sorted)) for j in range(len(labels_sorted))
           if i != j and cm[i][j] > 0]
    off.sort(key=lambda t: -t[2])
    print("\nLargest confusions:")
    for a, b, n in off[:5]:
        print(f"  {a} misread as {b}: {n} windows")

    # ---------- rule-based baseline on the same held-out test set ----------
    base_pred = rule_baseline_predict(df.iloc[testi])
    base_acc = accuracy_score(y_true, base_pred)
    base_f1 = f1_score(y_true, base_pred, average="macro", zero_division=0)
    print("\n" + "-" * 74)
    print(f"Rule-based baseline on same test set: accuracy {base_acc:.3f}, macro-F1 {base_f1:.3f}")
    print(f"XGBoost classifier:                   accuracy {acc:.3f}, "
          f"macro-F1 {rep['macro avg']['f1-score']:.3f}")
    print(f"Improvement: {acc - base_acc:+.3f} accuracy, "
          f"{rep['macro avg']['f1-score'] - base_f1:+.3f} macro-F1")

    # ---------- latency (valid for real deployment) ----------
    extractor = WindowFeatureExtractor(window_seconds=WINDOW_SECONDS)
    import random
    rng = random.Random(args.seed)
    sample_events = gen_session("lat", "PRODUCTIVE", 1_780_000_000.0, rng)
    ev = [e for e in sample_events
          if _to_epoch_seconds(e["timestamp"]) > 1_780_000_000.0 + SESSION_SECONDS - WINDOW_SECONDS]
    times = []
    for _ in range(200):
        t0 = time.perf_counter()
        f = extractor.extract(ev, roles={"U1": "DRIVER", "U2": "NAVIGATOR"})
        final.predict_proba(np.array([[f[c] for c in FEATURE_COLUMNS]]))
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    print(f"\nInference latency (extraction + prediction, {len(ev)} events/window, n=200):")
    print(f"  mean {np.mean(times):.2f} ms | median {times[len(times)//2]:.2f} ms "
          f"| p95 {times[int(len(times)*0.95)]:.2f} ms")

    print("\n" + "=" * 74)
    print("  REMINDER: synthetic corpus. Report as pipeline validation only.")
    print("=" * 74)


if __name__ == "__main__":
    main()
