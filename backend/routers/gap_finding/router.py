"""
Gap Finding Router — FastAPI endpoints.

POST /api/rag/query     — Direct LightRAG query (không qua conversation wrapper)
POST /api/gap-finding   — Full gap-finding pipeline (code vs SRS)
                          Hỗ trợ 2 auth mode:
                          1. User session: X-User-Key header → credentials từ DB
                          2. Pipeline: X-Pipeline-Api-Key header → credentials từ ~/.claude/.credentials.json
"""
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from database import get_db
from dependencies.claude_credentials import get_claude_credentials
from rag_state import get_rag_for_workspace
from lightrag import QueryParam
from skills.gap_finding.gap_finding import GapFindingRequest, run_gap_finding
import skills.gap_finding.gitnexus as gn

logger = logging.getLogger(__name__)

# Pipeline auth — đọc từ env để match với gapfinding container
_PIPELINE_API_KEY: str = os.getenv("PIPELINE_API_KEY", "")
# Credentials file được mount từ host: ~/.claude/.credentials.json (chỉ cần khi LLM_BINDING=claude)
_PIPELINE_CRED_PATH = Path("/root/.claude/.credentials.json")
# Fixed user_id cho pipeline auth file trong CLIProxy
_PIPELINE_USER_ID = "pipeline-system"
# Gap-finding LUÔN dùng Claude qua CLIProxy → luôn cần OAuth credentials
_LLM_BINDING: str = "claude"


def _load_pipeline_credentials() -> str:
    """
    Đọc Claude credentials từ ~/.claude/.credentials.json cho pipeline auth.
    File này được mount read-only vào backend container từ host machine.
    Format: { "claudeAiOauth": { "accessToken": "...", "refreshToken": "...", "expiresAt": ... } }

    Khi LLM_BINDING != "claude" (e.g. gemini): trả về "{}" vì
    gap_finding.py sẽ gọi _call_gemini_async (không cần OAuth).
    """
    if _LLM_BINDING != "claude":
        return "{}"  # Gemini và các binding khác không cần OAuth credentials

    if not _PIPELINE_CRED_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                "Pipeline credentials không tìm thấy tại /root/.claude/.credentials.json. "
                "Đảm bảo ~/.claude được mount vào backend container."
            ),
        )
    return _PIPELINE_CRED_PATH.read_text(encoding="utf-8")


router = APIRouter(prefix="/api", tags=["Gap Finding"])


# ─────────────────────────────────────────────────────────────
# POST /api/rag/query — Direct LightRAG query
# Thay thế /api/conversations/{id}/messages cho gap-finding use case.
# Không lưu DB, không parse citations, không cần conversation_id.
# ─────────────────────────────────────────────────────────────

class RawQueryRequest(BaseModel):
    content: str
    mode: str = "hybrid"  # "hybrid" | "local" | "global" | "naive"
    workspace_id: str = ""


@router.post("/rag/query")
async def direct_rag_query(body: RawQueryRequest):
    """
    Direct LightRAG query — bỏ qua conversation wrapper.

    Dùng cho:
    - Gap finding SRS lookup
    - Các tool nội bộ cần query LightRAG mà không lưu lịch sử chat

    Returns: { "result": "<LightRAG response text>" }
    """
    try:
        rag = await get_rag_for_workspace(body.workspace_id)
        result = await rag.aquery(
            body.content,
            param=QueryParam(mode=body.mode),
        )

        if not result or not result.strip():
            return {
                "result": "",
                "found": False,
                "message": "Không tìm thấy thông tin liên quan trong knowledge graph.",
            }

        return {"result": result, "found": True}

    except RuntimeError as e:
        logger.error(f"[RAG Query] RAG not ready: {e}")
        raise HTTPException(
            status_code=503,
            detail="Knowledge graph chưa sẵn sàng. Thử lại sau vài giây.",
        )
    except Exception as e:
        logger.error(f"[RAG Query] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# POST /api/gap-finding — Full gap-finding pipeline
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# GET /api/gitnexus/repos — Kiểm tra repos đã index
# ─────────────────────────────────────────────────────────────

@router.get("/gitnexus/repos")
async def list_gitnexus_repos():
    """
    Lấy danh sách repos đã được index trong gitnexus-service (port 4747).
    Dùng để kiểm tra xem 2 repos BE + FE đã sẵn sàng chưa.

    Status values: ready | queued | cloning | analyzing | error | not_registered
    """
    repos = await gn.list_repos()
    configured = {
        "backend": gn.get_repo_name("backend"),
        "frontend": gn.get_repo_name("frontend"),
    }
    indexed_names = {r["name"] for r in repos}

    return {
        "repos": repos,
        "configured_repos": configured,
        "readiness": {
            role: {
                "name": name,
                "indexed": name in indexed_names,
                "status": next(
                    (r["status"]
                     for r in repos if r["name"] == name), "not_registered"
                ),
            }
            for role, name in configured.items()
        },
    }


@router.post("/gitnexus/repos/register")
async def register_gitnexus_repo(body: dict):
    """
    Đăng ký repo mới vào gitnexus-service: clone + analyze.
    Body: { repo_url, repo_name?, access_token?, branch? }
    """
    repo_url = body.get("repo_url")
    if not repo_url:
        raise HTTPException(status_code=400, detail="repo_url là bắt buộc")
    try:
        result = await gn.register_repo(
            repo_url=repo_url,
            repo_name=body.get("repo_name"),
            access_token=body.get("access_token"),
            branch=body.get("branch"),
        )
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


class GapFindingRequestBody(BaseModel):
    pr_number: Optional[int] = None
    repo: Optional[str] = None           # "org/EVO-LMS-DJANGO"
    branch_range: Optional[str] = None   # "develop..feature-branch"
    feature_name: Optional[str] = None   # "xem chi tiet lop hoc"
    uc_id: Optional[str] = None          # "UC-TM-002"
    base_branch: str = "develop"
    workspace_id: Optional[str] = None   # LightRAG workspace (teamId)


@router.post("/gap-finding")
async def gap_finding(
    body: GapFindingRequestBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Full gap-finding pipeline: code vs SRS → Drift Report JSON.

    Hỗ trợ 2 auth mode:
    1. User session: Header X-User-Key → credentials từ DB (dùng trong UI)
    2. Pipeline: Header X-Pipeline-Api-Key → credentials từ ~/.claude/.credentials.json (dùng trong webhook)

    Input: PR number hoặc branch range hoặc feature name
    Output: JSON Drift Report theo gap-finding schema
    """
    # ── Resolve credentials theo auth mode ──────────────────────────────────
    pipeline_key = request.headers.get("X-Pipeline-Api-Key", "").strip()
    is_pipeline_auth = bool(
        pipeline_key and _PIPELINE_API_KEY and pipeline_key == _PIPELINE_API_KEY
    )

    if is_pipeline_auth:
        credentials_json = _load_pipeline_credentials()
        user_id = _PIPELINE_USER_ID
        logger.info("[GapFinding] Pipeline auth — using system credentials")
    else:
        credentials_json = await get_claude_credentials(request, db)
        user_id = request.headers.get("X-User-Key", "").strip()
        if not user_id:
            raise HTTPException(status_code=401, detail="X-User-Key header required")

    if not any([body.pr_number, body.branch_range, body.feature_name]):
        raise HTTPException(
            status_code=400,
            detail="Cần ít nhất 1 trong: pr_number, branch_range, hoặc feature_name",
        )

    # Resolve workspace_id: body > X-Workspace-Id header > ""
    workspace_id = (
        body.workspace_id
        or request.headers.get("X-Workspace-Id", "").strip()
        or ""
    )

    gap_request = GapFindingRequest(
        pr_number=body.pr_number,
        repo=body.repo,
        branch_range=body.branch_range,
        feature_name=body.feature_name,
        uc_id=body.uc_id,
        base_branch=body.base_branch,
        workspace_id=workspace_id,
        credentials_json=credentials_json,
        user_id=user_id,
    )

    result = await run_gap_finding(gap_request)

    if not result.success:
        raise HTTPException(status_code=500, detail=result.error)

    return result.drift_report
