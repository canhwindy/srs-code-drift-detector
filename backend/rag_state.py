import json
import logging
import time
import os
from contextvars import ContextVar
from datetime import datetime, timezone
from lightrag_extended import ExtendedLightRAG
from openai import AsyncOpenAI
from dotenv import load_dotenv
from lightrag.utils import wrap_embedding_func_with_attrs
from pathlib import Path
import numpy as np
import asyncio
import httpx
import requests
from cryptography.fernet import Fernet, InvalidToken
# Load environment variables
# 1) Load root .env to read NODE_ENV
_root_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_root_env, encoding='latin-1')

# 2) Load .env.{NODE_ENV} (e.g. .env.local, .env.production)
_node_env = os.getenv("NODE_ENV", "local")
_env_file = _root_env.parent / f".env.{_node_env}"
print(f"DEBUG: NODE_ENV={_node_env}, env_file={_env_file}, exists={_env_file.exists()}")
if _env_file.exists():
    load_dotenv(_env_file, encoding='latin-1', override=True)
print(f"DEBUG: EMBEDDING_BINDING_API_KEY={os.getenv('EMBEDDING_BINDING_API_KEY', '<MISSING>')[:20]}...")

# ─────────────────────────────────────────────────────────────
# LLM CONFIG — unified configuration for all LLM providers.
# LLM_BINDING: "gemini" or "claude" (or any OpenAI-compatible)
# Change these in .env to switch models without touching code.
# ─────────────────────────────────────────────────────────────
LLM_BINDING: str = os.getenv("LLM_BINDING", "gemini")  # "gemini" or "claude"
LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.5-flash")
LLM_BINDING_HOST: str = os.getenv("LLM_BINDING_HOST", "https://gemini.windyselfhost.space/gemini")
LLM_BINDING_API_KEY: str = os.getenv("LLM_BINDING_API_KEY", "")

# Legacy support for old variable names
GEMINI_LLM_MODEL: str = LLM_MODEL

# ─────────────────────────────────────────────────────────────
# EMBEDDING CONFIG — OpenAI-compatible endpoint (OpenRouter).
# Change these in .env to switch embedding model/provider.
# ─────────────────────────────────────────────────────────────
EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "baai/bge-m3")
EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "1024"))
EMBEDDING_TOKEN_LIMIT: int = int(os.getenv("EMBEDDING_TOKEN_LIMIT", "8192"))
EMBEDDING_BINDING_HOST: str = os.getenv("EMBEDDING_BINDING_HOST", "https://openrouter.ai/api/v1")
EMBEDDING_BINDING_API_KEY: str = os.getenv("EMBEDDING_BINDING_API_KEY", "")

# ─────────────────────────────────────────────────────────────
# CLAUDE PROXY CONFIG — OpenAI-compatible proxy for Claude models.
# Legacy support - now uses LLM_BINDING_* vars above.
# ─────────────────────────────────────────────────────────────
CLAUDE_PROXY_URL: str = os.getenv("CLAUDE_PROXY_URL", "")
CLAUDE_PROXY_API_KEY: str = os.getenv("CLAUDE_PROXY_API_KEY", "")
CLAUDE_PROXY_MODEL: str = os.getenv("CLAUDE_PROXY_MODEL", "")

# ─────────────────────────────────────────────────────────────
# CLIPROXY CONFIG — per-user Claude routing qua CLIProxyAPI.
# CLIProxyAPI (Go proxy) handle OAuth, token refresh, fingerprinting.
# ─────────────────────────────────────────────────────────────
CLIPROXY_BASE_URL: str = os.getenv("CLIPROXY_BASE_URL", "http://localhost:8317")
CLIPROXY_MANAGEMENT_KEY: str = os.getenv("CLIPROXY_MANAGEMENT_KEY", "")
CLIPROXY_API_KEY: str = os.getenv("CLIPROXY_API_KEY", "outline-internal-proxy-key")

# ─────────────────────────────────────────────────────────────────────
# CLAUDE AI ERROR — structured exception với error_code cho frontend
#
# chat.py / kanban_implement.py bắt ClaudeAIError TRƯỚC RuntimeError,
# extract error_code → trả HTTP 400 về frontend → frontend mở đúng UI.
# ─────────────────────────────────────────────────────────────────────
CLAUDE_CREDENTIAL_MISSING = "CLAUDE_CREDENTIAL_MISSING"  # Chưa connect tài khoản Claude
CLAUDE_CREDENTIAL_EXPIRED = "CLAUDE_CREDENTIAL_EXPIRED"  # Credentials invalid/expired
CLIPROXY_UNAVAILABLE      = "CLIPROXY_UNAVAILABLE"       # CLIProxyAPI chưa start / misconfigured


class ClaudeAIError(RuntimeError):
    """Lỗi Claude AI có cấu trúc — mang error_code để frontend mở đúng UI.

    Là subclass của RuntimeError để backward-compatible với code cũ (không crash).
    chat.py và kanban_implement.py bắt ClaudeAIError trước RuntimeError,
    extract error_code và forward về frontend dưới dạng HTTP 400.
    """

    def __init__(self, error_code: str, message: str) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message


# ─────────────────────────────────────────────────────────────
# GEMINI_API_KEY: Module-level variable, updated at runtime.
#
# Priority order:
#   1. Database (gemini_api_keys table, first row by created_at)
#   2. Environment variable GEMINI_API_KEY (fallback)
#   3. None — RAG calls will raise RuntimeError with helpful message
#
# Python resolves module globals at CALL TIME, not definition time.
# Updating this variable from refresh_gemini_api_key() is immediately
# visible to all callers of llm_model_func() and embedding_func().
# ─────────────────────────────────────────────────────────────
GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")


# ─────────────────────────────────────────────────────────────────────
# CLAUDE CREDENTIALS ENCRYPTION
#
# Fernet key (AES-128-CBC + HMAC-SHA256) dùng để encrypt/decrypt
# OAuth credentials trước khi lưu vào DB.
#
# Generate key (chạy 1 lần):
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Thêm vào .env: CREDENTIAL_ENCRYPTION_KEY=<key>
# ─────────────────────────────────────────────────────────────────────
CREDENTIAL_ENCRYPTION_KEY: str = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")

CLAUDE_MESSAGES_MODEL: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
CLAUDE_MESSAGES_MAX_TOKENS: int = int(os.getenv("CLAUDE_MAX_TOKENS", "32000"))

# ContextVar — lưu per-request credentials (isolate per asyncio Task, thread-safe)
# chat.py set giá trị này trước khi gọi rag.aquery_llm()
# _call_claude_cli_async đọc từ đây để lấy cred_dict upload lên CLIProxyAPI
_request_credentials: ContextVar[str | None] = ContextVar(
    "_request_credentials", default=None
)

# ContextVar — lưu userId (UUID string) để build auth_file_name cho CLIProxyAPI
# Set bởi chat.py và kanban_implement.py trước khi gọi _call_claude_cli_async
_request_user_id: ContextVar[str | None] = ContextVar("_request_user_id", default=None)

# Process-level set để track auth files đã upload lên CLIProxyAPI.
# Tránh upload lại mỗi request (CLIProxyAPI tự refresh token, không cần upload lại).
# Nếu CLIProxyAPI trả 401 → discard auth_file_name khỏi set → force re-upload lần sau.
_uploaded_users: set[str] = set()

# ContextVar — pipeline-run usage collector. Set bởi pr_event_worker trước run_gap_finding;
# _call_claude_cli_async append 1 record mỗi Claude call. Cuối run, worker format summary
# để in PR ID + bảng token/duration/cost ra console. None = không collect (chat flow bình thường).
_pipeline_usage_log: ContextVar[list | None] = ContextVar(
    "_pipeline_usage_log", default=None
)

# Pricing Claude Sonnet 4.6 (USD / 1M tokens).
_CLAUDE_SONNET_4_6_PRICING = {
    "input": 3.0,
    "output": 15.0,
    "cache_creation": 3.75,
    "cache_read": 0.30,
}


def _detect_claude_call_purpose(prompt_prefix: str) -> str:
    """Phân loại Claude call từ prompt prefix để hiển thị trong summary."""
    p = (prompt_prefix or "").lower()
    if "keyword extractor" in p:
        return "Keyword extraction"
    if "two separate eas tables" in p:
        return "EAS extraction"
    if "below are two eas tables" in p:
        return "Drift analysis"
    if "full spec:" in p:
        return "LightRAG synthesis"
    return "LLM call"


def format_pipeline_usage_summary(
    pr_id,
    repo: str,
    records: list[dict],
    uc_id: str | None = None,
    gap_rows: int | None = None,
) -> str:
    """Build multiline summary: bảng calls + totals + cost theo pricing Sonnet 4.6."""
    header = f"[PipelineUsage] PR #{pr_id} ({repo})"
    if not records:
        return header + " — no Claude calls recorded"

    lines = [header, "Call  Tokens (in/out)          Duration  Purpose"]
    total_in = total_out = total_cc = total_cr = 0
    total_duration = 0.0

    for i, r in enumerate(records, 1):
        in_t = int(r.get("input_tokens") or 0)
        out_t = int(r.get("output_tokens") or 0)
        cc = int(r.get("cache_creation") or 0)
        cr = int(r.get("cache_read") or 0)
        dur = float(r.get("duration_s") or 0.0)
        purpose = r.get("purpose") or "LLM call"
        cache_note = ""
        if cc:
            cache_note = f"  cache_create={cc:,}"
        elif cr:
            cache_note = f"  cache_read={cr:,}"
        lines.append(
            f"#{i:<4}{in_t:>6,}  / {out_t:>6,}{cache_note:<22}{dur:>6.0f}s   {purpose}"
        )
        total_in += in_t
        total_out += out_t
        total_cc += cc
        total_cr += cr
        total_duration += dur

    lines.append("─" * 66)
    mins = int(total_duration // 60)
    secs = int(total_duration % 60)
    dur_str = f"~{mins}m {secs}s" if mins else f"~{secs}s"
    lines.append(f"TOTAL {total_in:>6,}  / {total_out:>6,}                        {dur_str}")

    if uc_id is not None or gap_rows is not None:
        lines.append("")
        lines.append(f"Output: uc_id={uc_id or 'N/A'}, gap_rows={gap_rows or 0}")

    p = _CLAUDE_SONNET_4_6_PRICING
    cost_in = total_in * p["input"] / 1_000_000
    cost_out = total_out * p["output"] / 1_000_000
    cost_cc = total_cc * p["cache_creation"] / 1_000_000
    cost_cr = total_cr * p["cache_read"] / 1_000_000
    total_cost = cost_in + cost_out + cost_cc + cost_cr

    lines.append("")
    lines.append("Cost (Sonnet 4.6 @ $3 in / $15 out per M tokens):")
    lines.append(f"Input:  {total_in:>6,}  × $3/M    = ${cost_in:.3f}")
    lines.append(f"Output: {total_out:>6,}  × $15/M   = ${cost_out:.3f}")
    if total_cc:
        lines.append(f"Cache create: {total_cc:>6,}  × $3.75/M = ${cost_cc:.3f}")
    if total_cr:
        lines.append(f"Cache read:   {total_cr:>6,}  × $0.30/M = ${cost_cr:.3f}")
    lines.append(f"Total per run:                   ≈ ${total_cost:.2f}")

    return "\n".join(lines)


def encrypt_credentials(json_str: str) -> str:
    """Mã hóa credentials JSON string bằng Fernet trước khi lưu DB."""
    if not CREDENTIAL_ENCRYPTION_KEY:
        raise ValueError(
            "CREDENTIAL_ENCRYPTION_KEY chưa được set trong .env. "
            "Generate: python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        )
    return Fernet(CREDENTIAL_ENCRYPTION_KEY.encode()).encrypt(json_str.encode()).decode()


def decrypt_credentials(encrypted_str: str) -> str:
    """Giải mã credentials đã encrypt bằng Fernet."""
    if not CREDENTIAL_ENCRYPTION_KEY:
        raise ValueError("CREDENTIAL_ENCRYPTION_KEY chưa được set trong .env")
    try:
        return Fernet(CREDENTIAL_ENCRYPTION_KEY.encode()).decrypt(encrypted_str.encode()).decode()
    except InvalidToken as exc:
        raise ValueError(
            "Không thể giải mã credentials. CREDENTIAL_ENCRYPTION_KEY có thể đã thay đổi."
        ) from exc


async def refresh_gemini_api_key() -> None:
    """
    Load GEMINI_API_KEY from the database (first row by created_at ASC).
    Falls back silently to the environment variable if no DB keys exist.

    Called:
      1. During lifespan startup in main.py (after create_all)
      2. After POST /api/api-keys (new key added)
      3. After DELETE /api/api-keys/{id} (key removed)
    """
    global GEMINI_API_KEY

    try:
        # Lazy imports to avoid circular dependency at module load time
        from database import AsyncSessionLocal
        from models.api_key import GeminiApiKey
        from sqlalchemy import select as sa_select

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                sa_select(GeminiApiKey).order_by(GeminiApiKey.created_at.asc()).limit(1)
            )
            key_record = result.scalar_one_or_none()

            if key_record:
                GEMINI_API_KEY = key_record.key_value
                logger.info("GEMINI_API_KEY loaded from database")
            else:
                env_key = os.getenv("GEMINI_API_KEY")
                if env_key:
                    GEMINI_API_KEY = env_key
                    logger.info("GEMINI_API_KEY loaded from environment (no DB keys found)")
                else:
                    GEMINI_API_KEY = None
                    logger.warning(
                        "No GEMINI_API_KEY found in DB or environment. "
                        "Add one via the API Keys page."
                    )

    except Exception as e:
        logger.error(f"Failed to refresh GEMINI_API_KEY from DB: {e}")


# Paths (defaults are relative to this file's directory, so they work in any environment)
_BASE_DIR = Path(__file__).parent
WORKING_DIR = Path(os.getenv("LIGHTRAG_WORKING_DIR", str(_BASE_DIR / "rag_storage")))
#INPUT_DIR = Path(os.getenv("LIGHTRAG_INPUT_DIR", str(_BASE_DIR / "input_document")))

# Ensure directories exist
WORKING_DIR.mkdir(parents=True, exist_ok=True)
#INPUT_DIR.mkdir(parents=True, exist_ok=True)


NEO4J_URI = os.getenv("NEO4J_URI")           # Ví dụ: neo4j://127.0.0.1:7687
NEO4J_USERNAME = os.getenv("NEO4J_USERNAME") # Ví dụ: neo4j
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD") # Ví dụ: 123456789
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")  # Mặc định: "neo4j"


# ─────────────────────────────────────────────────────────────
# PostgreSQL connection for LightRAG's built-in PG storage backends.
# LightRAG uses these to build its own asyncpg connection pool.
# ─────────────────────────────────────────────────────────────
PG_HOST     = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", "5432"))
PG_USER     = os.getenv("POSTGRES_USER", "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
PG_DATABASE = os.getenv("POSTGRES_DATABASE", "outline")

# asyncpg connection string format expected by LightRAG PG backends
_PG_URL = f"postgresql://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{PG_DATABASE}"
# Neon.tech (and similar cloud PG hosts) reject plain connections — require SSL
if "neon.tech" in PG_HOST:
    _PG_URL += "?sslmode=require"

# Fail fast: Nếu thiếu bất kỳ biến bắt buộc nào, dừng ngay khi khởi động
if not all([NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD]):
    raise ValueError(
        "Thiếu biến môi trường Neo4j. "
        "Hãy đặt NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD trong file .env"
    )

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Module-level httpx AsyncClient - tai su dung connection pool, khong tao moi moi request
_claude_http_client: httpx.AsyncClient | None = None


def _get_claude_http_client() -> httpx.AsyncClient:
    """Lay hoac khoi tao httpx AsyncClient singleton cho Claude Messages API."""
    global _claude_http_client
    if _claude_http_client is None:
        _claude_http_client = httpx.AsyncClient(timeout=httpx.Timeout(900.0))
    return _claude_http_client


def _parse_claude_credentials(credentials_str: str) -> dict:
    """Parse credentials: accept full JSON hoặc raw OAuth access token.

    - Full JSON: {"claudeAiOauth": {"accessToken": "...", "refreshToken": "...", "expiresAt": <ms>}}
    - Raw token: "sk-ant-oat01-..." → wrap thành dict với refresh_token rỗng, expiresAt xa.

    Dùng cho pipeline-global credential: admin chỉ cung cấp access token → không có
    refresh nên CLIProxyAPI phải rely access token còn sống. Nếu hết hạn, admin phải
    thay key mới trong .env.production.
    """
    s = (credentials_str or "").strip()
    if s.startswith("sk-ant-"):
        far_future_ms = int(
            datetime(2099, 12, 31, tzinfo=timezone.utc).timestamp() * 1000
        )
        return {
            "claudeAiOauth": {
                "accessToken": s,
                "refreshToken": "",
                "expiresAt": far_future_ms,
            }
        }
    return json.loads(s)


async def _ensure_user_credential_in_cliproxy(cred_dict: dict, auth_file_name: str) -> None:
    """Upload credential lên CLIProxyAPI Management API nếu chưa có trong process-level cache.

    CLIProxyAPI sẽ tự refresh token — chỉ cần upload 1 lần per process.
    Nếu nhận 401 từ /v1/messages, caller discard auth_file_name khỏi _uploaded_users,
    lần gọi sau sẽ re-upload credentials mới từ DB.
    """
    if auth_file_name in _uploaded_users:
        return

    oauth = cred_dict["claudeAiOauth"]
    expires_rfc3339 = datetime.fromtimestamp(
        oauth["expiresAt"] / 1000.0, tz=timezone.utc
    ).isoformat()

    payload = {
        "access_token": oauth["accessToken"],
        "refresh_token": oauth["refreshToken"],
        "expired": expires_rfc3339,
        "type": "claude",
    }

    mgmt_url = f"{CLIPROXY_BASE_URL}/v0/management/auth-files"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                mgmt_url,
                params={"name": auth_file_name},
                headers={"X-Management-Key": CLIPROXY_MANAGEMENT_KEY},
                json=payload,
            )
            resp.raise_for_status()
    except httpx.ConnectError as exc:
        raise ClaudeAIError(
            CLIPROXY_UNAVAILABLE,
            "CLIProxyAPI chưa được khởi động. Vui lòng start CLIProxyAPI trước khi sử dụng tính năng AI.",
        ) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise ClaudeAIError(
                CLIPROXY_UNAVAILABLE,
                "CLIPROXY_MANAGEMENT_KEY không hợp lệ. Kiểm tra lại config CLIProxyAPI.",
            ) from exc
        raise ClaudeAIError(
            CLIPROXY_UNAVAILABLE,
            f"Lỗi upload credential lên CLIProxyAPI: HTTP {exc.response.status_code}",
        ) from exc

    _uploaded_users.add(auth_file_name)
    logger.info("[CLIProxy] Uploaded credential for %s", auth_file_name)


async def _call_gemini_async(
    prompt: str,
    system_prompt: str | None = None,
    history_messages: list[dict] | None = None,
    **kwargs,
) -> str:
    """Gọi Gemini API cho entity extraction (upload use case).

    Dùng Gemini native API format với contents array.
    Rẻ hơn Claude CLI cho batch entity/relation extraction từ tài liệu dài.
    """
    logger.info(f"[Gemini API] _call_gemini_async ENTER — prompt[:60]={prompt[:60]!r}")
    contents: list[dict] = []

    if system_prompt:
        contents.append({"role": "user", "parts": [{"text": system_prompt}]})
        contents.append({"role": "model", "parts": [{"text": "Understood. I will follow these instructions."}]})

    for msg in (history_messages or []):
        role = msg.get("role", "user")
        gemini_role = "model" if role == "assistant" else "user"
        contents.append({"role": gemini_role, "parts": [{"text": msg.get("content", "")}]})

    contents.append({"role": "user", "parts": [{"text": prompt}]})

    url = f"{LLM_BINDING_HOST}/models/{LLM_MODEL}:generateContent"

    def _sync_call() -> str:
        resp = requests.post(
            url,
            headers={
                "x-goog-api-key": LLM_BINDING_API_KEY,
                "Content-Type": "application/json",
            },
            json={"contents": contents},
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_call)


async def _call_claude_cli_async(
    prompt: str,
    system_prompt: str | None = None,
    history_messages: list[dict[str, str]] | None = None,
    **kwargs,
) -> str:
    """
    Goi Claude qua CLIProxyAPI voi per-user credential routing.

    CLIProxyAPI (Go proxy) xu ly OAuth, token refresh va fingerprinting.
    Moi user co 1 auth file rieng (user-{userId}.json) tren CLIProxyAPI.

    Authentication:
        Upload credentials len CLIProxyAPI 1 lan per process (cache _uploaded_users).
        Dung X-Pinned-Auth-ID header de pin request vao credential cua user.
        CLIProxyAPI tu dong refresh token — khong can refresh thu cong.

    Per-user isolation:
        _request_credentials + _request_user_id (ContextVar) isolate theo asyncio Task.
        Moi concurrent request dung credential rieng — khong race condition.

    Args:
        prompt: Cau hoi / noi dung can xu ly
        system_prompt: System instructions (neu co) - payload["system"] field
        history_messages: Conversation history [{"role": "user/assistant", "content": "..."}]

    Returns:
        str: Response text tu Claude

    Raises:
        RuntimeError: Khi khong co credentials, CLIProxyAPI chua start, rate limit, hoac API loi
    """
    logger.info(f"[Claude CLI] _call_claude_cli_async ENTER — prompt[:60]={prompt[:60]!r}")
    _t_start = time.monotonic()
    _prompt_prefix = (prompt or "")[:200]
    # BUOC 1: Lay credentials tu ContextVar (set boi chat.py / kanban_implement.py)
    credentials_json: str | None = _request_credentials.get()
    if not credentials_json:
        raise ClaudeAIError(
            CLAUDE_CREDENTIAL_MISSING,
            "Vui lòng kết nối tài khoản Claude trong Settings.",
        )

    cred_dict: dict = _parse_claude_credentials(credentials_json)

    # BUOC 2: Lay userId de build auth_file_name cho CLIProxyAPI
    user_id: str | None = _request_user_id.get()
    if not user_id:
        raise RuntimeError(
            "_request_user_id chua duoc set trong request context. "
            "chat.py / kanban_implement.py phai set ContextVar nay truoc khi goi LightRAG."
        )
    auth_file_name = f"user-{user_id}.json"

    # BUOC 3: Dam bao credential da duoc upload len CLIProxyAPI
    # (CLIProxyAPI tu refresh token — chi upload 1 lan per process)
    await _ensure_user_credential_in_cliproxy(cred_dict, auth_file_name)

    # BUOC 4: Build messages array theo Messages API format
    messages: list[dict[str, str]] = []
    if history_messages:
        messages.extend(history_messages)
    messages.append({"role": "user", "content": prompt})

    payload: dict = {
        "model": CLAUDE_MESSAGES_MODEL,
        "max_tokens": CLAUDE_MESSAGES_MAX_TOKENS,
        "messages": messages,
    }
    if system_prompt:
        payload["system"] = system_prompt

    # BUOC 5: Goi CLIProxyAPI (thay vi api.anthropic.com truc tiep)
    # CLIProxyAPI xu ly OAuth, token refresh, fingerprinting
    client = _get_claude_http_client()
    logger.debug(
        "[CLIProxy] POST %s/v1/messages - model=%s, messages=%d, auth=%s",
        CLIPROXY_BASE_URL,
        CLAUDE_MESSAGES_MODEL,
        len(messages),
        auth_file_name,
    )

    try:
        resp = await client.post(
            f"{CLIPROXY_BASE_URL}/v1/messages",
            headers={
                "Authorization": f"Bearer {CLIPROXY_API_KEY}",
                "X-Pinned-Auth-ID": auth_file_name,
                "content-type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()

    except httpx.ConnectError as exc:
        raise ClaudeAIError(
            CLIPROXY_UNAVAILABLE,
            "CLIProxyAPI chưa được khởi động. Vui lòng start CLIProxyAPI trước khi sử dụng tính năng AI.",
        ) from exc

    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        body_snippet = exc.response.text[:300]
        if status == 401:
            _uploaded_users.discard(auth_file_name)  # force re-upload lan sau
            raise ClaudeAIError(
                CLAUDE_CREDENTIAL_EXPIRED,
                "Claude credentials không hợp lệ. Vui lòng nhập lại credentials mới.",
            ) from exc
        if status == 429:
            raise RuntimeError(
                "Claude API rate limit. Vui long thu lai sau vai phut."
            ) from exc
        if status == 529:
            raise RuntimeError("Claude API qua tai (529). Vui long thu lai sau.") from exc
        raise RuntimeError(f"CLIProxyAPI loi HTTP {status}: {body_snippet}") from exc

    except httpx.TimeoutException as exc:
        raise RuntimeError(
            "Claude API timeout sau 900 giay. Query co the qua phuc tap."
        ) from exc

    except httpx.RequestError as exc:
        raise RuntimeError(f"Khong the ket noi CLIProxyAPI: {exc}") from exc

    # BUOC 5: Parse response
    data: dict = resp.json()
    _usage = data.get("usage") or {}
    _duration = time.monotonic() - _t_start
    logger.info(
        "[Claude Usage] model=%s msg_id=%s input=%s output=%s cache_read=%s cache_creation=%s tier=%s duration=%.1fs",
        data.get("model"),
        data.get("id"),
        _usage.get("input_tokens"),
        _usage.get("output_tokens"),
        _usage.get("cache_read_input_tokens"),
        _usage.get("cache_creation_input_tokens"),
        _usage.get("service_tier"),
        _duration,
    )
    _collector = _pipeline_usage_log.get()
    if _collector is not None:
        _collector.append({
            "model": data.get("model"),
            "msg_id": data.get("id"),
            "input_tokens": _usage.get("input_tokens") or 0,
            "output_tokens": _usage.get("output_tokens") or 0,
            "cache_creation": _usage.get("cache_creation_input_tokens") or 0,
            "cache_read": _usage.get("cache_read_input_tokens") or 0,
            "duration_s": _duration,
            "purpose": _detect_claude_call_purpose(_prompt_prefix),
        })
    content_blocks: list[dict] = data.get("content", [])
    if not content_blocks:
        raise RuntimeError("Claude API tra ve response rong (content array empty).")

    text_blocks = [
        block["text"]
        for block in content_blocks
        if block.get("type") == "text" and block.get("text")
    ]
    if not text_blocks:
        raise RuntimeError("Claude API khong tra ve text content block.")

    result = "\n".join(text_blocks)
    logger.debug("[Claude API] Response length: %d chars", len(result))
    return result


async def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
    """LLM function — default Claude CLI (dùng làm initial value cho rag.llm_model_func).

    Caller override rag.llm_model_func trực tiếp trước khi gọi LightRAG:
      - Upload: rag.llm_model_func = _call_gemini_async
      - Chat:   rag.llm_model_func = _call_claude_cli_async
    """
    logger.info(f"[RAG] llm_model_func (Claude CLI) - prompt[:60]={prompt[:60]!r}")
    try:
        result = await _call_claude_cli_async(
            prompt=prompt,
            system_prompt=system_prompt,
            history_messages=list(history_messages) if history_messages else None,
        )
        logger.info(f"[RAG] llm_model_func OK - result[:80]={result[:80]!r}")
        return result
    except Exception as e:
        logger.error(f"[RAG] llm_model_func FAILED - {type(e).__name__}: {e!r}", exc_info=True)
        raise



@wrap_embedding_func_with_attrs(
    embedding_dim=EMBEDDING_DIM,
    send_dimensions=False,
    max_token_size=EMBEDDING_TOKEN_LIMIT,
    model_name=EMBEDDING_MODEL,
)
async def embedding_func(texts: list[str]) -> np.ndarray:
    """OpenAI-compatible embedding function via OpenRouter (baai/bge-m3).

    Gọi trực tiếp OpenAI AsyncClient thay vì openai_embed.func vì:
    - openai_embed.func hardcode encoding_format="base64" ở lightrag/llm/openai.py:823
    - OpenRouter/baai bge-m3 không support base64 → response.data = None → TypeError
    - Dùng encoding_format="float" (default chuẩn OpenAI) để tương thích hoàn toàn
    """
    client = AsyncOpenAI(
        api_key=EMBEDDING_BINDING_API_KEY,
        base_url=EMBEDDING_BINDING_HOST,
    )
    async with client:
        response = await client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
            encoding_format="float",
        )
    # OpenRouter can return HTTP 200 with data=null when quota is exhausted or
    # the model is rate-limited. The SDK doesn't raise an exception in that case,
    # so we must guard explicitly and raise a retryable RuntimeError.
    if not response.data:
        raise RuntimeError(
            f"OpenRouter embedding API returned empty data for {len(texts)} text(s). "
            "Check EMBEDDING_BINDING_API_KEY and OpenRouter quota/rate limits."
        )
    return np.array(
        [dp.embedding for dp in response.data],
        dtype=np.float32,
    )



# ═══════════════════════════════════════════════════════════════════════════════
# WORKSPACE ISOLATION — Per-workspace RAG instances + exclusive operation locks
# ═══════════════════════════════════════════════════════════════════════════════
# rag_instances: Cache of per-workspace ExtendedLightRAG instances
#   Key: workspace_id (e.g., "team-123")
#   Value: ExtendedLightRAG instance (lazy-created on first access)
# Reason: LightRAG workspace parameter filters Neo4j data by workspace label
# ───────────────────────────────────────────────────────────────────────────────
rag_instances: dict[str, ExtendedLightRAG] = {}
rag_lock = asyncio.Lock()  # Prevent race condition during instance creation

# workspace_locks: Exclusive locks per workspace (prevent concurrent KG modifications)
#   Key: workspace_id
#   Value: operation name (str) — "dedup" | "indexing" | "merging" | None
#   None = workspace is idle (not locked)
# Reason: Ensure atomic knowledge graph updates (no interleaved modifications)
# ───────────────────────────────────────────────────────────────────────────────
workspace_locks: dict[str, str | None] = {}
workspace_lock_time: dict[str, float] = {}  # Lock acquisition timestamp (for monitoring)


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: acquire_workspace_lock
# ═══════════════════════════════════════════════════════════════════════════════
# Try to acquire exclusive lock for workspace.
# Returns: bool — True if lock acquired, False if workspace already locked
# Usage:
#   if not await acquire_workspace_lock("workspace-a", "dedup"):
#       return {"status": "busy"}, 429
#   try:
#       # Perform operation...
#   finally:
#       release_workspace_lock("workspace-a")
# ═══════════════════════════════════════════════════════════════════════════════
async def acquire_workspace_lock(workspace_id: str, operation: str) -> bool:
    """Try to acquire exclusive lock for workspace operation."""
    if workspace_locks.get(workspace_id) is not None:
        return False  # Workspace already locked

    workspace_locks[workspace_id] = operation
    workspace_lock_time[workspace_id] = time.time()
    logger.info(f"🔒 Workspace lock acquired: {workspace_id} ({operation})")
    return True


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: release_workspace_lock
# ═══════════════════════════════════════════════════════════════════════════════
# Release exclusive lock for workspace.
# ═══════════════════════════════════════════════════════════════════════════════
def release_workspace_lock(workspace_id: str):
    """Release workspace lock."""
    workspace_locks[workspace_id] = None
    workspace_lock_time[workspace_id] = None
    logger.info(f"🔓 Workspace lock released: {workspace_id}")


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: check_workspace_lock
# ═══════════════════════════════════════════════════════════════════════════════
# Check if workspace is locked. Returns error response if locked, None if idle.
# Usage:
#   lock_error = await check_workspace_lock("workspace-a")
#   if lock_error:
#       return lock_error, 429  # Return to client
# ═══════════════════════════════════════════════════════════════════════════════
async def check_workspace_lock(workspace_id: str) -> dict | None:
    """Check if workspace locked, return error response if so."""
    if workspace_id not in workspace_locks or workspace_locks[workspace_id] is None:
        return None  # Not locked

    operation = workspace_locks[workspace_id]
    lock_start_time = workspace_lock_time[workspace_id]

    # Estimate unlock time based on operation type
    operation_duration = {
        "dedup": 1800,      # 30 minutes (LLM-heavy)
        "indexing": 300,    # 5 minutes (typical)
        "merging": 60,      # 1 minute (typically fast)
    }
    estimated_duration = operation_duration.get(operation, 1800)
    estimated_unlock_time = lock_start_time + estimated_duration

    return {
        "status": "locked",
        "message": f"Workspace busy with {operation}. Try after {estimated_unlock_time}.",
        "operation": operation,
        "locked_since": lock_start_time,
        "estimated_unlock_time": estimated_unlock_time,
        "retry_after_seconds": 10,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: monitor_stuck_locks (Background Task)
# ═══════════════════════════════════════════════════════════════════════════════
# Background monitoring: log warnings if workspace lock held > 1 hour
# Called from FastAPI startup event. Runs indefinitely.
# ═══════════════════════════════════════════════════════════════════════════════
async def monitor_stuck_locks():
    """Background task: monitor and warn about locks held too long."""
    while True:
        for workspace_id, operation in workspace_locks.items():
            if operation is None:
                continue

            elapsed = time.time() - workspace_lock_time[workspace_id]
            if elapsed > 3600:  # 1 hour
                logger.warning(
                    f"⚠️  Workspace {workspace_id} lock held for {elapsed:.0f}s "
                    f"(operation={operation}). Consider manual unlock if stuck."
                )

        await asyncio.sleep(300)  # Check every 5 minutes


# ═══════════════════════════════════════════════════════════════════════════════
# FUNCTION: get_rag_for_workspace
# ═══════════════════════════════════════════════════════════════════════════════
# Get or create ExtendedLightRAG instance for workspace.
# Lazy-loaded: instance created only on first access, then cached.
# Thread-safe: asyncio.Lock prevents race condition during creation.
# ═══════════════════════════════════════════════════════════════════════════════
async def get_rag_for_workspace(workspace_id: str) -> ExtendedLightRAG:
    """
    Get or create a workspace-isolated ExtendedLightRAG instance (lazy-load, cached).

    ═════════════════════════════════════════════════════════════════════════════════
    🎯 PURPOSE
    ═════════════════════════════════════════════════════════════════════════════════
    Returns a per-workspace ExtendedLightRAG instance that ensures:
    - Workspace A's entities are not visible to Workspace B
    - All queries (Neo4j, vector embeddings, documents) are filtered by workspace
    - Only one instance per workspace is created (lazy loading + caching)

    ═════════════════════════════════════════════════════════════════════════════════
    🔒 WORKSPACE ISOLATION MECHANISM
    ═════════════════════════════════════════════════════════════════════════════════
    LAYER 1 (Parameter Flow):
        workspace_id → ExtendedLightRAG(..., workspace=workspace_id, ...)

    LAYER 2 (Storage Filtering):
        - Neo4j: Creates nodes with :workspace_{id} label, queries match only that label
        - PostgreSQL: Filters chunks/embeddings via workspace parameter in WHERE clauses

    LAYER 3 (Parent LightRAG Methods):
        Parent class methods should respect workspace parameter passed to storage

    LAYER 4 (Defensive Validation):
        ExtendedLightRAG override methods validate results contain only workspace's data

    ═════════════════════════════════════════════════════════════════════════════════
    ⚠️  CRITICAL: ENVIRONMENT VARIABLE RISK
    ═════════════════════════════════════════════════════════════════════════════════
    NEO4J_WORKSPACE env var (if set) will OVERRIDE the workspace parameter!

    Example:
        NEO4J_WORKSPACE="workspace_1"  # In .env or environment
        get_rag_for_workspace("workspace_2")  # ← will use workspace_1 instead!

    This env var exists for backward compatibility but is DANGEROUS in multi-tenant contexts.
    Never set NEO4J_WORKSPACE in production.

    ═════════════════════════════════════════════════════════════════════════════════
    🔄 INSTANCE CACHING
    ═════════════════════════════════════════════════════════════════════════════════
    - Fast path (cache hit): Return cached instance from rag_instances[workspace_id]
    - Slow path (cache miss): Create new instance, store in dict, return
    - Thread-safe: asyncio.Lock prevents race condition during creation
    - Per-workspace caching reduces initialization overhead, maintains isolation

    ═════════════════════════════════════════════════════════════════════════════════
    📥 PARAMETERS
    ═════════════════════════════════════════════════════════════════════════════════
    workspace_id : str
        Unique identifier for the workspace (e.g., "workspace_123", team UUID)
        Each workspace sees only its own entities/relationships
        Must not be empty; validated at entry

    ═════════════════════════════════════════════════════════════════════════════════
    📤 RETURNS
    ═════════════════════════════════════════════════════════════════════════════════
    ExtendedLightRAG
        Ready-to-use instance with all storages initialized
        All queries will be filtered to workspace_id
        Inherits 5 override methods for defensive validation

    ═════════════════════════════════════════════════════════════════════════════════
    🚨 RAISES
    ═════════════════════════════════════════════════════════════════════════════════
    ValueError
        If workspace_id is empty or whitespace
    RuntimeError
        If workspace parameter was not properly passed to storage layers

    ═════════════════════════════════════════════════════════════════════════════════
    📝 EXAMPLE USAGE
    ═════════════════════════════════════════════════════════════════════════════════
    # Get instance for workspace A
    rag_a = await get_rag_for_workspace("workspace_a")
    entities_a = await rag_a.get_knowledge_graph()  # Only workspace_a entities

    # Get instance for workspace B — isolated results
    rag_b = await get_rag_for_workspace("workspace_b")
    entities_b = await rag_b.get_knowledge_graph()  # Only workspace_b entities (different from A)

    ═════════════════════════════════════════════════════════════════════════════════
    """
    # ═══════════════════════════════════════════════════════════════════════════════
    # TASK 1.B (pre-creation): Validate workspace_id parameter
    # Reject whitespace-only strings (e.g., "  ") but allow empty "" for backward
    # compat with deprecated get_rag() which calls get_rag_for_workspace("").
    # ═══════════════════════════════════════════════════════════════════════════════
    if workspace_id and not workspace_id.strip():
        raise ValueError(
            f"workspace_id cannot be whitespace-only (got {workspace_id!r}). "
            f"Use a valid workspace identifier or empty string for default workspace."
        )

    # Check cache first (fast path)
    if workspace_id in rag_instances:
        return rag_instances[workspace_id]

    # Cache miss: create new instance (slow path, requires lock)
    async with rag_lock:
        # Double-check pattern: another task may have created it while we waited for lock
        if workspace_id in rag_instances:
            return rag_instances[workspace_id]

        # ═══════════════════════════════════════════════════════════════════════════════
        # TASK 1.A: Environment Variable Safeguard
        # Detect if NEO4J_WORKSPACE env var is set (can override workspace parameter)
        # ═══════════════════════════════════════════════════════════════════════════════
        neo4j_workspace_env = os.getenv("NEO4J_WORKSPACE")
        if neo4j_workspace_env:
            logger.warning(
                f"⚠️  NEO4J_WORKSPACE env var is set to '{neo4j_workspace_env}' — "
                f"this will override workspace parameter '{workspace_id}' in Neo4JStorage. "
                f"Ensure NEO4J_WORKSPACE is NOT set. Remove from .env immediately."
            )

        logger.info(f"🔧 Initializing ExtendedLightRAG for workspace: {workspace_id}")

        # Create per-workspace directory
        workspace_dir = WORKING_DIR / workspace_id
        workspace_dir.mkdir(parents=True, exist_ok=True)

        # Create ExtendedLightRAG instance with workspace parameter
        # This ensures LightRAG's Neo4JStorage uses workspace_id in Cypher queries
        rag_instances[workspace_id] = ExtendedLightRAG(
            working_dir=str(workspace_dir),
            workspace=workspace_id,  # KEY: pass workspace to LightRAG
            llm_model_func=llm_model_func,
            llm_model_name=GEMINI_LLM_MODEL,
            embedding_func=embedding_func,
            # Graph storage — Neo4j filters by workspace_id label
            graph_storage="Neo4JStorage",
            # KV stores — PostgreSQL tables with workspace_id column
            kv_storage="PGKVStorage",
            # Vector stores — PostgreSQL tables with workspace_id column (pgvector)
            vector_storage="PGVectorStorage",
            # Document status — PostgreSQL table with workspace_id column
            doc_status_storage="PGDocStatusStorage",
            # Pass PG connection URL to LightRAG's storage backends
            addon_params={"postgres_url": _PG_URL},
        )

        # ═══════════════════════════════════════════════════════════════════════════════
        # TASK 1.A.5: Initialize storages
        # Must be called before any storage operation (including drop).
        # Neo4JStorage.drop() requires self._DATABASE which is only set inside
        # initialize() — skipping this causes AttributeError on drop/clear calls.
        # ═══════════════════════════════════════════════════════════════════════════════
        await rag_instances[workspace_id].initialize_storages()

        # ═══════════════════════════════════════════════════════════════════════════════
        # TASK 1.B: Parameter Validation
        # Verify workspace parameter was actually set on the instance
        # ═══════════════════════════════════════════════════════════════════════════════
        rag_instance = rag_instances[workspace_id]
        if rag_instance.workspace != workspace_id:
            logger.error(
                f"❌ Workspace parameter mismatch! Expected: {workspace_id}, Got: {rag_instance.workspace}. "
                f"This indicates workspace parameter was not properly passed to storage layers. "
                f"Check Neo4JStorage and PostgreSQL storage initialization."
            )
            raise RuntimeError(
                f"Workspace parameter validation failed for {workspace_id}: "
                f"Expected workspace={workspace_id}, but instance has workspace={rag_instance.workspace}"
            )

        # Enable PathRAG path-based retrieval
        from pathrag_query import patch_lightrag_with_pathrag
        patch_lightrag_with_pathrag(enable=True)

        logger.info(
            f"✅ ExtendedLightRAG initialized for workspace {workspace_id}\n"
            f"   Working dir: {workspace_dir}\n"
            f"   Neo4j URI  : {NEO4J_URI}\n"
            f"   Neo4j DB   : {NEO4J_DATABASE}"
        )

        return rag_instances[workspace_id]


