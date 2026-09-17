"""Two vocabularies, and the map between them.

============================ WHY THERE ARE TWO ============================
The platform has fourteen concept tags - `loop_boundaries`, `array_indexing`,
`string_comparison` and so on - defined in
code-coach/knowledge_base/code_coach_errors.json. They are identifiers: Code
Coach reports a finding under one, Study Guider teaches a lesson for one, the
gamification engine drills one, and a PairPath exercise is tagged with one. The
whole point of them is that all four components mean the same thing.

The RAG corpus is indexed differently, and has to be. Its tags are the words a
retrieval problem is described in - `off-by-one`, `bounds`, `equality`,
`semicolon`, `infinite loop` - because a hint is retrieved for what is going
wrong in front of a pair, which is finer-grained than a concept and often
crosses concepts. `java_compile_errors.txt` alone covers a dozen failures that
belong to no single platform tag.

Replacing one with the other would break something either way. Retagging the
corpus to fourteen coarse identifiers would lose the distinctions the retriever
ranks on; renaming the platform tags to match the corpus would break the joins
between components.

So they stay separate and this file states the relationship. It is the piece
that was missing: with questions tagged `loop_boundaries` and the corpus tagged
`loops`, `boundaries`, `off-by-one`, tag-based retrieval matched NOTHING - every
hint fell through to the error-keyword path alone, and to generic guidance when
no error text was available. That is a silent 71.4% to 0% on the tags-only
case measured in dev_tools/evaluate_rag.py, with no error and no warning.
===========================================================================
"""

from typing import Dict, Iterable, List, Tuple

# Platform concept tag -> the corpus tags that express it.
#
# Every value below appears on at least one corpus entry; a test asserts that,
# because a synonym that matches nothing is indistinguishable from a working
# one until somebody measures retrieval.
PLATFORM_TAG_SYNONYMS: Dict[str, Tuple[str, ...]] = {
    "loop_boundaries": ("loops", "boundaries", "boundary", "off-by-one", "bounds"),
    "loop_control": ("loops", "iteration", "for", "while"),
    "loop_initialization": ("loops", "initialization", "uninitialized", "variables"),
    "loop_termination": ("loops", "while", "termination", "infinite loop"),
    "array_indexing": ("arrays", "indexing", "index", "bounds", "out of bounds", "length"),
    "conditional_logic": ("conditions", "if", "else", "branching", "logic"),
    "boolean_logic": ("boolean", "logic", "and", "or", "comparison"),
    # `methods` is deliberately absent: it is the primary tag on entries about
    # parameter passing and method syntax, so including it retrieved those over
    # the ones about paths and returns.
    "control_flow": ("missing return", "return", "branching"),
    "switch_statements": ("conditions", "branching", "logic"),
    "string_comparison": ("strings", "comparison", "equality", "equals"),
    "immutable_strings": ("strings", "text", "return value"),
    "assignment_logic": ("assignment", "variables", "variable"),
    "arithmetic_operations": ("arithmetic", "operators", "division", "division by zero", "remainder", "modulo"),
    "statement_structure": ("syntax", "semicolon", "braces", "statement", "structure"),
}


def expand_concept_tags(tags: Iterable[str]) -> List[str]:
    """Add the corpus vocabulary for any platform tag, keeping order.

    A tag that is not a platform identifier passes through untouched - the
    corpus's own tags are legitimate search terms, and so is anything a
    question was tagged with before the taxonomy existed.

    Order matters to the retriever: the FIRST tag that matches an entry earns
    the full weight and the primary-subject bonus, later ones much less. So a
    platform tag's own synonyms are inserted immediately after it, keeping the
    caller's priority rather than appending everything at the end.
    """
    expanded: List[str] = []
    seen = set()

    for tag in tags:
        if not tag:
            continue
        for candidate in (tag, *PLATFORM_TAG_SYNONYMS.get(tag, ())):
            lowered = candidate.lower()
            if lowered not in seen:
                seen.add(lowered)
                expanded.append(candidate)

    return expanded
