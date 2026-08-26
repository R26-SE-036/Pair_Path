from typing import List, Dict, Any

class HintGenerator:
    def generate(self, retrieved_chunks: List[Dict], fallback_type: str = "LOGIC_HINT") -> Dict[str, Any]:
        if not retrieved_chunks:
            return self._generate_fallback(fallback_type)

        # For RAG-lite, we use the best chunk for the concept reminder
        best_chunk = retrieved_chunks[0]
        
        # Extract primary topic from tags
        topic = best_chunk["tags"][0].capitalize() if best_chunk["tags"] else "Concept"
        
        # We enforce short scaffolded hints without giving full code solutions
        concept_reminder = best_chunk["content"]
        
        example_idea = f"Review your code handling {topic.lower()}. Are you sure the logic aligns with the core rule?"
        reflective_question = f"How would changing your approach to {topic.lower()} alter the execution?"
        
        # Add custom rules based on specific tags for more tailored scaffolded help
        combined_tags = " ".join(best_chunk["tags"]).lower()
        if "loop" in combined_tags:
            example_idea = "Check whether your loop condition allows the index to reach its intended boundaries."
            reflective_question = "If an array has N elements, what is the highest valid index you can access?"
        elif "array" in combined_tags:
            example_idea = "Check the values of your variables at the start, middle, and end of the loop."
            reflective_question = "What do you expect each variable to contain after one iteration?"
        elif "pair programming" in combined_tags or "collaboration" in combined_tags:
            concept_reminder = "Effective pair programming requires active participation from both partners."
            example_idea = "Try swapping roles now. The Driver should explain the current logic, and the Navigator should start typing."
            reflective_question = "When was the last time you switched roles?"
        elif "peer review" in combined_tags:
            concept_reminder = "A high-quality peer review provides constructive, specific, and actionable feedback."
            example_idea = "Point out exactly what could be improved and suggest an alternative approach."
            reflective_question = "What was the original reasoning for this logic?"

        return {
            "conceptReminder": concept_reminder,
            "exampleIdea": example_idea,
            "reflectiveQuestion": reflective_question,
            "fallbackUsed": False
        }

    def _generate_fallback(self, fallback_type: str) -> Dict[str, Any]:
        if fallback_type in ["COLLABORATION_PROMPT", "ROLE_BALANCE_PROMPT"]:
            return {
                "conceptReminder": "Collaboration is key to successful pair programming.",
                "exampleIdea": "Make sure you are communicating your thoughts out loud.",
                "reflectiveQuestion": "Are both partners contributing equally to the current task?",
                "fallbackUsed": True
            }
        elif fallback_type == "REVIEW_HINT":
            return {
                "conceptReminder": "Reviews should help the author improve.",
                "exampleIdea": "Leave a comment suggesting one specific way to simplify the code.",
                "reflectiveQuestion": "Is the code readable and easy to understand?",
                "fallbackUsed": True
            }
            
        # Default Logic Hint Fallback
        return {
            "conceptReminder": "Try tracing the logic step by step before changing the code.",
            "exampleIdea": "Check the values of your variables at the start, middle, and end of the loop.",
            "reflectiveQuestion": "What do you expect each variable to contain after one iteration?",
            "fallbackUsed": True
        }
