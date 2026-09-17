"""Print everything measurable about the deployed model, in one place.

The test suite in tests/ asserts these properties and reports pass or fail;
this prints the numbers behind them. Same artifacts, same held-out sessions —
one is a gate, the other is a readout.

Distinct from evaluate_simulated.py, which trains fresh models to ask whether
the *method* works. This scores the model file the service actually loads.

Usage:
    python dev_tools/model_report.py
    python dev_tools/model_report.py --f1             # F1 scores only
    python dev_tools/model_report.py --no-latency     # skip the timing loop
"""

import argparse
import hashlib
import json
import os
import sys
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix, f1_score, accuracy_score

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
MODELS = os.path.join(ROOT, "models")
DATA = os.path.join(ROOT, "data", "extracted", "labeled_windows.csv")

from app.features import WindowFeatureExtractor  # noqa: E402


def rule(title=""):
    print("\n" + "=" * 74)
    if title:
        print(f"  {title}")
        print("=" * 74)


def print_f1_only(model, encoder, columns, card):
    """Just the F1 scores — macro, weighted, and one per state.

    Scored on the held-out sessions the model card names, so this is the
    deployed artifact's own number rather than a training figure.
    """
    if not os.path.exists(DATA):
        sys.exit("[ABORT] training dataset not found; cannot score")
    with open(DATA, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:16]
    if digest != card["dataset"]["sha256_16"]:
        sys.exit("[ABORT] dataset changed since training — the recorded test "
                 "sessions no longer identify unseen data")

    df = pd.read_csv(DATA)
    test = df[df["session_id"].astype(str).isin(set(card["split"]["test_sessions"]))]
    X = test[columns].fillna(0).to_numpy()
    y_true = encoder.transform(test["label"])
    y_pred = model.predict(X)

    per_class = f1_score(y_true, y_pred, average=None)
    macro = f1_score(y_true, y_pred, average="macro")
    weighted = f1_score(y_true, y_pred, average="weighted")

    print(f"\nF1 SCORES — {card['version']}")
    print(f"{len(test)} held-out windows from "
          f"{len(card['split']['test_sessions'])} unseen sessions\n")

    for name, score in sorted(zip(encoder.classes_, per_class), key=lambda x: -x[1]):
        print(f"  {name:20} {score:.4f}   {score*100:5.1f}%")

    print(f"\n  {'MACRO F1':20} {macro:.4f}   {macro*100:5.1f}%")
    print(f"  {'WEIGHTED F1':20} {weighted:.4f}   {weighted*100:5.1f}%")

    if "SIMULATED" in card["data_provenance"].upper() or card["version"].startswith("demo_"):
        print("\n  Simulated corpus — pipeline validation, not real-student accuracy.")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-latency", action="store_true")
    ap.add_argument("--f1", action="store_true",
                    help="print only the F1 scores and exit")
    args = ap.parse_args()

    model = joblib.load(os.path.join(MODELS, "pair_state_xgboost.joblib"))
    encoder = joblib.load(os.path.join(MODELS, "pair_state_label_encoder.joblib"))
    columns = list(joblib.load(os.path.join(MODELS, "pair_state_feature_columns.joblib")))
    with open(os.path.join(MODELS, "model_card.json"), encoding="utf-8") as f:
        card = json.load(f)

    if args.f1:
        print_f1_only(model, encoder, columns, card)
        return

    rule("DEPLOYED MODEL")
    print(f"  version        : {card['version']}")
    print(f"  trained at     : {card['trained_at'][:19].replace('T', ' ')}")
    print(f"  algorithm      : {type(model).__name__}, {len(encoder.classes_)} classes")
    print(f"  features       : {len(columns)}")
    size_kb = os.path.getsize(os.path.join(MODELS, 'pair_state_xgboost.joblib')) / 1024
    print(f"  artifact size  : {size_kb:.0f} KB")
    print(f"  hyperparameters: {card['hyperparameters']}")
    print(f"  selected by    : {card['hyperparameter_selection']}")

    rule("TRAINING DATA")
    d = card["dataset"]
    print(f"  rows / sessions: {d['rows']} windows from {d['sessions']} sessions")
    print(f"  recorded hash  : {d['sha256_16']}")
    if os.path.exists(DATA):
        with open(DATA, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()[:16]
        print(f"  file hash      : {digest}  ->  "
              f"{'UNCHANGED' if digest == d['sha256_16'] else 'CHANGED SINCE TRAINING'}")
    else:
        digest = None
        print("  file           : not present")
    print(f"  provenance     : {card['data_provenance'][:66]}...")

    rule("CROSS-VALIDATION (train/validation only)")
    cv = card["cv"]
    print(f"  folds          : {cv['folds']} (grouped by session)")
    print(f"  macro-F1 mean  : {cv['macro_f1_mean']:.4f}")
    print(f"  macro-F1 std   : {cv['macro_f1_std']:.4f}")

    rule("HELD-OUT TEST — sessions never seen in training or tuning")
    held = card["split"]["test_sessions"]
    print(f"  held-out sessions : {len(held)}  (seed {card['split']['seed']}, "
          f"test_size {card['split']['test_size']})")

    if os.path.exists(DATA) and digest == d["sha256_16"]:
        df = pd.read_csv(DATA)
        test = df[df["session_id"].astype(str).isin(set(held))]
        X = test[columns].fillna(0).to_numpy()
        y_true = encoder.transform(test["label"])
        y_pred = model.predict(X)

        acc = accuracy_score(y_true, y_pred)
        macro = f1_score(y_true, y_pred, average="macro")
        weighted = f1_score(y_true, y_pred, average="weighted")

        print(f"  windows scored    : {len(test)}\n")
        print(classification_report(
            encoder.inverse_transform(y_true),
            encoder.inverse_transform(y_pred),
            digits=3, zero_division=0,
        ))
        print(f"  accuracy       : {acc:.4f}   ({acc*100:.1f}%)")
        print(f"  macro F1       : {macro:.4f}   ({macro*100:.1f}%)")
        print(f"  weighted F1    : {weighted:.4f}")

        recorded = card["test"]["macro_f1"]
        agree = abs(macro - recorded) < 1e-6
        print(f"\n  card says      : {recorded:.6f}")
        print(f"  reproduced     : {macro:.6f}   -> "
              f"{'MATCHES — the artifact is the one the card describes' if agree else 'DIFFERS'}")

        rule("CONFUSION MATRIX (rows = true, cols = predicted)")
        labels = list(encoder.classes_)
        cm = confusion_matrix(y_true, y_pred)
        w = max(len(l) for l in labels) + 2
        print(" " * w + "".join(l[:9].rjust(11) for l in labels))
        for name, row in zip(labels, cm):
            print(name.ljust(w) + "".join(str(v).rjust(11) for v in row))

        # Where the model is weakest is more useful than the headline number.
        errs = []
        for i, t in enumerate(labels):
            for j, p in enumerate(labels):
                if i != j and cm[i][j]:
                    errs.append((cm[i][j], t, p))
        errs.sort(reverse=True)
        if errs:
            print("\n  largest confusions:")
            for n, t, p in errs[:4]:
                print(f"    {n:>4}  {t} read as {p}")
    else:
        print("  cannot score: dataset missing or changed since training")

    rule("WHAT THE MODEL LEANS ON")
    imp = sorted(zip(columns, model.feature_importances_), key=lambda x: -x[1])
    for name, v in imp:
        print(f"  {name:28} {v*100:5.1f}%  {'#' * int(round(v * 110))}")

    if not args.no_latency:
        rule("SERVING LATENCY (extraction + prediction)")
        ex = WindowFeatureExtractor(window_seconds=180)
        now = time.time()
        D, N = "U-D", "U-N"
        events = [{"userId": D, "eventType": "CODE_EDIT", "metadata": {"codeLength": 140},
                   "timestamp": now - (175 - i * 11)} for i in range(13)]
        for at in (150, 100, 45):
            events.append({"userId": D, "eventType": "CODE_RUN", "metadata": {},
                           "timestamp": now - at})
            events.append({"userId": D, "eventType": "CODE_RUN_RESULT",
                           "metadata": {"success": False}, "timestamp": now - at + 2})
        roles = {D: "DRIVER", N: "NAVIGATOR"}

        times = []
        for _ in range(200):
            t0 = time.perf_counter()
            f = ex.extract(events, roles=roles, window_end=now, session_start_at=now - 450)
            model.predict(np.array([[float(f[c]) for c in columns]]))
            times.append((time.perf_counter() - t0) * 1000)
        times.sort()
        print(f"  n = {len(times)}, {len(events)}-event window")
        print(f"  median : {times[len(times)//2]:6.2f} ms")
        print(f"  mean   : {sum(times)/len(times):6.2f} ms")
        print(f"  p95    : {times[int(len(times)*0.95)]:6.2f} ms")
        print(f"  budget : 100.00 ms (NFR1)  ->  "
              f"{'within budget' if sum(times)/len(times) < 100 else 'OVER BUDGET'}")

    if "SIMULATED" in card["data_provenance"].upper() or card["version"].startswith("demo_"):
        rule("REMINDER")
        print("  These figures come from a SIMULATED corpus. They show the pipeline")
        print("  recovers the planted states — they are NOT an estimate of accuracy")
        print("  on real student pairs.")
    print()


if __name__ == "__main__":
    main()
