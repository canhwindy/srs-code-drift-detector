"""
Message Translator — team_events queue

Maps Outline's team event wire format → gap-finding internal domain.

Rule: only this file knows the Outline wire format for team events.
Consumers work exclusively with the translated dict.
"""

_STATUS_MAP = {
    "team.deleted":     "deleted",
    "team.suspended":   "suspended",
    "team.reactivated": "active",
}


def translate_team_event(raw: dict) -> dict:
    """
    Translate a team event message from Outline wire format to gap-finding domain.

    Outline publishes: teamId, event, ...
    We keep:           team_id, status, event

    Raises:
        ValueError: if required fields are missing or event is unrecognised.
    """
    if not raw.get("teamId"):
        raise ValueError("team event message missing required field: teamId")

    event = raw.get("event", "")
    status = _STATUS_MAP.get(event)
    if status is None:
        raise ValueError(f"team event message has unrecognised event: {event!r}")

    return {
        "team_id": raw["teamId"],
        "status":  status,
        "event":   event,
    }
