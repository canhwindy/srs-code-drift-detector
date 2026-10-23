"""
Message Translator — github_config_events queue

Maps Outline's config wire format → gap-finding internal domain.

Rule: only this file knows the Outline wire format for config events.
Consumers work exclusively with the translated dict.
"""


def translate_config_event(raw: dict) -> dict:
    """
    Translate a config event message from Outline wire format to gap-finding domain.

    Outline publishes: event, teamId, apiKey, repositories, claudeProjectDir, userId, ...
    We keep:           team_id, github_token, repositories (with webhookSecret)

    Field requirements:
      - teamId: required for all events (needed to locate config)
      - apiKey: required only for upsert — delete events legitimately omit it
                since no credential is needed to remove a record.

    Raises:
        ValueError: if required fields are missing for the event type.
    """
    if not raw.get("teamId"):
        raise ValueError("config event message missing required field: teamId")

    event = raw.get("event") or ""
    if event != "config.deleted" and not raw.get("apiKey"):
        raise ValueError("config event message missing required field: apiKey")

    return {
        "team_id":            raw["teamId"],
        "github_token":       raw.get("apiKey"),
        "repositories":       raw.get("repositories", []),
        "claude_project_dir": raw.get("claudeProjectDir"),
    }
