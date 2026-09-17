"""The classifier's edges, and the rules that decide when it stays quiet.

None of this was covered. The pieces here are the ones where being wrong is
indistinguishable from working: a substituted feature value still produces a
confident prediction, and an intervention mapping that falls through to praise
still returns a valid-looking response.
"""

import asyncio
import unittest

from rag_context import ML_ROOT  # noqa: F401  (puts the service root on sys.path)

from app.label_mapping import (
    NO_ACTION,
    PAIR_STATES,
    STATE_DESCRIPTIONS,
    STATE_INTERVENTIONS,
    get_intervention_for_state,
    validate_state,
)
from app.models.intervention_engine import InterventionEngine
from app.models.predictor import PairStatePredictor


def run(coro):
    return asyncio.run(coro)


class TestMissingFeatures(unittest.TestCase):
    """A vector the model was not fitted on is not something to guess at."""

    def setUp(self):
        self.predictor = PairStatePredictor()
        if self.predictor.model is None:
            self.skipTest("no trained model in this checkout")
        self.full = {column: 0.5 for column in self.predictor.feature_columns}

    def test_a_complete_vector_reaches_the_model(self):
        result = run(self.predictor.predict(self.full))
        self.assertIn(result["state"], PAIR_STATES)
        # The rule-based fallback's confidences are fixed values from a short
        # list; a real prediction almost never lands exactly on one.
        self.assertNotIn(result["confidence"], {0.55, 0.6, 0.65, 0.7})

    def test_a_missing_column_falls_back_instead_of_substituting_zero(self):
        partial = dict(self.full)
        partial.pop("idle_ratio")

        result = run(self.predictor.predict(partial))

        # 0.0 is not a neutral value to a tree ensemble. idle_ratio 0.0 means
        # "constant activity" and run_success_rate 0.0 means "everything
        # failed", so filling a gap with zero produces a confident description
        # of a session nobody had. This has happened: the model sandbox once
        # sent a retired naming scheme, every value resolved to zero, and the
        # model returned the same answer whatever the sliders said.
        self.assertEqual(result["confidence"], 0.6)  # the rule fallback's PRODUCTIVE

    def test_the_missing_columns_are_named(self):
        partial = dict(self.full)
        del partial["idle_ratio"]
        del partial["run_success_rate"]

        missing = self.predictor._missing_columns(partial)

        self.assertEqual(sorted(missing), ["idle_ratio", "run_success_rate"])

    def test_column_order_is_load_bearing(self):
        # The model reads a positional array. A dict is unordered as far as the
        # caller is concerned, so the extractor's order has to be imposed here
        # or the same features arrive as a different vector.
        reversed_dict = {k: self.full[k] for k in reversed(list(self.full))}
        vector = self.predictor._prepare_features(reversed_dict)
        expected = [reversed_dict[c] for c in self.predictor.feature_columns]
        self.assertEqual(list(vector), expected)


class TestRuleFallback(unittest.TestCase):
    """The RQ1 baseline. Also what answers when no model is loaded."""

    def setUp(self):
        self.predictor = PairStatePredictor()

    def rule(self, **features):
        base = {
            "idle_ratio": 0.2,
            "discussion_note_count": 2,
            "run_attempt_count": 1,
            "run_success_rate": 1.0,
            "navigator_note_count": 1,
            "total_edit_count": 5,
            "seconds_since_role_switch": 30,
        }
        base.update(features)
        return self.predictor._fallback_prediction(base)

    def test_idle_and_silent_is_disengaged(self):
        self.assertEqual(
            self.rule(idle_ratio=0.8, discussion_note_count=0)["state"], "DISENGAGED"
        )

    def test_repeated_failures_is_a_logic_struggle(self):
        self.assertEqual(
            self.rule(run_attempt_count=3, run_success_rate=0.0)["state"], "LOGIC_STRUGGLE"
        )

    def test_a_silent_navigator_beside_a_working_driver(self):
        self.assertEqual(
            self.rule(navigator_note_count=0, total_edit_count=8)["state"],
            "PASSIVE_NAVIGATOR",
        )

    def test_no_rotation_while_the_navigator_talks_is_dominance(self):
        # The distinction the whole taxonomy turns on: a silent navigator is
        # passive, a talking one whose partner will not hand over the keyboard
        # is being dominated.
        self.assertEqual(
            self.rule(seconds_since_role_switch=400, navigator_note_count=3)["state"],
            "DRIVER_DOMINANCE",
        )

    def test_otherwise_productive(self):
        self.assertEqual(self.rule()["state"], "PRODUCTIVE")

    def test_disengagement_is_checked_before_struggle(self):
        # Priority order matters where a window satisfies two rules. A pair who
        # are idle AND have failing runs are not working hard on a hard problem;
        # they stopped.
        result = self.rule(
            idle_ratio=0.9, discussion_note_count=0, run_attempt_count=3, run_success_rate=0.0
        )
        self.assertEqual(result["state"], "DISENGAGED")

    def test_every_answer_is_a_real_state(self):
        for result in [
            self.rule(),
            self.rule(idle_ratio=0.9, discussion_note_count=0),
            self.rule(run_attempt_count=5, run_success_rate=0.0),
            self.rule(navigator_note_count=0, total_edit_count=1),
            self.rule(seconds_since_role_switch=900, navigator_note_count=2),
        ]:
            self.assertTrue(validate_state(result["state"]), result["state"])
            self.assertGreater(result["confidence"], 0.0)


class TestInterventionEngine(unittest.TestCase):
    def setUp(self):
        self.engine = InterventionEngine()

    def test_low_confidence_stays_silent(self):
        result = run(self.engine.recommend("LOGIC_STRUGGLE", 0.2))
        # A mistimed interrupt has a real cost, and the threshold is the only
        # thing standing between a shaky prediction and a nudge about it.
        self.assertEqual(result["action"], "NO_ACTION")

    def test_confident_predictions_map_to_their_intervention(self):
        result = run(self.engine.recommend("DRIVER_DOMINANCE", 0.9))
        self.assertEqual(result["action"], "ROLE_SWITCH_SUPPORT")
        self.assertEqual(result["delivery"]["uiTarget"], "role_switch_button")

    def test_an_unknown_state_stays_silent_rather_than_praising(self):
        # The dangerous default. Falling through to PRODUCTIVE would tell a
        # pair they are doing well on the strength of a state the system does
        # not recognise.
        result = run(self.engine.recommend("SOMETHING_ELSE", 0.99))
        self.assertEqual(result["action"], "NO_ACTION")

    def test_praise_wording_varies_without_mutating_the_mapping(self):
        before = dict(STATE_INTERVENTIONS["PRODUCTIVE"]["delivery"])
        seen = {run(self.engine.recommend("PRODUCTIVE", 0.9))["delivery"]["message"] for _ in range(40)}

        self.assertGreater(len(seen), 1, "repeated praise reads as a canned bot response")
        # The shared mapping is a module-level dict. Writing the rotated
        # message into it would make the "default" whatever fired last.
        self.assertEqual(STATE_INTERVENTIONS["PRODUCTIVE"]["delivery"], before)


class TestLabelMapping(unittest.TestCase):
    """The single source of truth for states and their interventions."""

    def test_five_states(self):
        self.assertEqual(len(PAIR_STATES), 5)
        # LOW_QUALITY_REVIEW is documented future work: not a live class, no
        # intervention mapping, rejected by the trainer.
        self.assertNotIn("LOW_QUALITY_REVIEW", PAIR_STATES)

    def test_every_state_has_a_description_and_an_intervention(self):
        for state in PAIR_STATES:
            self.assertIn(state, STATE_DESCRIPTIONS)
            self.assertIn(state, STATE_INTERVENTIONS)

    def test_no_intervention_carries_solution_content(self):
        # NFR10 is enforced by the shape of this contract: delivery says WHERE
        # to draw attention and with what effect, never what to write.
        for state, intervention in STATE_INTERVENTIONS.items():
            delivery = intervention["delivery"]
            self.assertIn("uiTarget", delivery, state)
            self.assertIn("uiEffect", delivery, state)
            self.assertNotIn("code", delivery, state)
            self.assertNotIn("solution", delivery, state)

    def test_messages_addressed_to_one_student_are_sent_to_one_student(self):
        # Broadcasting "Navigator, you aren't contributing" to both students
        # calls the quieter one out in front of their partner - worse than
        # silence, and worse still when the prediction is wrong.
        navigator = STATE_INTERVENTIONS["PASSIVE_NAVIGATOR"]["delivery"]
        self.assertEqual(navigator.get("audience"), "navigator")

    def test_an_unknown_state_resolves_to_silence(self):
        self.assertEqual(get_intervention_for_state("NOPE"), NO_ACTION)


if __name__ == "__main__":
    unittest.main()
