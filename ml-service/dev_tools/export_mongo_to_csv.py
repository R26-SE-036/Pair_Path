import pandas as pd
from pymongo import MongoClient
import os
from dotenv import load_dotenv

# We will load env inside the function with correct absolute paths

def export_to_csv():
    api_env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'api', '.env')
    load_dotenv(api_env_path)
    MONGODB_URI = os.getenv('MONGODB_URI')
    
    if not MONGODB_URI:
        print(f"[ERROR] MONGODB_URI not found in {api_env_path}")
        return

    client = MongoClient(MONGODB_URI)
    
    # Note: In our seeder we used 'pairprogramming_ml' db and 'ml_events' collection
    db = client['pairprogramming_ml']
    collection = db['ml_events']
    
    # Fetch all events with features
    events = list(collection.find({"features": {"$exists": True}}))
    print(f"[INFO] Fetched {len(events)} events from MongoDB")

    if not events:
        print("[ERROR] No events found to export")
        return

    # NOTE: intentionally NOT including prediction.predictedState as a "label".
    # That was the model grading its own homework (circular training) — see
    # archive/README.md. This export is real production feature vectors only,
    # unlabeled, meant to be hand-labeled by a human before any training use.
    rows = []
    for e in events:
        row = dict(e['features'])
        row['session_id'] = e['sessionId']
        rows.append(row)

    df = pd.DataFrame(rows)

    base_dir = os.path.dirname(os.path.dirname(__file__))
    output_path = os.path.join(base_dir, 'data', 'extracted', 'pair_state_features_unlabeled.csv')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df.to_csv(output_path, index=False)
    print(f"[SUCCESS] Exported {len(df)} unlabeled feature rows to {output_path}")
    print("[INFO] These rows have NO ground-truth label. Label them by hand (see archive/README.md) before training on them.")

if __name__ == "__main__":
    export_to_csv()
