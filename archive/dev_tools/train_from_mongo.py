from train_xgboost import XGBoostTrainer
import os

def train_from_mongodb_data():
    base_dir = os.path.dirname(os.path.dirname(__file__))
    features_file = os.path.join(base_dir, 'data', 'extracted', 'pair_state_features_mongodb.csv')
    
    if not os.path.exists(features_file):
        print(f"[ERROR] Features file not found at {features_file}")
        return

    print(f"[INFO] Starting training from {features_file}...")
    trainer = XGBoostTrainer()
    
    # We call train_complete_pipeline but pass the features_file directly
    # so it skips the extraction from sessions_file
    accuracy = trainer.train_complete_pipeline(features_file=features_file)
    
    print(f"[SUCCESS] Training complete! Accuracy: {accuracy:.4f}")
    print("[INFO] Model saved to ml-service/models/pair_state_xgboost.joblib")

if __name__ == "__main__":
    train_from_mongodb_data()
