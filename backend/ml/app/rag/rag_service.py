import os
from typing import List
from .schemas import RAGHintRequest, RAGHintResponse
from .knowledge_loader import KnowledgeLoader
from .retriever import KeywordRetriever
from .hint_generator import HintGenerator

# Which kind of hint each state calls for. Keyed only on states that exist -
# see app/label_mapping.py, the single source of truth for the five.
STATE_TO_INTERVENTION = {
    "LOGIC_STRUGGLE": "LOGIC_HINT",
    "PASSIVE_NAVIGATOR": "COLLABORATION_PROMPT",
    "DRIVER_DOMINANCE": "ROLE_BALANCE_PROMPT",
}

# States about the collaboration rather than the code.
COLLABORATION_STATES = frozenset({"PASSIVE_NAVIGATOR", "DRIVER_DOMINANCE"})


class RAGService:
    def __init__(self):
        # Resolve path to data/rag_knowledge
        current_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.join(current_dir, "..", "data", "rag_knowledge")
        
        self.loader = KnowledgeLoader(data_dir)
        self.retriever = KeywordRetriever(self.loader)
        self.generator = HintGenerator()

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

        # Collaboration states are not about the exercise, so retrieval on the
        # question's concept tags alone would return Java content for a problem
        # that is about how the pair is working.
        search_tags = list(request.questionConceptTags) if request.questionConceptTags else []
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
