import os
import random
from typing import Dict, Any

from app.label_mapping import (
    NO_ACTION,
    POSITIVE_REINFORCEMENT_MESSAGES,
    STATE_INTERVENTIONS,
)

# Confidence gate: predictions below this stay silent (deliberate — a
# mistimed interrupt has real cost). NOTE: the exact threshold is a Phase 2
# calibration deliverable against annotated ground truth; 0.6 is provisional.
CONFIDENCE_THRESHOLD = float(os.getenv("ML_CONFIDENCE_THRESHOLD", "0.6"))


class InterventionEngine:
    """Maps predicted states to interventions.

    L12: the mapping lives in app/label_mapping.py (single source of truth);
    this class only applies the confidence gate on top of it.
    """

    async def recommend(self, predicted_state: str, confidence: float) -> Dict[str, Any]:
        """Recommend an intervention based on the predicted state and confidence."""
        if confidence < CONFIDENCE_THRESHOLD:
            return {
                "action": "NO_ACTION",
                "delivery": {**NO_ACTION["delivery"], "message": "Low confidence prediction"},
            }

        intervention = STATE_INTERVENTIONS.get(predicted_state, NO_ACTION)

        # Vary the praise wording so repeated encouragement doesn't read as
        # a canned bot response. Copy first — never mutate the shared mapping.
        if intervention["action"] == "POSITIVE_REINFORCEMENT":
            delivery = dict(intervention["delivery"])
            delivery["message"] = random.choice(POSITIVE_REINFORCEMENT_MESSAGES)
            return {**intervention, "delivery": delivery}

        return intervention
