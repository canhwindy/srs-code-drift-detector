from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, field_validator


class SaveCredentialsRequest(BaseModel):
    """Body của POST /api/claude-credentials — user paste nội dung ~/.claude/.credentials.json."""

    credentials_json: str

    @field_validator("credentials_json")
    @classmethod
    def validate_credentials_structure(cls, value: str) -> str:
        """Kiểm tra JSON có đúng cấu trúc claudeAiOauth không trước khi lưu."""
        try:
            parsed: Any = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("credentials_json phải là JSON hợp lệ") from exc

        if not isinstance(parsed, dict) or "claudeAiOauth" not in parsed:
            raise ValueError('credentials_json phải có key "claudeAiOauth" ở cấp cao nhất')

        oauth: Any = parsed["claudeAiOauth"]
        for field in ("accessToken", "refreshToken", "expiresAt"):
            if field not in oauth:
                raise ValueError(
                    f'credentials_json.claudeAiOauth thiếu trường bắt buộc: "{field}"'
                )

        if not isinstance(oauth["accessToken"], str) or not oauth["accessToken"]:
            raise ValueError("accessToken phải là string không rỗng")
        if not isinstance(oauth["refreshToken"], str) or not oauth["refreshToken"]:
            raise ValueError("refreshToken phải là string không rỗng")
        if not isinstance(oauth["expiresAt"], (int, float)):
            raise ValueError("expiresAt phải là number (milliseconds)")

        return value


class SaveCredentialsResponse(BaseModel):
    """Response của POST /api/claude-credentials."""

    status: str
    subscription_type: str | None = None
    expires_at_iso: str | None = None


class CredentialStatusResponse(BaseModel):
    """
    Response của GET /api/claude-credentials.
    KHÔNG bao giờ trả về token values — chỉ trả về metadata.
    """

    connected: bool
    subscription_type: str | None = None
    expires_at_iso: str | None = None
    scopes: list[str] = []
    warning: str | None = None
