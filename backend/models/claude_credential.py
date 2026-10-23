from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, Text, JSON, Boolean, Enum
from sqlalchemy.orm import Mapped, mapped_column
import enum

from database import Base


class TokenType(str, enum.Enum):
    """Token type: oauth with refresh, long-lived access token, or API key."""
    OAUTH_WITH_REFRESH = "oauth_with_refresh"
    ACCESS_TOKEN_ONLY = "access_token_only"
    API_KEY = "api_key"


class ClaudeCredential(Base):
    """
    Bảng lưu trữ Claude OAuth credentials của từng user (đã mã hóa Fernet).

    Mỗi row tương ứng 1 user, phân biệt qua user_key (SHA-256 hash của X-User-Key header).
    Credentials được Fernet-encrypt trước khi INSERT — DB breach không lộ tokens.

    expires_at_ms và subscription_type lưu plain text (không nhạy cảm) để
    check expiry và hiển thị UI mà không phải decrypt mỗi request.
    """

    __tablename__ = "claude_credentials"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # SHA-256 hash của raw X-User-Key header — unique per user, indexed for fast lookup
    user_key: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        nullable=False,
        index=True,
    )

    # Fernet-encrypted JSON string — chứa accessToken, refreshToken, scopes, v.v.
    credentials_encrypted: Mapped[str] = mapped_column(Text, nullable=False)

    # claudeAiOauth.expiresAt (milliseconds) — lưu plain để check expiry nhanh
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # "team" / "pro" / "max" — hiển thị trên UI, không nhạy cảm
    subscription_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # [Option 1] Token type: oauth_with_refresh | access_token_only | api_key
    # name= must match Sequelize ENUM type: enum_<tableName>_<columnName>
    # values_callable ensures SQLAlchemy uses enum .value (lowercase) not .name (uppercase)
    token_type: Mapped[TokenType] = mapped_column(
        Enum(TokenType, values_callable=lambda x: [e.value for e in x],
             name="enum_claude_credentials_token_type"),
        nullable=False,
        default=TokenType.OAUTH_WITH_REFRESH
    )

    # [Option 1] Auto-refresh enabled for this credential (False = skip refresh in scheduler)
    auto_refresh_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # [Option 1] Metadata: {status, verified_at, is_long_lived, token_lifetime_days, ...}
    # Note: renamed from 'metadata' to 'credential_metadata' to avoid SQLAlchemy reserved name
    credential_metadata: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def __repr__(self) -> str:
        return (
            f"<ClaudeCredential user_key={self.user_key[:8]}... "
            f"subscription={self.subscription_type} expires_at_ms={self.expires_at_ms}>"
        )
