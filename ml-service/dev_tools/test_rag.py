import os
import sys
import json

# Add ml-service root to path so we can import app modules
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.rag.rag_service import RAGService
from app.rag.schemas import RAGHintRequest

def test_rag():
    print("[INFO] Initializing RAG Service...")
    rag_service = RAGService()
    
    test_cases = [
        {
            "name": "Java Loops & Arrays (Logic Struggle)",
            "request": RAGHintRequest(
                predictedState="LOGIC_STRUGGLE",
                interventionType="LOGIC_HINT",
                questionConceptTags=["java", "loops", "arrays"],
                recentErrorContext="ArrayIndexOutOfBoundsException at line 14",
                recentCodeSnippet="for(int i=0; i<=arr.length; i++) { sum += arr[i]; }"
            )
        },
        {
            "name": "Pair Programming (Passive Navigator)",
            "request": RAGHintRequest(
                predictedState="PASSIVE_NAVIGATOR",
                interventionType="COLLABORATION_PROMPT",
                questionConceptTags=["java", "methods"],
                recentErrorContext="",
                recentCodeSnippet="public void doSomething() {}"
            )
        },
        {
            "name": "Code Review Quality (Low Quality Review)",
            "request": RAGHintRequest(
                predictedState="LOW_QUALITY_REVIEW",
                interventionType="REVIEW_HINT",
                questionConceptTags=["java"],
                recentErrorContext="",
                recentCodeSnippet=""
            )
        }
    ]
    
    print("-" * 70)
    for idx, tc in enumerate(test_cases):
        print(f"\n[TEST {idx+1}] {tc['name']}")
        
        # Call the RAG service synchronously
        response = rag_service.process_request(tc['request'])
        
        print(f"  --> Intervention Type: {response.interventionType}")
        print(f"  --> Retrieved Concepts: {response.retrievedConcepts}")
        print(f"  --> Concept Reminder: {response.conceptReminder}")
        print(f"  --> Example Idea: {response.exampleIdea}")
        print(f"  --> Reflective Question: {response.reflectiveQuestion}")
        print(f"  --> Fallback Used: {response.fallbackUsed}")
        print(f"  --> Source Files Used:")
        for chunk in response.sourceChunks:
            print(f"      - {chunk}")

    print("\n" + "-" * 70)

if __name__ == "__main__":
    test_rag()
