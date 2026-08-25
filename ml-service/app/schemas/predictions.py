from pydantic import BaseModel
from typing import Dict, Any, List, Optional

class PredictPairStateRequest(BaseModel):
    sessionId: str
    # L5: preferred path — send raw events (+ roles) and let the canonical
    # extractor compute features server-side, same code as training.
    events: Optional[List[Dict[str, Any]]] = None
    roles: Optional[Dict[str, str]] = None
    lastRoleSwitchAt: Optional[float] = None  # epoch seconds, if known
    sessionStartAt: Optional[float] = None  # epoch seconds; enables session-age features
    # Legacy path: pre-computed features (kept for backward compatibility).
    features: Optional[Dict[str, Any]] = None

class PredictPairStateResponse(BaseModel):
    sessionId: str
    predictedState: str
    confidence: float
    modelVersion: str
    # Echo of the features actually used, so the caller can log the exact
    # vector the prediction was made on (for later human labeling).
    features: Optional[Dict[str, float]] = None
