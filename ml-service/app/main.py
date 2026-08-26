import os
import sys

# Add the parent directory to sys.path so 'python app/main.py' works directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.schemas.predictions import PredictPairStateRequest, PredictPairStateResponse
from app.schemas.interventions import RecommendInterventionRequest, RecommendInterventionResponse
from app.models.predictor import PairStatePredictor
from app.models.intervention_engine import InterventionEngine
from app.features import WindowFeatureExtractor
from app.rag import RAGService
from app.rag.schemas import RAGHintRequest, RAGHintResponse

app = FastAPI(
    title="Pair Programming ML Service",
    description="ML service for pair programming collaboration analysis and adaptive support",
    version="1.0.0",
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components
predictor = PairStatePredictor()
intervention_engine = InterventionEngine()
feature_extractor = WindowFeatureExtractor()
rag_service = RAGService()

@app.post("/predict-pair-state", response_model=PredictPairStateResponse)
async def predict_pair_state(request: PredictPairStateRequest):
    """Predict the current collaboration state of a pair programming session.

    Preferred: send raw `events` (+ `roles`) — features are computed here by
    the same canonical extractor used to build training data (L5).
    Legacy: send pre-computed `features` directly.
    """
    try:
        if request.events is not None:
            features = feature_extractor.extract(
                request.events,
                roles=request.roles,
                last_role_switch_at=request.lastRoleSwitchAt,
                session_start_at=request.sessionStartAt,
            )
        else:
            features = request.features or {}

        prediction = await predictor.predict(features)
        return PredictPairStateResponse(
            sessionId=request.sessionId,
            predictedState=prediction["state"],
            confidence=prediction["confidence"],
            modelVersion=predictor.model_version,
            features={k: float(v) for k, v in features.items()},
        )
    except Exception:
        # Fallback prediction
        return PredictPairStateResponse(
            sessionId=request.sessionId,
            predictedState="PRODUCTIVE",
            confidence=0.5,
            modelVersion="fallback_v1",
        )

@app.post("/recommend-intervention", response_model=RecommendInterventionResponse)
async def recommend_intervention(request: RecommendInterventionRequest):
    """Recommend an intervention based on the predicted pair state."""
    try:
        intervention = await intervention_engine.recommend(
            request.predictedState, 
            request.confidence
        )
        return RecommendInterventionResponse(
            state=request.predictedState,
            action=intervention["action"],
            delivery=intervention["delivery"],
        )
    except Exception as e:
        # Fallback intervention
        return RecommendInterventionResponse(
            state=request.predictedState,
            action="NO_ACTION",
            delivery={
                "type": "none",
                "uiTarget": "none",
                "uiEffect": "none",
                "message": "Intervention service unavailable",
            },
        )

@app.post("/retrieve-hint", response_model=RAGHintResponse)
@app.post("/rag/hint", response_model=RAGHintResponse)
async def retrieve_hint(request: RAGHintRequest):
    """Retrieve a contextual hint using the RAG-lite pipeline."""
    try:
        # The new RAGService is synchronous in our implementation
        response = rag_service.process_request(request)
        return response
    except Exception as e:
        import traceback
        traceback.print_exc()
        # Fallback hint matching RAGHintResponse
        return RAGHintResponse(
            interventionType=request.interventionType or "LOGIC_HINT",
            retrievedConcepts=[],
            conceptReminder="Try tracing the logic step by step before changing the code.",
            exampleIdea="Check the values of your variables at the start, middle, and end of the loop.",
            reflectiveQuestion="What do you expect each variable to contain after one iteration?",
            sourceChunks=[],
            fallbackUsed=True
        )

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "pair-programming-ml"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
