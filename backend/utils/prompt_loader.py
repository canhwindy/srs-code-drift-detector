import os
from functools import lru_cache

_PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "prompts")


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    """Load a prompt file from the prompts/ directory. Cached after first read."""
    path = os.path.normpath(os.path.join(_PROMPTS_DIR, name))
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()
