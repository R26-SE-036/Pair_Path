"""A written hint for every mistake Code Coach can name.

Retrieval picks a hint from the exercise's concept tags and the run's error
text. A program that runs and prints the wrong answer has no error text, so for
a logic mistake the hint came down to the exercise's topic: the same advice for
every mistake on it, and for some the wrong advice. Measured over Code Coach's
thirty error types, about half got a hint that pointed at the actual mistake.

When Code Coach has found the mistake in the pair's code, the gateway passes
its name and the hint written for it is used as it is.
"""

import os
import unittest

from rag_context import ML_ROOT, ask, pipeline
from test_rag_corpus import TestCorpusContainsNoSolutionCode

from app.rag.knowledge_loader import KnowledgeLoader
from app.rag.schemas import RAGHintRequest

ERROR_TYPE_DIR = os.path.join(ML_ROOT, "app", "data", "error_type_hints")

# Every error type and its concept tag, from
# code-coach/knowledge_base/code_coach_errors.json. Written out so a type
# missing from the hints fails here rather than quietly getting a ranked guess.
CODE_COACH_ERROR_TYPES = {
    "OFF_BY_ONE_LOOP_BOUNDARY": "loop_boundaries",
    "INCORRECT_CONDITIONAL_OPERATOR": "conditional_logic",
    "ARRAY_LENGTH_INDEX_MISUSE": "array_indexing",
    "STRING_EQUALITY_WITH_OPERATOR": "string_comparison",
    "LOOP_UPDATE_WRONG_DIRECTION": "loop_control",
    "UNREACHABLE_CODE_AFTER_RETURN": "control_flow",
    "MISSING_BREAK_IN_SWITCH": "switch_statements",
    "EMPTY_CONDITIONAL_BODY": "statement_structure",
    "SELF_ASSIGNMENT": "assignment_logic",
    "ALWAYS_TRUE_OR_CONDITION": "boolean_logic",
    "IGNORED_STRING_METHOD_RESULT": "immutable_strings",
    "DIVISION_BY_ZERO_LITERAL": "arithmetic_operations",
    "CONSTANT_FALSE_LOOP_CONDITION": "loop_initialization",
    "DUPLICATE_IF_ELSE_CONDITION": "conditional_logic",
    "WHILE_VARIABLE_NOT_UPDATED": "loop_termination",
    "INTEGER_DIVISION_IN_DECIMAL_CONTEXT": "arithmetic_operations",
    "DECIMAL_EQUALITY_COMPARISON": "arithmetic_operations",
    "POSTFIX_INCREMENT_ASSIGNED_BACK": "assignment_logic",
    "ALWAYS_FALSE_AND_CONDITION": "boolean_logic",
    "LOOP_SKIPS_LAST_ELEMENT": "loop_boundaries",
    "INDEX_PLUS_ONE_OUT_OF_BOUNDS": "array_indexing",
    "WRONG_LOOP_VARIABLE_IN_INDEX": "array_indexing",
    "NESTED_LOOP_WRONG_COUNTER": "loop_control",
    "LOOP_COUNTER_CHANGED_IN_BODY": "loop_control",
    "ACCUMULATOR_RESET_INSIDE_LOOP": "loop_initialization",
    "WRONG_EXTREME_INITIAL_VALUE": "loop_initialization",
    "EARLY_RETURN_IN_LOOP": "control_flow",
    "UNREACHABLE_ELSE_IF_ORDER": "conditional_logic",
    "MISLEADING_INDENTATION_NO_BRACES": "statement_structure",
    "NON_SHORT_CIRCUIT_OPERATOR": "boolean_logic",
}


def entries():
    return KnowledgeLoader(ERROR_TYPE_DIR).chunks


def ask_with(service, detected, tags=None, error="", state="LOGIC_STRUGGLE"):
    return service.process_request(RAGHintRequest(
        predictedState=state,
        interventionType="LOGIC_HINT",
        questionConceptTags=tags or [],
        recentErrorContext=error,
        detectedErrorTypes=detected,
    ))


class TestEveryErrorTypeHasAHint(unittest.TestCase):
    def test_each_of_the_thirty_has_exactly_one_entry(self):
        found = [c["error_type"] for c in entries()]
        self.assertEqual(sorted(CODE_COACH_ERROR_TYPES), sorted(found))

    def test_every_entry_names_an_error_type(self):
        """A block that lost its ErrorType line could never be looked up."""
        for c in entries():
            self.assertTrue(c["error_type"], f"{c['id']} has no ErrorType")

    def test_the_first_tag_is_the_error_types_concept(self):
        for c in entries():
            self.assertEqual(CODE_COACH_ERROR_TYPES[c["error_type"]], c["tags"][0],
                             f"{c['error_type']} is not filed under its concept")


class TestEveryHintIsComplete(unittest.TestCase):
    def test_all_three_parts_are_written(self):
        for c in entries():
            self.assertGreater(len(c["content"]), 60, f"{c['error_type']} content is a stub")
            self.assertTrue(c["example"], f"{c['error_type']} has no example")
            self.assertTrue(c["question"].rstrip().endswith("?"),
                            f"{c['error_type']} question does not ask anything")

    def test_tags_are_normalised(self):
        for c in entries():
            for tag in c["tags"]:
                self.assertEqual(tag, tag.strip().lower(), f"{c['error_type']} tag {tag!r}")

    def test_no_two_hints_say_the_same_thing(self):
        for field in ("content", "example", "question"):
            values = [c[field] for c in entries()]
            self.assertEqual(len(values), len(set(values)), f"two entries share a {field}")

    def test_no_hint_contains_java_code(self):
        """The same guarantee as the rest of the corpus: describe, never solve."""
        for c in entries():
            for field in ("content", "example", "question"):
                for pattern, description in TestCorpusContainsNoSolutionCode.CODE_MARKERS:
                    self.assertIsNone(pattern.search(c[field]),
                                      f"{c['error_type']} {field} contains {description}")


class TestADetectedMistakeGetsItsOwnHint(unittest.TestCase):
    def setUp(self):
        self.loader, _, _, self.service = pipeline()

    def test_every_type_returns_its_own_entry(self):
        by_type = {c["error_type"]: c for c in entries()}
        for error_type, entry in by_type.items():
            r = ask_with(self.service, [error_type])
            self.assertFalse(r.fallbackUsed)
            self.assertEqual(entry["content"], r.conceptReminder)
            self.assertEqual(entry["example"], r.exampleIdea)
            self.assertEqual(entry["question"], r.reflectiveQuestion)
            self.assertEqual([entry["id"]], r.sourceChunks)
            self.assertIn(error_type, r.sourceChunks[0])

    def test_a_wrong_answer_on_an_arithmetic_exercise_is_not_about_the_remainder(self):
        """The case that showed the problem. Ranked on the exercise's tags alone,
        an integer-division mistake got the entry about the % operator."""
        before = ask(self.service, tags=["arithmetic_operations"])
        self.assertIn("remainder", before.conceptReminder)

        after = ask_with(self.service, ["INTEGER_DIVISION_IN_DECIMAL_CONTEXT"],
                         tags=["arithmetic_operations"])
        self.assertIn("whole numbers", after.conceptReminder)
        self.assertNotIn("remainder", after.conceptReminder)

    def test_the_most_confident_known_type_wins(self):
        r = ask_with(self.service, ["NOT_A_CODE_COACH_TYPE", "MISSING_BREAK_IN_SWITCH",
                                    "SELF_ASSIGNMENT"])
        self.assertIn("MISSING_BREAK_IN_SWITCH", r.sourceChunks[0])

    def test_an_unknown_type_falls_back_to_retrieval(self):
        error = 'Exception in thread "main" java.lang.ArithmeticException: / by zero'
        expected = ask(self.service, error=error)
        r = ask_with(self.service, ["NOT_A_CODE_COACH_TYPE"], error=error)
        self.assertEqual(expected.sourceChunks, r.sourceChunks)

    def test_nothing_detected_changes_nothing(self):
        expected = ask(self.service, tags=["loop_boundaries"])
        r = ask_with(self.service, [], tags=["loop_boundaries"])
        self.assertEqual(expected, r)

    def test_a_collaboration_problem_still_gets_a_collaboration_prompt(self):
        """A bug in the code is not what a pair with one silent partner needs to hear."""
        r = self.service.process_request(RAGHintRequest(
            predictedState="PASSIVE_NAVIGATOR", interventionType="UNKNOWN",
            detectedErrorTypes=["OFF_BY_ONE_LOOP_BOUNDARY"],
        ))
        self.assertEqual("COLLABORATION_PROMPT", r.interventionType)
        self.assertFalse(any("OFF_BY_ONE" in s for s in r.sourceChunks))

    def test_a_wrong_answer_is_explained_by_a_mistake_that_does_not_crash(self):
        """What Code Coach's detector returns for `average = total / count`,
        divisor first. The run finished, so the divisor was not zero."""
        detected = ["DIVISION_BY_ZERO_LITERAL", "INTEGER_DIVISION_IN_DECIMAL_CONTEXT"]
        r = ask_with(self.service, detected)
        self.assertIn("INTEGER_DIVISION_IN_DECIMAL_CONTEXT", r.sourceChunks[0])

    def test_a_crash_is_explained_by_the_mistake_that_raises_it(self):
        detected = ["DIVISION_BY_ZERO_LITERAL", "INTEGER_DIVISION_IN_DECIMAL_CONTEXT"]
        r = ask_with(self.service, detected,
                     error='Exception in thread "main" java.lang.ArithmeticException: / by zero')
        self.assertIn("DIVISION_BY_ZERO_LITERAL", r.sourceChunks[0])

        r = ask_with(self.service, ["INTEGER_DIVISION_IN_DECIMAL_CONTEXT", "OFF_BY_ONE_LOOP_BOUNDARY"],
                     error="java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 5")
        self.assertIn("OFF_BY_ONE_LOOP_BOUNDARY", r.sourceChunks[0])

    def test_a_crash_only_mistake_is_still_better_than_a_guess(self):
        """Alone, it is still a real mistake in the pair's code."""
        r = ask_with(self.service, ["ARRAY_LENGTH_INDEX_MISUSE"])
        self.assertIn("ARRAY_LENGTH_INDEX_MISUSE", r.sourceChunks[0])

    def test_findings_the_run_says_nothing_about_keep_the_detectors_order(self):
        r = ask_with(self.service, ["SELF_ASSIGNMENT", "MISSING_BREAK_IN_SWITCH"],
                     error="Command failed: the program ran for too long")
        self.assertIn("SELF_ASSIGNMENT", r.sourceChunks[0])

    def test_code_after_a_return_is_covered_on_the_compile_error_path(self):
        """Java does not compile it, and the gateway leaves the detector out after
        a failed compile, so this mistake reaches the pair through retrieval on
        the compiler's message - which used to return the missing-return entry."""
        r = ask(self.service, tags=["control_flow"],
                error="Main.java:5: error: unreachable statement\n        total = 0;\n1 error")
        self.assertFalse(r.fallbackUsed)
        self.assertTrue(r.conceptReminder.startswith("Unreachable statement"))

    def test_these_entries_never_enter_keyword_ranking(self):
        """Reached by name only, so the measured retrieval corpus is unchanged."""
        self.assertFalse(any(c["error_type"] for c in self.loader.chunks))
        self.assertFalse(any(c["error_type"] for c in self.service.loader.chunks))


if __name__ == "__main__":
    unittest.main(verbosity=2)
