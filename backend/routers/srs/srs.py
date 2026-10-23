import re
import time
import logging
import asyncio
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Literal
from rag_state import get_rag_for_workspace, llm_model_func
from lightrag import QueryParam
from utils.srs_flow_logger import SrsFlowLogger, count_tokens
from utils.graph_eval import get_nodes_by_file_path, request_change_intent, evaluate_intent
from utils.prompt_loader import load_prompt

logger = logging.getLogger(__name__)

# Suppress LightRAG's verbose INFO output — only show WARNING+ in terminal
for _lg in ("lightrag", "lightrag.lightrag", "lightrag.operate", "lightrag.kg.neo4j_impl"):
    logging.getLogger(_lg).setLevel(logging.WARNING)

router = APIRouter(prefix="/api/srs", tags=["SRS"])


class TestResultItem(BaseModel):
    id: str
    gapFindingId: str
    title: str
    description: str
    code_to_srs: Literal["mismatch", "match", "missing", "surplus"]


class SrsChangeSuggestionRequest(BaseModel):
    gapFindingId: str
    testResults: List[TestResultItem]
    gapDescription: str
    useCaseName: str
    userInstruction: str = ""
    documentFilePaths: List[str] = []
    """
    Candidate doc_name values from lightrag_doc_full for this use case.
    Python will query Neo4j using ANY(fp IN documentFilePaths WHERE node.file_path CONTAINS fp).
    If empty, falls back to _resolve_file_path() auto-match from Neo4j.
    """


def _normalize(s: str) -> str:
    """Lowercase + collapse non-alphanumeric runs to a single space for fuzzy matching."""
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


async def _resolve_file_path(use_case_name: str, rag) -> str:
    """
    Auto-match useCaseName against file_path values actually stored in Neo4j nodes.

    Queries Neo4j for all distinct file_path values (splitting on <SEP>),
    then scores each against the tokenised use_case_name.
    This avoids the doc_status vs. graph filename mismatch problem.
    """
    tokens = _normalize(use_case_name).split()
    if not tokens:
        return ""

    graph = rag.chunk_entity_relation_graph
    workspace_label = graph._get_workspace_label()

    try:
        async with graph._driver.session(
            database=graph._DATABASE, default_access_mode="READ"
        ) as session:
            result = await session.run(
                f"MATCH (n:`{workspace_label}`) WHERE n.file_path IS NOT NULL "
                f"RETURN DISTINCT n.file_path AS fp"
            )
            raw_fps: list[str] = [record["fp"] async for record in result]
            await result.consume()
    except Exception as e:
        logger.warning(f"[SRS] Neo4j file_path query failed: {e}")
        return ""

    # Each value may be "<SEP>"-joined — split to get individual filenames
    all_filenames: set[str] = set()
    for raw in raw_fps:
        for part in raw.split("<SEP>"):
            part = part.strip()
            if part:
                all_filenames.add(part)

    best_path, best_score = "", 0
    for fname in all_filenames:
        norm = _normalize(fname)
        score = sum(1 for t in tokens if t in norm)
        if score > best_score:
            best_score, best_path = score, fname

    if best_score >= 2:
        logger.info(
            f"[SRS] Resolved file_path='{best_path}' (score={best_score}) "
            f"for use_case='{use_case_name}'"
        )
        return best_path

    logger.info(
        f"[SRS] No file_path match for use_case='{use_case_name}' (best_score={best_score})"
    )
    return ""


def _build_query(tr: TestResultItem, gap_description: str, use_case_name: str, user_instruction: str = "") -> str:
    base = (
        f"Use Case: {use_case_name}\n"
        f"Gap Finding Description: {gap_description}\n\n"
        f"Test Title: {tr.title}\n"
        f"Test Description: {tr.description}\n\n"
    )
    instruction_block = (
        f"\nAdditional user instruction: {user_instruction.strip()}\n"
        if user_instruction and user_instruction.strip()
        else ""
    )

    if tr.code_to_srs == "mismatch":
        return (
            f"Use Case: {use_case_name}\n"
            f"Which section of the SRS describes the following requirement?\n"
            f'"{tr.title}: {tr.description}"'
            f"{instruction_block}"
        )
    elif tr.code_to_srs == "surplus":
        return (
            f"The following test result indicates SURPLUS code functionality "
            f"that is NOT currently covered by the SRS:\n\n"
            f"{base}"
            f"Based on the knowledge graph, please:\n"
            f"1. Identify the most appropriate location in the SRS where this "
            f"surplus functionality should be documented.\n"
            f"2. Suggest the exact SRS text to add to document this functionality "
            f"in alignment with the existing SRS structure and language."
            f"{instruction_block}"
        )
    elif tr.code_to_srs == "missing":
        return (
            f"Use Case: {use_case_name}\n"
            f"Which section of the SRS describes the following requirement?\n"
            f'"{tr.title}: {tr.description}"'
            f"{instruction_block}"
        )
    return ""


def _case_header(case: str, title: str) -> str:
    labels = {
        "mismatch": "MISMATCH — SRS Update Required",
        "surplus":  "SURPLUS — Add to SRS",
        "missing":  "MISSING — SRS Content to Remove",
    }
    label = labels.get(case, case.upper())
    return f"[{label}]\nTest: {title}"


class SrsRefineRequest(BaseModel):
    previousSuggestion: str
    userInstruction: str
    useCaseName: str


@router.post("/refine")
async def refine_srs_suggestion(body: SrsRefineRequest):
    """
    Refine an existing SRS change proposal based on user instruction.
    No LightRAG queries — just one LLM call to update the previous suggestion.
    """
    refine_prompt = (
        f"Use Case: {body.useCaseName}\n\n"
        f"The following SRS change proposal was previously generated:\n\n"
        f"{body.previousSuggestion}\n\n"
        f"The user has provided the following instruction to refine it:\n"
        f"{body.userInstruction}"
    )
    try:
        result = await llm_model_func(
            refine_prompt,
            system_prompt=load_prompt("srs_refine_system.txt"),
        )
        return {"suggestion": result.strip()}
    except Exception as e:
        logger.error(f"[SRS] Refine failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suggest")
async def get_srs_change_suggestion(request: Request, body: SrsChangeSuggestionRequest):
    """
    Generate a LightRAG-powered SRS change suggestion based on test results.

    Pipeline:
      1. Parallel LightRAG hybrid queries — one per non-match test result.
      2. Synthesis — combine individual results into a structured proposal.
      3. Graph evaluation (if documentFilePath provided):
         a. Fetch nodes belonging to the document from Neo4j.
         b. LLM intent extraction — classify add/update/delete on those nodes.
         c. Deterministic structural check — warnings for cross-document refs.
      4. Log the full flow to backend/logs/srs_flow.jsonl.

    Returns:
        {
            "suggestion":  str,
            "evaluation": {
                "warnings":        [...],
                "intent_summary":  {add, update, delete},
                "node_counts":     {total, external_ref, internal_only},
            },
        }
    """
    flow_log = SrsFlowLogger(
        gap_finding_id=body.gapFindingId,
        use_case_name=body.useCaseName,
    )

    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        rag = await get_rag_for_workspace(workspace_id)
        non_match = [
            tr for tr in body.testResults if tr.code_to_srs != "match"]

        # ── Resolve documentFilePath (use candidates from Node.js, fallback to Neo4j auto-match) ──
        doc_file_paths = [p.strip()
                          for p in body.documentFilePaths if p.strip()]
        if not doc_file_paths:
            fallback = await _resolve_file_path(body.useCaseName, rag)
            if fallback:
                doc_file_paths = [fallback]

        # ── Step 1: Parallel LightRAG queries ────────────────────────────────
        async def _query_one(tr: TestResultItem) -> str:
            # For "missing" case: SRS doesn't document this behavior yet — skip LightRAG query
            # and emit a direct "add to SRS" suggestion instead.
            if tr.code_to_srs == "surplus":
                content = (
                    f"The code implements '{tr.title}' but the SRS does not document it."
                )
                flow_log.log_step(
                    "lightrag_query",
                    prompt_tokens=0,
                    response_tokens=0,
                    duration_ms=0,
                    case=tr.code_to_srs,
                    title=tr.title[:80],
                    response_text=content,
                )
                return f"{_case_header(tr.code_to_srs, tr.title)}\n{content}"

            _FALLBACK: dict[str, str] = {
                "mismatch": (
                    f"The SRS documents '{tr.title}' but the code implements it differently."
                ),
                "missing": (
                    f"The SRS requires '{tr.title}' but the code does not implement it."
                ),
            }
            _LIGHTRAG_TIMEOUT_S = 100

            query = _build_query(tr, body.gapDescription,
                                 body.useCaseName, body.userInstruction)
            logger.info(
                f"[SRS] Querying LightRAG — case={tr.code_to_srs}, "
                f"gapFindingId={body.gapFindingId}, title='{tr.title[:50]}'"
            )
            t0 = time.monotonic()
            try:
                raw = await asyncio.wait_for(
                    rag.aquery(query, param=QueryParam(mode="hybrid")),
                    timeout=_LIGHTRAG_TIMEOUT_S,
                )
                no_content = not raw or not raw.strip() or "no relevant" in raw.lower()
                if no_content:
                    content = _FALLBACK.get(tr.code_to_srs, raw.strip())
                elif tr.code_to_srs in ("missing", "mismatch"):
                    content = f"{_FALLBACK[tr.code_to_srs]}\n\nSRS Reference:\n{raw.strip()}"
                else:
                    content = raw.strip()
                flow_log.log_step(
                    "lightrag_query",
                    prompt_tokens=count_tokens(query),
                    response_tokens=count_tokens(content),
                    duration_ms=(time.monotonic() - t0) * 1000,
                    case=tr.code_to_srs,
                    title=tr.title[:80],
                    response_text=content,
                    fallback=no_content,
                )
                return f"{_case_header(tr.code_to_srs, tr.title)}\n{content}"
            except asyncio.TimeoutError:
                duration = (time.monotonic() - t0) * 1000
                content = _FALLBACK.get(
                    tr.code_to_srs, f"LightRAG query timed out after {_LIGHTRAG_TIMEOUT_S}s.")
                flow_log.log_step(
                    "lightrag_query",
                    duration_ms=duration,
                    case=tr.code_to_srs,
                    title=tr.title[:80],
                    response_text=content,
                    fallback=True,
                    timeout=True,
                )
                logger.warning(
                    f"[SRS] LightRAG timeout after {_LIGHTRAG_TIMEOUT_S}s — case={tr.code_to_srs}, title='{tr.title}'")
                return f"{_case_header(tr.code_to_srs, tr.title)}\n{content}"
            except Exception as e:
                duration = (time.monotonic() - t0) * 1000
                flow_log.log_step(
                    "lightrag_query",
                    duration_ms=duration,
                    case=tr.code_to_srs,
                    title=tr.title[:80],
                    error=str(e),
                )
                logger.error(
                    f"[SRS] LightRAG query failed — case={tr.code_to_srs}, title='{tr.title}': {e}", exc_info=True)
                return f"{_case_header(tr.code_to_srs, tr.title)}\nError querying knowledge graph: {str(e)}"

        parts: list[str] = await asyncio.gather(*[_query_one(tr) for tr in non_match])

        if not parts:
            evaluation = {"warnings": [], "intent_summary": {"add": 0, "update": 0, "delete": 0}, "node_counts": {
                "total": 0, "external_ref": 0, "internal_only": 0}}
            flow_log.log_step("no_non_match_results")
            flow_log.flush(
                "All test results match the SRS. No changes needed.")
            return {"suggestion": "All test results match the SRS. No changes needed.", "evaluation": evaluation}

        separator = "\n\n" + "─" * 60 + "\n\n"
        combined = separator.join(parts)

        # ── Step 2: Synthesis (skip if only 1 result) ────────────────────────
        if len(parts) == 1:
            suggestion = parts[0]
        else:
            user_instruction_block = (
                f"\nAdditional instruction from user: {body.userInstruction.strip()}\n"
                if body.userInstruction and body.userInstruction.strip()
                else ""
            )

            synthesis_prompt = (
                f"Use Case: {body.useCaseName}\n"
                f"Gap Finding: {body.gapDescription}\n"
                f"{user_instruction_block}\n"
                f"Below are individual SRS analysis results for each test case gap found:\n\n"
                f"{combined}"
            )

            t0 = time.monotonic()
            synthesis_raw = await llm_model_func(
                synthesis_prompt,
                system_prompt=load_prompt("srs_synthesis_system.txt"),
            )
            suggestion = synthesis_raw.strip()
            flow_log.log_step(
                "synthesis",
                prompt_tokens=count_tokens(synthesis_prompt),
                response_tokens=count_tokens(suggestion),
                duration_ms=(time.monotonic() - t0) * 1000,
                parts_count=len(parts),
                response_text=suggestion,
            )

        # ── Step 3: Graph evaluation ──────────────────────────────────────────
        evaluation: dict = {
            "warnings": [],
            "intent_summary": {"add": 0, "update": 0, "delete": 0},
            "node_counts": {"total": 0, "external_ref": 0, "internal_only": 0},
        }

        if doc_file_paths:
            # 3a — Fetch nodes from Neo4j
            t0 = time.monotonic()
            doc_nodes = await get_nodes_by_file_path(doc_file_paths, rag)
            flow_log.log_step(
                "node_fetch",
                duration_ms=(time.monotonic() - t0) * 1000,
                nodes_found=len(doc_nodes),
                external_ref_count=sum(
                    1 for n in doc_nodes if n.has_external_ref),
                file_paths=doc_file_paths,
                nodes=[
                    {
                        "entity_id": n.entity_id,
                        "entity_type": n.entity_type,
                        "has_external_ref": n.has_external_ref,
                    }
                    for n in doc_nodes
                ],
            )

            if doc_nodes:
                # 3b — LLM intent extraction
                intent_prompt_approx = (
                    suggestion
                    + "\n".join(f"- {n.entity_id}" for n in doc_nodes)
                )
                t0 = time.monotonic()
                intent, intent_raw = await request_change_intent(suggestion, doc_nodes, llm_model_func)
                flow_log.log_step(
                    "intent_extraction",
                    prompt_tokens=count_tokens(intent_prompt_approx),
                    response_tokens=count_tokens(intent_raw),
                    duration_ms=(time.monotonic() - t0) * 1000,
                    intent_add=len(intent.get("add", [])),
                    intent_update=len(intent.get("update", [])),
                    intent_delete=len(intent.get("delete", [])),
                    response_text=intent_raw,
                )

                # 3c — Deterministic structural warnings (0 tokens)
                t0 = time.monotonic()
                evaluation = await evaluate_intent(intent, doc_nodes, rag)
                flow_log.log_step(
                    "graph_eval",
                    duration_ms=(time.monotonic() - t0) * 1000,
                    warnings=evaluation["warnings"],
                    warnings_count=len(evaluation["warnings"]),
                    **evaluation["intent_summary"],
                )
            else:
                flow_log.log_step(
                    "graph_eval_skipped",
                    reason="no nodes found for documentFilePath",
                )
        else:
            flow_log.log_step(
                "graph_eval_skipped",
                reason="documentFilePath not provided",
            )

        flow_log.flush(suggestion_preview=suggestion)
        return {"suggestion": suggestion, "evaluation": evaluation}

    except RuntimeError as e:
        logger.error(f"[SRS] RAG not ready: {e}")
        flow_log.flush()
        raise HTTPException(
            status_code=503,
            detail="Knowledge graph is not ready. Please try again in a few seconds.",
        )
    except Exception as e:
        logger.error(f"[SRS] Unexpected error: {e}", exc_info=True)
        flow_log.flush()
        raise HTTPException(status_code=500, detail=str(e))
