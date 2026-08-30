"""The knowledge corpus is the entire content of the hint system.

There is no language model in this pipeline — whatever a student reads was
written by hand into one of these files and returned verbatim. That makes the
corpus a research artifact rather than a config file: a malformed entry is a
hint that never fires, and a code snippet that slipped into an Example is the
system handing over an answer it was designed never to give.
"""

import re
import unittest

from rag_context import (
    KNOWLEDGE_DIR, REQUIRED_FIELDS, corpus_files, pipeline, raw_blocks,
)
from app.rag.retriever import STOPWORDS


class TestCorpusLoads(unittest.TestCase):
    def test_knowledge_directory_is_present(self):
        self.assertTrue(corpus_files(), f"no .txt corpus files in {KNOWLEDGE_DIR}")

    def test_loader_returns_entries(self):
        loader, _, _, _ = pipeline()
        self.assertTrue(loader.chunks, "corpus loaded but produced no entries")

    def test_no_entry_is_silently_dropped(self):
        """The parser discards any block without a Content field.

        That discard is deliberate but invisible — nothing logs it. If someone
        adds an entry and mistypes `Content:`, retrieval simply never sees it
        and the corpus quietly shrinks.
        """
        loader, _, _, _ = pipeline()
        blocks = raw_blocks()
        loaded = {c["id"] for c in loader.chunks}
        missing = [b["id"] for b in blocks if b["id"] not in loaded]
        self.assertEqual([], missing, f"blocks present in the files but dropped at parse: {missing}")

    def test_entry_ids_are_unique(self):
        loader, _, _, _ = pipeline()
        ids = [c["id"] for c in loader.chunks]
        dupes = {i for i in ids if ids.count(i) > 1}
        self.assertEqual(set(), dupes, f"duplicate entry ids: {dupes}")


class TestEveryEntryIsComplete(unittest.TestCase):
    """A hint has three parts. An entry missing one degrades to generic text."""

    def test_all_five_fields_are_declared(self):
        for block in raw_blocks():
            missing = [f for f in REQUIRED_FIELDS if f not in block["text"]]
            self.assertEqual([], missing, f"{block['id']} is missing {missing}")

    def test_no_field_is_empty(self):
        loader, _, _, _ = pipeline()
        for c in loader.chunks:
            for field in ("tags", "keywords", "content", "example", "question"):
                self.assertTrue(c[field], f"{c['id']} has an empty {field}")

    def test_content_is_prose_not_a_stub(self):
        loader, _, _, _ = pipeline()
        for c in loader.chunks:
            self.assertGreater(
                len(c["content"]), 60,
                f"{c['id']} content is too short to explain anything: {c['content']!r}",
            )

    def test_reflective_question_is_a_question(self):
        """The third part of the scaffold has to actually ask something."""
        loader, _, _, _ = pipeline()
        for c in loader.chunks:
            self.assertTrue(
                c["question"].rstrip().endswith("?"),
                f"{c['id']} question does not end in '?': {c['question']!r}",
            )

    def test_tags_and_keywords_are_normalised(self):
        """Scoring lowercases the query, so a capitalised keyword never matches."""
        loader, _, _, _ = pipeline()
        for c in loader.chunks:
            for field in ("tags", "keywords"):
                for value in c[field]:
                    self.assertEqual(value, value.lower(),
                                     f"{c['id']} has non-lowercase {field}: {value!r}")
                    self.assertEqual(value, value.strip(),
                                     f"{c['id']} has untrimmed {field}: {value!r}")


class TestEntriesAreReachable(unittest.TestCase):
    def test_every_entry_has_a_scoreable_keyword(self):
        """Stopwords are excluded from scoring entirely.

        An entry keyed only on words like "error" or "java" can never be
        retrieved by an error message — it is in the corpus but unreachable.
        """
        loader, _, _, _ = pipeline()
        for c in loader.chunks:
            scoreable = [k for k in c["keywords"] if k not in STOPWORDS]
            self.assertTrue(
                scoreable,
                f"{c['id']} keywords are all stopwords, so it can never match an error: "
                f"{c['keywords']}",
            )

    def test_no_two_entries_are_identical(self):
        """Duplicated content means two entries compete and split the corpus."""
        loader, _, _, _ = pipeline()
        seen = {}
        for c in loader.chunks:
            key = c["content"].strip().lower()
            self.assertNotIn(key, seen,
                             f"{c['id']} duplicates the content of {seen.get(key)}")
            seen[key] = c["id"]


class TestCorpusContainsNoSolutionCode(unittest.TestCase):
    """The safety guarantee behind retrieval-without-generation.

    PairPath scaffolds; it does not solve. Because entries are returned
    verbatim, the only way a solution can reach a student is if someone writes
    one into the corpus. This is the check that stops that.
    """

    # Chosen to catch Java statements while staying clear of prose. The word
    # "public" alone is not evidence — several entries discuss the public class
    # naming rule in plain English.
    CODE_MARKERS = (
        (re.compile(r"[{}]"), "braces"),
        (re.compile(r"System\.out\."), "a System.out call"),
        (re.compile(r"=\s*new\s+\w"), "an object instantiation"),
        (re.compile(r"\)\s*;"), "a terminated call"),
        (re.compile(r"\b(?:int|String|double|boolean)\s+\w+\s*="), "a variable declaration"),
    )

    def test_no_entry_contains_java_code(self):
        loader, _, _, _ = pipeline()
        for c in loader.chunks:
            for field in ("content", "example", "question"):
                for pattern, description in self.CODE_MARKERS:
                    match = pattern.search(c[field])
                    if match:
                        self.fail(
                            f"{c['id']} {field} appears to contain {description} "
                            f"({match.group(0)!r} in {c[field][:80]!r}). The corpus "
                            f"must describe the idea, never supply the code."
                        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
