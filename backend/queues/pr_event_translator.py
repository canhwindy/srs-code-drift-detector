"""
Message Translator — pr_events queue

Converts the wire format published by the gap_finding_module (pr_worker.py)
into the internal PrEventInput type used by pr_event_worker.py.

Rule: only this file knows the wire format of pr_events messages.
If gap_finding_module renames a field, update only this file — the worker is unaffected.
"""

from dataclasses import dataclass


# =============================================================================
# Wire format — exactly what gap_finding_module/pr_worker.py publishes
# =============================================================================

@dataclass
class PrEventMessage:
    """Raw fields from pr_events queue message (snake_case, may be missing)."""
    pr_id: int | None
    repo: str
    pr_title: str
    team_id: str
    action: str
    merged: bool
    published_at: str


# =============================================================================
# Internal format — what pr_event_worker.py uses
# =============================================================================

@dataclass
class PrEventInput:
    """Validated, typed representation of a pr_events message."""
    pr_id: int
    repo: str
    pr_title: str
    team_id: str
    action: str
    merged: bool
    published_at: str


# =============================================================================
# Translator
# =============================================================================

class PrEventTranslateError(ValueError):
    """Raised when a required field is missing or invalid."""


def translate_pr_event(raw: dict) -> PrEventInput:
    """
    Parse and translate a raw queue message dict into a typed PrEventInput.
    Raises PrEventTranslateError if required fields (pr_id, repo) are missing.
    """
    if not isinstance(raw, dict):
        raise PrEventTranslateError("pr_events message must be a JSON object")

    pr_id = raw.get("pr_id")
    if pr_id is None:
        raise PrEventTranslateError("pr_events message missing required field: pr_id")

    repo = raw.get("repo") or ""
    if not repo:
        raise PrEventTranslateError("pr_events message missing required field: repo")

    return PrEventInput(
        pr_id=int(pr_id),
        repo=repo,
        pr_title=raw.get("pr_title") or "",
        team_id=raw.get("team_id") or "",
        action=raw.get("action") or "",
        merged=bool(raw.get("merged", False)),
        published_at=raw.get("published_at") or "",
    )
