from pydantic import BaseModel
from typing import Dict, Any

class RecommendInterventionRequest(BaseModel):
    sessionId: str
    predictedState: str
    confidence: float

class RecommendInterventionResponse(BaseModel):
    state: str
    action: str
    delivery: Dict[str, Any]
