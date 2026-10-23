"""
Gap-finding module DB models.
"""

import enum
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum, String, JSON

from pr_webhook_module.db.database import Base


class ConfigStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    deleted = "deleted"


class GithubConfig(Base):
    """
    Stores GitHub pipeline config per Outline team.

    Synced from Outline via github_config_events queue (config.upserted / config.deleted).
    Status updated via team_events queue (team.deleted / team.suspended / team.reactivated).
    """

    __tablename__ = "github_configs"

    team_id = Column(String, primary_key=True)
    github_token = Column(String, nullable=False)
    repositories = Column(JSON, nullable=False, default=list)
    # [{ "url": str, "owner": str, "repo": str, "webhookSecret": str | None }]
    claude_project_dir = Column(String, nullable=True)
    status = Column(
        Enum(ConfigStatus, name="config_status"),
        nullable=False,
        default=ConfigStatus.active,
    )
    updated_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def get_webhook_secret_for_repo(self, repo_full_name: str) -> str | None:
        """Return webhookSecret for the matching repo, or None."""
        for r in (self.repositories or []):
            owner_repo = f"{r.get('owner', '')}/{r.get('repo', '')}"
            if owner_repo == repo_full_name or r.get("url", "").endswith(repo_full_name):
                return r.get("webhookSecret") or None
        return None
