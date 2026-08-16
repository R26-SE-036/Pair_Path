import joblib
import json
import numpy as np
from typing import Dict, Any
import os

class PairStatePredictor:
    def __init__(self):
        self.model = None
        self.label_encoder = None
        self.feature_columns = None
        self.model_version = "rule_fallback_v1"
        self.load_models()

    def load_models(self):
        """Load the trained XGBoost model and related components."""
        models_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'models')

        try:
            model_path = os.path.join(models_dir, 'pair_state_xgboost.joblib')
            encoder_path = os.path.join(models_dir, 'pair_state_label_encoder.joblib')
            columns_path = os.path.join(models_dir, 'pair_state_feature_columns.joblib')
            card_path = os.path.join(models_dir, 'model_card.json')

            if not os.path.exists(model_path):
                print(f"[WARNING] Model file not found at {model_path}, using fallback predictions")
                return False

            self.model = joblib.load(model_path)
            self.label_encoder = joblib.load(encoder_path)
            self.feature_columns = joblib.load(columns_path)

            # Version comes from the model card written at training time,
            # never a hardcoded string.
            if os.path.exists(card_path):
                with open(card_path) as f:
                    self.model_version = json.load(f).get("version", "unversioned")
            else:
                self.model_version = "unversioned"

            print(f"[SUCCESS] Loaded XGBoost model {self.model_version} from {model_path}")
            return True
        except Exception as e:
            print(f"[WARNING] Failed to load models: {e}, using fallback predictions")
            return False

    async def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """Predict pair state based on extracted features."""
        if self.model is None:
            return self._fallback_prediction(features)
        
        try:
            feature_vector = self._prepare_features(features)
            prediction_proba = self.model.predict_proba(feature_vector.reshape(1, -1))[0]
            predicted_class_idx = np.argmax(prediction_proba)
            confidence = float(prediction_proba[predicted_class_idx])
            predicted_state = self.label_encoder.inverse_transform([predicted_class_idx])[0]
            
            return {
                "state": predicted_state,
                "confidence": confidence
            }
        except Exception as e:
            print(f"[WARNING] Prediction error: {e}")
            return self._fallback_prediction(features)

    def _prepare_features(self, features: Dict[str, Any]) -> np.ndarray:
        """Prepare features in the correct order for the model."""
        feature_vector = []
        for col in self.feature_columns:
            feature_vector.append(float(features.get(col, 0.0)))
        return np.array(feature_vector)

    def _fallback_prediction(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """Rule-based fallback when the trained model is not available.

        Reads the canonical window-agnostic feature names (app.features),
        with the legacy `_3m` names as a fallback for old callers. This is
        also the RQ1 rule-based baseline the trained model is compared to.
        """
        def get(canonical, legacy, default):
            return features.get(canonical, features.get(legacy, default))

        edit_balance = get("edit_balance_ratio", "edit_balance_ratio_3m", 0.5)
        run_success_rate = get("run_success_rate", "avg_run_success_rate_3m", 0.5)
        discussion_count = get("discussion_note_count", "total_discussion_note_count_3m", 0)
        idle_ratio = get("idle_ratio", "avg_idle_ratio_3m", 0.2)
        navigator_chat = get("navigator_note_count", "navigator_chat_count_3m", 0)

        # Rule-based classification
        if idle_ratio > 0.7 and discussion_count < 1:
            return {"state": "DISENGAGED", "confidence": 0.65}
        elif edit_balance > 0.85 and navigator_chat < 1:
            return {"state": "DRIVER_DOMINANCE", "confidence": 0.7}
        elif run_success_rate < 0.3 and discussion_count >= 1:
            return {"state": "LOGIC_STRUGGLE", "confidence": 0.65}
        elif navigator_chat == 0 and discussion_count < 2:
            return {"state": "PASSIVE_NAVIGATOR", "confidence": 0.55}
        else:
            return {"state": "PRODUCTIVE", "confidence": 0.6}
