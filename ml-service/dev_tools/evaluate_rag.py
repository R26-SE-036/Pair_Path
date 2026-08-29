"""Measure hint retrieval against a labelled test set.

Reports two numbers the hint engine previously had no way to produce:

    retrieval accuracy  how often the top result is the entry that should
                        have been returned
    fallback rate       how often nothing matched and a generic hint was used

Also runs the two experiments described in the specification:

    Experiment A  concept tags only
    Experiment B  concept tags + error message + code context

A is what the system did before the gateway was connected; B is what it does
now. Reporting both is what makes "connecting the error improved retrieval" a
measurement rather than an assertion.

Usage:
    python evaluate_rag.py
    python evaluate_rag.py --show-failures
"""

import argparse
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.rag.hint_generator import HintGenerator  # noqa: E402
from app.rag.knowledge_loader import KnowledgeLoader  # noqa: E402
from app.rag.retriever import KeywordRetriever  # noqa: E402

KNOWLEDGE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "app", "data", "rag_knowledge",
)
TESTSET = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rag_testset.json")


def run_experiment(cases, retriever, generator, use_context: bool):
    """use_context=False is Experiment A (tags only), True is Experiment B."""
    results = []
    for case in cases:
        error = case["error"] if use_context else ""
        code = case["code"] if use_context else ""
        chunks = retriever.retrieve(
            tags=case["tags"], error_context=error, code_snippet=code, top_k=3
        )
        hint = generator.generate(chunks, fallback_type="LOGIC_HINT")

        top = chunks[0]["id"] if chunks else None
        expect = case["expect"]

        if expect is None:
            # A fallback is the correct outcome for these cases.
            correct = hint["fallbackUsed"]
        else:
            # `expect` may list several files where a concept genuinely spans
            # more than one; any of them counts.
            accepted = expect if isinstance(expect, list) else [expect]
            correct = bool(top) and top.split("#")[0] in accepted

        results.append({
            "id": case["id"],
            "expect": expect,
            "got": top,
            "correct": correct,
            "fallback": hint["fallbackUsed"],
            "score": chunks[0]["score"] if chunks else 0,
            "note": case.get("note", ""),
        })
    return results


def summarise(name, results):
    total = len(results)
    correct = sum(r["correct"] for r in results)
    fallback = sum(r["fallback"] for r in results)
    # Fallback rate is only meaningful over cases that *should* have matched.
    should_match = [r for r in results if r["expect"] is not None]
    unwanted_fallback = sum(r["fallback"] for r in should_match)

    print(f"\n{name}")
    print(f"  retrieval accuracy : {correct}/{total}  ({correct / total:.1%})")
    print(f"  fallback rate      : {fallback}/{total}  ({fallback / total:.1%})")
    print(f"  unwanted fallbacks : {unwanted_fallback}/{len(should_match)}"
          f"  (cases that should have matched but did not)")
    return correct / total, unwanted_fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show-failures", action="store_true")
    args = ap.parse_args()

    loader = KnowledgeLoader(KNOWLEDGE_DIR)
    retriever = KeywordRetriever(loader)
    generator = HintGenerator()

    with open(TESTSET, encoding="utf-8") as f:
        cases = json.load(f)["cases"]

    print("=" * 68)
    print("  HINT RETRIEVAL EVALUATION")
    print("=" * 68)
    print(f"\nCorpus  : {len(loader.chunks)} entries across "
          f"{len({c['source'] for c in loader.chunks})} files")
    print(f"Test set: {len(cases)} labelled cases")

    a = run_experiment(cases, retriever, generator, use_context=False)
    b = run_experiment(cases, retriever, generator, use_context=True)

    acc_a, fb_a = summarise("Experiment A — concept tags only", a)
    acc_b, fb_b = summarise("Experiment B — tags + error + code", b)

    print("\n" + "-" * 68)
    print(f"Effect of supplying error and code context: "
          f"{acc_b - acc_a:+.1%} accuracy, "
          f"{fb_a - fb_b:+d} fewer unwanted fallbacks")

    if args.show_failures:
        for name, results in (("A", a), ("B", b)):
            bad = [r for r in results if not r["correct"]]
            if bad:
                print(f"\nExperiment {name} — failures:")
                for r in bad:
                    # `expect` may be a list when a concept legitimately spans
                    # more than one file, so render it before padding.
                    expect = r["expect"]
                    if isinstance(expect, list):
                        expect = " | ".join(expect)
                    print(f"  {r['id']}  expected {expect or 'FALLBACK':<26}"
                          f" got {str(r['got']):<24} {r['note']}")

    print("\n" + "=" * 68)
    return 0


if __name__ == "__main__":
    sys.exit(main())
