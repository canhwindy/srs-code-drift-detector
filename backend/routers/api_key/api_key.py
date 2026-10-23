import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.api_key import GeminiApiKey
from .api_key_type import AddApiKeyRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ApiKey"])


def _mask_key(key_value: str) -> str:
    """Return a masked version of an API key for safe UI display.

    Example: "AIzaSyD1AbCdEfGhIjKl" -> "AIzaSyD1...IjKl"
    """
    if len(key_value) <= 12:
        return "****"
    return f"{key_value[:8]}...{key_value[-4:]}"


def _serialize_api_key(key: GeminiApiKey) -> dict:
    """Convert ORM object to API response dict with masked key."""
    return {
        "id": key.id,
        "key_masked": _mask_key(key.key_value),
        "label": key.label,
        "created_at": key.created_at.isoformat(),
    }


@router.get("/api-keys")
async def list_api_keys(db: AsyncSession = Depends(get_db)) -> dict:
    """
    GET /api/api-keys

    Returns all stored API keys with masked key values.
    Sorted by created_at ASC (oldest first = consistent ordering).

    Returns: { "api_keys": [{ id, key_masked, label, created_at }] }
    """
    result = await db.execute(
        select(GeminiApiKey).order_by(GeminiApiKey.created_at.asc())
    )
    keys = result.scalars().all()

    logger.info(f"[ApiKey] Listed {len(keys)} keys")
    return {"api_keys": [_serialize_api_key(k) for k in keys]}


@router.post("/api-keys", status_code=201)
async def add_api_key(
    body: AddApiKeyRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    POST /api/api-keys

    Saves a new Gemini API key to the database.
    After saving, refreshes the in-memory GEMINI_API_KEY so
    subsequent LLM/embedding calls use the new key immediately.

    Body: { "key_value": "AIzaSy...", "label": "My Key" }
    Returns: { id, key_masked, label, created_at }
    """
    # STEP 1: Validate — key must not be empty or whitespace
    stripped_key = body.key_value.strip()
    if not stripped_key:
        raise HTTPException(status_code=400, detail="key_value must not be empty")

    # STEP 2: Persist key to database
    new_key = GeminiApiKey(
        key_value=stripped_key,
        label=body.label.strip() if body.label else None,
    )
    db.add(new_key)
    await db.commit()
    await db.refresh(new_key)

    logger.info(f"[ApiKey] Added new key: id={new_key.id}, label={new_key.label}")

    # STEP 3: Refresh in-memory GEMINI_API_KEY so RAG calls use the new key immediately.
    # Lazy import to avoid circular import at module load time.
    from rag_state import refresh_gemini_api_key
    await refresh_gemini_api_key()

    return _serialize_api_key(new_key)


@router.delete("/api-keys/{key_id}", status_code=200)
async def delete_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    DELETE /api/api-keys/{key_id}

    Deletes a stored API key by its UUID.
    After deletion, refreshes the in-memory GEMINI_API_KEY
    so the next LLM call uses a different key (or None if no keys left).

    Returns: { "deleted": true, "id": key_id }
    HTTP 404 if key_id does not exist.
    """
    # STEP 1: Verify key exists
    key = await db.get(GeminiApiKey, key_id)
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")

    # STEP 2: Delete from database
    await db.delete(key)
    await db.commit()

    logger.info(f"[ApiKey] Deleted key: id={key_id}")

    # STEP 3: Refresh in-memory GEMINI_API_KEY after deletion.
    # Lazy import to avoid circular import at module load time.
    from rag_state import refresh_gemini_api_key
    await refresh_gemini_api_key()

    return {"deleted": True, "id": key_id}
