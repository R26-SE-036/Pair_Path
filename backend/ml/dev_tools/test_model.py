"""Sanity-check the deployed model against hand-built scenarios.

Scenarios are written as RAW EVENT STREAMS and pushed through the real
feature extractor — the same path the live service uses. An earlier version
hand-wrote feature dictionaries, which silently rotted when the feature set
was renamed: every value resolved to zero and the script reported the same
prediction for every scenario while appearing to pass.

This is a smoke test, not an evaluation. For real numbers with a held-out
test set, use evaluate_simulated.py.

Usage:
    python test_model.py          # exits non-zero if any scenario fails
"""

import asyncio
import json
import os
import sys
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.features import WindowFeatureExtractor  # noqa: E402
from app.models.predictor import PairStatePredictor  # noqa: E402

WINDOW = 180
NOW = time.time()
DRIVER, NAVIGATOR = "u1", "u2"
ROLES = {DRIVER: "DRIVER", NAVIGATOR: "NAVIGATOR"}


def ev(seconds_ago, user, event_type, meta=None):
    return {
        "timestamp": NOW - seconds_ago,
        "userId": user,
        "eventType": event_type,
        "metadata": json.dumps(meta or {}),
    }


def edits(user, count, start_ago=175, gap=None):
    gap = gap or (start_ago - 5) / max(count - 1, 1)
    return [ev(start_ago - i * gap, user, "CODE_EDIT", {"codeLength": 200 + i * 7})
            for i in range(count)]


def runs(user, results, start_ago=150, gap=30):
    out = []
    for i, ok in enumerate(results):
        out.append(ev(start_ago - i * gap, user, "CODE_RUN", {}))
        out.append(ev(start_ago - i * gap - 2, user, "CODE_RUN_RESULT",
                      {"success": ok, "hasError": not ok}))
    return out


def notes(user, count, start_ago=160, gap=45):
    return [ev(start_ago - i * gap, user, "DISCUSSION_NOTE", {"note": "discussion"})
            for i in range(count)]


# Each scenario: (expected_state, description, events, session_age, last_switch_ago)
# last_switch_ago = None means the pair has never rotated.
SCENARIOS = [
    (
        "PRODUCTIVE",
        "Balanced work, navigator talking, runs passing, rotated recently",
        edits(DRIVER, 13) + notes(NAVIGATOR, 2) + notes(DRIVER, 1, start_ago=120)
        + runs(DRIVER, [True, True]),
        420, 60,
    ),
    (
        "DRIVER_DOMINANCE",
        "Navigator engaged and talking, but roles never rotate",
        edits(DRIVER, 20, gap=9) + notes(NAVIGATOR, 3, gap=55)
        + runs(DRIVER, [True, True]),
        600, None,
    ),
    (
        "PASSIVE_NAVIGATOR",
        "Driver working steadily, navigator completely silent",
        edits(DRIVER, 14) + notes(DRIVER, 1) + runs(DRIVER, [True, True]),
        500, 200,
    ),
    (
        "LOGIC_STRUGGLE",
        "Active discussion but runs keep failing",
        edits(DRIVER, 11) + notes(NAVIGATOR, 2) + notes(DRIVER, 2, start_ago=130)
        + runs(DRIVER, [False, False, False, True, False], gap=28),
        450, 240,
    ),
    (
        "DISENGAGED",
        "Almost no activity, nobody talking",
        [ev(170, DRIVER, "CODE_EDIT", {"codeLength": 210}),
         ev(95, DRIVER, "CODE_EDIT", {"codeLength": 214}),
         ev(20, DRIVER, "CODE_EDIT", {"codeLength": 216})],
        400, None,
    ),
]


async def main():
    predictor = PairStatePredictor()
    extractor = WindowFeatureExtractor(window_seconds=WINDOW)
    print(f"\nModel under test: {predictor.model_version}")
    if predictor.model is None:
        print("[WARN] No trained model loaded — exercising the rule-based fallback.")
    print("=" * 72)

    passed = 0
    for expected, description, events, session_age, switch_ago in SCENARIOS:
        features = extractor.extract(
            events,
            roles=ROLES,
            window_end=NOW,
            last_role_switch_at=None if switch_ago is None else NOW - switch_ago,
            session_start_at=NOW - session_age,
        )
        result = await predictor.predict(features)
        ok = result["state"] == expected
        passed += ok

        print(f"\n{'PASS' if ok else 'FAIL'}  expected {expected}")
        print(f"      {description}")
        print(f"      got {result['state']} ({result['confidence']:.2f})")
        print(f"      edits={features['total_edit_count']:.0f} "
              f"nav_notes={features['navigator_note_count']:.0f} "
              f"runs={features['run_attempt_count']:.0f} "
              f"success={features['run_success_rate']:.2f} "
              f"idle={features['idle_ratio']:.2f} "
              f"since_switch={features['seconds_since_role_switch']:.0f}s "
              f"session_age={features['session_elapsed_seconds']:.0f}s")

    print("\n" + "=" * 72)
    print(f"{passed}/{len(SCENARIOS)} scenarios matched.")
    if passed < len(SCENARIOS):
        print("A mismatch is not automatically a bug — these are hand-built windows,\n"
              "and the states they sit between are genuinely close. Check the printed\n"
              "features look like the situation described before blaming the model.")
    return 0 if passed == len(SCENARIOS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
