from typing import List, Dict
from .knowledge_loader import KnowledgeLoader

class KeywordRetriever:
    def __init__(self, loader: KnowledgeLoader):
        self.loader = loader

    def retrieve(self, tags: List[str], error_context: str, code_snippet: str, top_k: int = 3) -> List[Dict]:
        chunks = self.loader.chunks
        if not chunks:
            return []

        scored_chunks = []
        
        # Normalize inputs for simple string matching
        search_tags = [t.lower() for t in tags]
        error_lower = error_context.lower() if error_context else ""
        code_lower = code_snippet.lower() if code_snippet else ""

        for chunk in chunks:
            score = 0
            
            # Score 1: Concept tag match
            for tag in search_tags:
                if tag in chunk["tags"]:
                    score += 5
                    
            # Score 2: Error keyword match
            for keyword in chunk["keywords"]:
                if keyword and keyword in error_lower:
                    score += 3
                    
            # Score 3: Code keyword match
            for keyword in chunk["keywords"]:
                if keyword and keyword in code_lower:
                    score += 1
            
            if score > 0:
                scored_chunks.append((score, chunk))

        # Sort by score descending
        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        
        return [c[1] for c in scored_chunks[:top_k]]
