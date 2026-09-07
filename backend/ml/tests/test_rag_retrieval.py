"""Retrieval: does the right entry come back, and does nothing come back when
nothing fits?

The second half matters more than the first. Early versions always returned
their best match, so a pair holding a NumberFormatException was told about
unclosed braces — confidently, with a source citation. A wrong hint delivered
with certainty sends a student looking in the wrong place, which is worse than
the generic advice they would otherwise have seen. Most of these tests exist to
hold that line.
"""

import unittest

from rag_context import pipeline
from app.rag.retriever import (
    ADDITIONAL_TAG, CODE_KEYWORD, ERROR_KEYWORD, ERROR_KEYWORD_SPECIFIC,
    MIN_SCORE, PRIMARY_TAG_BONUS, STOPWORDS, TAG_MATCH,
    _expand_camel_case, _is_specific, _matches_word, _strip_locations,
)

AIOOBE = ("Exception in thread \"main\" java.lang.ArrayIndexOutOfBoundsException: "
          "Index 5 out of bounds for length 5\n\tat ArraySum.main(ArraySum.java:9)")


def get(retriever, tags=None, error="", code="", top_k=3):
    return retriever.retrieve(tags=tags or [], error_context=error,
                              code_snippet=code, top_k=top_k)


class TestWordMatching(unittest.TestCase):
    """Substring matching caused most of the original false positives."""

    def test_keyword_must_be_a_whole_word(self):
        self.assertFalse(_matches_word("or", "java.lang.error occurred"),
                         "'or' matched inside 'error'")
        self.assertFalse(_matches_word("int", "print the value"),
                         "'int' matched inside 'print'")
        self.assertFalse(_matches_word("for", "for input string: \"abc\""[4:]),
                         "'for' matched inside a longer token")

    def test_real_word_still_matches(self):
        self.assertTrue(_matches_word("bounds", "index 5 out of bounds for length 5"))
        self.assertTrue(_matches_word("nullpointerexception",
                                      "java.lang.nullpointerexception"))

    def test_multi_word_keyword_matches_as_a_phrase(self):
        self.assertTrue(_matches_word("cannot find symbol",
                                      "arraysum.java:6: error: cannot find symbol"))


class TestLocationStripping(unittest.TestCase):
    """A class is named after the exercise, so its filename leaks the exercise's
    vocabulary into every error it ever produces."""

    def test_filename_and_line_are_removed(self):
        cleaned = _strip_locations("ArraySum.java:6: error: ';' expected")
        self.assertNotIn("ArraySum", cleaned)
        self.assertIn("expected", cleaned)

    def test_stack_frames_are_removed(self):
        cleaned = _strip_locations("at ArraySum.main(ArraySum.java:9)")
        self.assertNotIn("ArraySum", cleaned)

    def test_the_error_itself_survives(self):
        cleaned = _strip_locations(AIOOBE)
        self.assertIn("ArrayIndexOutOfBoundsException", cleaned)


class TestCamelCaseExpansion(unittest.TestCase):
    def test_exception_name_splits_into_words(self):
        self.assertEqual(
            "Array Index Out Of Bounds Exception",
            _expand_camel_case("ArrayIndexOutOfBoundsException"),
        )

    def test_ordinary_text_is_unchanged(self):
        self.assertEqual("cannot find symbol", _expand_camel_case("cannot find symbol"))


class TestKeywordSpecificity(unittest.TestCase):
    def test_exception_names_and_phrases_are_specific(self):
        for keyword in ("nullpointerexception", "stackoverflowerror", "cannot find symbol"):
            self.assertTrue(_is_specific(keyword), f"{keyword} should count as specific")

    def test_common_words_are_not(self):
        for keyword in ("expected", "value", "loop", "array"):
            self.assertFalse(_is_specific(keyword), f"{keyword} should not count as specific")

    def test_a_named_exception_outweighs_a_perfect_tag_match(self):
        """The ordering that decides which signal wins.

        A tag says what the question is nominally about; the exception says what
        is breaking right now. If this inequality ever flips, an error match can
        be buried by topic tags — which is exactly the bug that handed a pair
        holding "cannot find symbol" a hint about array traversal.
        """
        self.assertGreater(ERROR_KEYWORD_SPECIFIC, TAG_MATCH + PRIMARY_TAG_BONUS)
        self.assertGreater(TAG_MATCH, ERROR_KEYWORD)
        self.assertGreater(ERROR_KEYWORD, ADDITIONAL_TAG)
        self.assertGreaterEqual(ADDITIONAL_TAG, CODE_KEYWORD)


class TestRetrievalFindsTheRightEntry(unittest.TestCase):
    def setUp(self):
        _, self.retriever, _, _ = pipeline()

    def test_array_bounds_error_retrieves_an_arrays_entry(self):
        top = get(self.retriever, error=AIOOBE)[0]
        self.assertEqual("java_arrays#0", top["id"])

    def test_missing_symbol_retrieves_a_compile_error_entry(self):
        """Tagged 'arrays', but the error is about a symbol, not an array.

        The filename is ArraySum.java and the question tag is 'arrays', so every
        weak signal points at the arrays entries. The error still has to win.
        """
        top = get(self.retriever, tags=["arrays"],
                  error="ArraySum.java:6: error: cannot find symbol")[0]
        self.assertEqual("java_compile_errors#0", top["id"])

    def test_missing_semicolon_retrieves_the_semicolon_entry(self):
        top = get(self.retriever, tags=["arrays"],
                  error="ArraySum.java:6: error: ';' expected")[0]
        self.assertEqual("java_compile_errors#3", top["id"])

    def test_null_pointer_retrieves_a_runtime_error_entry(self):
        top = get(self.retriever, tags=["conditions"],
                  error="Exception in thread \"main\" java.lang.NullPointerException")[0]
        self.assertEqual("java_runtime_errors#1", top["id"])

    def test_number_format_retrieves_its_own_entry(self):
        """The case that used to return 'unclosed braces' with full confidence."""
        top = get(self.retriever,
                  error="java.lang.NumberFormatException: For input string: \"abc\"")[0]
        self.assertEqual("java_runtime_errors#2", top["id"])

    def test_a_tag_alone_still_retrieves(self):
        """Not every intervention has an error attached to it."""
        results = get(self.retriever, tags=["pair programming", "collaboration", "role"])
        self.assertTrue(results)
        self.assertTrue(results[0]["id"].startswith("pair_programming_guidance"))


class TestAbstention(unittest.TestCase):
    """Returning nothing is a valid, and sometimes the only honest, answer."""

    def setUp(self):
        _, self.retriever, _, _ = pipeline()

    def test_unrelated_error_returns_nothing(self):
        results = get(self.retriever,
                      error="org.hibernate.LazyInitializationException: could not "
                            "initialize proxy - no Session")
        self.assertEqual([], results,
                         f"expected abstention, got {[r['id'] for r in results]}")

    def test_empty_request_returns_nothing(self):
        self.assertEqual([], get(self.retriever))

    def test_unknown_tag_returns_nothing(self):
        self.assertEqual([], get(self.retriever, tags=["kubernetes", "helm"]))

    def test_stopwords_alone_cannot_trigger_a_hint(self):
        """Every Java error contains these words. If they could score, every
        error would retrieve something."""
        results = get(self.retriever, error=" ".join(sorted(STOPWORDS)))
        self.assertEqual([], results,
                         f"stopwords alone retrieved {[r['id'] for r in results]}")

    def test_nothing_below_the_threshold_is_ever_returned(self):
        probes = [
            {"error": AIOOBE},
            {"tags": ["arrays"], "error": "ArraySum.java:6: error: cannot find symbol"},
            {"tags": ["loops"]},
            {"code": "for (int i = 0; i <= arr.length; i++)"},
        ]
        for probe in probes:
            for chunk in get(self.retriever, **probe):
                self.assertGreaterEqual(
                    chunk["score"], MIN_SCORE,
                    f"{chunk['id']} returned with score {chunk['score']} "
                    f"below MIN_SCORE={MIN_SCORE} for {probe}",
                )


class TestRankingContract(unittest.TestCase):
    def setUp(self):
        _, self.retriever, _, _ = pipeline()

    def test_results_are_ordered_best_first(self):
        scores = [c["score"] for c in get(self.retriever, error=AIOOBE)]
        self.assertEqual(sorted(scores, reverse=True), scores)

    def test_top_k_is_respected(self):
        for k in (1, 2, 3):
            self.assertLessEqual(len(get(self.retriever, error=AIOOBE, top_k=k)), k)

    def test_retrieval_is_deterministic(self):
        """No sampling anywhere in the pipeline — the same window must produce
        the same hint every time it is shown."""
        first = [c["id"] for c in get(self.retriever, error=AIOOBE)]
        for _ in range(5):
            self.assertEqual(first, [c["id"] for c in get(self.retriever, error=AIOOBE)])

    def test_score_breakdown_accounts_for_the_total(self):
        """The breakdown is what a reviewer reads to see why an entry won."""
        for chunk in get(self.retriever, tags=["arrays"], error=AIOOBE):
            self.assertEqual(sum(chunk["scoreBreakdown"].values()), chunk["score"],
                             f"{chunk['id']} breakdown does not sum to its score")


if __name__ == "__main__":
    unittest.main(verbosity=2)
