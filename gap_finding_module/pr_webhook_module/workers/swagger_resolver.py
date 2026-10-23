"""
Phase 2.5 — Swagger Endpoint Resolver

Fetch OpenAPI schema từ running backend, extract keywords từ PR diff,
filter ra các endpoints liên quan đến PR đang xử lý.

Mục đích: cung cấp EXACT endpoint URLs cho LLM khi generate tests,
thay vì để LLM đoán URL từ SRS.

Design:
    - Swagger cung cấp: URL, method, params, response schema
    - SRS cung cấp: expected behavior, status codes, business rules
    → Tách biệt "kỹ thuật gọi API" khỏi "assertion logic"
"""

import re
import logging
import json
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)


# =============================================================================
# Data structures
# =============================================================================

@dataclass
class ResolvedEndpoint:
    method: str         # GET | POST | PUT | PATCH | DELETE
    path: str           # /api/lms/course-classes/{id}/take-survey/
    summary: str        # Short description từ schema
    description: str    # Longer description nếu có
    path_params: list[str] = field(default_factory=list)   # ["id", "pk"]
    query_params: list[str] = field(default_factory=list)  # ["page", "status"]
    request_body_hint: str = ""   # "application/json — {username, password}"
    response_hints: list[str] = field(default_factory=list)  # ["200: ...", "400: ..."]
    score: int = 0      # Relevance score (higher = more relevant)

    def to_prompt_line(self) -> str:
        """Format ngắn gọn để đưa vào LLM prompt."""
        line = f"{self.method.upper()} {self.path}"
        if self.summary:
            line += f" — {self.summary}"
        if self.path_params:
            line += f"\n   Path params: {', '.join(self.path_params)}"
        if self.query_params:
            line += f"\n   Query params: {', '.join(self.query_params)}"
        if self.request_body_hint:
            line += f"\n   Body: {self.request_body_hint}"
        if self.response_hints:
            line += f"\n   Responses: {' | '.join(self.response_hints)}"
        return line


# =============================================================================
# Keyword extraction from diff
# =============================================================================

def extract_keywords_from_pr(changed_files: list[dict], diff: str) -> list[str]:
    """
    Extract search keywords từ PR diff để filter Swagger endpoints.

    Sources:
      - Filenames: class_survey_viewset.py → ["survey", "class-survey", "class_survey"]
      - @action decorators: @action(...) def take_survey → ["take-survey", "take_survey"]
      - Class names: class ClassSurveyViewSet → ["class-survey", "survey"]
      - URL patterns in diff: router.register(..., "surveys") → ["surveys"]
    """
    keywords: set[str] = set()

    # 1. Extract từ filenames
    for f in changed_files:
        filename = f.get("filename", "") if isinstance(f, dict) else str(f)
        stem = filename.split("/")[-1].replace(".py", "").replace(".ts", "").replace(".js", "")
        # Remove common suffixes
        for suffix in ("viewset", "view", "views", "serializer", "model", "service", "controller", "component"):
            stem = stem.replace(f"_{suffix}", "").replace(suffix, "")
        # Split by underscore, add individual words + combinations
        parts = [p for p in stem.split("_") if len(p) > 2]
        for part in parts:
            keywords.add(part.lower())
        if len(parts) > 1:
            keywords.add("-".join(parts))
            keywords.add("_".join(parts))

    # 2. Extract action names từ diff (@action decorator + def)
    action_pattern = re.compile(r'def\s+([a-z_]+)\s*\(self', re.MULTILINE)
    for match in action_pattern.finditer(diff):
        func_name = match.group(1)
        if func_name in ("get", "post", "put", "patch", "delete", "list", "retrieve", "create", "update", "destroy"):
            continue
        keywords.add(func_name.replace("_", "-"))
        keywords.add(func_name)

    # 3. Extract URL patterns nếu có trong diff
    url_pattern = re.compile(r'["\']([a-z][a-z0-9-_/]+)["\']')
    for match in url_pattern.finditer(diff):
        url_frag = match.group(1)
        if "/" in url_frag and len(url_frag) > 3:
            # e.g. "course-classes" hoặc "survey-activities"
            parts = [p for p in url_frag.strip("/").split("/") if p and not p.startswith("{")]
            for part in parts:
                if len(part) > 2:
                    keywords.add(part)

    # 4. Extract class names
    class_pattern = re.compile(r'class\s+([A-Z][A-Za-z]+(?:ViewSet|View|Controller))', re.MULTILINE)
    for match in class_pattern.finditer(diff):
        class_name = match.group(1)
        # CamelCase → kebab-case
        kebab = re.sub(r'([a-z])([A-Z])', r'\1-\2', class_name).lower()
        for suffix in ("-viewset", "-view", "-controller"):
            kebab = kebab.replace(suffix, "")
        keywords.add(kebab)
        parts = [p for p in kebab.split("-") if len(p) > 2]
        for part in parts:
            keywords.add(part)

    result = sorted(keywords - {"the", "and", "for", "api", "get", "set"})
    logger.info(f"[Swagger] Keywords extracted: {result}")
    return result


# =============================================================================
# Fetch and filter OpenAPI schema
# =============================================================================

async def fetch_openapi_schema(base_url: str, timeout: float = 15.0) -> dict | None:
    """Fetch OpenAPI schema từ /api/schema/ endpoint."""
    schema_url = f"{base_url.rstrip('/')}/api/schema/"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(schema_url, headers={"Accept": "application/json"})
            resp.raise_for_status()
            schema = resp.json()
            path_count = len(schema.get("paths", {}))
            logger.info(f"[Swagger] Fetched schema from {schema_url} — {path_count} paths")
            return schema
    except Exception as e:
        logger.warning(f"[Swagger] Failed to fetch schema from {schema_url}: {e}")
        return None


def _score_path(path: str, operations: dict, keywords: list[str]) -> int:
    """Score một endpoint dựa trên keyword matches."""
    score = 0
    haystack = path.lower()
    # Also search in summary/description
    for method, op in operations.items():
        if isinstance(op, dict):
            haystack += " " + op.get("summary", "").lower()
            haystack += " " + op.get("description", "").lower()
            for tag in op.get("tags", []):
                haystack += " " + tag.lower()

    for kw in keywords:
        if kw in haystack:
            # Exact segment match scores higher
            if f"/{kw}/" in path or path.endswith(f"/{kw}/") or f"/{kw}-" in path or f"-{kw}/" in path:
                score += 3
            else:
                score += 1
    return score


def _extract_params(operation: dict) -> tuple[list[str], list[str]]:
    """Extract path params và query params từ operation."""
    path_params = []
    query_params = []
    for param in operation.get("parameters", []):
        name = param.get("name", "")
        location = param.get("in", "")
        if location == "path":
            path_params.append(name)
        elif location == "query":
            query_params.append(name)
    return path_params, query_params


def _extract_request_body_hint(operation: dict) -> str:
    """Extract request body summary từ operation."""
    rb = operation.get("requestBody", {})
    if not rb:
        return ""
    content = rb.get("content", {})
    for media_type, media_info in content.items():
        schema = media_info.get("schema", {})
        props = schema.get("properties", {})
        required = schema.get("required", [])
        if props:
            fields = [f"{k}*" if k in required else k for k in list(props.keys())[:6]]
            return f"{media_type} — {{{', '.join(fields)}}}"
        ref = schema.get("$ref", "")
        if ref:
            return f"{media_type} — {ref.split('/')[-1]}"
    return ""


def _extract_response_hints(operation: dict) -> list[str]:
    """Extract response hints (status code + description)."""
    hints = []
    for status_code, response_info in operation.get("responses", {}).items():
        desc = response_info.get("description", "")
        if desc:
            hints.append(f"{status_code}: {desc[:50]}")
        else:
            hints.append(str(status_code))
    return hints[:5]  # Max 5 response hints


def filter_relevant_endpoints(
    schema: dict,
    keywords: list[str],
    top_n: int = 15,
    min_score: int = 1,
) -> list[ResolvedEndpoint]:
    """
    Filter và rank endpoints từ OpenAPI schema dựa trên keyword relevance.
    """
    paths: dict = schema.get("paths", {})
    endpoints: list[ResolvedEndpoint] = []

    for path, path_item in paths.items():
        for method, operation in path_item.items():
            if method.upper() not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                continue
            if not isinstance(operation, dict):
                continue

            score = _score_path(path, {method: operation}, keywords)
            if score < min_score:
                continue

            path_params, query_params = _extract_params(operation)
            # Also get path params from path template {id}, {pk}, etc.
            template_params = re.findall(r'\{(\w+)\}', path)
            for tp in template_params:
                if tp not in path_params:
                    path_params.append(tp)

            endpoints.append(ResolvedEndpoint(
                method=method.upper(),
                path=path,
                summary=operation.get("summary", ""),
                description=operation.get("description", "")[:200],
                path_params=path_params,
                query_params=query_params,
                request_body_hint=_extract_request_body_hint(operation),
                response_hints=_extract_response_hints(operation),
                score=score,
            ))

    # Sort by score desc, then by path length asc (shorter = more general)
    endpoints.sort(key=lambda e: (-e.score, len(e.path)))
    result = endpoints[:top_n]

    # Đảm bảo list endpoint (để lấy IDs) luôn đi kèm với action endpoint có {id}
    # Ví dụ: nếu có /api/X/{id}/action/ thì thêm GET /api/X/ vào kết quả
    result_paths = {(ep.method, ep.path) for ep in result}
    extra: list[ResolvedEndpoint] = []
    for ep in list(result):
        if "{" in ep.path:
            # Tìm collection path: cắt tại đoạn /{param} đầu tiên
            collection_path = re.sub(r'/\{[^}]+\}.*$', '/', ep.path)
            if collection_path and ("GET", collection_path) not in result_paths:
                path_item = paths.get(collection_path, {})
                get_op = path_item.get("get")
                if get_op and isinstance(get_op, dict):
                    path_params, query_params = _extract_params(get_op)
                    extra.append(ResolvedEndpoint(
                        method="GET",
                        path=collection_path,
                        summary=get_op.get("summary", ""),
                        description=get_op.get("description", "")[:200],
                        path_params=path_params,
                        query_params=query_params,
                        request_body_hint="",
                        response_hints=_extract_response_hints(get_op),
                        score=ep.score,  # Inherit parent score
                    ))
                    result_paths.add(("GET", collection_path))
                    logger.info(f"[Swagger] Auto-added list endpoint: GET {collection_path}")

    result = result + extra

    # Nếu có survey/activity endpoint → tự động thêm GET /api/course-classes/
    # để LLM có thể filter surveys theo class status (INPROGRESS, DRAFT, etc.)
    has_survey = any("survey" in ep.path or "activit" in ep.path for ep in result)
    cc_path = "/api/course-classes/"
    if has_survey and ("GET", cc_path) not in result_paths:
        path_item = paths.get(cc_path, {})
        get_op = path_item.get("get")
        if get_op and isinstance(get_op, dict):
            path_params, query_params = _extract_params(get_op)
            result.append(ResolvedEndpoint(
                method="GET",
                path=cc_path,
                summary=get_op.get("summary", "List course classes (filter by status=INPROGRESS etc.)"),
                description="Use ?status=INPROGRESS to find classes in specific state",
                path_params=path_params,
                query_params=query_params + (["status"] if "status" not in query_params else []),
                request_body_hint="",
                response_hints=_extract_response_hints(get_op),
                score=4,
            ))
            logger.info(f"[Swagger] Auto-added course-classes endpoint for status filtering")

    logger.info(f"[Swagger] {len(result)}/{len(endpoints)} endpoints selected (top {top_n}, min_score={min_score})")
    for ep in result[:5]:
        logger.debug(f"  [{ep.score:2d}] {ep.method} {ep.path}")
    return result


# =============================================================================
# Main function
# =============================================================================

async def resolve_endpoints_for_pr(
    pr_context: dict,
    base_url: str,
) -> list[ResolvedEndpoint]:
    """
    Phase 2.5: Fetch Swagger schema + filter endpoints relevant to this PR.

    Args:
        pr_context: context.json dict (có changed_files, diff)
        base_url:   backend base URL, e.g. http://localhost:8001

    Returns:
        List of ResolvedEndpoint sorted by relevance.
        Empty list nếu không fetch được schema.
    """
    changed_files: list = pr_context.get("changed_files", [])
    diff: str = pr_context.get("diff", "")

    keywords = extract_keywords_from_pr(changed_files, diff)
    if not keywords:
        logger.warning("[Swagger] No keywords extracted from PR diff")
        return []

    schema = await fetch_openapi_schema(base_url)
    if not schema:
        return []

    return filter_relevant_endpoints(schema, keywords)


def endpoints_to_prompt_section(endpoints: list[ResolvedEndpoint]) -> str:
    """
    Format endpoints thành section text để đưa vào LLM prompt.
    """
    if not endpoints:
        return "(Swagger schema not available — infer endpoints from SRS context)"

    lines = []
    for ep in endpoints:
        lines.append(ep.to_prompt_line())
        lines.append("")  # blank line between endpoints

    return "\n".join(lines).strip()
