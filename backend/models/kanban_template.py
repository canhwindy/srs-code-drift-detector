from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class KanbanTemplate(Base):
    """
    Lưu trữ các AI instruction templates do user tạo cho Kanban create agent.

    Mỗi template thuộc về một user trong một workspace (user_id + team_id).
    Chỉ một template được active tại một thời điểm cho mỗi user+workspace.
    System default template KHÔNG lưu ở đây — được hardcode trong code.

    Schema:
        kanban_templates (
            id          VARCHAR(36)  PRIMARY KEY,
            name        VARCHAR(255) NOT NULL,
            content     TEXT         NOT NULL,
            user_id     VARCHAR(36)  NOT NULL,
            team_id     VARCHAR(36)  NOT NULL,
            is_active   BOOLEAN      NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMP    NOT NULL,
            updated_at  TIMESTAMP    NOT NULL
        )
    """

    __tablename__ = "kanban_templates"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    user_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        index=True,
    )

    team_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        index=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
