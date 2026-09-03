import re
from typing import Dict, List

from .knowledge_loader import KnowledgeLoader

# Scoring weights, ordered by how much each signal can be trusted.
TAG_MATCH = 5          # someone deliberately tagged this question
PRIMARY_TAG_BONUS = 2  # ...and it is this entry's main subject
ADDITIONAL_TAG = 1     # each further tag match, worth much less — see below
ERROR_KEYWORD = 3      # the error the pair is actually looking at
CODE_KEYWORD = 1       # code mentions many things incidentally


def _strip_locations(text: str) -> str:
    """Remove file names and stack frames from an error.

    A student's class is called whatever their exercise is called, so
    "ArraySum.java:6" contributes the words "array" and "sum" to every error
    that file ever produces — which had a missing semicolon retrieving a hint
    about array traversal. The location tells you where the failure is, never
    which concept it involves.
    """
    text = re.sub(r"\bat\s+[\w.$]+\([^)]*\)", " ", text)      # stack frames
    text = re.sub(r"\b[A-Za-z_$][\w$]*\.java(:\d+)?", " ", text)  # Foo.java:12
    return text


def _expand_camel_case(text: str) -> str:
    """Split run-together names so their parts can be matched as words.

    Java exception names arrive as one token — ArrayIndexOutOfBoundsException —
    and whole-word matching cannot see the words inside it. Expanding it to
    "array index out of bounds exception" lets an entry keyed on "bounds" match
    the exception that is actually about bounds.
    """
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)

# A long, distinctive token appearing verbatim in an error is not coincidence.
# "stackoverflowerror" or "';' expected" identifies the problem on its own,
# whereas "expected" or "value" could turn up in almost anything — so match
# strength is graded by how specific the keyword is, not just how many hit.
# Deliberately above TAG_MATCH + PRIMARY_TAG_BONUS. A named exception sitting in
# the pair's actual error describes what is breaking right now; a tag only
# describes what the question is nominally about. When a pair on a conditions
# exercise hits a NullPointerException, the exception is the more useful thing
# to explain.
ERROR_KEYWORD_SPECIFIC = 8


def _is_specific(keyword: str) -> bool:
    """Does this keyword identify a problem on its own?

    Two kinds qualify: the name of a Java exception or error, and a multi-word
    phrase. Both are distinctive enough that appearing verbatim in an error is
    not coincidence.

    Keyword *length* was tried first and is not a reliable proxy — "initialize"
    is ten characters yet turns up in unrelated messages, which had a Hibernate
    proxy error retrieving a hint about Java array defaults.
    """
    return (
        keyword.endswith("exception")
        or keyword.endswith("error")
        or " " in keyword
    )

# Below this, the best match is treated as coincidence and nothing is returned,
# so the caller falls back to generic guidance.
#
# A wrong-but-specific hint is worse than no hint: a student holding a
# NumberFormatException who is told about unclosed braces will go looking in
# the wrong place. Scoring 3 means a single weak signal fired, which is not
# enough to name a concept with confidence.
MIN_SCORE = 5

# Tokens that appear in almost any Java error and therefore carry no
# information about which concept is involved. Kept out of scoring entirely so
# a corpus entry cannot win on them.
STOPWORDS = {
    "java", "lang", "util", "exception", "error", "thread", "main",
    "at", "in", "the", "a", "an", "is", "of", "to", "for", "or", "and", "not",
}

_WORD_CACHE: Dict[str, re.Pattern] = {}


def _matches_word(keyword: str, text: str) -> bool:
    """Whole-word match.

    Substring matching produced most of the false positives here: 'or' matched
    "err-or-", 'int' matched "pr-int-", 'for' matched "For input string".
    """
    pattern = _WORD_CACHE.get(keyword)
    if pattern is None:
        pattern = re.compile(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])")
        _WORD_CACHE[keyword] = pattern
    return bool(pattern.search(text))


class KeywordRetriever:
    def __init__(self, loader: KnowledgeLoader):
        self.loader = loader

    def retrieve(
        self,
        tags: List[str],
        error_context: str,
        code_snippet: str,
        top_k: int = 3,
    ) -> List[Dict]:
        chunks = self.loader.chunks
        if not chunks:
            return []

        search_tags = [t.lower() for t in tags if t]
        # Both forms are searched: the raw text so a run-together exception
        # name still matches a keyword written the same way, and the expanded
        # form so an entry keyed on "bounds" matches ArrayIndexOutOfBounds.
        cleaned = _strip_locations(error_context or "")
        raw_error = cleaned.lower()
        error_lower = (raw_error + " " + _expand_camel_case(cleaned).lower()).strip()
        code_lower = (code_snippet or "").lower()

        scored = []
        for chunk in chunks:
            score, breakdown = self._score(chunk, search_tags, error_lower, code_lower)
            if score > 0:
                scored.append({**chunk, "score": score, "scoreBreakdown": breakdown})

        scored.sort(key=lambda c: c["score"], reverse=True)

        # Abstain rather than guess. Returning nothing lets the caller serve
        # generic guidance, which is honest; returning the least-bad entry
        # sends the pair to the wrong concept with full confidence.
        if not scored or scored[0]["score"] < MIN_SCORE:
            return []

        # The threshold applies to every entry returned, not only the best one.
        # The hint text is taken from the top match alone, but the whole list is
        # reported as sourceChunks — so an entry scoring below the level this
        # module treats as coincidence would be cited as a source for a hint it
        # contributed nothing to.
        return [c for c in scored if c["score"] >= MIN_SCORE][:top_k]

    @staticmethod
    def _score(chunk, search_tags, error_lower, code_lower):
        score = 0
        breakdown = {"tag": 0, "primary": 0, "error": 0, "code": 0}
        chunk_tags = chunk.get("tags", [])

        # Only the first tag match counts fully. Tags say what the question is
        # about, not what is failing right now, and an entry tagged with three
        # of them used to out-score any error match — which is how a pair
        # holding "cannot find symbol" on an arrays question was handed a hint
        # about array traversal.
        matched_tags = 0
        for tag in search_tags:
            if tag in chunk_tags:
                matched_tags += 1
                weight = TAG_MATCH if matched_tags == 1 else ADDITIONAL_TAG
                score += weight
                breakdown["tag"] += weight
                # An entry whose *main* subject is the searched topic beats one
                # that merely mentions it. Without this, a search for "loops"
                # can return an arrays entry that happens to be tagged loops,
                # because both score identically and order decides.
                if matched_tags == 1 and chunk_tags and tag == chunk_tags[0]:
                    score += PRIMARY_TAG_BONUS
                    breakdown["primary"] += PRIMARY_TAG_BONUS

        for keyword in chunk.get("keywords", []):
            keyword = (keyword or "").strip().lower()
            if not keyword or keyword in STOPWORDS:
                continue
            if error_lower and _matches_word(keyword, error_lower):
                weight = ERROR_KEYWORD_SPECIFIC if _is_specific(keyword) else ERROR_KEYWORD
                score += weight
                breakdown["error"] += weight
            if code_lower and _matches_word(keyword, code_lower):
                score += CODE_KEYWORD
                breakdown["code"] += CODE_KEYWORD

        return score, breakdown
