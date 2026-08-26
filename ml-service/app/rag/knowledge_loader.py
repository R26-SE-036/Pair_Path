import os
from typing import List, Dict

class KnowledgeLoader:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.chunks = self._load_knowledge()

    def _load_knowledge(self) -> List[Dict]:
        chunks = []
        if not os.path.exists(self.data_dir):
            print(f"Warning: RAG knowledge directory not found at {self.data_dir}")
            return chunks

        for filename in os.listdir(self.data_dir):
            if filename.endswith(".txt"):
                filepath = os.path.join(self.data_dir, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                    chunk = {"tags": [], "content": "", "keywords": [], "source": filename}
                    for line in lines:
                        if line.startswith("Tags:"):
                            chunk["tags"] = [t.strip().lower() for t in line.replace("Tags:", "").split(",")]
                        elif line.startswith("Content:"):
                            chunk["content"] = line.replace("Content:", "").strip()
                        elif line.startswith("Keywords:"):
                            chunk["keywords"] = [k.strip().lower() for k in line.replace("Keywords:", "").split(",")]
                    
                    if chunk["content"]:
                        chunks.append(chunk)
        return chunks
