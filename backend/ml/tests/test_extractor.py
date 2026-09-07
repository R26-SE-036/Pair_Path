"""The canonical feature extractor.

There were no tests for this file, which is the one place train/serve skew can
enter: `dev_tools/build_windows.py` imports it to build the training set and
`app/main.py` imports it to serve, so a change here moves both at once - and a
change that moves only one of the fifteen features moves them apart silently.
The model reads a positional array, so nothing downstream can tell that a
column now means something different.

These tests fix the meanings, not just the arithmetic. A feature whose value is
right but whose definition has drifted is the failure that survives a test
suite checking totals.
"""

import json
import unittest

from rag_context import ML_ROOT  # noqa: F401  (puts the service root on sys.path)

from app.features.extractor import FEATURE_COLUMNS, WindowFeatureExtractor


ROLES = {"d": "DRIVER", "n": "NAVIGATOR"}


def event(ts, user, kind, **metadata):
    return {
        "timestamp": ts,
        "userId": user,
        "eventType": kind,
        "metadata": metadata,
    }


class TestFeatureContract(unittest.TestCase):
    """The columns are a contract with the serialized model."""

    def test_fifteen_named_features(self):
        self.assertEqual(len(FEATURE_COLUMNS), 15)
        self.assertEqual(len(set(FEATURE_COLUMNS)), 15, "duplicate column name")

    def test_extract_returns_exactly_the_declared_columns(self):
        # The model is fitted on FEATURE_COLUMNS in order. A vector with an
        # extra key is harmless; a vector missing one used to be silently
        # filled with 0.0, and 0.0 is not neutral - idle_ratio 0.0 means
        # "constant activity" and run_success_rate 0.0 means "everything
        # failed", so the substitution produced a confident description of a
        # session nobody had.
        features = WindowFeatureExtractor().extract([], roles={})
        self.assertEqual(sorted(features), sorted(FEATURE_COLUMNS))

    def test_matches_the_columns_the_trained_model_expects(self):
        import os
        import joblib

        path = os.path.join(ML_ROOT, "models", "pair_state_feature_columns.joblib")
        if not os.path.exists(path):
            self.skipTest("no trained model in this checkout")

        # The actual train/serve contract, checked against the artefact rather
        # than against another copy of the list.
        self.assertEqual(list(joblib.load(path)), list(FEATURE_COLUMNS))


class TestWindowing(unittest.TestCase):
    def test_only_events_inside_the_window_count(self):
        extractor = WindowFeatureExtractor(window_seconds=60)
        events = [
            event(0, "d", "CODE_EDIT"),      # 100s before the end: outside
            event(70, "d", "CODE_EDIT"),     # inside
            event(100, "d", "CODE_EDIT"),    # inside, at the boundary
        ]
        features = extractor.extract(events, ROLES, window_end=100)
        self.assertEqual(features["total_edit_count"], 2.0)

    def test_the_window_is_half_open(self):
        # (start, end]. An event exactly at the start belongs to the previous
        # window, or a sliding evaluation counts it twice.
        extractor = WindowFeatureExtractor(window_seconds=60)
        at_start = extractor.extract([event(40, "d", "CODE_EDIT")], ROLES, window_end=100)
        at_end = extractor.extract([event(100, "d", "CODE_EDIT")], ROLES, window_end=100)
        self.assertEqual(at_start["total_edit_count"], 0.0)
        self.assertEqual(at_end["total_edit_count"], 1.0)

    def test_unordered_events_are_handled(self):
        extractor = WindowFeatureExtractor(window_seconds=180)
        shuffled = [
            event(120, "d", "CODE_EDIT"),
            event(20, "d", "CODE_EDIT"),
            event(80, "d", "CODE_EDIT"),
        ]
        # The gateway sends the most recent 50 events ordered DESC, so this is
        # the live path's actual input shape, not a hypothetical.
        features = extractor.extract(shuffled, ROLES, window_end=180)
        self.assertEqual(features["total_edit_count"], 3.0)


class TestEditAttribution(unittest.TestCase):
    def test_edits_are_split_by_role(self):
        features = WindowFeatureExtractor().extract(
            [
                event(10, "d", "CODE_EDIT"),
                event(20, "d", "CODE_EDIT"),
                event(30, "n", "CODE_EDIT"),
            ],
            ROLES,
            window_end=60,
        )
        self.assertEqual(features["driver_edit_count"], 2.0)
        self.assertEqual(features["navigator_edit_count"], 1.0)
        self.assertEqual(features["total_edit_count"], 3.0)

    def test_navigator_edits_should_not_occur_in_practice(self):
        # The gateway refuses a code_change from the navigator, so this feature
        # is 0 by construction in real data. The extractor still computes it,
        # which is right: it is also used offline on imported sessions, and a
        # non-zero value there is a signal that something bypassed the rule.
        features = WindowFeatureExtractor().extract(
            [event(10, "d", "CODE_EDIT")], ROLES, window_end=60
        )
        self.assertEqual(features["navigator_edit_count"], 0.0)

    def test_edit_balance_is_the_larger_share(self):
        features = WindowFeatureExtractor().extract(
            [
                event(10, "d", "CODE_EDIT"),
                event(20, "d", "CODE_EDIT"),
                event(30, "d", "CODE_EDIT"),
                event(40, "n", "CODE_EDIT"),
            ],
            ROLES,
            window_end=60,
        )
        self.assertAlmostEqual(features["edit_balance_ratio"], 0.75)

    def test_no_edits_gives_a_neutral_balance(self):
        # 0.5 rather than 0.0 or 1.0. An empty window is not evidence of
        # perfect balance OR of total dominance, and either extreme would be a
        # strong signal drawn from no observation at all.
        features = WindowFeatureExtractor().extract([], ROLES, window_end=60)
        self.assertEqual(features["edit_balance_ratio"], 0.5)
        self.assertEqual(features["active_user_dominance"], 0.5)


class TestRuns(unittest.TestCase):
    def test_success_rate_reads_the_result_event(self):
        features = WindowFeatureExtractor().extract(
            [
                event(10, "d", "CODE_RUN_RESULT", success=True),
                event(20, "d", "CODE_RUN_RESULT", success=False),
                event(30, "d", "CODE_RUN_RESULT", success=True),
            ],
            ROLES,
            window_end=60,
        )
        self.assertEqual(features["run_attempt_count"], 3.0)
        self.assertAlmostEqual(features["run_success_rate"], 2 / 3, places=3)

    def test_metadata_arriving_as_a_json_string_is_parsed(self):
        # The gateway writes JSON.stringify(...) into a Prisma Json column, so
        # rows come back as a JSON *string* rather than an object. Reading
        # `metadata.success` off the string yields nothing, and every run would
        # score as a failure.
        stringified = {
            "timestamp": 10,
            "userId": "d",
            "eventType": "CODE_RUN_RESULT",
            "metadata": json.dumps({"success": True}),
        }
        features = WindowFeatureExtractor().extract([stringified], ROLES, window_end=60)
        self.assertEqual(features["run_success_rate"], 1.0)

    def test_unparseable_metadata_does_not_crash_the_window(self):
        broken = {
            "timestamp": 10,
            "userId": "d",
            "eventType": "CODE_RUN_RESULT",
            "metadata": "{not json",
        }
        features = WindowFeatureExtractor().extract([broken], ROLES, window_end=60)
        # Treated as a failed run rather than dropped: one malformed row must
        # not take out the whole feature vector for the window.
        self.assertEqual(features["run_attempt_count"], 1.0)
        self.assertEqual(features["run_success_rate"], 0.0)

    def test_consecutive_failures_is_the_longest_streak(self):
        features = WindowFeatureExtractor().extract(
            [
                event(10, "d", "CODE_RUN_RESULT", success=False),
                event(20, "d", "CODE_RUN_RESULT", success=False),
                event(30, "d", "CODE_RUN_RESULT", success=True),
                event(40, "d", "CODE_RUN_RESULT", success=False),
            ],
            ROLES,
            window_end=60,
        )
        # Longest, not current, and not total. LOGIC_STRUGGLE is about being
        # stuck on one thing, which a run of failures shows and a count of
        # failures scattered across the window does not.
        self.assertEqual(features["consecutive_failure_count"], 2.0)

    def test_error_recovery_measures_failure_to_next_success(self):
        features = WindowFeatureExtractor().extract(
            [
                event(10, "d", "CODE_RUN_RESULT", success=False),
                event(40, "d", "CODE_RUN_RESULT", success=True),
            ],
            ROLES,
            window_end=60,
        )
        self.assertAlmostEqual(features["error_recovery_seconds_avg"], 30.0)

    def test_an_unrecovered_failure_contributes_nothing(self):
        # A pair still stuck at the end of the window has no recovery time yet.
        # Counting the time so far would make "still stuck" and "recovered
        # slowly" the same number, which is the distinction that matters.
        features = WindowFeatureExtractor().extract(
            [event(10, "d", "CODE_RUN_RESULT", success=False)], ROLES, window_end=60
        )
        self.assertEqual(features["error_recovery_seconds_avg"], 0.0)

    def test_no_runs_gives_a_neutral_success_rate(self):
        features = WindowFeatureExtractor().extract([], ROLES, window_end=60)
        self.assertEqual(features["run_success_rate"], 0.5)


class TestDiscussion(unittest.TestCase):
    def test_notes_are_counted_and_split_by_role(self):
        features = WindowFeatureExtractor().extract(
            [
                event(10, "d", "DISCUSSION_NOTE"),
                event(20, "n", "DISCUSSION_NOTE"),
                event(30, "n", "DISCUSSION_NOTE"),
            ],
            ROLES,
            window_end=60,
        )
        self.assertEqual(features["discussion_note_count"], 3.0)
        # The feature that separates DRIVER_DOMINANCE from PASSIVE_NAVIGATOR:
        # a silent navigator is passive, a talking one whose partner will not
        # hand over the keyboard is being dominated.
        self.assertEqual(features["navigator_note_count"], 2.0)


class TestRolesAndTime(unittest.TestCase):
    def test_never_rotated_measures_from_the_session_start(self):
        features = WindowFeatureExtractor(window_seconds=180).extract(
            [event(1000, "d", "CODE_EDIT")],
            ROLES,
            window_end=1000,
            session_start_at=100,
        )
        # NOT capped at the window length. Capping made a pair who never
        # switched look identical to one who switched a window ago, which is
        # precisely what blurred DRIVER_DOMINANCE against PRODUCTIVE.
        self.assertAlmostEqual(features["seconds_since_role_switch"], 900.0)
        self.assertAlmostEqual(features["session_elapsed_seconds"], 900.0)

    def test_a_switch_inside_the_window_wins(self):
        features = WindowFeatureExtractor(window_seconds=180).extract(
            [event(950, "d", "ROLE_SWITCH")],
            ROLES,
            window_end=1000,
            last_role_switch_at=200,
            session_start_at=100,
        )
        self.assertEqual(features["role_switch_count"], 1.0)
        self.assertAlmostEqual(features["seconds_since_role_switch"], 50.0)

    def test_a_switch_before_the_window_is_still_known(self):
        # The caller passes the last switch from outside the window. Without
        # it, a pair who rotated four minutes ago is indistinguishable from one
        # who has never rotated at all.
        features = WindowFeatureExtractor(window_seconds=180).extract(
            [event(1000, "d", "CODE_EDIT")],
            ROLES,
            window_end=1000,
            last_role_switch_at=800,
            session_start_at=100,
        )
        self.assertEqual(features["role_switch_count"], 0.0)
        self.assertAlmostEqual(features["seconds_since_role_switch"], 200.0)


class TestIdleAndDominance(unittest.TestCase):
    def test_an_empty_window_is_fully_idle(self):
        features = WindowFeatureExtractor(window_seconds=60).extract(
            [], ROLES, window_end=100
        )
        self.assertEqual(features["idle_ratio"], 1.0)

    def test_activity_spread_across_the_window_lowers_idleness(self):
        extractor = WindowFeatureExtractor(window_seconds=60)  # six 10s buckets
        spread = extractor.extract(
            [event(t, "d", "CODE_EDIT") for t in (45, 55, 65, 75, 85, 95)],
            ROLES,
            window_end=100,
        )
        bunched = extractor.extract(
            [event(t, "d", "CODE_EDIT") for t in (95, 96, 97, 98, 99, 100)],
            ROLES,
            window_end=100,
        )
        # Same number of events, very different sessions. Bucketing is what
        # makes six edits in one burst read as mostly-idle, which is what
        # DISENGAGED looks like.
        self.assertLess(spread["idle_ratio"], bunched["idle_ratio"])

    def test_dominance_counts_every_event_type(self):
        features = WindowFeatureExtractor().extract(
            [
                event(10, "d", "CODE_EDIT"),
                event(20, "d", "CODE_RUN"),
                event(30, "d", "DISCUSSION_NOTE"),
                event(40, "n", "DISCUSSION_NOTE"),
            ],
            ROLES,
            window_end=60,
        )
        # Not just edits. Since the navigator cannot type, an edit-only measure
        # would read every session as totally dominated by construction.
        self.assertAlmostEqual(features["active_user_dominance"], 0.75)


class TestTimestampForms(unittest.TestCase):
    def test_iso_strings_epoch_seconds_and_epoch_millis_all_work(self):
        extractor = WindowFeatureExtractor(window_seconds=3600)
        forms = [
            {"timestamp": "2026-01-01T00:10:00+00:00", "userId": "d", "eventType": "CODE_EDIT"},
            {"timestamp": 1767226200, "userId": "d", "eventType": "CODE_EDIT"},
            {"timestamp": 1767226200000, "userId": "d", "eventType": "CODE_EDIT"},
        ]
        for form in forms:
            with self.subTest(form=form["timestamp"]):
                features = extractor.extract([form], ROLES)
                self.assertEqual(features["total_edit_count"], 1.0)

    def test_an_unparseable_timestamp_is_dropped_not_guessed(self):
        features = WindowFeatureExtractor().extract(
            [
                {"timestamp": "not a date", "userId": "d", "eventType": "CODE_EDIT"},
                event(10, "d", "CODE_EDIT"),
            ],
            ROLES,
            window_end=60,
        )
        # Placing an undated event at zero would drag window boundaries and
        # idle ratios toward the epoch.
        self.assertEqual(features["total_edit_count"], 1.0)


class TestSlidingWindows(unittest.TestCase):
    def test_busy_windows_are_emitted_and_quiet_ones_are_not(self):
        extractor = WindowFeatureExtractor(window_seconds=60)
        # Four events clustered at the start, then one long after. The first
        # window is busy; everything after the cluster is empty or nearly so.
        events = [event(t, "d", "CODE_EDIT") for t in (0, 5, 10, 15)] + [
            event(600, "d", "CODE_EDIT")
        ]

        rows = extractor.sliding_windows(events, ROLES, stride_seconds=30, min_events=3)

        # Matching the runtime's low-activity rule, so training never sees
        # windows the model will not be asked about.
        self.assertTrue(rows, "the busy window should have produced a row")
        self.assertTrue(all(row["window_end"] - row["window_start"] == 60 for row in rows))
        # The isolated event at 600 is alone in every window it falls in.
        self.assertTrue(all(row["window_end"] < 300 for row in rows))

    def test_the_first_window_starts_after_the_first_event(self):
        # A consequence of the half-open (start, end] convention: the first
        # window ends one window-length after the earliest event, so that event
        # sits exactly on its excluded boundary. Worth pinning rather than
        # discovering - it means a session's very first event never appears in
        # any training window, and a test written without knowing it looks like
        # a bug in the extractor.
        extractor = WindowFeatureExtractor(window_seconds=60)
        events = [event(t, "d", "CODE_EDIT") for t in (0, 10, 20, 30)]

        rows = extractor.sliding_windows(events, ROLES, stride_seconds=30, min_events=3)

        self.assertTrue(rows)
        self.assertEqual(rows[0]["window_end"], 60)
        self.assertEqual(rows[0]["total_edit_count"], 3.0)  # 10, 20, 30 - not the one at 0

    def test_no_events_yields_no_rows(self):
        self.assertEqual(WindowFeatureExtractor().sliding_windows([], ROLES), [])


if __name__ == "__main__":
    unittest.main()
