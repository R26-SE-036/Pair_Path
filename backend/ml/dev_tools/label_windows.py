"""Human annotation CLI (L1) + inter-rater agreement (Cohen's kappa).

Label mode — steps through each window from build_windows.py, shows what
actually happened in it (event timeline summary), and asks for a state:

  python label_windows.py --windows windows.csv --events events.json --rater nimesh

Writes <windows>_labeled_<rater>.csv with columns:
  session_id, window_start, window_end, label, label_source=human, rater

Resume-safe: already-labeled windows are skipped on rerun.

Kappa mode — agreement between two raters' label files on their overlap:

  python label_windows.py --kappa a_labeled_nimesh.csv b_labeled_friend.csv

Report the resulting kappa in the paper (annotation ceiling for RQ1).
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.features.extractor import _metadata, _to_epoch_seconds  # noqa: E402
from app.label_mapping import PAIR_STATES, STATE_DESCRIPTIONS  # noqa: E402

SKIP = "s"
QUIT = "q"


def summarize_window(events, start, end):
    lines = []
    counts = Counter()
    by_user = Counter()
    for e in events:
        ts = _to_epoch_seconds(e.get("timestamp"))
        if ts is None or not (start < ts <= end):
            continue
        etype = e.get("eventType")
        uid = e.get("userId") or "?"
        counts[etype] += 1
        by_user[uid] += 1
        offset = int(ts - start)
        extra = ""
        if etype == "CODE_RUN_RESULT":
            extra = " [OK]" if _metadata(e).get("success") else " [FAIL]"
        elif etype == "DISCUSSION_NOTE":
            note = str(_metadata(e).get("note", ""))[:60]
            extra = f' "{note}"'
        lines.append(f"    +{offset:>3}s  {etype:<22} {uid}{extra}")
    header = "  events: " + ", ".join(f"{k}×{v}" for k, v in counts.most_common()) or "  (none)"
    users = "  by user: " + ", ".join(f"{u}: {n}" for u, n in by_user.most_common())
    return "\n".join([header, users, *lines[:30]])


def label_mode(args):
    windows = pd.read_csv(args.windows)
    with open(args.events, encoding="utf-8") as f:
        raw = json.load(f)
    if isinstance(raw, list) and len(raw) == 1 and isinstance(raw[0], list):
        raw = raw[0]
    by_session = defaultdict(list)
    for e in raw:
        by_session[e.get("sessionId") or e.get("session_id")].append(e)

    out_path = args.out or args.windows.replace(".csv", f"_labeled_{args.rater}.csv")
    done = set()
    if os.path.exists(out_path):
        prev = pd.read_csv(out_path)
        done = {(r.session_id, r.window_start) for r in prev.itertuples()}
        print(f"[RESUME] {len(done)} windows already labeled in {out_path}")

    menu = "\n".join(
        f"  {i + 1}. {s:<20} {STATE_DESCRIPTIONS[s]}" for i, s in enumerate(PAIR_STATES)
    )
    print(f"\nStates:\n{menu}\n  {SKIP}. skip (unclear)   {QUIT}. save and quit\n")

    rows = []
    try:
        for idx, w in windows.iterrows():
            key = (w["session_id"], w["window_start"])
            if key in done:
                continue
            start, end = float(w["window_start"]), float(w["window_end"])
            t0 = datetime.fromtimestamp(start, tz=timezone.utc).strftime("%H:%M:%S")
            t1 = datetime.fromtimestamp(end, tz=timezone.utc).strftime("%H:%M:%S")
            print(f"\n── window {idx + 1}/{len(windows)} · session {w['session_id']} · {t0}–{t1} UTC ──")
            print(summarize_window(by_session.get(w["session_id"], []), start, end))
            while True:
                choice = input("label> ").strip().lower()
                if choice == QUIT:
                    raise KeyboardInterrupt
                if choice == SKIP:
                    break
                if choice.isdigit() and 1 <= int(choice) <= len(PAIR_STATES):
                    rows.append({
                        "session_id": w["session_id"],
                        "window_start": start,
                        "window_end": end,
                        "label": PAIR_STATES[int(choice) - 1],
                        "label_source": "human",
                        "rater": args.rater,
                    })
                    break
                print(f"  enter 1-{len(PAIR_STATES)}, '{SKIP}' to skip, '{QUIT}' to quit")
    except (KeyboardInterrupt, EOFError):
        print("\n[STOP] saving progress…")

    if rows:
        new = pd.DataFrame(rows)
        if os.path.exists(out_path):
            new = pd.concat([pd.read_csv(out_path), new], ignore_index=True)
        new.to_csv(out_path, index=False)
        print(f"[SUCCESS] {len(rows)} new labels -> {out_path}")
        print("[NEXT] Join with features and train:")
        print(f"  merge on (session_id, window_start), then: python train_xgboost.py --data <merged.csv>")
    else:
        print("[INFO] no new labels recorded")


def kappa_mode(files):
    a, b = (pd.read_csv(f) for f in files)
    merged = a.merge(b, on=["session_id", "window_start"], suffixes=("_a", "_b"))
    if merged.empty:
        sys.exit("[ERROR] The two label files share no windows.")
    la, lb = merged["label_a"], merged["label_b"]
    po = (la == lb).mean()
    pe = sum(
        (la == s).mean() * (lb == s).mean() for s in set(la) | set(lb)
    )
    kappa = (po - pe) / (1 - pe) if pe < 1 else 1.0
    print(f"[KAPPA] overlap windows: {len(merged)}")
    print(f"[KAPPA] raw agreement: {po:.3f}")
    print(f"[KAPPA] Cohen's kappa: {kappa:.3f}")
    if kappa < 0.6:
        print("[WARN] kappa < 0.6 — the rubric is too ambiguous; revise it and re-label "
              "before training (this number is your model's honest ceiling).")
    disagreements = merged[la != lb][["session_id", "window_start", "label_a", "label_b"]]
    if len(disagreements):
        print("\nDisagreements:")
        print(disagreements.to_string(index=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--windows", help="windows CSV from build_windows.py")
    parser.add_argument("--events", help="raw events JSON (same file used to build windows)")
    parser.add_argument("--rater", help="your name/initials — recorded per label")
    parser.add_argument("--out", help="output CSV (default: <windows>_labeled_<rater>.csv)")
    parser.add_argument("--kappa", nargs=2, metavar=("FILE_A", "FILE_B"),
                        help="two labeled CSVs to compare instead of labeling")
    args = parser.parse_args()

    if args.kappa:
        kappa_mode(args.kappa)
    else:
        if not (args.windows and args.events and args.rater):
            parser.error("label mode needs --windows, --events and --rater")
        label_mode(args)


if __name__ == "__main__":
    main()
