import hashlib
import json

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.claude_credential import ClaudeCredential
from rag_state import (
    decrypt_credentials,
)


async def get_claude_credentials(
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> str:
    """FastAPI dependency: resolve và decrypt per-user credentials từ DB.

    Raises HTTP 401 nếu thiếu X-User-Key hoặc không tìm thấy credentials trong DB.
    Returns credentials_json (str) để inject vào _request_credentials ContextVar.
    CLIProxyAPI tự xử lý token refresh — không cần pre-refresh tại đây.
    """
    user_key_raw = http_request.headers.get("X-User-Key", "").strip()
    if not user_key_raw:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "CLAUDE_CREDENTIALS_REQUIRED",
                "message": "X-User-Key header is required",
            },
        )

    user_key_hash = hashlib.sha256(user_key_raw.encode()).hexdigest()
    result = await db.execute(
        select(ClaudeCredential).where(ClaudeCredential.user_key == user_key_hash)
    )
    cred = result.scalar_one_or_none()

    if not cred:
        raise HTTPException(
            status_code=401,
            detail={
                "error_code": "CLAUDE_CREDENTIAL_MISSING",
                "message": "Claude credentials are missing. Please connect your Claude account.",
            },
        )

    credentials_dict = json.loads(decrypt_credentials(cred.credentials_encrypted))
    return json.dumps(credentials_dict)
