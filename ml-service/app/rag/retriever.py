from typing import Dict, List

from .knowledge_loader import KnowledgeLoader

# Scoring weights, ordered by how much each signal can be trusted.
TAG_MATCH = 5          # someone deliberately tagged this question
PRIMARY_TAG_BONUS = 2  # ...and it is this entry's main subject
ERROR_KEYWORD = 3      # the error the pair is actually looking at
CODE_KEYWORD = 1       # code mentions many things incidentally


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
        error_lower = (error_context or "").lower()
        code_lower = (code_snippet or "").lower()

        scored = []
        for chunk in chunks:
            score, breakdown = self._score(chunk, search_tags, error_lower, code_lower)
            if score > 0:
                scored.append({**chunk, "score": score, "scoreBreakdown": breakdown})

        scored.sort(key=lambda c: c["score"], reverse=True)
        return scored[:top_k]

    @staticmethod
    def _score(chunk, search_tags, error_lower, code_lower):
        score = 0
        breakdown = {"tag": 0, "primary": 0, "error": 0, "code": 0}
        chunk_tags = chunk.get("tags", [])

        for tag in search_tags:
            if tag in chunk_tags:
                score += TAG_MATCH
                breakdown["tag"] += TAG_MATCH
                # An entry whose *main* subject is the searched topic beats one
                # that merely mentions it. Without this, a search for "loops"
                # can return an arrays entry that happens to be tagged loops,
                # because both score identically and order decides.
                if chunk_tags and tag == chunk_tags[0]:
                    score += PRIMARY_TAG_BONUS
                    breakdown["primary"] += PRIMARY_TAG_BONUS

        for keyword in chunk.get("keywords", []):
            if not keyword:
                continue
            if error_lower and keyword in error_lower:
                score += ERROR_KEYWORD
                breakdown["error"] += ERROR_KEYWORD
            if code_lower and keyword in code_lower:
                score += CODE_KEYWORD
                breakdown["code"] += CODE_KEYWORD

        return score, breakdown
