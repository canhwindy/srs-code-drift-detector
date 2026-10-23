"""
GitNexus Client — gọi eval-server HTTP thay vì MCP tools.

eval-server chạy local: npx gitnexus eval-server --port 4848
Cung cấp REST API tương đương với các MCP tools:
  gitnexus_query()          → POST /tool/query
  gitnexus_context()        → POST /tool/context
  gitnexus_impact()         → POST /tool/impact
  gitnexus_cypher()         → POST /tool/cypher
  gitnexus_detect_changes() → POST /tool/detect-changes

Response format: JSON object (+ optional "---\\nNext:..." suffix) hoặc plain text.
Nếu eval-server chưa chạy, fallback sang subprocess (npx gitnexus <cmd>).
"""
import asyncio
import json
import logging
import subprocess
from typing import Any

import httpx

from .config import (
    GITNEXUS_EVAL_SERVER_URL,
    GITNEXUS_HTTP_TIMEOUT,
    GITNEXUS_REPOS,
    GITNEXUS_REPOS_DIR,
    GITNEXUS_SERVICE_URL,
)

logger = logging.getLogger(__name__)

# Module-level client — reuse connection pool
_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=GITNEXUS_HTTP_TIMEOUT)
    return _http_client


def _parse_eval_response(text: str) -> dict:
    """
    Parse response từ eval-server.

    Eval-server trả về 2 dạng:
    1. JSON object + optional "---\\nNext: ..." suffix  (cypher, impact)
    2. Plain text (query, context khi không có kết quả)

    Trả về dict từ JSON nếu parse được, ngược lại { "raw": text }.
    """
    # Bỏ phần "---\nNext: ..." sau JSON nếu có
    body = text.split("\n---\n")[0].strip()
    if body.startswith("{") or body.startswith("["):
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            pass
    return {"raw": text.strip()}


async def _eval_server_post(path: str, payload: dict) -> dict:
    """
    Gọi eval-server HTTP.

    Path phải là tên tool (query, context, impact, cypher, detect-changes).
    Eval-server endpoint: POST /tool/<path>
    Raise ConnectError nếu server chưa chạy.
    """
    client = _get_client()
    tool_name = path.lstrip("/")
    resp = await client.post(
        f"{GITNEXUS_EVAL_SERVER_URL}/tool/{tool_name}",
        json=payload,
    )
    resp.raise_for_status()
    return _parse_eval_response(resp.text)


def _subprocess_gitnexus(args: list[str], repo_name: str | None = None) -> str:
    """
    Fallback: gọi GitNexus CLI qua subprocess.
    Nếu repo_name được cung cấp, chạy trong thư mục repo tương ứng
    trên shared volume (/data/repos/{repo_name}).
    """
    cwd = _get_repo_dir(repo_name) if repo_name else None
    result = subprocess.run(
        ["npx", "gitnexus"] + args,
        capture_output=True,
        text=True,
        timeout=GITNEXUS_HTTP_TIMEOUT,
        cwd=cwd,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"gitnexus CLI error: {result.stderr.strip()}"
        )
    return result.stdout.strip()


async def query(
    query_text: str,
    repo: str | None = None,
    limit: int = 5,
    include_content: bool = False,
) -> dict:
    """
    Tìm execution flows liên quan đến concept.
    Tương đương: gitnexus_query({query: "...", repo: "..."})
    """
    payload = {
        "query": query_text,
        "limit": limit,
        "content": include_content,
    }
    if repo:
        payload["repo"] = repo

    try:
        return await _eval_server_post("/query", payload)
    except httpx.ConnectError:
        logger.warning("[GitNexus] eval-server không chạy — fallback sang subprocess")
        args = ["query", query_text, "--limit", str(limit)]
        if repo:
            args += ["--repo", repo]
        if include_content:
            args.append("--content")
        raw = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _subprocess_gitnexus(args)
        )
        return {"raw": raw}


async def context(
    name: str,
    repo: str | None = None,
    include_content: bool = False,
) -> dict:
    """
    360-degree view của 1 symbol: callers, callees, processes.
    Tương đương: gitnexus_context({name: "...", include_content: true})
    """
    payload = {"name": name, "content": include_content}
    if repo:
        payload["repo"] = repo

    try:
        return await _eval_server_post("/context", payload)
    except httpx.ConnectError:
        logger.warning("[GitNexus] eval-server không chạy — fallback sang subprocess")
        args = ["context", name]
        if repo:
            args += ["--repo", repo]
        if include_content:
            args.append("--content")
        raw = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _subprocess_gitnexus(args)
        )
        return {"raw": raw}


async def impact(
    target: str,
    repo: str | None = None,
    direction: str = "upstream",
) -> dict:
    """
    Blast radius analysis: cái gì bị ảnh hưởng nếu thay đổi symbol.
    Tương đương: gitnexus_impact({target: "...", direction: "upstream"})
    """
    payload = {"target": target, "direction": direction}
    if repo:
        payload["repo"] = repo

    try:
        return await _eval_server_post("/impact", payload)
    except httpx.ConnectError:
        logger.warning("[GitNexus] eval-server không chạy — fallback sang subprocess")
        args = ["impact", target]
        if repo:
            args += ["--repo", repo]
        raw = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _subprocess_gitnexus(args)
        )
        return {"raw": raw}


async def detect_changes(
    repo: str | None = None,
    scope: str = "compare",
    base_ref: str = "develop",
) -> dict:
    """
    Phát hiện symbols thay đổi so với base_ref.
    Tương đương: gitnexus_detect_changes({scope: "compare", base_ref: "develop"})
    """
    payload = {"scope": scope, "base_ref": base_ref}
    if repo:
        payload["repo"] = repo

    try:
        return await _eval_server_post("/detect-changes", payload)
    except httpx.ConnectError:
        logger.warning("[GitNexus] eval-server không chạy — fallback sang subprocess")
        # detect_changes chưa có CLI equivalent — trả empty
        logger.error("[GitNexus] detect_changes không hỗ trợ qua subprocess")
        return {"changes": [], "error": "eval-server required"}


async def cypher(query_str: str, repo: str | None = None) -> dict:
    """
    Chạy raw Cypher query trực tiếp trên knowledge graph.
    Tương đương: gitnexus_cypher({query: "MATCH ..."})
    """
    payload = {"query": query_str}
    if repo:
        payload["repo"] = repo

    try:
        return await _eval_server_post("/cypher", payload)
    except httpx.ConnectError:
        args = ["cypher", query_str]
        if repo:
            args += ["--repo", repo]
        raw = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _subprocess_gitnexus(args)
        )
        return {"raw": raw}


def get_repo_name(role: str) -> str:
    """Trả về GitNexus repo name theo role ('backend' hoặc 'frontend')."""
    return GITNEXUS_REPOS.get(role, role)


# ─────────────────────────────────────────────────────────────
# REPO LIFECYCLE MANAGER (port 4747)
# Dùng để kiểm tra repos đã index và đăng ký repo mới.
# ─────────────────────────────────────────────────────────────

async def list_repos() -> list[dict]:
    """
    Lấy danh sách repos đã được index trong gitnexus-service.
    GET http://gitnexus-service:4747/api/repos
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{GITNEXUS_SERVICE_URL}/api/repos")
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        logger.warning("[GitNexus] gitnexus-service (4747) không khả dụng")
        return []
    except Exception as e:
        logger.error(f"[GitNexus] list_repos error: {e}")
        return []


async def get_repo_status(repo_name: str) -> dict:
    """
    Kiểm tra status của 1 repo cụ thể.
    GET http://gitnexus-service:4747/api/repos/:name/status
    Returns: { name, status: "ready"|"queued"|"cloning"|"analyzing"|"error", stats, ... }
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{GITNEXUS_SERVICE_URL}/api/repos/{repo_name}/status"
            )
            if resp.status_code == 404:
                return {"name": repo_name, "status": "not_registered"}
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        return {"name": repo_name, "status": "service_offline"}
    except Exception as e:
        logger.error(f"[GitNexus] get_repo_status error: {e}")
        return {"name": repo_name, "status": "error", "error": str(e)}


async def register_repo(
    repo_url: str,
    repo_name: str | None = None,
    access_token: str | None = None,
    branch: str | None = None,
) -> dict:
    """
    Đăng ký repo mới: clone + gitnexus analyze.
    POST http://gitnexus-service:4747/api/repos/register

    Returns: { repo_name, status: "queued" }
    Note: Analyze chạy async — poll get_repo_status() để biết khi "ready".
    """
    payload: dict = {"repo_url": repo_url}
    if repo_name:
        payload["repo_name"] = repo_name
    if access_token:
        payload["access_token"] = access_token
    if branch:
        payload["branch"] = branch

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{GITNEXUS_SERVICE_URL}/api/repos/register",
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        raise RuntimeError(
            f"gitnexus-service không khả dụng tại {GITNEXUS_SERVICE_URL}. "
            "Đảm bảo Docker container outline-gitnexus đang chạy."
        )


def _get_repo_dir(repo_name: str) -> str:
    """Trả về đường dẫn tuyệt đối của repo trên shared volume."""
    import os
    return os.path.join(GITNEXUS_REPOS_DIR, repo_name)
