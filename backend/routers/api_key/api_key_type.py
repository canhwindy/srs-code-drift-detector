from pydantic import BaseModel


class AddApiKeyRequest(BaseModel):
    """
    Request body for adding a new API key.

    Fields:
        key_value: The full Gemini API key string (required).
        label: Optional human-readable name for the key.
    """

    key_value: str
    label: str | None = None


class ApiKeyResponse(BaseModel):
    """
    Public representation of a stored API key.
    key_masked is used instead of key_value to avoid exposing
    the full key in API responses.

    Example key_masked: "AIzaSyD1...k9zX"
    """

    id: str
    key_masked: str
    label: str | None
    created_at: str
