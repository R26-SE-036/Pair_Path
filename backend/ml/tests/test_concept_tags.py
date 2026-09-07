"""The bridge between the platform taxonomy and the corpus index.

This is the piece that was missing, and its absence was completely silent.
Questions tagged `loop_boundaries` against a corpus tagged `loops`,
`boundaries`, `off-by-one` matched nothing at all: every hint fell through to
the error-keyword path, and to generic guidance whenever there was no error
text to work from. No exception, no warning, no failing test - just a hint
system quietly reduced to one of its two signals.

So these tests assert the thing that actually matters, which is not that the
mapping exists but that every platform tag retrieves something on topic.
"""

import unittest

from rag_context import KNOWLEDGE_DIR, pipeline  # noqa: F401

from app.rag.concept_tags import PLATFORM_TAG_SYNONYMS, expand_concept_tags
from app.rag.knowledge_loader import KnowledgeLoader
from app.rag.rag_service import RAGService
from app.rag.schemas import RAGHintRequest


# The fourteen, from code-coach/knowledge_base/code_coach_errors.json. Written
# out rather than derived from the mapping, so a tag dropped from the mapping
# fails here instead of shrinking the expected set with it.
PLATFORM_CONCEPT_TAGS = {
    "loop_boundaries",
    "conditional_logic",
    "array_indexing",
    "string_comparison",
    "loop_control",
    "control_flow",
    "switch_statements",
    "statement_structure",
    "assignment_logic",
    "boolean_logic",
    "immutable_strings",
    "arithmetic_operations",
    "loop_initialization",
    "loop_termination",
}


class TestMappingCoverage(unittest.TestCase):
    def setUp(self):
        self.chunks = KnowledgeLoader(KNOWLEDGE_DIR).chunks
        self.corpus_tags = {tag for chunk in self.chunks for tag in chunk["tags"]}

    def test_every_platform_tag_is_mapped(self):
        self.assertEqual(set(PLATFORM_TAG_SYNONYMS), PLATFORM_CONCEPT_TAGS)

    def test_every_synonym_exists_in_the_corpus(self):
        # A synonym that matches nothing is indistinguishable from a working one
        # until somebody measures retrieval, which is how this whole class of
        # bug survives.
        dangling = {
            tag: [s for s in synonyms if s not in self.corpus_tags]
            for tag, synonyms in PLATFORM_TAG_SYNONYMS.items()
        }
        self.assertEqual({t: s for t, s in dangling.items() if s}, {})


class TestExpansion(unittest.TestCase):
    def test_a_platform_tag_gains_its_corpus_vocabulary(self):
        expanded = expand_concept_tags(["loop_boundaries"])
        self.assertEqual(expanded[0], "loop_boundaries")
        self.assertIn("off-by-one", expanded)

    def test_synonyms_follow_their_own_tag(self):
        # The retriever gives the FIRST matching tag full weight plus the
        # primary-subject bonus and later ones much less, so appending every
        # synonym at the end would reorder the caller's priorities.
        expanded = expand_concept_tags(["array_indexing", "loop_boundaries"])
        self.assertLess(expanded.index("arrays"), expanded.index("loop_boundaries"))

    def test_an_unknown_tag_passes_through(self):
        # The corpus's own tags are legitimate search terms, and so is anything
        # a question carried before the taxonomy existed.
        self.assertEqual(expand_concept_tags(["arrays", "modulo"]), ["arrays", "modulo"])

    def test_duplicates_are_dropped(self):
        # loop_boundaries and loop_control both expand to "loops".
        expanded = expand_concept_tags(["loop_boundaries", "loop_control"])
        self.assertEqual(len(expanded), len(set(expanded)))

    def test_empty_and_blank_are_ignored(self):
        self.assertEqual(expand_concept_tags([]), [])
        self.assertEqual(expand_concept_tags(["", None]), [])


class TestRetrievalByPlatformTag(unittest.TestCase):
    """The claim that matters: each tag reaches a hint, and the right one."""

    @classmethod
    def setUpClass(cls):
        cls.service = RAGService()

    def hint_for(self, tag):
        return self.service.process_request(
            RAGHintRequest(questionConceptTags=[tag], predictedState="LOGIC_STRUGGLE")
        )

    def test_every_platform_tag_retrieves_rather_than_falling_back(self):
        fell_back = [tag for tag in PLATFORM_CONCEPT_TAGS if self.hint_for(tag).fallbackUsed]
        self.assertEqual(fell_back, [])

    def test_the_retrieved_hint_is_on_topic(self):
        # Retrieving *something* is not the claim. These pairs are the ones
        # worth pinning: each was checked by hand, and two of them were wrong
        # when the mapping was first written - immutable_strings had no corpus
        # entry at all, and control_flow matched entries about parameter
        # passing because `methods` is too broad a synonym for it.
        expected_words = {
            "loop_boundaries": ("off-by-one", "edges"),
            "array_indexing": ("zero-indexed", "positions"),
            "loop_termination": ("condition", "running"),
            "string_comparison": ("equality operator", "same stored"),
            "immutable_strings": ("never be changed", "hands back a new string"),
            "control_flow": ("return", "route through"),
            "arithmetic_operations": ("remainder", "dividing"),
            "statement_structure": ("semicolon", "braces"),
        }

        for tag, words in expected_words.items():
            with self.subTest(tag=tag):
                content = self.hint_for(tag).conceptReminder.lower()
                self.assertTrue(
                    any(word.lower() in content for word in words),
                    f"{tag} retrieved: {content[:120]}",
                )

    def test_a_hint_never_contains_a_solution(self):
        # The architectural guarantee behind the whole RAG-lite design: no
        # corpus document contains the answer to any exercise, so the hint
        # system cannot give one away even when retrieval is confident.
        for tag in PLATFORM_CONCEPT_TAGS:
            with self.subTest(tag=tag):
                hint = self.hint_for(tag)
                whole = " ".join(
                    [hint.conceptReminder, hint.exampleIdea, hint.reflectiveQuestion]
                )
                for giveaway in ("public class", "for (int", "System.out.println"):
                    self.assertNotIn(giveaway, whole)


if __name__ == "__main__":
    unittest.main()
