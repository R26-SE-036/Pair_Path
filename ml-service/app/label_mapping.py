# Pair State Label Mapping — SINGLE SOURCE OF TRUTH (L12)
#
# The five collaboration states for this study (L7: LOW_QUALITY_REVIEW is
# deferred as documented future work — it is not a live class, has no
# intervention mapping, and the trainer rejects datasets containing it).
# InterventionEngine derives its mapping from STATE_INTERVENTIONS below;
# do not define intervention actions/messages anywhere else.

PAIR_STATES = [
    "PRODUCTIVE",
    "DRIVER_DOMINANCE",
    "PASSIVE_NAVIGATOR",
    "LOGIC_STRUGGLE",
    "DISENGAGED",
]

# State descriptions for logging and documentation
STATE_DESCRIPTIONS = {
    "PRODUCTIVE": "Both students are actively collaborating well with balanced participation",
    "DRIVER_DOMINANCE": "One student is doing most of the coding for an extended time",
    "PASSIVE_NAVIGATOR": "Navigator is not actively contributing or discussing",
    "LOGIC_STRUGGLE": "Pair is active but stuck due to repeated failures or logic confusion",
    "DISENGAGED": "Both students show low activity or no meaningful progress",
}

# Silence: used for low-confidence predictions and unrecognized states.
NO_ACTION = {
    "action": "NO_ACTION",
    "delivery": {
        "type": "none",
        "uiTarget": "none",
        "uiEffect": "none",
        "message": "none",
    },
}

# Rotated so repeated praise doesn't read as a canned bot response.
POSITIVE_REINFORCEMENT_MESSAGES = [
    "Good work — keep it up!",
    "Nice teamwork. You're both contributing well.",
    "Strong collaboration — steady progress.",
    "Great rhythm between driver and navigator.",
    "You're working well together — keep going!",
]

# Intervention mapping for each state. Delivery carries only WHERE the UI
# should draw attention and WHAT effect to use — never solution content
# (pedagogical safety is enforced by this contract shape, NFR10).
#
# `audience` controls who receives the message:
#   "pair"      -> both students (default; use for anything phrased to the pair)
#   "navigator" -> only whoever currently holds the navigator role
#   "driver"    -> only whoever currently holds the driver role
# Anything that singles out one student MUST be addressed to them alone —
# broadcasting "Navigator, you aren't contributing" to both students calls the
# quieter one out in front of their partner, which is the opposite of the
# intended effect and is worse when the prediction is wrong.
STATE_INTERVENTIONS = {
    # Reinforcement, not correction: a brief self-dismissing toast that
    # affirms the pair without interrupting their flow. uiEffect "toast"
    # tells the client to auto-hide it and offer no accept/dismiss choice.
    "PRODUCTIVE": {
        "action": "POSITIVE_REINFORCEMENT",
        "delivery": {
            "type": "toast",
            "uiTarget": "toast",
            "uiEffect": "toast",
            "message": POSITIVE_REINFORCEMENT_MESSAGES[0],
            "autoDismissMs": 4000,
        },
    },
    "DRIVER_DOMINANCE": {
        "action": "ROLE_SWITCH_SUPPORT",
        "delivery": {
            "type": "combined",
            "uiTarget": "role_switch_button",
            "uiEffect": "glow",
            "message": "You have been in the same roles for a while. Consider switching Driver and Navigator.",
        },
    },
    "PASSIVE_NAVIGATOR": {
        "action": "NAVIGATOR_PARTICIPATION_SUPPORT",
        "delivery": {
            "type": "prompt",
            "uiTarget": "chat_input",
            "uiEffect": "pulse",
            "message": "Try explaining your thinking or suggesting the next step.",
            "audience": "navigator",
        },
    },
    "LOGIC_STRUGGLE": {
        "action": "LOGIC_SUPPORT",
        "delivery": {
            "type": "hint",
            "uiTarget": "hint_panel",
            "uiEffect": "highlight",
            "message": "Break the problem into smaller steps and test each part.",
        },
    },
    "DISENGAGED": {
        "action": "RE_ENGAGEMENT_SUPPORT",
        "delivery": {
            "type": "prompt",
            "uiTarget": "discussion_panel",
            "uiEffect": "glow",
            "message": "Summarize what you have accomplished and plan the next step together.",
        },
    },
}


def get_state_description(state: str) -> str:
    """Get human-readable description of a state."""
    return STATE_DESCRIPTIONS.get(state, "Unknown state")


def get_intervention_for_state(state: str) -> dict:
    """Get the recommended intervention for a given state.

    Unknown states stay silent — they must never fall through to praise.
    """
    return STATE_INTERVENTIONS.get(state, NO_ACTION)


def validate_state(state: str) -> bool:
    """Validate if a state is recognized."""
    return state in PAIR_STATES
