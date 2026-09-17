"""End to end: a predicted state and an error go in, a three-part hint comes out.

This is the path the API actually calls. The tests here check the contract the
frontend depends on (every field populated, always) and the claim the
dissertation depends on (the text is retrieved, never generated).
"""

import time
import unittest

from rag_context import ask, pipeline
from app.rag.hint_generator import DEFAULT_FALLBACK, FALLBACKS
from app.rag.schemas import RAGHintRequest

AIOOBE = ("Exception in thread \"main\" java.lang.ArrayIndexOutOfBoundsException: "
          "Index 5 out of bounds for length 5")
UNRELATED = ("org.hibernate.LazyInitializationException: could not initialize "
             "proxy - no Session")


class TestResponseContract(unittest.TestCase):
    """The UI renders all three parts unconditionally, so none may be blank —
    including on the abstention path, which is where a missing field would
    otherwise slip through."""

    def setUp(self):
        _, _, _, self.service = pipeline()

    def test_a_retrieved_hint_is_fully_populated(self):
        r = ask(self.service, error=AIOOBE)
        self.assertFalse(r.fallbackUsed)
        for field in ("conceptReminder", "exampleIdea", "reflectiveQuestion"):
            self.assertTrue(getattr(r, field).strip(), f"{field} is empty")

    def test_an_abstention_is_also_fully_populated(self):
        r = ask(self.service, error=UNRELATED)
        self.assertTrue(r.fallbackUsed)
        for field in ("conceptReminder", "exampleIdea", "reflectiveQuestion"):
            self.assertTrue(getattr(r, field).strip(), f"{field} is empty on the fallback path")

    def test_sources_are_cited_when_something_was_retrieved(self):
        loader, _, _, _ = pipeline()
        known = {c["id"] for c in loader.chunks}
        r = ask(self.service, error=AIOOBE)
        self.assertTrue(r.sourceChunks)
        for source in r.sourceChunks:
            self.assertIn(source, known, f"cited a source not in the corpus: {source}")

    def test_no_sources_are_cited_when_nothing_was_retrieved(self):
        """A fallback must not look like a grounded answer."""
        r = ask(self.service, error=UNRELATED)
        self.assertEqual([], r.sourceChunks)
        self.assertEqual([], r.retrievedConcepts)

    def test_concepts_are_deduplicated(self):
        r = ask(self.service, error=AIOOBE)
        self.assertEqual(len(r.retrievedConcepts), len(set(r.retrievedConcepts)))


class TestHintTextIsRetrievedNotGenerated(unittest.TestCase):
    """The safety claim, stated as a test.

    PairPath does no generation: there is no model and no prompt in this path.
    Every word a student sees is either a corpus entry returned verbatim or one
    of the hardcoded fallbacks. If this test ever fails, the system is composing
    text, and nothing in the pipeline constrains what it might say.
    """

    def setUp(self):
        self.loader, _, _, self.service = pipeline()

    def test_every_part_of_a_hint_appears_verbatim_in_the_corpus(self):
        probes = [
            {"error": AIOOBE},
            {"tags": ["arrays"], "error": "ArraySum.java:6: error: cannot find symbol"},
            {"error": "java.lang.NumberFormatException: For input string: \"abc\""},
            {"tags": ["conditions"],
             "error": "Exception in thread \"main\" java.lang.NullPointerException"},
        ]
        contents = {c["content"].strip() for c in self.loader.chunks}
        examples = {c["example"].strip() for c in self.loader.chunks}
        questions = {c["question"].strip() for c in self.loader.chunks}

        for probe in probes:
            r = ask(self.service, **probe)
            self.assertFalse(r.fallbackUsed, f"expected a retrieved hint for {probe}")
            self.assertIn(r.conceptReminder.strip(), contents,
                          f"conceptReminder is not a corpus entry for {probe}")
            self.assertIn(r.exampleIdea.strip(), examples,
                          f"exampleIdea is not a corpus entry for {probe}")
            self.assertIn(r.reflectiveQuestion.strip(), questions,
                          f"reflectiveQuestion is not a corpus entry for {probe}")

    def test_the_hint_comes_from_the_entry_that_was_cited(self):
        """Citation and content must describe the same entry — otherwise the
        source list is decoration rather than provenance."""
        r = ask(self.service, error=AIOOBE)
        cited = next(c for c in self.loader.chunks if c["id"] == r.sourceChunks[0])
        self.assertEqual(cited["content"].strip(), r.conceptReminder.strip())
        self.assertEqual(cited["example"].strip(), r.exampleIdea.strip())
        self.assertEqual(cited["question"].strip(), r.reflectiveQuestion.strip())

    def test_fallback_text_is_one_of_the_hardcoded_options(self):
        known = [DEFAULT_FALLBACK] + list(FALLBACKS.values())
        r = ask(self.service, error=UNRELATED)
        self.assertIn(
            r.conceptReminder.strip(),
            [f["conceptReminder"].strip() for f in known],
            "fallback text is not one of the written fallbacks",
        )


class TestStateToInterventionMapping(unittest.TestCase):
    """Each collaboration state has to reach the intervention written for it."""

    def setUp(self):
        _, _, _, self.service = pipeline()

    def ask_state(self, state):
        return self.service.process_request(RAGHintRequest(
            predictedState=state, interventionType="UNKNOWN",
        ))

    def test_each_state_maps_to_its_intervention(self):
        expected = {
            "LOGIC_STRUGGLE": "LOGIC_HINT",
            "PASSIVE_NAVIGATOR": "COLLABORATION_PROMPT",
            "DRIVER_DOMINANCE": "ROLE_BALANCE_PROMPT",
            "PRODUCTIVE": "CONCEPT_HINT",
            "DISENGAGED": "CONCEPT_HINT",
        }
        for state, intervention in expected.items():
            self.assertEqual(intervention, self.ask_state(state).interventionType,
                             f"{state} mapped to the wrong intervention")

    def test_an_explicit_intervention_type_is_respected(self):
        r = self.service.process_request(RAGHintRequest(
            predictedState="LOGIC_STRUGGLE", interventionType="ROLE_BALANCE_PROMPT",
        ))
        self.assertEqual("ROLE_BALANCE_PROMPT", r.interventionType)

    def test_collaboration_states_retrieve_collaboration_guidance(self):
        """These two fire without any error attached, so the injected tags are
        the only thing keeping them off the generic fallback."""
        for state in ("PASSIVE_NAVIGATOR", "DRIVER_DOMINANCE"):
            r = self.ask_state(state)
            self.assertFalse(r.fallbackUsed, f"{state} fell back to generic advice")
            self.assertTrue(
                r.sourceChunks[0].startswith("pair_programming_guidance"),
                f"{state} retrieved {r.sourceChunks[0]} instead of pair-programming guidance",
            )


class TestNoSolutionCodeReachesTheStudent(unittest.TestCase):
    """Corpus-level code checks live in test_rag_corpus; this checks the
    assembled response, which is what a student actually reads."""

    def setUp(self):
        _, _, _, self.service = pipeline()

    def test_responses_contain_no_code(self):
        probes = [
            {"error": AIOOBE},
            {"error": UNRELATED},
            {"tags": ["loops"], "code": "for (int i = 0; i <= arr.length; i++) {"},
            {"error": "java.lang.StackOverflowError"},
        ]
        for probe in probes:
            r = ask(self.service, **probe)
            text = " ".join([r.conceptReminder, r.exampleIdea, r.reflectiveQuestion])
            for marker in ("{", "}", "System.out.", "= new "):
                self.assertNotIn(marker, text,
                                 f"response to {probe} contains {marker!r}")

    def test_the_students_own_code_is_never_echoed_back(self):
        """The snippet is a retrieval signal, not something to quote."""
        snippet = "int secretTotal = 12345;"
        r = ask(self.service, code=snippet, error=AIOOBE)
        text = " ".join([r.conceptReminder, r.exampleIdea, r.reflectiveQuestion])
        self.assertNotIn("secretTotal", text)


class TestServingPerformance(unittest.TestCase):
    def test_hint_generation_is_fast_enough_to_be_live(self):
        """Retrieval runs inside the same request that classifies the window,
        so it shares the 100 ms interaction budget with the model."""
        _, _, _, service = pipeline()
        ask(service, error=AIOOBE)  # warm the compiled-pattern cache

        times = []
        for _ in range(100):
            start = time.perf_counter()
            ask(service, tags=["arrays"], error=AIOOBE)
            times.append((time.perf_counter() - start) * 1000)

        mean = sum(times) / len(times)
        self.assertLess(mean, 50.0, f"mean hint latency {mean:.2f} ms is too slow to serve live")


if __name__ == "__main__":
    unittest.main(verbosity=2)
