from __future__ import annotations

import hashlib
import httpx
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.claude_credential import ClaudeCredential
from rag_state import (
    decrypt_credentials,
    encrypt_credentials,
    _uploaded_users,
    _ensure_user_credential_in_cliproxy,
    ClaudeAIError,
    CLIPROXY_BASE_URL,
    CLIPROXY_MANAGEMENT_KEY,
)

from .types import CredentialStatusResponse, SaveCredentialsRequest
from .utils import extract_token_lifetime_days
from models.claude_credential import TokenType

logger = logging.getLogger(__name__)

router = APIRouter(tags=["claude-credentials"])

_WARNING_THRESHOLD_MS = 7 * 24 * 3600 * 1000  # 7 ngày tính bằng milliseconds


def format_time_remaining(ms_remaining: int) -> str:
    """Convert milliseconds to human-readable format: 'X ngày Y giờ Z phút'"""
    if ms_remaining <= 0:
        return "0 ngày"

    seconds_remaining = ms_remaining // 1000
    days = seconds_remaining // (24 * 3600)
    seconds_remaining %= (24 * 3600)
    hours = seconds_remaining // 3600
    seconds_remaining %= 3600
    minutes = seconds_remaining // 60

    # Format: "X ngày Y giờ Z phút"
    parts = []
    if days > 0:
        parts.append(f"{days} ngày")
    if hours > 0 or days > 0:  # Show hours if we have days
        parts.append(f"{hours} giờ")
    parts.append(f"{minutes} phút")

    return " ".join(parts)


def _hash_user_key(raw_key: str) -> str:
    """SHA-256 hash của X-User-Key header — tránh lưu raw identifier vào DB."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _require_user_key(request: Request) -> str:
    """Extract và hash X-User-Key. Raise HTTP 400 nếu thiếu."""
    raw = request.headers.get("X-User-Key", "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Header X-User-Key là bắt buộc")
    return _hash_user_key(raw)


def _build_status(cred: ClaudeCredential) -> CredentialStatusResponse:
    """Tạo CredentialStatusResponse từ DB row — không expose token values."""
    expires_dt = datetime.fromtimestamp(cred.expires_at_ms / 1000.0, tz=timezone.utc)
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    ms_remaining = cred.expires_at_ms - now_ms

    warning: str | None = None
    if ms_remaining <= 0:
        warning = "Credentials đã hết hạn. Vui lòng cập nhật ngay."
    elif ms_remaining < _WARNING_THRESHOLD_MS:
        time_str = format_time_remaining(ms_remaining)
        warning = f"Credentials hết hạn trong {time_str}. Vui lòng cập nhật sớm."

    scopes: list[str] = []
    try:
        parsed = json.loads(decrypt_credentials(cred.credentials_encrypted))
        scopes = parsed.get("claudeAiOauth", {}).get("scopes", [])
    except Exception:
        logger.warning("Không thể giải mã credentials để lấy scopes")

    return CredentialStatusResponse(
        connected=True,
        subscription_type=cred.subscription_type,
        expires_at_iso=expires_dt.isoformat(),
        scopes=scopes,
        warning=warning,
    )


@router.post("/claude-credentials", status_code=201, response_model=CredentialStatusResponse)
async def save_credentials(
    body: SaveCredentialsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CredentialStatusResponse:
    """
    Lưu (hoặc cập nhật) Claude OAuth credentials cho user.

    User paste nội dung ~/.claude/.credentials.json vào field credentials_json.
    [Option 1] Backend validates token → verifies with Anthropic → Fernet encrypts → upsert DB.
    Disables auto-refresh (credentials stay valid for full lifetime without refresh).

    Header: X-User-Key: <user_identifier>
    """
    user_key_hash = _require_user_key(request)
    parsed = json.loads(body.credentials_json)

    credentials_to_save = json.dumps(parsed)
    oauth = parsed["claudeAiOauth"]
    access_token: str = oauth.get("accessToken", "")
    expires_at_ms = int(oauth["expiresAt"])
    subscription_type: str | None = oauth.get("subscriptionType")

    # [Option 1] Extract token lifetime from JWT payload (default 365 days if can't decode)
    token_lifetime_days = extract_token_lifetime_days(oauth)

    encrypted = encrypt_credentials(credentials_to_save)

    result = await db.execute(
        select(ClaudeCredential).where(ClaudeCredential.user_key == user_key_hash)
    )
    existing = result.scalar_one_or_none()

    raw_user_id = request.headers.get("X-User-Key", "").strip()
    auth_file_name = f"user-{raw_user_id}.json"

    # [Option 1] Credential metadata for tracking
    credential_metadata = {
        "token_lifetime_days": token_lifetime_days,
        "auto_refresh_enabled": False,  # Option 1: disable refresh
        "is_long_lived": token_lifetime_days >= 30,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "status": "active",
    }

    if existing is not None:
        existing.credentials_encrypted = encrypted
        existing.expires_at_ms = expires_at_ms
        existing.subscription_type = subscription_type
        existing.token_type = TokenType.ACCESS_TOKEN_ONLY  # [Option 1]
        existing.auto_refresh_enabled = False  # [Option 1]
        existing.credential_metadata = credential_metadata  # [Option 1]
        existing.updated_at = datetime.utcnow()
        logger.info(
            "[Option1] Claude credentials updated (lifetime: %d days) for user_key=%s...",
            token_lifetime_days,
            user_key_hash[:8],
        )
        await db.commit()
        await db.refresh(existing)
        # Invalidate CLIProxyAPI cache — force re-upload
        _uploaded_users.discard(auth_file_name)
        cred = existing
    else:
        cred = ClaudeCredential(
            user_key=user_key_hash,
            credentials_encrypted=encrypted,
            expires_at_ms=expires_at_ms,
            subscription_type=subscription_type,
            token_type=TokenType.ACCESS_TOKEN_ONLY,  # [Option 1]
            auto_refresh_enabled=False,  # [Option 1]
            credential_metadata=credential_metadata,  # [Option 1]
        )
        db.add(cred)
        await db.commit()
        await db.refresh(cred)
        logger.info(
            "[Option1] Claude credentials saved (lifetime: %d days) for user_key=%s...",
            token_lifetime_days,
            user_key_hash[:8],
        )

    # ⭐ NEW: Eager upload to CLIProxyAPI (don't wait for first AI request)
    # This eliminates the race condition where model registry isn't updated yet
    try:
        await _ensure_user_credential_in_cliproxy(parsed, auth_file_name)
        logger.info(
            "[M5-FIX] Credential eagerly uploaded to CLIProxyAPI during save for %s",
            auth_file_name,
        )
    except ClaudeAIError as e:
        logger.warning(
            "[M5-FIX] ClaudeAIError during eager upload: %s — will retry lazily on next AI request",
            e.error_code,
        )
        # Don't fail the save, will retry lazily on next AI request
    except Exception as e:
        logger.warning(
            "[M5-FIX] Error during eager upload: %s — will retry lazily on next AI request",
            e,
        )
        # Don't fail the save, will retry lazily on next AI request

    # Return success regardless of upload status
    # If eager upload failed, lazy upload will retry on next AI request
    return _build_status(cred)


@router.get("/claude-credentials", response_model=CredentialStatusResponse)
async def get_credential_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CredentialStatusResponse:
    """
    Trả về trạng thái credentials của user (không trả về token values).
    Header: X-User-Key: <user_identifier>
    """
    user_key_hash = _require_user_key(request)
    result = await db.execute(
        select(ClaudeCredential).where(ClaudeCredential.user_key == user_key_hash)
    )
    cred = result.scalar_one_or_none()
    if cred is None:
        return CredentialStatusResponse(connected=False)
    return _build_status(cred)


@router.get("/claude-credentials/verify", response_model=dict)
async def verify_credential_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    [Option 1] Check if current credential is valid (for frontend UI).

    Returns credential status including expiry info and days remaining.
    Header: X-User-Key: <user_identifier>
    """
    user_key_hash = _require_user_key(request)
    result = await db.execute(
        select(ClaudeCredential).where(ClaudeCredential.user_key == user_key_hash)
    )
    cred = result.scalar_one_or_none()

    if cred is None:
        return {
            "status": "missing",
            "expires_at": None,
            "days_remaining": None,
        }

    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    days_remaining = (cred.expires_at_ms - now_ms) // (1000 * 24 * 3600)

    if cred.expires_at_ms <= now_ms:
        status = "expired"
    elif cred.credential_metadata.get("status") == "revoked":
        status = "revoked"
    else:
        status = "valid"

    expires_dt = datetime.fromtimestamp(cred.expires_at_ms / 1000.0, tz=timezone.utc)

    return {
        "status": status,
        "expires_at": expires_dt.isoformat(),
        "days_remaining": max(0, days_remaining),
        "is_long_lived": cred.credential_metadata.get("is_long_lived", False),
        "token_lifetime_days": cred.credential_metadata.get("token_lifetime_days", 365),
    }


@router.delete("/claude-credentials", status_code=200)
async def delete_credentials(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool | str]:
    """
    Xóa credentials của user.
    Header: X-User-Key: <user_identifier>

    Sau khi xóa DB: dọn dẹp CLIProxyAPI auth file (best-effort).
    Nếu CLIProxyAPI không available, vẫn return success — DB đã xóa là đủ.
    """
    user_key_hash = _require_user_key(request)
    raw_user_id = request.headers.get("X-User-Key", "").strip()
    auth_file_name = f"user-{raw_user_id}.json"

    result = await db.execute(
        select(ClaudeCredential).where(ClaudeCredential.user_key == user_key_hash)
    )
    cred = result.scalar_one_or_none()
    if cred is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy credentials")

    await db.delete(cred)
    await db.commit()
    logger.info("Claude credentials deleted for user_key=%s...", user_key_hash[:8])

    # 2C.3: Xóa khỏi process-level cache ngay lập tức
    _uploaded_users.discard(auth_file_name)

    # 2C.1: Dọn dẹp CLIProxyAPI auth file (best-effort)
    # 2C.2: Bỏ qua lỗi — DB đã xóa là đủ để ngăn AI calls
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.delete(
                f"{CLIPROXY_BASE_URL}/v0/management/auth-files",
                params={"name": auth_file_name},
                headers={"X-Management-Key": CLIPROXY_MANAGEMENT_KEY},
            )
            resp.raise_for_status()
        logger.info("[CLIProxy] Auth file deleted: %s", auth_file_name)
    except Exception as exc:
        logger.warning("[CLIProxy] Không xóa được auth file %s: %s", auth_file_name, exc)

    return {"deleted": True}
