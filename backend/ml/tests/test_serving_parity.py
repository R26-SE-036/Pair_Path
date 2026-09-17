"""Serving reads the window training cut.

dev_tools/build_windows.py built the training set by stepping through each
session in time and extracting every event inside the window ending at each
step. The live path ended its window at whichever event came last, and was
handed only the fifty newest events - so a pair that went quiet looked like
their last few active minutes, and a pair typing fast looked idle. Both halves
worked on their own, which is why nothing caught it.

These pin the live handler to the training call.
"""

import asyncio
import unittest

from rag_context import ML_ROOT  # noqa: F401  (puts the service root on sys.path)

from app.features.extractor import WindowFeatureExtractor
from app.main import feature_extractor, predict_pair_state
from app.schemas.predictions import PredictPairStateRequest

ROLES = {"d": "DRIVER", "n": "NAVIGATOR"}
STRIDE = 30  # build_windows --stride
MIN_EVENTS = 3  # build_windows --min-events


def event(ts, user, kind, **metadata):
    return {"timestamp": ts, "userId": user, "eventType": kind, "metadata": metadata}


def a_session():
    """Seven minutes of a pair: steady editing, notes, runs, a swap - then silence."""
    events = [event(second, "d", "CODE_EDIT") for second in range(0, 300, 7)]
    events += [event(second, "n", "DISCUSSION_NOTE") for second in range(20, 300, 45)]
    events.append(event(120, "d", "CODE_RUN_RESULT", success=False))
    events.append(event(200, "d", "CODE_RUN_RESULT", success=True))
    events.append(event(310, "n", "ROLE_SWITCH"))
    events += [event(second, "n", "CODE_EDIT") for second in range(320, 420, 9)]
    return sorted(events, key=lambda e: e["timestamp"])


def serve(events, window_end=None, **extra):
    request = PredictPairStateRequest(
        sessionId="s1",
        events=events,
        roles=ROLES,
        windowEnd=window_end,
        **extra,
    )
    return asyncio.run(predict_pair_state(request))


class ServingMatchesTraining(unittest.TestCase):
    def test_every_stride_reads_the_features_training_would_have(self):
        events = a_session()
        window = feature_extractor.window_seconds
        extractor = WindowFeatureExtractor(window_seconds=window)
        first = events[0]["timestamp"]

        checked = 0
        t = first + window
        # On past the last event and into the silence - the windows the live
        # path could never produce before, because each ended on an event.
        while t <= events[-1]["timestamp"] + 5 * STRIDE:
            window_events = [e for e in events if t - window < e["timestamp"] <= t]
            if len(window_events) >= MIN_EVENTS:
                switches = [
                    e["timestamp"]
                    for e in events
                    if e["eventType"] == "ROLE_SWITCH" and e["timestamp"] <= t
                ]
                last_switch = max(switches) if switches else None

                # Exactly the call build_windows.py makes for this window...
                trained = extractor.extract(
                    window_events,
                    roles=ROLES,
                    window_end=t,
                    last_role_switch_at=last_switch,
                    session_start_at=first,
                )
                # ...and what the gateway now sends for the same moment.
                served = serve(
                    window_events,
                    window_end=t,
                    lastRoleSwitchAt=last_switch,
                    sessionStartAt=first,
                )

                self.assertEqual(
                    served.features,
                    {name: float(value) for name, value in trained.items()},
                    f"window ending at {t}s",
                )
                checked += 1
            t += STRIDE

        self.assertGreater(checked, 10)

    def test_a_pair_that_stopped_is_seen_as_idle_when_the_window_ends_now(self):
        # Busy for three minutes, then nothing. A window ending on the last
        # event - what serving used to do - is wall-to-wall activity, and stays
        # that way however long the silence lasts: every event is still inside
        # it. Only a window ending now lets the early events fall out.
        busy = [event(second, "d", "CODE_EDIT") for second in range(0, 180, 5)]
        last = busy[-1]["timestamp"]

        at_the_last_event = serve(busy)
        two_minutes_on = serve(busy, window_end=last + 120)

        self.assertLess(at_the_last_event.features["idle_ratio"], 0.1)
        self.assertGreater(two_minutes_on.features["idle_ratio"], 0.5)

    def test_the_response_reports_the_window_it_read(self):
        # Stored with the prediction. The gateway used to store the earliest
        # and latest of the events it sent, which described neither end.
        events = [event(second, "d", "CODE_EDIT") for second in range(0, 60, 5)]

        response = serve(events, window_end=175)

        self.assertEqual(response.windowEnd, 175)
        self.assertEqual(response.windowStart, 175 - feature_extractor.window_seconds)

    def test_without_a_window_end_it_still_ends_at_the_last_event(self):
        # The pre-computed-features path and any older caller keep working.
        events = [event(second, "d", "CODE_EDIT") for second in range(0, 60, 5)]

        self.assertEqual(serve(events).windowEnd, 55)


class TheTruncationThisReplaces(unittest.TestCase):
    def test_the_newest_fifty_events_make_fast_typing_look_idle(self):
        """Why the gateway fetches by time now.

        One CODE_EDIT per keystroke means fifty events can be the last few
        seconds of a busy window - and every bucket before them reads as idle.
        """
        extractor = WindowFeatureExtractor(window_seconds=180)
        typing = [event(half / 2, "d", "CODE_EDIT") for half in range(0, 360)]  # two a second
        end = typing[-1]["timestamp"]

        whole_window = extractor.extract(typing, ROLES, window_end=end)
        newest_fifty = extractor.extract(typing[-50:], ROLES, window_end=end)

        self.assertLess(whole_window["idle_ratio"], 0.1)
        self.assertGreater(newest_fifty["idle_ratio"], 0.7)


if __name__ == "__main__":
    unittest.main()
