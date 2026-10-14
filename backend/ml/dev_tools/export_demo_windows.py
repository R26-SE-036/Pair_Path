"""Export one held-out window per state for the presenter view's replays.

The presenter view in the workspace can replay a recorded window through the
live engine, so a panel can see all five states produce their nudges in a
minute instead of the ~3 minutes of behaviour each state needs to fill a
180-second window. This picks those windows.

  * Only sessions in the model card's held-out test split - the model was
    never trained on them.
  * Windows are cut exactly as build_windows.py cut the training set: 180 s,
    stepped every 30 s, roles as of the window end, the last switch and the
    session start carried along.
  * For each state, the FIRST window (sessions in name order, then time) that
    the model classifies as its label above the intervention gate. That is a
    window chosen to show a nudge, not a sample of accuracy - accuracy is the
    model card's test figure, and the replay says which session it came from.

Times are written as offsets in seconds from the window end, so the API can
replay a window as if it had just happened.

Written as a TypeScript module, because the API's build emits .ts sources
and nothing else into dist.

Usage (from backend/ml):
  python dev_tools/export_demo_windows.py --out ../src/content/demo-windows.ts
"""

import argparse
import asyncio
import json
import os
import sys
from collections import defaultdict

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(ML_ROOT)
sys.path.append(os.path.join(ML_ROOT, "dev_tools"))

from app.features import WindowFeatureExtractor  # noqa: E402
from app.features.extractor import _to_epoch_seconds  # noqa: E402
from app.label_mapping import PAIR_STATES  # noqa: E402
from app.models.intervention_engine import CONFIDENCE_THRESHOLD  # noqa: E402
from app.models.predictor import PairStatePredictor  # noqa: E402
from build_windows import initial_roles, roles_as_of  # noqa: E402

WINDOW_SECONDS = 180
STRIDE = 30
MIN_EVENTS = 3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--events", default=os.path.join(ML_ROOT, "data", "raw_sessions", "events.json"))
    parser.add_argument("--labels", default=os.path.join(ML_ROOT, "data", "labels", "session_labels.csv"))
    parser.add_argument("--card", default=os.path.join(ML_ROOT, "models", "model_card.json"))
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    with open(args.card, encoding="utf-8") as f:
        card = json.load(f)
    held_out = sorted(card["split"]["test_sessions"])

    labels = {}
    with open(args.labels, encoding="utf-8") as f:
        header = f.readline().strip().split(",")
        for line in f:
            row = dict(zip(header, line.strip().split(",")))
            labels[row["session_id"]] = row["label"]

    with open(args.events, encoding="utf-8") as f:
        raw = json.load(f)
    by_session = defaultdict(list)
    for e in raw:
        by_session[e["sessionId"]].append(e)

    extractor = WindowFeatureExtractor(window_seconds=WINDOW_SECONDS)
    predictor = PairStatePredictor()
    if predictor.model is None:
        sys.exit("[ERROR] No trained model - nothing to choose windows with.")

    chosen = {}
    for session_id in held_out:
        state = labels.get(session_id)
        if state not in PAIR_STATES or state in chosen:
            continue
        stamped = sorted(
            ((ts, e) for e in by_session[session_id] if (ts := _to_epoch_seconds(e.get("timestamp"))) is not None),
            key=lambda p: p[0],
        )
        seed_roles = initial_roles(stamped)
        start = stamped[0][0]
        t = start + WINDOW_SECONDS
        while t <= stamped[-1][0] + STRIDE and state not in chosen:
            window = [(ts, e) for ts, e in stamped if t - WINDOW_SECONDS < ts <= t]
            switches = [ts for ts, e in stamped if ts <= t and e.get("eventType") == "ROLE_SWITCH"]
            last_switch = max(switches) if switches else None
            roles = roles_as_of(stamped, t, seed_roles)
            if len(window) >= MIN_EVENTS:
                features = extractor.extract(
                    [e for _, e in window],
                    roles=roles,
                    window_end=t,
                    last_role_switch_at=last_switch,
                    session_start_at=start,
                )
                result = asyncio.run(predictor.predict(features))
                if result["state"] == state and result["confidence"] >= CONFIDENCE_THRESHOLD:
                    chosen[state] = {
                        "state": state,
                        "sourceSession": session_id,
                        "windowSeconds": WINDOW_SECONDS,
                        "roles": roles,
                        "lastRoleSwitchOffset": None if last_switch is None else round(last_switch - t, 3),
                        "sessionStartOffset": round(start - t, 3),
                        "events": [
                            {
                                "offset": round(ts - t, 3),
                                "userId": e["userId"],
                                "eventType": e["eventType"],
                                "metadata": e.get("metadata") or "{}",
                            }
                            for ts, e in window
                        ],
                        "modelAtExport": {
                            "version": predictor.model_version,
                            "state": result["state"],
                            "confidence": round(result["confidence"], 4),
                        },
                    }
            t += STRIDE

    missing = [s for s in PAIR_STATES if s not in chosen]
    if missing:
        sys.exit(f"[ERROR] No held-out window above the gate for: {', '.join(missing)}")

    out = {
        "modelVersion": predictor.model_version,
        "windows": [chosen[s] for s in PAIR_STATES],
    }
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(
            "/**\n"
            " * One held-out window per state, for the presenter view's replays.\n"
            " *\n"
            " * GENERATED by ml/dev_tools/export_demo_windows.py - edit that, not this.\n"
            " * Simulated sessions from the model card's held-out test split, which the\n"
            " * model was never trained on. Offsets are seconds from the window end.\n"
            " */\n\n"
            "import type { DemoWindows } from '../modules/websocket/presenter';\n\n"
            "export const DEMO_WINDOWS: DemoWindows = "
        )
        json.dump(out, f, indent=1)
        f.write(";\n")
    for s in PAIR_STATES:
        w = chosen[s]
        print(f"{s:18} {w['sourceSession']:28} {len(w['events']):4} events  "
              f"confidence {w['modelAtExport']['confidence']:.3f}")
    print(f"[SUCCESS] -> {args.out}")


if __name__ == "__main__":
    main()
