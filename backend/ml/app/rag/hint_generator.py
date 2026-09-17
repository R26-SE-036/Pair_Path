from typing import Any, Dict, List

# Used only when an entry predates the Example/Question fields, or when nothing
# was retrieved at all. Kept deliberately generic: a vague hint is honest, a
# specific-sounding but invented one is not.
GENERIC_EXAMPLE = (
    "Print the values of your key variables just before and just after the "
    "section you suspect."
)
GENERIC_QUESTION = (
    "At what point does the program's actual behaviour first differ from what "
    "you expected?"
)

FALLBACKS: Dict[str, Dict[str, str]] = {
    "COLLABORATION_PROMPT": {
        "conceptReminder": (
            "Pair programming works because thinking is spoken aloud. When a pair "
            "goes quiet, the two people stop solving the same problem at the same time."
        ),
        "exampleIdea": "Say out loud what you think the next step should be, before writing it.",
        "reflectiveQuestion": "Do you both currently agree on what the next step should be?",
    },
    "ROLE_BALANCE_PROMPT": {
        "conceptReminder": (
            "Rotating the keyboard keeps both partners engaged and lets each think "
            "at both levels. After a long stretch in one role, the other partner's "
            "contribution gradually fades."
        ),
        "exampleIdea": "Finish the step you are on, then hand the keyboard over.",
        "reflectiveQuestion": "How long has it been since you last swapped roles?",
    },
    "REVIEW_HINT": {
        "conceptReminder": (
            "Useful review feedback is specific and actionable. Naming what works, "
            "and suggesting one concrete alternative, gives the author something to act on."
        ),
        "exampleIdea": "Pick one section and describe both what it does well and what might read more clearly.",
        "reflectiveQuestion": "Could the author act on your feedback without asking what you meant?",
    },
}

DEFAULT_FALLBACK = {
    "conceptReminder": (
        "When a program does not behave as expected, the quickest route forward is "
        "to narrow down the first point where reality stops matching your expectation."
    ),
    "exampleIdea": GENERIC_EXAMPLE,
    "reflectiveQuestion": GENERIC_QUESTION,
}


class HintGenerator:
    """Assembles a three-part scaffolded hint from a retrieved entry.

    The wording is carried by the corpus, not produced here. An earlier version
    generated the example and question from the entry's topic name, which meant
    every topic without a hardcoded special case produced the same advice
    regardless of what the student was actually struggling with.
    """

    def generate(self, retrieved_chunks: List[Dict], fallback_type: str = "LOGIC_HINT") -> Dict[str, Any]:
        if not retrieved_chunks:
            return {**self._fallback(fallback_type), "fallbackUsed": True}

        best = retrieved_chunks[0]
        return {
            "conceptReminder": best.get("content", "").strip() or DEFAULT_FALLBACK["conceptReminder"],
            "exampleIdea": best.get("example", "").strip() or GENERIC_EXAMPLE,
            "reflectiveQuestion": best.get("question", "").strip() or GENERIC_QUESTION,
            "fallbackUsed": False,
        }

    @staticmethod
    def _fallback(fallback_type: str) -> Dict[str, str]:
        return FALLBACKS.get(fallback_type, DEFAULT_FALLBACK)
