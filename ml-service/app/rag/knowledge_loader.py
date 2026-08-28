import os
from typing import List, Dict

# Entries within a file are separated by a line of three or more dashes.
ENTRY_SEPARATOR = "---"

# Recognised field names. Everything on following lines belongs to the last
# field seen, so an entry's text may wrap across as many lines as it needs.
FIELDS = {
    "Tags:": "tags",
    "Keywords:": "keywords",
    "Content:": "content",
    "Example:": "example",
    "Question:": "question",
}
LIST_FIELDS = {"tags", "keywords"}


class KnowledgeLoader:
    """Loads the pedagogical corpus into memory once at startup.

    A file may hold any number of entries. An earlier version kept only the
    last `Content:` line in each file, which silently capped the corpus at one
    entry per file and made growing it mean creating files rather than writing
    knowledge.
    """

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.chunks = self._load_knowledge()

    def _load_knowledge(self) -> List[Dict]:
        chunks: List[Dict] = []
        if not os.path.exists(self.data_dir):
            print(f"Warning: RAG knowledge directory not found at {self.data_dir}")
            return chunks

        for filename in sorted(os.listdir(self.data_dir)):
            if not filename.endswith(".txt"):
                continue
            path = os.path.join(self.data_dir, filename)
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            for index, block in enumerate(self._split_entries(text)):
                chunk = self._parse_entry(block, filename, index)
                if chunk:
                    chunks.append(chunk)
        return chunks

    @staticmethod
    def _split_entries(text: str) -> List[str]:
        blocks, current = [], []
        for line in text.splitlines():
            if line.strip().startswith(ENTRY_SEPARATOR) and set(line.strip()) == {"-"}:
                blocks.append("\n".join(current))
                current = []
            else:
                current.append(line)
        blocks.append("\n".join(current))
        return [b for b in blocks if b.strip()]

    @staticmethod
    def _parse_entry(block: str, filename: str, index: int) -> Dict:
        entry = {
            "id": f"{os.path.splitext(filename)[0]}#{index}",
            "source": filename,
            "tags": [],
            "keywords": [],
            "content": "",
            "example": "",
            "question": "",
        }

        field = None
        for line in block.splitlines():
            matched = next((f for f in FIELDS if line.startswith(f)), None)
            if matched:
                field = FIELDS[matched]
                value = line[len(matched):].strip()
                if field in LIST_FIELDS:
                    entry[field] = [v.strip().lower() for v in value.split(",") if v.strip()]
                else:
                    entry[field] = value
            elif field and field not in LIST_FIELDS and line.strip():
                # Continuation of the previous field.
                entry[field] = (entry[field] + " " + line.strip()).strip()

        # An entry without content cannot help anyone; drop it rather than
        # letting a malformed block reach retrieval.
        return entry if entry["content"] else None
