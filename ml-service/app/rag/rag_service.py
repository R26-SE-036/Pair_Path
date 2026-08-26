import os
from typing import List
from .schemas import RAGHintRequest, RAGHintResponse
from .knowledge_loader import KnowledgeLoader
from .retriever import KeywordRetriever
from .hint_generator import HintGenerator

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
        
        if not intervention_type or intervention_type == "UNKNOWN":
            if state == "LOGIC_STRUGGLE":
                intervention_type = "LOGIC_HINT"
            elif state == "PASSIVE_NAVIGATOR":
                intervention_type = "COLLABORATION_PROMPT"
            elif state == "DRIVER_DOMINANCE":
                intervention_type = "ROLE_BALANCE_PROMPT"
            elif state == "LOW_QUALITY_REVIEW":
                intervention_type = "REVIEW_HINT"
            else:
                intervention_type = "CONCEPT_HINT"
                
        # Inject collaboration tags if the state warrants it
        search_tags = list(request.questionConceptTags) if request.questionConceptTags else []
        if state in ["PASSIVE_NAVIGATOR", "DRIVER_DOMINANCE"]:
            search_tags.extend(["pair programming", "collaboration", "role"])
        elif state == "LOW_QUALITY_REVIEW":
            search_tags.extend(["peer review", "feedback", "quality"])

        # 2. Retrieve relevant chunks
        chunks = self.retriever.retrieve(
            tags=search_tags,
            error_context=request.recentErrorContext,
            code_snippet=request.recentCodeSnippet,
            top_k=3
        )
        
        # 3. Generate structured hint
        hint_data = self.generator.generate(chunks, fallback_type=intervention_type)
        
        # 4. Format response
        retrieved_concepts = []
        source_chunks = []
        for c in chunks:
            if c["tags"]:
                retrieved_concepts.extend(c["tags"])
            source_chunks.append(c["source"])
            
        # Deduplicate concepts
        retrieved_concepts = list(set(retrieved_concepts))
        
        return RAGHintResponse(
            interventionType=intervention_type,
            retrievedConcepts=retrieved_concepts,
            conceptReminder=hint_data["conceptReminder"],
            exampleIdea=hint_data["exampleIdea"],
            reflectiveQuestion=hint_data["reflectiveQuestion"],
            sourceChunks=source_chunks,
            fallbackUsed=hint_data["fallbackUsed"]
        )
