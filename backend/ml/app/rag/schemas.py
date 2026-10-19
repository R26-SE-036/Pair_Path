from pydantic import BaseModel, Field
from typing import List

class RAGHintRequest(BaseModel):
    sessionId: str = Field(default="")
    pairId: str = Field(default="")
    predictedState: str = Field(default="LOGIC_STRUGGLE")
    interventionType: str = Field(default="LOGIC_HINT")
    questionConceptTags: List[str] = Field(default_factory=list)
    recentErrorContext: str = Field(default="")
    recentCodeSnippet: str = Field(default="")
    # What Code Coach's detector found in the pair's code, most confident first.
    detectedErrorTypes: List[str] = Field(default_factory=list)

class RAGHintResponse(BaseModel):
    interventionType: str
    retrievedConcepts: List[str]
    conceptReminder: str
    exampleIdea: str
    reflectiveQuestion: str
    sourceChunks: List[str]
    fallbackUsed: bool
