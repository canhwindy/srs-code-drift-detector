"""
graph_eval.py — Structural graph evaluation for Phase 1 SRS suggestions.

Replaces the LLM-as-judge groundedness check with a deterministic approach:
1. get_nodes_by_file_path()  — fetch all nodes belonging to a document + tag external refs
2. request_change_intent()   — LLM returns {add, update, delete} node lists (no graph topology exposed)
3. evaluate_intent()         — pure Python: checks has_external_ref tags → warnings

Token cost:
  - Steps 1 & 3: 0 LLM calls (graph queries + Python logic).
  - Step 2: 1 LLM call, prompt ≈ suggestion + node name list (no descriptions).

Why no descriptions in node list?
  - Keeps intent-extraction prompt short (hundreds, not thousands, of tokens).
  - The LLM only needs names to decide add/update/delete; it already has the full
    suggestion as context.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Callable

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Data model
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class NodeInfo:
    entity_id: str
    entity_type: str
    description: str
    file_path: str
    has_external_ref: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Query Neo4j nodes for a document + tag external references
# ─────────────────────────────────────────────────────────────────────────────

async def get_nodes_by_file_path(file_paths: list[str], rag) -> list[NodeInfo]:
    """
    Fetch all graph nodes whose `file_path` property contains any of the given strings,
    then tag each node with has_external_ref=True if it has at least one edge
    to a node that does NOT belong to the same file.

    Args:
        file_paths: List of candidate doc_names from lightrag_doc_full.
                    A node matches if its file_path contains ANY of these strings.
        rag:        ExtendedLightRAG singleton from rag_state.get_rag().

    Returns:
        List[NodeInfo] — empty if file_paths is empty or no nodes found.
    """
    candidates = [p.strip() for p in file_paths if p.strip()]
    if not candidates:
        return []

    graph = rag.chunk_entity_relation_graph
    workspace_label = graph._get_workspace_label()

    # ── 1. Fetch all nodes for this file ────────────────────────────────────
    try:
        async with graph._driver.session(
            database=graph._DATABASE, default_access_mode="READ"
        ) as session:
            query = f"""
            MATCH (n:`{workspace_label}`)
            WHERE n.file_path IS NOT NULL
              AND ANY(fp IN $file_paths WHERE n.file_path CONTAINS fp)
            RETURN n.entity_id  AS entity_id,
                   n.entity_type AS entity_type,
                   n.description AS description,
                   n.file_path   AS file_path
            """
            result = await session.run(query, file_paths=candidates)
            raw_nodes: list[dict] = []
            async for record in result:
                raw_nodes.append({
                    "entity_id":   record["entity_id"]   or "",
                    "entity_type": record["entity_type"] or "",
                    "description": record["description"] or "",
                    "file_path":   record["file_path"]   or "",
                })
            await result.consume()
    except Exception as e:
        logger.error(f"[GraphEval] Neo4j query failed for file_paths='{candidates}': {e}")
        return []

    if not raw_nodes:
        return []

    # ── 2. Tag external refs ─────────────────────────────────────────────────
    # Build set of entity_ids that belong to this document
    doc_ids = {n["entity_id"] for n in raw_nodes}

    nodes: list[NodeInfo] = []
    for n in raw_nodes:
        try:
            edges = await graph.get_node_edges(n["entity_id"])
            # An edge is (src, tgt); the node itself is one endpoint.
            # has_external_ref = any neighbor NOT in doc_ids
            has_external = any(
                (src not in doc_ids) or (tgt not in doc_ids)
                for src, tgt in edges
                if src != tgt  # skip self-loops
            )
        except Exception as exc:
            logger.warning(
                f"[GraphEval] Could not get edges for node '{n['entity_id']}': {exc}"
            )
            has_external = False

        nodes.append(
            NodeInfo(
                entity_id=n["entity_id"],
                entity_type=n["entity_type"],
                description=n["description"],
                file_path=n["file_path"],
                has_external_ref=has_external,
            )
        )

    return nodes


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — LLM intent extraction
# ─────────────────────────────────────────────────────────────────────────────

_INTENT_SYSTEM_PROMPT = """You are a requirement analyst reviewing SRS change proposals.

Given an SRS change suggestion and a list of existing knowledge-graph node names for the document, classify the intended operations as ADD, UPDATE, or DELETE.

Return ONLY valid JSON — no markdown fences, no explanation:
{
  "add":    ["new_concept_A", "new_section_B"],
  "update": ["EXISTING_NODE_X"],
  "delete": ["EXISTING_NODE_Y"]
}

Rules:
- "add":    Brand-new concepts/requirements described in the suggestion that do NOT appear in the node list.
- "update": Nodes from the node list that the suggestion proposes to modify or rewrite.
- "delete": Nodes from the node list that the suggestion proposes to remove or mark as "not implemented".
- Use the EXACT node name from the list for "update" and "delete".
- For "add", use the name as described in the suggestion (keep it concise, ≤ 5 words).
- Empty list [] is valid for any category if nothing applies.
"""


async def request_change_intent(
    suggestion: str,
    nodes: list[NodeInfo],
    llm_model_func: Callable,
) -> tuple[dict, str]:
    """
    Ask the LLM to classify which nodes will be added / updated / deleted.
    The LLM only sees node names — has_external_ref is intentionally hidden.

    Args:
        suggestion:       The synthesised SRS change suggestion text.
        nodes:            Nodes belonging to the document (from get_nodes_by_file_path).
        llm_model_func:   LLM callable from rag_state.

    Returns:
        Tuple of:
          - intent dict: { "add": [...], "update": [...], "delete": [...] }
          - raw_response: the raw string returned by the LLM (for logging)
        Empty lists on error or when nodes is empty.
    """
    _empty = {"add": [], "update": [], "delete": []}

    if not nodes:
        return _empty, ""

    node_list_text = "\n".join(f"- {n.entity_id}" for n in nodes)
    prompt = (
        f"SRS CHANGE SUGGESTION:\n{suggestion}\n\n"
        f"EXISTING NODES IN THIS DOCUMENT ({len(nodes)} total):\n{node_list_text}\n\n"
        f"Classify the intended node operations (ADD / UPDATE / DELETE)."
    )

    raw = ""
    try:
        raw = await llm_model_func(prompt, system_prompt=_INTENT_SYSTEM_PROMPT)

        # Extract first JSON object from response (handles markdown fences etc.)
        json_match = re.search(r"\{[\s\S]*?\}", raw)
        if not json_match:
            logger.warning(f"[GraphEval] Intent LLM returned no JSON. Raw: {raw[:300]}")
            return _empty, raw

        intent = json.loads(json_match.group())
        result = {
            "add":    [str(x) for x in intent.get("add",    [])],
            "update": [str(x) for x in intent.get("update", [])],
            "delete": [str(x) for x in intent.get("delete", [])],
        }
        return result, raw

    except json.JSONDecodeError as e:
        logger.error(f"[GraphEval] Intent JSON parse error: {e} | raw: {raw[:300]}")
        return _empty, raw
    except Exception as e:
        logger.error(f"[GraphEval] Intent extraction failed: {e}", exc_info=True)
        return _empty, raw


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Deterministic structural evaluation (0 LLM tokens)
# ─────────────────────────────────────────────────────────────────────────────

_WINDOW_CHARS = 150  # chars before/after match for excerpt



def _extract_heading(text: str) -> str:
    """Return the first markdown heading found in the chunk, or empty string."""
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return ""


def _find_excerpt(content: str, entity_id: str) -> dict:
    """
    Search for entity_id (case-insensitive) in chunk content.
    Returns a window of ±_WINDOW_CHARS around the match with highlight offsets.
    Falls back to the first _WINDOW_CHARS*2 chars with no highlight if not found.
    """
    lower_content = content.lower()
    lower_entity = entity_id.lower().strip()

    pos = lower_content.find(lower_entity) if lower_entity else -1

    if pos == -1:
        # No literal match — return start of chunk, no highlight
        excerpt = content[: _WINDOW_CHARS * 2].strip()
        return {"excerpt": excerpt, "highlight_start": -1, "highlight_end": -1}

    # Build window around match
    win_start = max(0, pos - _WINDOW_CHARS)
    win_end = min(len(content), pos + len(lower_entity) + _WINDOW_CHARS)
    excerpt = content[win_start:win_end].strip()

    # Recalculate highlight positions relative to the excerpt start
    # Account for leading whitespace stripped by .strip()
    leading_stripped = len(content[win_start:win_end]) - len(content[win_start:win_end].lstrip())
    hl_start = pos - win_start - leading_stripped
    hl_end = hl_start + len(lower_entity)

    # Add ellipsis markers if window doesn't start/end at doc boundary
    if win_start > 0:
        excerpt = "…" + excerpt
        hl_start += 1
        hl_end += 1
    if win_end < len(content):
        excerpt = excerpt + "…"

    return {
        "excerpt": excerpt,
        "highlight_start": max(0, hl_start),
        "highlight_end": max(0, hl_end),
    }


async def _enrich_node(entity_id: str, rag) -> dict:
    """
    Fetch doc list + context snippets for a node from the knowledge graph.
    Returns:
        {
            "appears_in_docs": ["UC_341.md", ...],
            "context_snippets": [{"doc": "UC_341.md", "text": "..."}, ...]
        }
    """
    graph = rag.chunk_entity_relation_graph
    try:
        node_data = await graph.get_node(entity_id)
    except Exception:
        return {"appears_in_docs": [], "context_snippets": []}

    if not node_data:
        return {"appears_in_docs": [], "context_snippets": []}

    # 1. Derive unique doc names from file_path property
    raw_fp = node_data.get("file_path") or ""
    appears_in_docs: list[str] = []
    seen_docs: set[str] = set()
    for part in raw_fp.split("<SEP>"):
        part = part.strip()
        if part and part not in seen_docs and not part.startswith("..."):
            appears_in_docs.append(part)
            seen_docs.add(part)

    # 2. Fetch one context snippet per doc from text_chunks
    raw_source_id = node_data.get("source_id") or ""
    chunk_ids = [c.strip() for c in raw_source_id.split("<SEP>") if c.strip()]

    # Map each chunk to its doc, upgrading to a better match if found later.
    # A chunk WITH a highlight match beats one without — so we keep iterating
    # even after we have a fallback entry for a doc.
    snippets_by_doc: dict[str, dict] = {}
    all_matched = lambda: all(
        v["highlight_start"] >= 0 for v in snippets_by_doc.values()
    )
    for chunk_id in chunk_ids:
        # Stop early only when every doc already has a highlighted match
        if len(snippets_by_doc) >= len(appears_in_docs) and all_matched():
            break
        try:
            chunk = await rag.text_chunks.get_by_id(chunk_id)
        except Exception:
            continue
        if not chunk:
            continue
        doc = (chunk.get("file_path") or "").strip()
        if not doc:
            continue
        text = (chunk.get("content") or "").strip()
        if not text:
            continue
        section = _extract_heading(text)
        excerpt_data = _find_excerpt(text, entity_id)
        existing = snippets_by_doc.get(doc)
        # Upgrade if: no entry yet, OR existing has no highlight and new one does
        if existing is None or (existing["highlight_start"] < 0 and excerpt_data["highlight_start"] >= 0):
            snippets_by_doc[doc] = {
                "section": section,
                "chunk_order": chunk.get("chunk_order_index", None),
                **excerpt_data,
            }

    context_snippets = [
        {
            "doc": doc,
            "section": meta["section"],
            "chunk_order": meta["chunk_order"],
            "excerpt": meta["excerpt"],
            "highlight_start": meta["highlight_start"],
            "highlight_end": meta["highlight_end"],
        }
        for doc, meta in snippets_by_doc.items()
    ]

    return {"appears_in_docs": appears_in_docs, "context_snippets": context_snippets}


async def evaluate_intent(
    intent: dict,
    nodes: list[NodeInfo],
    rag,
) -> dict:
    """
    Produce structural warnings based on has_external_ref tags.
    For each warned node, enriches the warning with which docs it appears in
    and a short context snippet from each doc (0 LLM tokens — graph + KV reads only).

    Warning types:
    - "add_near_external":  New node name suspiciously similar to an existing external-ref node.
    - "update_external":    Target node for UPDATE has cross-document relationships.
    - "delete_external":    Target node for DELETE has cross-document relationships.

    Returns:
        {
            "warnings": [
                {
                    "type": str, "node": str, "message": str,
                    "appears_in_docs": [...],
                    "context_snippets": [{"doc": str, "text": str}, ...]
                },
                ...
            ],
            "intent_summary": {"add": int, "update": int, "delete": int},
            "node_counts": {"total": int, "external_ref": int, "internal_only": int},
        }
    """
    nodes_by_id: dict[str, NodeInfo] = {n.entity_id.lower(): n for n in nodes}
    external_ids: set[str] = {n.entity_id.lower() for n in nodes if n.has_external_ref}

    warnings: list[dict] = []

    # ── ADD warnings ─────────────────────────────────────────────────────────
    for add_name in intent.get("add", []):
        add_lower = add_name.lower().strip()
        if not add_lower:
            continue
        for ext_id in external_ids:
            if add_lower in ext_id or ext_id in add_lower:
                # Find the original-case entity_id
                original_node = next((n for n in nodes if n.entity_id.lower() == ext_id), None)
                enrichment = await _enrich_node(original_node.entity_id if original_node else ext_id, rag)
                warnings.append({
                    "type": "add_near_external",
                    "node": add_name,
                    "message": (
                        f"Proposed new node '{add_name}' may duplicate the existing "
                        f"cross-document node '{ext_id}'. "
                        "Consider reusing the existing node instead of creating a new one."
                    ),
                    **enrichment,
                })
                break

    # ── UPDATE warnings ───────────────────────────────────────────────────────
    for upd_name in intent.get("update", []):
        node = nodes_by_id.get(upd_name.lower().strip())
        if node and node.has_external_ref:
            enrichment = await _enrich_node(node.entity_id, rag)
            warnings.append({
                "type": "update_external",
                "node": upd_name,
                "message": (
                    f"Node '{upd_name}' has relationships to nodes in other documents. "
                    "Updating its content may affect requirements in other use cases."
                ),
                **enrichment,
            })

    # ── DELETE warnings ───────────────────────────────────────────────────────
    for del_name in intent.get("delete", []):
        node = nodes_by_id.get(del_name.lower().strip())
        if node and node.has_external_ref:
            enrichment = await _enrich_node(node.entity_id, rag)
            warnings.append({
                "type": "delete_external",
                "node": del_name,
                "message": (
                    f"Node '{del_name}' has relationships to nodes in other documents. "
                    "Deleting this node will break cross-document links."
                ),
                **enrichment,
            })

    internal_count = sum(1 for n in nodes if not n.has_external_ref)
    external_count = len(nodes) - internal_count

    return {
        "warnings": warnings,
        "intent_summary": {
            "add":    len(intent.get("add",    [])),
            "update": len(intent.get("update", [])),
            "delete": len(intent.get("delete", [])),
        },
        "node_counts": {
            "total":         len(nodes),
            "external_ref":  external_count,
            "internal_only": internal_count,
        },
    }
