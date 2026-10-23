from datetime import datetime
from uuid import uuid4
from sqlalchemy import String, DateTime, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Conversation(Base):
    """
    Đại diện cho một cuộc hội thoại chat.

    Mỗi conversation có nhiều messages (1-to-many).
    Dùng prefix "chat_" cho tên bảng để tránh xung đột với Outline.

    Schema:
        chat_conversations (
            id          VARCHAR  PRIMARY KEY,
            title       VARCHAR  NOT NULL,
            created_at  TIMESTAMP NOT NULL,
            updated_at  TIMESTAMP NOT NULL
        )
    """

    __tablename__ = "chat_conversations"

    # ─────────────────────────────────────────────────────────
    # PRIMARY KEY: UUID dạng string
    # ─────────────────────────────────────────────────────────
    # default=lambda: str(uuid4()): Tạo UUID mới mỗi khi tạo row.
    # Dùng lambda để UUID được tạo lúc runtime, không phải lúc import.
    # Dùng String thay vì UUID type để dễ serialize sang JSON.
    # ─────────────────────────────────────────────────────────
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )

    # ID của user tạo conversation — dùng để filter và kiểm tra quyền
    user_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        index=True,
        default="",
    )

    # ID của workspace (team) mà conversation thuộc về
    workspace_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        index=True,
        default="",
    )

    # Soft delete flag — True khi user bị remove khỏi workspace
    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    # Tiêu đề conversation — user có thể đổi sau
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default="New conversation",
    )

    # ─────────────────────────────────────────────────────────
    # TIMESTAMPS
    # ─────────────────────────────────────────────────────────
    # created_at: Thời điểm tạo conversation, không bao giờ thay đổi.
    # updated_at: Cập nhật mỗi khi có message mới → dùng để sort
    #             danh sách conversation (recent first).
    # ─────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    # ─────────────────────────────────────────────────────────
    # RELATIONSHIP: Một Conversation có nhiều Messages
    # ─────────────────────────────────────────────────────────
    # back_populates="conversation": Message.conversation trỏ ngược lại
    # cascade="all, delete-orphan": Khi xóa Conversation, tự động xóa
    #   tất cả Messages thuộc về nó — tránh orphan records.
    # ─────────────────────────────────────────────────────────
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )