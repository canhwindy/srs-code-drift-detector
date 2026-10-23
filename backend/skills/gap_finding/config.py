"""
Gap Finding Skill — Hardcoded Configuration

Tập trung tất cả config vào 1 file để dễ maintain.
Không cần SKILL.md hay CLI nữa — gọi trực tiếp từ Python/CLIProxy.
"""
import os

# ─────────────────────────────────────────────────────────────
# LIGHTRAG — direct query endpoint (không qua conversation wrapper)
# ─────────────────────────────────────────────────────────────
LIGHTRAG_BASE_URL: str = os.getenv("LIGHTRAG_BASE_URL", "http://localhost:8000")
LIGHTRAG_QUERY_ENDPOINT: str = f"{LIGHTRAG_BASE_URL}/api/rag/query"

# Query template cho SRS UC spec retrieval.
# Mở rộng radius để hybrid search lôi cả Screen Spec docs — không chỉ UC doc.
# Screen Spec định nghĩa filter/sort/search/tab/role-view; nếu thiếu thì pipeline
# sẽ flag UI logic là surplus (false positive).
LIGHTRAG_QUERY_TEMPLATE: str = (
    "{uc_id} {uc_name} — full UC spec: "
    "actor, trigger, precondition, main flow, business rules, exception, postcondition; "
    "kèm các screen specification / mô tả màn hình liên quan: "
    "tab, filter, search, sort, query parameter, validation, button, role-based view, "
    "bộ lọc, tìm kiếm, sắp xếp, tham số, hiển thị theo vai trò, thông báo lỗi."
)

# ─────────────────────────────────────────────────────────────
# GITNEXUS — 2 services khác nhau:
#
# 1. gitnexus-service:4747 — Repo Lifecycle Manager
#    Dùng để: clone repo, chạy analyze, kiểm tra status
#    Endpoints: /api/repos, /api/repos/register, /api/repos/:name/status
#    Docker compose service: gitnexus-service (outline-gitnexus)
#
# 2. eval-server:4848 — Query API (chạy riêng bên trong gapfinding container)
#    Dùng để: query, context, impact, cypher
#    Khởi động trong container: npx gitnexus eval-server --port 4848
#    Hoặc fallback: subprocess npx gitnexus query/context/impact
# ─────────────────────────────────────────────────────────────

# Repo Lifecycle Manager — dùng để register và kiểm tra repos
GITNEXUS_SERVICE_URL: str = os.getenv(
    "GITNEXUS_SERVICE_URL", "http://localhost:4747"
)

# Eval-server — dùng để query/context/impact (cần start thủ công hoặc sidecar)
GITNEXUS_EVAL_SERVER_URL: str = os.getenv(
    "GITNEXUS_EVAL_SERVER_URL", "http://localhost:4848"
)

# Thư mục repos trên shared Docker volume (gapfinding container mount tại /data/repos)
GITNEXUS_REPOS_DIR: str = os.getenv("GITNEXUS_REPOS_DIR", "/data/repos")

# Repo names đã index trong GitNexus
GITNEXUS_REPOS: dict[str, str] = {
    "backend": os.getenv("GITNEXUS_REPO_BACKEND", "EVO-LMS-DJANGO"),
    "frontend": os.getenv("GITNEXUS_REPO_FRONTEND", "evo-lms-angular"),
}

# ─────────────────────────────────────────────────────────────
# CLAUDE VIA CLIPROXY — dùng _call_claude_cli_async từ rag_state
# Config CLIProxy đã có trong rag_state.py (CLIPROXY_BASE_URL, etc.)
# ─────────────────────────────────────────────────────────────
CLAUDE_MAX_TOKENS: int = int(os.getenv("CLAUDE_MAX_TOKENS", "32000"))
CLAUDE_MODEL: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

# ─────────────────────────────────────────────────────────────
# GITHUB API — dùng REST API để lấy PR diff + changed files
# Token được lấy từ DB (github_configs) qua internal Node.js endpoint.
# GITHUB_TOKEN chỉ dùng làm fallback nếu DB không có config.
# ─────────────────────────────────────────────────────────────
GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
GITHUB_API_URL: str = os.getenv("GITHUB_API_URL", "https://api.github.com")

# URL của Node.js Outline server — để lấy GitHub config từ DB
OUTLINE_INTERNAL_URL: str = os.getenv(
    "OUTLINE_INTERNAL_URL", "http://host.docker.internal:3000"
)

# Internal API key để xác thực với Node.js internal endpoint
# Reuse PIPELINE_API_KEY (cùng giá trị với gapfinding container)
INTERNAL_API_KEY: str = os.getenv("PIPELINE_API_KEY", "")

# Default base branch khi so sánh diff
DEFAULT_BASE_BRANCH: str = "develop"

# ─────────────────────────────────────────────────────────────
# GAP FINDING PIPELINE CONFIG
# ─────────────────────────────────────────────────────────────
# Số symbols tối đa cần đọc sâu (gitnexus context) per repo.
# Bumped 5→15 để chứa đủ DAOs/services khi auto-hop callees từ full-file parse.
MAX_DEEP_SYMBOLS_PER_REPO: int = 15

# Cap chars/symbol cho gitnexus context output trong prompt.
# Bumped 3000→6000 để full body của method dài (DAO query + parse logic) được giữ.
MAX_CONTEXT_CHARS_PER_SYMBOL: int = 6000

# Cap chars cho full file content (fetch qua GitHub Contents API).
# Đủ cho file ~150-200 dòng Java/Python; file lớn hơn sẽ bị truncate.
MAX_FULL_FILE_CHARS: int = 6000

# Timeout cho từng GitNexus HTTP call (seconds)
GITNEXUS_HTTP_TIMEOUT: int = 30

# Timeout cho LightRAG query (seconds)
LIGHTRAG_QUERY_TIMEOUT: int = 100
