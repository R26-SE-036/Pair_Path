"""Shared loading for the RAG tests.

The corpus is parsed once per run — every test wants the same entries, and
re-reading twelve files per test would dominate the runtime.
"""

import glob
import os
import sys

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KNOWLEDGE_DIR = os.path.join(ML_ROOT, "app", "data", "rag_knowledge")

if ML_ROOT not in sys.path:
    sys.path.insert(0, ML_ROOT)

from app.rag.knowledge_loader import KnowledgeLoader  # noqa: E402
from app.rag.retriever import KeywordRetriever  # noqa: E402
from app.rag.hint_generator import HintGenerator  # noqa: E402
from app.rag.rag_service import RAGService  # noqa: E402
from app.rag.schemas import RAGHintRequest  # noqa: E402

REQUIRED_FIELDS = ("Tags:", "Keywords:", "Content:", "Example:", "Question:")

_cache = {}


def pipeline():
    """(loader, retriever, generator, service), built once."""
    if not _cache:
        loader = KnowledgeLoader(KNOWLEDGE_DIR)
        _cache["loader"] = loader
        _cache["retriever"] = KeywordRetriever(loader)
        _cache["generator"] = HintGenerator()
        _cache["service"] = RAGService()
    return _cache["loader"], _cache["retriever"], _cache["generator"], _cache["service"]


def corpus_files():
    return sorted(glob.glob(os.path.join(KNOWLEDGE_DIR, "*.txt")))


def raw_blocks():
    """Every entry block in the source files, before parsing.

    Uses the loader's own splitter so entry boundaries match production, but
    stops short of its parser — the parser drops any block without content, so
    counting blocks here and chunks there is what catches a silent drop.
    """
    blocks = []
    for path in corpus_files():
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for i, block in enumerate(KnowledgeLoader._split_entries(text)):
            blocks.append({
                "text": block,
                "file": os.path.basename(path),
                "id": f"{os.path.splitext(os.path.basename(path))[0]}#{i}",
            })
    return blocks


def ask(service, tags=None, error="", code="", state="LOGIC_STRUGGLE"):
    """One request through the whole service, the way the API calls it."""
    return service.process_request(RAGHintRequest(
        predictedState=state,
        interventionType="LOGIC_HINT",
        questionConceptTags=tags or [],
        recentErrorContext=error,
        recentCodeSnippet=code,
    ))
