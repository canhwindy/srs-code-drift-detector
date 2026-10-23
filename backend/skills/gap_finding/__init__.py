"""Gap Finding Skill — Python implementation (replaces SKILL.md + CLI approach)."""
from .gap_finding import run_gap_finding
from .config import GITNEXUS_REPOS, LIGHTRAG_QUERY_ENDPOINT

__all__ = ["run_gap_finding", "GITNEXUS_REPOS", "LIGHTRAG_QUERY_ENDPOINT"]
