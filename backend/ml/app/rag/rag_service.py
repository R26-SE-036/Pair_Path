import os
from typing import List
from .schemas import RAGHintRequest, RAGHintResponse
from .knowledge_loader import KnowledgeLoader
from .retriever import KeywordRetriever
from .hint_generator import HintGenerator
from .concept_tags import expand_concept_tags

# Which kind of hint each state calls for. Keyed only on states that exist -
# see app/label_mapping.py, the single source of truth for the five.
STATE_TO_INTERVENTION = {
    "LOGIC_STRUGGLE": "LOGIC_HINT",
    "PASSIVE_NAVIGATOR": "COLLABORATION_PROMPT",
    "DRIVER_DOMINANCE": "ROLE_BALANCE_PROMPT",
}

# States about the collaboration rather than the code.
COLLABORATION_STATES = frozenset({"PASSIVE_NAVIGATOR", "DRIVER_DOMINANCE"})

# The exceptions a detected mistake raises when its line runs. Code Coach ranks
# its findings by confidence, which knows nothing about the run the pair is
# looking at: in `average = total / count` it finds both a divisor that could
# be zero and a whole-number division, and puts the divisor first. A run that
# crashed with one of these points at the mistake that raises it.
RAISES = {
    "DIVISION_BY_ZERO_LITERAL": ("arithmeticexception",),
    "ARRAY_LENGTH_INDEX_MISUSE": ("arrayindexoutofboundsexception",),
    "INDEX_PLUS_ONE_OUT_OF_BOUNDS": ("arrayindexoutofboundsexception",),
    "OFF_BY_ONE_LOOP_BOUNDARY": ("arrayindexoutofboundsexception",),
    "NON_SHORT_CIRCUIT_OPERATOR": ("nullpointerexception", "stringindexoutofboundsexception"),
}

# Mistakes that show only as a crash. A run that finished without error was not
# stopped by one, so it cannot explain the wrong answer the pair is stuck on;
# any other finding goes before it.
ONLY_SEEN_AS_A_CRASH = frozenset({
    "DIVISION_BY_ZERO_LITERAL",
    "ARRAY_LENGTH_INDEX_MISUSE",
    "INDEX_PLUS_ONE_OUT_OF_BOUNDS",
    "NON_SHORT_CIRCUIT_OPERATOR",
})


def order_for_the_run(detected: List[str], error_context: str) -> List[str]:
    """Code Coach's findings, the ones that explain this run first.

    Stable: findings the run says nothing about keep the detector's order.
    """
    error = (error_context or "").lower()

    def rank(item):
        position, error_type = item
        if any(name in error for name in RAISES.get(error_type, ())):
            return (0, position)
        if not error and error_type in ONLY_SEEN_AS_A_CRASH:
            return (2, position)
        return (1, position)

    return [error_type for _, error_type in sorted(enumerate(detected), key=rank)]


class RAGService:
    def __init__(self):
        # Resolve path to data/rag_knowledge
        current_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.join(current_dir, "..", "data", "rag_knowledge")
        
        self.loader = KnowledgeLoader(data_dir)
        self.retriever = KeywordRetriever(self.loader)
        self.generator = HintGenerator()

        # A separate directory, so these entries never enter keyword ranking:
        # they are reached by name or not at all.
        error_type_dir = os.path.join(current_dir, "..", "data", "error_type_hints")
        self.error_type_hints = {
            c["error_type"]: c for c in KnowledgeLoader(error_type_dir).chunks if c["error_type"]
        }

    def _hint_for_detected_error(self, request: RAGHintRequest, intervention_type: str):
        """The written hint for the mistake Code Coach found, if there is one.

        Retrieval ranks corpus entries by the exercise's concept tags and by
        whatever error text the run produced. A program that runs and prints
        the wrong answer produces no error text, so the hint came down to the
        exercise's tags - the same advice for every mistake on that topic, and
        sometimes the wrong one: an integer-division bug on an arithmetic
        exercise was handed the entry about the remainder operator. When the
        detector has named the mistake there is nothing left to rank.
        """
        if intervention_type != "LOGIC_HINT":
            return None
        detected = order_for_the_run(request.detectedErrorTypes or [], request.recentErrorContext)
        for error_type in detected:
            entry = self.error_type_hints.get(error_type)
            if entry:
                return RAGHintResponse(
                    interventionType=intervention_type,
                    retrievedConcepts=list(entry["tags"]),
                    conceptReminder=entry["content"],
                    exampleIdea=entry["example"],
                    reflectiveQuestion=entry["question"],
                    sourceChunks=[entry["id"]],
                    fallbackUsed=False,
                )
        return None

    def process_request(self, request: RAGHintRequest) -> RAGHintResponse:
        # 1. Map predicted state to intervention type if not explicitly provided
        intervention_type = request.interventionType
        state = request.predictedState
        
        # LOW_QUALITY_REVIEW is deliberately absent. It is documented future
        # work (L7): not a live class, absent from PAIR_STATES, and rejected by
        # the trainer - so no prediction can ever carry it and these branches
        # were unreachable. Dead code that looks like support for a sixth state
        # is worse than no code, because it makes the taxonomy look larger than
        # the one the model was fitted on.
        if not intervention_type or intervention_type == "UNKNOWN":
            intervention_type = STATE_TO_INTERVENTION.get(state, "CONCEPT_HINT")

        named = self._hint_for_detected_error(request, intervention_type)
        if named:
            return named

        # Platform concept tags are expanded into the corpus vocabulary. A
        # question tagged `loop_boundaries` matches no corpus entry on its own -
        # the corpus indexes the same ground as `loops`, `boundaries`,
        # `off-by-one`. See concept_tags.py for why the two vocabularies are
        # deliberately different.
        search_tags = expand_concept_tags(request.questionConceptTags or [])

        # Collaboration states are not about the exercise, so retrieval on the
        # question's concept tags alone would return Java content for a problem
        # that is about how the pair is working.
        if state in COLLABORATION_STATES:
            search_tags.extend(["pair programming", "collaboration", "role"])

        # 2. Retrieve relevant chunks
        chunks = self.retriever.retrieve(
            tags=search_tags,
            error_context=request.recentErrorContext,
            code_snippet=request.recentCodeSnippet,
            top_k=3
        )
        
        # 3. Generate structured hint
        hint_data = self.generator.generate(chunks, fallback_type=intervention_type)
        
        # 4. Format response. Source is the entry id rather than the filename —
        # a file now holds several entries, so the filename alone would not say
        # which one was used.
        retrieved_concepts = []
        source_chunks = []
        for c in chunks:
            retrieved_concepts.extend(c.get("tags", []))
            source_chunks.append(c.get("id", c.get("source", "")))

        # Deduplicate concepts, preserving retrieval order (best match first).
        seen = set()
        retrieved_concepts = [
            t for t in retrieved_concepts if not (t in seen or seen.add(t))
        ]
        
        return RAGHintResponse(
            interventionType=intervention_type,
            retrievedConcepts=retrieved_concepts,
            conceptReminder=hint_data["conceptReminder"],
            exampleIdea=hint_data["exampleIdea"],
            reflectiveQuestion=hint_data["reflectiveQuestion"],
            sourceChunks=source_chunks,
            fallbackUsed=hint_data["fallbackUsed"]
        )
