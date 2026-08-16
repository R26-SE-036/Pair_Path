"""Build unlabeled feature windows from real session events (L5 offline path).

Input: a JSON file containing an array of SessionEvent rows exported from
Postgres, e.g. via:

  \\copy (SELECT json_agg(t) FROM (
      SELECT "sessionId", "userId", "eventType", "metadata",
             "timestamp" FROM "SessionEvent" ORDER BY "timestamp"
    ) t) TO 'events.json'

Each event: {"sessionId": ..., "userId": ..., "eventType": ...,
             "metadata": str|dict, "timestamp": ISO8601}

Output: CSV with one row per window (session_id, window_start, window_end,
canonical features) — ready for human labeling with label_windows.py.
Roles per window are reconstructed by replaying ROLE_SWITCH events
(metadata.newRoles); windows before the first observed switch have unknown
roles and role-dependent features default to 0.

Usage:
  python build_windows.py --events events.json --out ../data/extracted/windows.csv
  python build_windows.py --events events.json --out windows.csv --window-seconds 120 --stride 30
"""

import argparse
import json
import os
import sys
from collections import defaultdict

import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.features import WindowFeatureExtractor  # noqa: E402
from app.features.extractor import _metadata, _to_epoch_seconds  # noqa: E402


def roles_as_of(events_sorted, t):
    """Replay ROLE_SWITCH events up to time t to reconstruct the roles map."""
    roles = {}
    for ts, e in events_sorted:
        if ts > t:
            break
        if e.get("eventType") == "ROLE_SWITCH":
            new_roles = _metadata(e).get("newRoles")
            if isinstance(new_roles, dict):
                roles = dict(new_roles)
    return roles


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--events", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--window-seconds", type=int, default=int(os.getenv("ML_WINDOW_SECONDS", "180")))
    parser.add_argument("--stride", type=int, default=30)
    parser.add_argument("--min-events", type=int, default=3)
    args = parser.parse_args()

    with open(args.events, encoding="utf-8") as f:
        raw = json.load(f)
    if isinstance(raw, list) and len(raw) == 1 and isinstance(raw[0], list):
        raw = raw[0]  # unwrap psql json_agg output

    by_session = defaultdict(list)
    for e in raw:
        by_session[e.get("sessionId") or e.get("session_id")].append(e)

    extractor = WindowFeatureExtractor(window_seconds=args.window_seconds)
    all_rows = []
    for session_id, events in by_session.items():
        stamped = sorted(
            ((ts, e) for e in events if (ts := _to_epoch_seconds(e.get("timestamp"))) is not None),
            key=lambda p: p[0],
        )
        if not stamped:
            continue
        t = stamped[0][0] + args.window_seconds
        last_switch = None
        while t <= stamped[-1][0] + args.stride:
            window_events = [e for ts, e in stamped if t - args.window_seconds < ts <= t]
            for ts, e in stamped:
                if ts <= t and e.get("eventType") == "ROLE_SWITCH":
                    last_switch = ts if last_switch is None else max(last_switch, ts)
            if len(window_events) >= args.min_events:
                features = extractor.extract(
                    window_events,
                    roles=roles_as_of(stamped, t),
                    window_end=t,
                    last_role_switch_at=last_switch,
                )
                all_rows.append({
                    "session_id": session_id,
                    "window_start": t - args.window_seconds,
                    "window_end": t,
                    **features,
                })
            t += args.stride

    if not all_rows:
        sys.exit("[ERROR] No windows produced — check the events file format.")

    df = pd.DataFrame(all_rows)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"[SUCCESS] {len(df)} windows from {df['session_id'].nunique()} sessions -> {args.out}")
    print("[NEXT] Label them: python label_windows.py --windows "
          f"{args.out} --events {args.events} --rater YOUR_NAME")


if __name__ == "__main__":
    main()
