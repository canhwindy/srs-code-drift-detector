from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class GeminiApiKey(Base):
    """
    Stores Gemini API keys entered by the user via the UI.

    Keys are stored in plaintext.
    The frontend always receives masked keys (first 8 + last 4 chars).

    Schema:
        gemini_api_keys (
            id          VARCHAR(36)  PRIMARY KEY,
            key_value   VARCHAR      NOT NULL,
            label       VARCHAR(255) NULLABLE,
            created_at  TIMESTAMP    NOT NULL
        )
    """

    __tablename__ = "gemini_api_keys"

    # UUID as string — consistent with Conversation model pattern
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # Full API key value — stored for internal RAG use only, never returned in full to frontend
    key_value: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # Optional human-readable label (e.g. "Production Key", "Test Key")
    label: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # Creation timestamp — used to pick the "first" key as the active one
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )
