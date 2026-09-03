"""Print everything measurable about the RAG hint pipeline, in one place.

The suite in tests/ asserts these properties and reports pass or fail; this
prints the numbers behind them. Same corpus, same retriever — one is a gate,
the other is a readout.

Distinct from evaluate_rag.py, which runs the A/B experiment on how much error
and code context improve retrieval. This describes the pipeline as it currently
stands.

Usage:
    python dev_tools/rag_report.py
    python dev_tools/rag_report.py --accuracy    # the labelled test set only
"""

import argparse
import json
import os
import sys
import time
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
TESTSET = os.path.join(ROOT, "dev_tools", "rag_testset.json")

from app.rag.rag_service import RAGService  # noqa: E402
from app.rag.schemas import RAGHintRequest  # noqa: E402
from app.rag.retriever import MIN_SCORE  # noqa: E402

# Representative of what actually reaches the retriever in a live session:
# a compile error, a runtime exception, a state with no error at all, and
# things that must not match.
PROBES = [
    ("array index out of bounds",
     [], "Exception in thread \"main\" java.lang.ArrayIndexOutOfBoundsException: "
         "Index 5 out of bounds for length 5\n\tat ArraySum.main(ArraySum.java:9)"),
    ("cannot find symbol (arrays question)",
     ["arrays"], "ArraySum.java:6: error: cannot find symbol"),
    ("missing semicolon (arrays question)",
     ["arrays"], "ArraySum.java:6: error: ';' expected"),
    ("null pointer (conditions question)",
     ["conditions"], "Exception in thread \"main\" java.lang.NullPointerException"),
    ("number format",
     [], "java.lang.NumberFormatException: For input string: \"abc\""),
    ("stack overflow",
     [], "Exception in thread \"main\" java.lang.StackOverflowError"),
    ("tags only, no error",
     ["loops", "iteration"], ""),
    ("unrelated framework error",
     [], "org.hibernate.LazyInitializationException: could not initialize proxy"),
    ("nothing at all",
     [], ""),
]

STATES = ["LOGIC_STRUGGLE", "PASSIVE_NAVIGATOR", "DRIVER_DOMINANCE",
          "DISENGAGED", "PRODUCTIVE"]


def rule(title=""):
    print("\n" + "=" * 74)
    if title:
        print(f"  {title}")
        print("=" * 74)


def ask(service, tags, error, state="LOGIC_STRUGGLE", code=""):
    return service.process_request(RAGHintRequest(
        predictedState=state, interventionType="LOGIC_HINT",
        questionConceptTags=tags, recentErrorContext=error, recentCodeSnippet=code,
    ))


def print_accuracy(service):
    """Top-1 retrieval against the labelled cases, including abstentions."""
    if not os.path.exists(TESTSET):
        print("  labelled test set not found; skipping")
        return
    with open(TESTSET, encoding="utf-8") as f:
        cases = json.load(f)["cases"]

    correct = wrong = 0
    should_match = matched = 0
    should_abstain = abstained = 0
    failures = []

    for case in cases:
        chunks = service.retriever.retrieve(
            tags=case.get("tags", []), error_context=case.get("error", ""),
            code_snippet=case.get("code", ""), top_k=3,
        )
        top = chunks[0]["id"] if chunks else None
        expect = case.get("expect")

        if expect is None:
            should_abstain += 1
            ok = top is None
            if ok:
                abstained += 1
        else:
            should_match += 1
            wanted = expect if isinstance(expect, list) else [expect]
            ok = top is not None and any(top.startswith(w) for w in wanted)
            if top is not None:
                matched += 1

        if ok:
            correct += 1
        else:
            wrong += 1
            failures.append((case["id"], expect, top, case.get("note", "")))

    total = len(cases)
    print(f"\n  labelled cases     : {total}")
    print(f"  top-1 correct      : {correct}/{total}  ({correct/total*100:.1f}%)")
    print(f"  should match       : {matched}/{should_match} returned something")
    print(f"  should abstain     : {abstained}/{should_abstain} correctly returned nothing")

    if failures:
        print(f"\n  {len(failures)} failing case(s):")
        for cid, expect, top, note in failures:
            want = "ABSTAIN" if expect is None else (
                "|".join(expect) if isinstance(expect, list) else expect)
            print(f"    {cid}  wanted {want:<28} got {top or 'ABSTAIN'}   {note}")
    else:
        print("\n  no failing cases")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accuracy", action="store_true",
                    help="print only the labelled-test-set result and exit")
    args = ap.parse_args()

    service = RAGService()
    chunks = service.loader.chunks

    if args.accuracy:
        print("\nRAG RETRIEVAL ACCURACY")
        print_accuracy(service)
        print()
        return

    rule("KNOWLEDGE CORPUS")
    files = sorted({c["source"] for c in chunks})
    print(f"  entries        : {len(chunks)}")
    print(f"  files          : {len(files)}")
    per_file = Counter(c["source"] for c in chunks)
    for name in files:
        print(f"    {name:34} {per_file[name]:>2} entries")

    tags = Counter(t for c in chunks for t in c["tags"])
    print(f"\n  distinct tags  : {len(tags)}")
    print("  most common    : " + ", ".join(f"{t} ({n})" for t, n in tags.most_common(8)))
    avg = sum(len(c["content"]) for c in chunks) / len(chunks)
    print(f"  avg content    : {avg:.0f} characters")

    rule("HOW A HINT IS BUILT")
    print("  Retrieval only - no language model and no prompt anywhere in this path.")
    print("  Every word a student reads is either a corpus entry returned verbatim")
    print("  or one of three hand-written fallbacks. Nothing is composed at runtime.")
    print(f"\n  abstention threshold : {MIN_SCORE}  (below this, nothing is returned)")

    rule("RETRIEVAL ON REPRESENTATIVE INPUTS")
    print(f"  {'input':<38} {'top entry':<26} {'score':>5}  breakdown")
    print("  " + "-" * 88)
    for label, tag_list, error in PROBES:
        got = service.retriever.retrieve(tags=tag_list, error_context=error,
                                         code_snippet="", top_k=3)
        if not got:
            print(f"  {label:<38} {'-- ABSTAINED --':<26} {'':>5}  falls back to generic advice")
            continue
        top = got[0]
        b = top["scoreBreakdown"]
        parts = ", ".join(f"{k} {v}" for k, v in b.items() if v)
        print(f"  {label:<38} {top['id']:<26} {top['score']:>5}  {parts}")

    rule("GROUNDING - is the hint text really taken from the corpus?")
    contents = {c["content"].strip() for c in chunks}
    examples = {c["example"].strip() for c in chunks}
    questions = {c["question"].strip() for c in chunks}
    grounded = retrieved = 0
    for label, tag_list, error in PROBES:
        r = ask(service, tag_list, error)
        if r.fallbackUsed:
            continue
        retrieved += 1
        if (r.conceptReminder.strip() in contents
                and r.exampleIdea.strip() in examples
                and r.reflectiveQuestion.strip() in questions):
            grounded += 1
    print(f"\n  retrieved hints traced back to a corpus entry, word for word: "
          f"{grounded}/{retrieved}")
    print("  Anything less than all of them would mean the system is composing text.")

    rule("STATE TO INTERVENTION")
    print(f"  {'predicted state':<22} {'intervention':<24} {'source':<32}")
    print("  " + "-" * 80)
    for state in STATES:
        r = service.process_request(RAGHintRequest(
            predictedState=state, interventionType="UNKNOWN"))
        source = r.sourceChunks[0] if r.sourceChunks else "-- generic fallback --"
        print(f"  {state:<22} {r.interventionType:<24} {source:<32}")

    rule("RETRIEVAL ACCURACY")
    print_accuracy(service)

    rule("SERVING LATENCY")
    ask(service, ["arrays"], PROBES[0][2])  # warm the pattern cache
    times = []
    for _ in range(200):
        t0 = time.perf_counter()
        ask(service, ["arrays"], PROBES[0][2])
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    print(f"  n = {len(times)}, {len(chunks)}-entry corpus")
    print(f"  median : {times[len(times)//2]:6.3f} ms")
    print(f"  mean   : {sum(times)/len(times):6.3f} ms")
    print(f"  p95    : {times[int(len(times)*0.95)]:6.3f} ms")
    print("  Runs inside the same request that classifies the window, so it shares")
    print("  the 100 ms interaction budget (NFR1) with the model.")
    print()


if __name__ == "__main__":
    main()
