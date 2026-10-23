"""
Utility functions for Claude credential management.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def extract_token_lifetime_days(oauth_data: dict[str, Any]) -> int:
    """
    Extract token lifetime from OAuth credential data.

    Tries to decode the JWT access_token to get `exp` and `iat` fields.
    If JWT decode fails, assumes 365 days (1 year standard for long-lived tokens).

    Args:
        oauth_data: Dict with keys like {accessToken, refreshToken, expiresAt, ...}

    Returns:
        Estimated token lifetime in days (default 365 if can't decode)
    """
    try:
        import jwt
        from datetime import datetime

        access_token = oauth_data.get("accessToken", "")
        if not access_token:
            logger.warning("[Option1] No accessToken in oauth_data, defaulting to 365 days")
            return 365

        # Decode without verification (we just want iat/exp fields)
        decoded = jwt.decode(access_token, options={"verify_signature": False})

        exp = decoded.get("exp")
        iat = decoded.get("iat")

        if not exp or not iat:
            logger.warning("[Option1] Token missing exp/iat, defaulting to 365 days")
            return 365

        lifetime_seconds = exp - iat
        lifetime_days = lifetime_seconds // 86400  # 1 day = 86400 seconds

        logger.info(
            "[Option1] Token lifetime extracted: %d days (exp=%d, iat=%d)",
            lifetime_days,
            exp,
            iat,
        )
        return lifetime_days

    except Exception as e:
        logger.warning("[Option1] Could not extract token lifetime: %s, defaulting to 365 days", e)
        return 365
