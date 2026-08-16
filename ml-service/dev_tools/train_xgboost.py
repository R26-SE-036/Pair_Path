"""Train the pair-state XGBoost classifier — corrected pipeline.

Fixes applied relative to the audited version:
  L1: refuses to run on data without a human `label_source` column marked
      'human' (no model predictions or generator targets as labels).
  L2: session-level split (GroupShuffleSplit) + grouped k-fold CV — no
      window from a test session ever appears in training.
  L3: within-session exact-duplicate rows dropped; class imbalance handled
      with sample weights, never row replication.
  L4: metrics + a model card are persisted alongside the artifacts.
  L7: only the five study states are accepted; anything else aborts.

Usage:
  python train_xgboost.py --data ../data/extracted/labeled_windows.csv
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_sample_weight

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.features import FEATURE_COLUMNS  # noqa: E402
from app.label_mapping import PAIR_STATES  # noqa: E402

NON_FEATURE_COLS = {"session_id", "window_start", "window_end", "label", "label_source", "rater"}


def load_dataset(path: str, demo_synthetic: bool = False) -> pd.DataFrame:
    df = pd.read_csv(path)

    required = {"session_id", "label"}
    missing = required - set(df.columns)
    if missing:
        sys.exit(f"[ABORT] Dataset missing required columns: {missing}")

    # L1: labels must be human-sourced.
    if "label_source" not in df.columns:
        sys.exit(
            "[ABORT] Dataset has no `label_source` column. Only human-annotated data "
            "may be used for training (L1). Use dev_tools/label_windows.py to produce it."
        )
    sources = set(df["label_source"].unique())
    if demo_synthetic:
        # Explicit demo path: synthetic-ONLY. Mixing synthetic rows into a
        # human dataset is never allowed — that's silent blending.
        if sources != {"synthetic"}:
            sys.exit(
                f"[ABORT] --demo-synthetic expects label_source == 'synthetic' for every "
                f"row, found {sources}. Human and synthetic data must never be mixed."
            )
        print("=" * 70)
        print("  DEMO MODE: training on SYNTHETIC data (pipeline demonstration).")
        print("  The resulting model card and every API response will be stamped")
        print("  demo_synthetic. Metrics describe the generator, NOT students —")
        print("  never report them as model performance (L1/L4).")
        print("=" * 70)
    elif sources != {"human"}:
        sys.exit(
            f"[ABORT] Found label_source values {sources - {'human'}} "
            "(model predictions or generator targets are not ground truth — L1). "
            "For a pipeline demo on synthetic data, pass --demo-synthetic explicitly."
        )

    # L7: five states only.
    bad_states = set(df["label"].unique()) - set(PAIR_STATES)
    if bad_states:
        sys.exit(
            f"[ABORT] Dataset contains states outside the study taxonomy: {bad_states} "
            "(L7: LOW_QUALITY_REVIEW and others are deferred future work)."
        )

    # L3: within-session exact-duplicate feature rows are dropped;
    # identical vectors from different sessions are kept (independent
    # observations of a discrete feature space).
    feature_cols = [c for c in df.columns if c not in NON_FEATURE_COLS]
    before = len(df)
    df = df.drop_duplicates(subset=["session_id", *feature_cols], keep="first")
    dropped = before - len(df)
    if dropped:
        print(f"[INFO] L3 dedupe: dropped {dropped} within-session duplicate rows")

    return df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="Labeled windows CSV (from build_windows.py + label_windows.py)")
    parser.add_argument("--test-size", type=float, default=0.2, help="Fraction of SESSIONS held out for test")
    parser.add_argument("--cv-folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--demo-synthetic",
        action="store_true",
        help="Explicitly accept an all-synthetic dataset for a PIPELINE DEMO. "
             "The model is stamped demo_synthetic everywhere; its metrics are "
             "not performance claims.",
    )
    args = parser.parse_args()

    df = load_dataset(args.data, demo_synthetic=args.demo_synthetic)

    feature_cols = [c for c in FEATURE_COLUMNS if c in df.columns]
    missing_feats = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing_feats:
        print(f"[WARN] Features missing from dataset (will not be used): {missing_feats}")

    X = df[feature_cols].fillna(0).to_numpy()
    groups = df["session_id"].to_numpy()
    encoder = LabelEncoder()
    y = encoder.fit_transform(df["label"])

    n_sessions = df["session_id"].nunique()
    print(f"[INFO] {len(df)} windows from {n_sessions} sessions, {len(feature_cols)} features")
    print(f"[INFO] Classes: {list(encoder.classes_)}")
    for cls in encoder.classes_:
        n = int((df["label"] == cls).sum())
        print(f"   {cls}: {n} ({n / len(df) * 100:.1f}%)")

    if n_sessions < 5:
        print(
            "[WARN] Fewer than 5 sessions — a grouped split is barely meaningful. "
            "Results will be reported but treat them as smoke-test numbers only."
        )

    # L2: held-out test = whole sessions.
    splitter = GroupShuffleSplit(n_splits=1, test_size=args.test_size, random_state=args.seed)
    trainval_idx, test_idx = next(splitter.split(X, y, groups))
    X_tv, y_tv, g_tv = X[trainval_idx], y[trainval_idx], groups[trainval_idx]
    X_test, y_test = X[test_idx], y[test_idx]
    test_sessions = sorted(set(groups[test_idx]))
    assert not (set(g_tv) & set(test_sessions)), "session leakage between train and test"

    def make_model():
        return xgb.XGBClassifier(
            objective="multi:softprob",
            num_class=len(encoder.classes_),
            max_depth=4,
            learning_rate=0.1,
            n_estimators=200,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=args.seed,
            eval_metric="mlogloss",
        )

    # Grouped CV on train/val for an honest tuning signal (macro-F1).
    n_folds = min(args.cv_folds, len(set(g_tv)))
    cv_scores = []
    if n_folds >= 2:
        gkf = GroupKFold(n_splits=n_folds)
        for fold, (tr, va) in enumerate(gkf.split(X_tv, y_tv, g_tv)):
            m = make_model()
            w = compute_sample_weight("balanced", y_tv[tr])
            m.fit(X_tv[tr], y_tv[tr], sample_weight=w)
            pred = m.predict(X_tv[va])
            score = f1_score(y_tv[va], pred, average="macro")
            cv_scores.append(score)
            print(f"[CV] fold {fold + 1}/{n_folds} macro-F1 = {score:.4f}")
        print(f"[CV] mean macro-F1 = {np.mean(cv_scores):.4f} (± {np.std(cv_scores):.4f})")

    # Final model on all train/val, evaluated once on held-out sessions.
    model = make_model()
    weights = compute_sample_weight("balanced", y_tv)  # L3: weights, not replication
    model.fit(X_tv, y_tv, sample_weight=weights)

    y_pred = model.predict(X_test)
    test_macro_f1 = f1_score(y_test, y_pred, average="macro")
    report = classification_report(
        encoder.inverse_transform(y_test),
        encoder.inverse_transform(y_pred),
        output_dict=True,
        zero_division=0,
    )
    print(f"\n[TEST] held-out sessions: {test_sessions}")
    print(f"[TEST] macro-F1 = {test_macro_f1:.4f}")
    print(classification_report(
        encoder.inverse_transform(y_test),
        encoder.inverse_transform(y_pred),
        zero_division=0,
    ))
    print("[TEST] confusion matrix (rows=true, cols=pred):")
    print(confusion_matrix(y_test, y_pred))

    # L4: persist artifacts + model card.
    models_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
    os.makedirs(models_dir, exist_ok=True)
    joblib.dump(model, os.path.join(models_dir, "pair_state_xgboost.joblib"))
    joblib.dump(encoder, os.path.join(models_dir, "pair_state_label_encoder.joblib"))
    joblib.dump(feature_cols, os.path.join(models_dir, "pair_state_feature_columns.joblib"))

    with open(args.data, "rb") as f:
        data_hash = hashlib.sha256(f.read()).hexdigest()[:16]
    prefix = "demo_synthetic" if args.demo_synthetic else "xgb"
    version = f"{prefix}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}_{data_hash[:8]}"
    card = {
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "data_provenance": (
            "SYNTHETIC_DEMO — generated by dev_tools/generate_demo_sessions.py for "
            "pipeline demonstration only. Metrics below describe the generator, not "
            "students, and are NOT valid performance claims. Replace with a "
            "human-annotated real dataset (L1) before any evaluation is reported."
            if args.demo_synthetic else "human-annotated real sessions"
        ),
        "dataset": {"path": os.path.abspath(args.data), "sha256_16": data_hash,
                    "rows": int(len(df)), "sessions": int(n_sessions)},
        "split": {"strategy": "GroupShuffleSplit by session_id", "test_size": args.test_size,
                  "test_sessions": [str(s) for s in test_sessions], "seed": args.seed},
        "cv": {"folds": n_folds, "macro_f1_mean": float(np.mean(cv_scores)) if cv_scores else None,
               "macro_f1_std": float(np.std(cv_scores)) if cv_scores else None},
        "test": {"macro_f1": float(test_macro_f1), "per_class": report},
        "classes": list(encoder.classes_),
        "features": feature_cols,
        "label_policy": "human annotation only (L1); 5-state taxonomy (L7)"
                        + (" — WAIVED for this demo model via --demo-synthetic" if args.demo_synthetic else ""),
        "imbalance_policy": "balanced sample weights, no replication (L3)",
    }
    card_path = os.path.join(models_dir, "model_card.json")
    with open(card_path, "w") as f:
        json.dump(card, f, indent=2)

    print(f"\n[SUCCESS] Saved model {version}")
    print(f"[SUCCESS] Model card: {card_path}")


if __name__ == "__main__":
    main()
