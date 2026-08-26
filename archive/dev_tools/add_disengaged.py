import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv('../api/.env')
MONGODB_URI = os.getenv('MONGODB_URI')

client = MongoClient(MONGODB_URI)
db = client['pairprogramming_ml']
collection = db['ml_events']

# Find the existing DISENGAGED event
disengaged = collection.find_one({"prediction.predictedState": "DISENGAGED"})

if disengaged:
    # Remove the _id so we can insert new documents
    del disengaged['_id']
    
    # Create 9 more copies with slight variations
    new_events = []
    for i in range(9):
        new_event = disengaged.copy()
        new_event['sessionId'] = f"S-MOCK-DISENGAGED-{i+10}"
        new_events.append(new_event)
        
    collection.insert_many(new_events)
    print(f"[SUCCESS] Added {len(new_events)} more DISENGAGED events")
else:
    print("[ERROR] Could not find a DISENGAGED event to duplicate")
