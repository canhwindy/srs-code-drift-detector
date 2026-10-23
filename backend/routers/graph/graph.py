import json
import logging
from datetime import datetime
from pathlib import Path
import asyncio
import sqlalchemy
from fastapi import APIRouter, HTTPException, Query, Request
from rag_state import get_rag_for_workspace, acquire_workspace_lock, release_workspace_lock, check_workspace_lock
from database import engine
from routers.graph.graph_type import EntityMergeRequest, SemanticDedupRequest
from kg_dedup_semantic_name import run_llm_dedup_api

logger = logging.getLogger(__name__)

# prefix="/api" keeps all graph endpoints under /api/ like the rest of the backend
router = APIRouter(prefix="/api", tags=["Knowledge Graph"])

# In-memory progress tracking for running dedup jobs (keyed by workspace_id)
_dedup_progress: dict[str, dict] = {}

def _get_env_path() -> str:
    """Resolve the .env file path."""
    backend_root = Path(__file__).resolve().parent.parent.parent
    env_file = backend_root / ".env"
    if env_file.exists():
        return str(env_file)
    project_root = backend_root.parent
    return str(project_root / ".env")


def _save_dedup_log(workspace_id: str, threshold: float, apply_merge: bool, result: dict = None, error: str = None) -> Path:
    """Save dedup run result to a JSON log file."""
    log_dir = Path(__file__).resolve().parent.parent.parent / "logs" / "semantic_dedup"
    log_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    mode = "apply" if apply_merge else "dry"
    filename = f"{ts}_{workspace_id}_t{threshold:.2f}_{mode}.json"

    payload = {
        "timestamp": datetime.now().isoformat(),
        "workspace_id": workspace_id,
        "threshold": threshold,
        "apply_merge": apply_merge,
        "error": error,
        "result": result,
    }
    log_path = log_dir / filename
    log_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Semantic dedup log saved: %s", log_path)
    return log_path


async def dedup_queue_worker():
    """Background worker: poll dedup_queue for pending jobs, process sequentially."""
    logger.info("Dedup queue worker started — polling every 5s")
    while True:
        try:
            # 1. Atomically claim the oldest pending job
            async with engine.begin() as conn:
                row = await conn.execute(sqlalchemy.text(
                    "UPDATE dedup_queue SET status='running', started_at=NOW() "
                    "WHERE id = (SELECT id FROM dedup_queue WHERE status='pending' "
                    "ORDER BY created_at LIMIT 1) RETURNING *"
                ))
                job = row.fetchone()

            if not job:
                await asyncio.sleep(5)
                continue

            # 2. Acquire workspace lock
            if not await acquire_workspace_lock(job.workspace_id, "dedup"):
                # Workspace busy with another operation, revert job to pending
                async with engine.begin() as conn:
                    await conn.execute(sqlalchemy.text(
                        "UPDATE dedup_queue SET status='pending', started_at=NULL "
                        "WHERE id = :id"
                    ), {"id": job.id})
                logger.info("Dedup worker: workspace %s busy, retrying later", job.workspace_id)
                await asyncio.sleep(10)
                continue

            # 3. Run dedup engine
            try:
                logger.info("Dedup worker: processing job %s for workspace %s", job.id, job.workspace_id)
                env_path = _get_env_path()

                # Progress callback — updates in-memory dict for polling
                # run_llm_dedup_api calls: progress_callback(step=N, step_name="...", current=X, total=Y)
                # Total steps is 7 (hardcoded in kg_dedup_semantic_name.py)
                def _progress_cb(step: int, step_name: str, current: int = 0, total: int = 0, **_kwargs):
                    _dedup_progress[job.workspace_id] = {
                        "step": step,
                        "total_steps": 7,
                        "step_name": step_name,
                        "current": current,
                        "total": total,
                    }

                result = await run_llm_dedup_api(
                    workspace=job.workspace_id,
                    env_path=env_path,
                    threshold=job.threshold,
                    apply=job.apply_merge,
                    progress_callback=_progress_cb,
                )
                # 4. Mark completed + store result
                result_json = json.dumps(result, ensure_ascii=False, default=str) if result else None
                async with engine.begin() as conn:
                    await conn.execute(sqlalchemy.text(
                        "UPDATE dedup_queue SET status='completed', completed_at=NOW(), "
                        "result_json = :rj WHERE id = :id"
                    ), {"id": job.id, "rj": result_json})
                _save_dedup_log(job.workspace_id, job.threshold, job.apply_merge, result=result)
                logger.info("Dedup worker: job %s completed", job.id)

            except Exception as e:
                # 5. Mark failed
                logger.error("Dedup worker: job %s failed: %s", job.id, e, exc_info=True)
                async with engine.begin() as conn:
                    await conn.execute(sqlalchemy.text(
                        "UPDATE dedup_queue SET status='failed', completed_at=NOW(), "
                        "error = :err WHERE id = :id"
                    ), {"id": job.id, "err": str(e)[:500]})
                _save_dedup_log(job.workspace_id, job.threshold, job.apply_merge, error=str(e))

            finally:
                _dedup_progress.pop(job.workspace_id, None)
                release_workspace_lock(job.workspace_id)

            await asyncio.sleep(2)

        except Exception as e:
            logger.error("Dedup queue worker error: %s", e, exc_info=True)
            await asyncio.sleep(10)


@router.get("/graphs")
async def get_knowledge_graph(
    request: Request,
    label: str = Query(
        default="*",
        description="Entity label to start traversal from. Use '*' to include all entities.",
    ),
    max_depth: int = Query(
        default=3,
        ge=1,
        le=10,
        description="Maximum BFS depth from starting node.",
    ),
    max_nodes: int = Query(
        default=1000,
        ge=1,
        le=5000,
        description="Maximum number of nodes to return.",
    ),
) -> dict:
    """
    Query knowledge graph for a specific entity label (or all entities with '*').

    Returns subgraph as { nodes: [...], edges: [...], is_truncated: bool }.
    Backend uses BFS traversal up to max_depth hops.
    When node count exceeds max_nodes, closest/highest-degree nodes are prioritized.

    Response shape:
    {
      "nodes": [{"id": str, "labels": [str], "properties": {...}}, ...],
      "edges": [{"id": str, "source": str, "target": str, "type": str, "properties": {...}}, ...],
      "is_truncated": bool
    }
    """
    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")
        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)
        rag = await get_rag_for_workspace(workspace_id)
        # get_knowledge_graph is an async method on ExtendedLightRAG (inherits LightRAG)
        result = await rag.get_knowledge_graph(
            node_label=label,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
        # rag.get_knowledge_graph() returns a Pydantic model (KnowledgeGraph),
        # not a plain dict. FastAPI validates -> dict strictly, so we convert here.
        if isinstance(result, dict):
            return result
        return result.model_dump()

    except AttributeError as exc:
        # Method doesn't exist on this LightRAG version
        logger.error("get_knowledge_graph method not found: %s", exc)
        raise HTTPException(
            status_code=501,
            detail="Knowledge graph query not supported by the current LightRAG version.",
        ) from exc

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error("Error in get_knowledge_graph: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    

@router.get("/graph/label/popular")
async def get_popular_labels(
    request: Request,
    limit: int = Query(
        default=50,
        ge=1,
        le=500,
        description="Maximum number of labels to return.",
    ),
) -> dict:
    """
    Return the most popular entity labels sorted by degree (connection count).

    Primary: calls rag.chunk_entity_relation_graph.get_popular_labels(limit)
    Fallback: shallow graph query (*) + extract unique labels from nodes

    Response shape: { "labels": [str, ...] }
    """
    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")
        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)
        rag = await get_rag_for_workspace(workspace_id)
        graph_storage = rag.chunk_entity_relation_graph

        # STEP 1: Try native method first (available in Neo4JStorage / NetworkXStorage)
        if hasattr(graph_storage, "get_popular_labels"):
            labels = await graph_storage.get_popular_labels(limit)
            return {"labels": labels}

        # STEP 2: Fallback — shallow BFS query and extract unique node labels
        logger.info("get_popular_labels not available, falling back to shallow graph query")
        graph_data = await rag.get_knowledge_graph(
            node_label="*",
            max_depth=1,
            max_nodes=limit * 3,
        )

        # graph_data may be a dict or a dataclass depending on LightRAG version
        nodes = (
            graph_data.get("nodes", [])
            if isinstance(graph_data, dict)
            else getattr(graph_data, "nodes", [])
        )

        seen: set[str] = set()
        labels: list[str] = []
        for node in nodes:
            node_labels = (
                node.get("labels", [])
                if isinstance(node, dict)
                else getattr(node, "labels", [])
            )
            label = node_labels[0] if node_labels else None
            if label and label not in seen:
                seen.add(label)
                labels.append(label)
                if len(labels) >= limit:
                    break

        return {"labels": labels}

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error("Error in get_popular_labels: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/graph/label/search")
async def search_labels(
    request: Request,
    q: str = Query(
        default="",
        description="Search query string (case-insensitive substring match).",
    ),
    limit: int = Query(
        default=50,
        ge=1,
        le=200,
        description="Maximum number of results to return.",
    ),
) -> dict:
    """
    Search entity labels by keyword string (fuzzy/substring match).

    Primary: calls rag.chunk_entity_relation_graph.search_labels(q, limit)
    Fallback: shallow graph query (*) + filter labels by q.lower()

    Response shape: { "labels": [str, ...] }
    """
    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")
        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)
        rag = await get_rag_for_workspace(workspace_id)
        graph_storage = rag.chunk_entity_relation_graph

        # STEP 1: Try native search method first
        if hasattr(graph_storage, "search_labels"):
            labels = await graph_storage.search_labels(q, limit)
            return {"labels": labels}

        # STEP 2: Fallback — shallow query + Python-side string filter
        logger.info("search_labels not available, falling back to shallow query + filter")
        graph_data = await rag.get_knowledge_graph(
            node_label="*",
            max_depth=1,
            max_nodes=500,
        )

        nodes = (
            graph_data.get("nodes", [])
            if isinstance(graph_data, dict)
            else getattr(graph_data, "nodes", [])
        )

        q_lower = q.lower()
        seen: set[str] = set()
        labels: list[str] = []
        for node in nodes:
            node_labels = (
                node.get("labels", [])
                if isinstance(node, dict)
                else getattr(node, "labels", [])
            )
            label = node_labels[0] if node_labels else None
            if label and label not in seen:
                # Match: empty query returns all, non-empty filters by substring
                if not q_lower or q_lower in label.lower():
                    seen.add(label)
                    labels.append(label)
                    if len(labels) >= limit:
                        break

        return {"labels": labels}

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error("Error in search_labels: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc



@router.get("/graphs/nx")
async def get_nx_knowledge_graph(
    request: Request,
    label: str = Query(
        default="*",
        description="Entity label to start from. Use '*' for all entities.",
    ),
    max_depth: int = Query(
        default=3,
        ge=1,
        le=10,
        description="Maximum BFS depth from starting node.",
    ),
    max_nodes: int = Query(
        default=500,
        ge=1,
        le=2000,
        description="Maximum nodes. Capped lower than /graphs for analytics perf.",
    ),
) -> dict:
    """
    Query knowledge graph và trả về dữ liệu NetworkX node_link_data format.

    Khác với /api/graphs, endpoint này:
    1. Build networkx.Graph từ LightRAG data
    2. Tính degree_centrality và community detection (greedy modularity)
    3. Serialize bằng json_graph.node_link_data(G, edges='links')
       → Format tương thích trực tiếp với D3.js force simulation

    Response shape (node_link_data format):
    {
      "directed": false,
      "multigraph": false,
      "graph": {},
      "nodes": [
        {
          "id": "EntityName",
          "label": "EntityName",
          "entity_type": "PERSON",
          "description": "...",
          "community": 2,
          "degree_centrality": 0.15,
          "degree": 5,
          "name": "EntityName"
        }
      ],
      "links": [
        {
          "source": "EntityA",
          "target": "EntityB",
          "weight": 1.5,
          "keywords": "CEO, founder"
        }
      ],
      "is_truncated": false
    }
    """
    import math
    import networkx as nx
    from networkx.readwrite import json_graph

    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")
        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)
        rag = await get_rag_for_workspace(workspace_id)

        # ── STEP 1: Lấy raw data từ LightRAG ────────────────────────
        result = await rag.get_knowledge_graph(
            node_label=label,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
        raw: dict = result if isinstance(result, dict) else result.model_dump()

        # ── STEP 2: Build NetworkX Graph ─────────────────────────────
        # Dùng nx.Graph (undirected) vì LightRAG knowledge graph
        # thường không phân biệt hướng rõ ràng ở mức visualization
        G: nx.Graph = nx.Graph()

        for node in raw.get("nodes", []):
            node_id: str = node["id"]
            props: dict = node.get("properties", {})
            labels_list: list = node.get("labels", [])
            # label: tên hiển thị = label[0] hoặc fallback sang id
            display_label: str = labels_list[0] if labels_list else node_id

            G.add_node(
                node_id,
                label=display_label,
                entity_type=props.get("entity_type", ""),
                description=props.get("description", ""),
                # name: D3 tooltip dùng field này (khớp với NetworkX guide)
                name=display_label,
            )

        for edge in raw.get("edges", []):
            source: str = edge["source"]
            target: str = edge["target"]
            edge_props: dict = edge.get("properties", {})

            # Chỉ add edge nếu cả 2 nodes tồn tại (guard cho dữ liệu bẩn)
            if G.has_node(source) and G.has_node(target) and source != target:
                G.add_edge(
                    source,
                    target,
                    weight=float(edge_props.get("weight", 1.0)),
                    keywords=edge_props.get("keywords", ""),
                )

        # ── STEP 3: NetworkX Analytics ───────────────────────────────
        # Guard: skip analytics nếu graph rỗng
        node_count: int = len(G.nodes())

        if node_count > 0:
            # Degree (số cạnh mỗi node có)
            degrees: dict[str, int] = dict(G.degree())

            # Degree centrality: normalized về [0, 1]
            # degree_centrality[v] = degree[v] / (n - 1)
            deg_centrality: dict[str, float] = nx.degree_centrality(G)

            # Community detection: greedy modularity maximization
            # Tìm nhóm nodes liên kết chặt với nhau
            communities: dict[str, int] = {}
            try:
                from networkx.algorithms import community as nx_community

                comm_list = list(
                    nx_community.greedy_modularity_communities(G, weight="weight")
                )
                for comm_id, comm_set in enumerate(comm_list):
                    for comm_node in comm_set:
                        communities[comm_node] = comm_id
            except Exception as comm_err:
                logger.warning("Community detection failed, using degree clusters: %s", comm_err)
                # Fallback: group by degree quartile (0–3)
                max_deg: int = max(degrees.values()) if degrees else 1
                for n_id, deg in degrees.items():
                    quartile: int = min(3, math.floor((deg / max(max_deg, 1)) * 4))
                    communities[n_id] = quartile
        else:
            degrees = {}
            deg_centrality = {}
            communities = {}

        # ── STEP 4: Enrich node attributes ─────────────────────────
        # Ghi analytics vào node attributes để json_graph serialize luôn
        for node_id in G.nodes():
            G.nodes[node_id]["community"] = communities.get(node_id, 0)
            G.nodes[node_id]["degree_centrality"] = deg_centrality.get(node_id, 0.0)
            G.nodes[node_id]["degree"] = degrees.get(node_id, 0)

        # ── STEP 5: Serialize sang node_link_data (D3 compatible) ───
        # edges="links" → D3 dùng "links" key (không phải "edges")
        # Đây là format chuẩn trong NetworkX guide cho D3 integration
        data: dict = json_graph.node_link_data(G, edges="links")

        # Thêm metadata từ LightRAG response
        data["is_truncated"] = raw.get("is_truncated", False)

        return data

    except AttributeError as exc:
        logger.error("get_knowledge_graph method not found: %s", exc)
        raise HTTPException(
            status_code=501,
            detail="Knowledge graph query not supported by current LightRAG version.",
        ) from exc

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error("Error in get_nx_knowledge_graph: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc




@router.get("/entity/details")
async def get_entity_details(
    request: Request,
    label: str = Query(
        ...,
        description="Entity label to fetch full details for (exact match).",
        min_length=1,
    ),
) -> dict:
    """
    Lấy chi tiết đầy đủ của một entity: type, description, source_id,
    file_path (nếu có), danh sách related entities và relationships.

    Dùng BFS depth=1 từ entity label đã cho.

    Response shape:
    {
      "entity": {
        "name": str,
        "type": str,
        "description": str,
        "source_id": str,
        "file_path": str | null
      },
      "related_entities": [
        {
          "name": str,
          "type": str,
          "descriptions": [str]
        }
      ],
      "relationships": [
        {
          "from": str,
          "to": str,
          "description": str,
          "weight": float,
          "keywords": [str]
        }
      ]
    }
    """
    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")
        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)
        rag = await get_rag_for_workspace(workspace_id)

        # ── STEP 1: Query subgraph với depth=1 ─────────────────────────────
        # max_depth=1 chỉ lấy direct neighbors — đủ cho detail panel
        # max_nodes=500 để tránh quá tải khi entity có nhiều relations
        # get_knowledge_graph với node_label=label có mục đích là BFS traversal — tìm tất cả nodes và edges trong
        # vùng lân cận của node đó, không phải chỉ trả về thông tin của một node đơn lẻ.
        result = await rag.get_knowledge_graph(
            node_label=label,
            max_depth=1,
            max_nodes=500,
        )
#   get_knowledge_graph(node_label="Elon Musk", max_depth=1)

#   Kết quả trả về:
#   nodes = [
#       "Elon Musk",   ← điểm xuất phát (label)
#       "Tesla",       ← neighbor depth 1
#       "SpaceX",      ← neighbor depth 1
#       "OpenAI",      ← neighbor depth 1
#   ]
#   edges = [
#       Elon Musk → Tesla
#       Elon Musk → SpaceX
#       Elon Musk → OpenAI
#   ]

#   label chỉ là điểm xuất phát của BFS, không phải filter. LightRAG dùng nó để biết bắt đầu từ đâu trong   
#   graph, sau đó trả về toàn bộ subgraph xung quanh điểm đó.

#           {
#       "nodes": [
#           {"id": "Elon Musk", "properties": {"entity_type": "PERSON", ...}},  # ← node chính
#           {"id": "Tesla", "properties": {"entity_type": "ORGANIZATION", ...}},  # ← neighbor                        {"id": "SpaceX", "properties": {"entity_type": "ORGANIZATION", ...}}, # ← neighbor
#       ],                                                                                                  
#       "edges": [...]
#   }

# => Chính vì thế mà cần STEP 2 để lấy node chính giống với label, bởi vì node chính hiên tại nằm lẫn trong label.

        # Normalize về dict (LightRAG có thể trả Pydantic model hoặc dict)
        raw: dict = result if isinstance(result, dict) else result.model_dump()

        nodes: list = raw.get("nodes", [])
        edges: list = raw.get("edges", [])

        # ── STEP 2: Build id→name map và tìm entity node chính ────────────
        # Neo4JStorage: node["id"] = internal element ID tail (e.g. 179).
        # node["labels"] = Neo4j type labels (["base","concept"]) — KHÔNG phải tên entity.
        # Entity name thực nằm ở properties.entity_id.
        id_to_name: dict = {}
        for node in nodes:
            nd: dict = node if isinstance(node, dict) else node.model_dump()
            nid = nd.get("id", "")
            np_: dict = nd.get("properties", {})
            name_val: str = np_.get("entity_id", "") or str(nid)
            if nid is not None and nid != "":
                id_to_name[nid] = name_val

        entity_node: dict | None = None
        entity_node_id = None  # internal ID dùng để filter edges
        for node in nodes:
            nd: dict = node if isinstance(node, dict) else node.model_dump()
            np_: dict = nd.get("properties", {})
            node_name: str = np_.get("entity_id", "") or str(nd.get("id", ""))
            if node_name == label:
                entity_node = nd
                entity_node_id = nd.get("id", "")
                break

        # Guard: trả 404 nếu không tìm thấy entity trong graph
        if entity_node is None:
            raise HTTPException(
                status_code=404,
                detail=f"Entity '{label}' not found in knowledge graph.",
            )
        entity_props: dict = entity_node.get("properties", {})

        # ── STEP 3: Parse source_id & file_path ────────────────────────────
        # source_id có thể là pipe-separated: "chunk-abc<SEP>chunk-xyz"
        # Lấy chunk ID đầu tiên làm primary source_id
        # source_id trong LightRAG node properties là chunk ID
        raw_source_id: str = entity_props.get("source_id", "") or ""
        primary_source_id: str = raw_source_id.split("<SEP>")[0].strip()

        # Thử resolve file_path từ text_chunks storage
        # LightRAG text_chunks lưu: {content, full_doc_id, file_path, ...}
        file_path: str | None = None
        if primary_source_id and hasattr(rag, "text_chunks"):
            try:
                # get chunk by chunk id (primary_source_id) để lấy file_path, chunk đc chunk ra từ file nào
                chunk_data = await rag.text_chunks.get_by_id(primary_source_id)
                if chunk_data and isinstance(chunk_data, dict):
                    # Thử các key phổ biến mà LightRAG dùng cho file path
                    file_path = (
                        chunk_data.get("file_path")
                        or chunk_data.get("filename")
                        or chunk_data.get("source")
                    )
            except Exception as chunk_err:
                # File path lookup là best-effort — không throw nếu fail
                logger.debug("Could not resolve file_path for chunk %s: %s", primary_source_id, chunk_err)

        # ── STEP 4: Build related_entities từ neighbor nodes ───────────────
        # Neighbor nodes = tất cả nodes NGOẠI TRỪ entity chính
        related_entities: list[dict] = []
        for node in nodes:
            node_dict: dict = node if isinstance(node, dict) else node.model_dump()
            node_props: dict = node_dict.get("properties", {})
            neighbor_name: str = node_props.get("entity_id", "") or str(node_dict.get("id", ""))

            # Bỏ qua entity chính
            if neighbor_name == label:
                continue

            node_description: str = node_props.get("description", "") or ""

            # descriptions: list of strings (có thể mở rộng sau cho multi-description)
            descriptions: list[str] = [node_description] if node_description else []

            related_entities.append({
                "name": neighbor_name,
                "type": node_props.get("entity_type", "UNKNOWN") or "UNKNOWN",
                "descriptions": descriptions,
            })

        # ── STEP 5: Build relationships từ edges ───────────────────────────
        # Lấy tất cả edges có source hoặc target là entity chính.
        # edges dùng internal node ID (numeric) cho source/target,
        # nên filter theo entity_node_id, sau đó resolve về entity name qua id_to_name.
        relationships: list[dict] = []
        for edge in edges:
            edge_dict: dict = edge if isinstance(edge, dict) else edge.model_dump()
            edge_source = edge_dict.get("source", "")
            edge_target = edge_dict.get("target", "")

            # Chỉ lấy edges liên quan đến entity chính (dùng internal ID)
            if edge_source != entity_node_id and edge_target != entity_node_id:
                continue

            edge_props: dict = edge_dict.get("properties", {})
            raw_keywords: str = edge_props.get("keywords", "") or ""

            # Parse keywords: "assignment,role" → ["assignment", "role"]
            keywords: list[str] = [
                kw.strip()
                for kw in raw_keywords.split(",")
                if kw.strip()
            ]

            # Resolve internal IDs → entity names cho from/to
            from_name: str = id_to_name.get(edge_source, str(edge_source))
            to_name: str = id_to_name.get(edge_target, str(edge_target))

            relationships.append({
                "from": from_name,
                "to": to_name,
                "description": edge_props.get("description", "") or "",
                "weight": float(edge_props.get("weight", 1.0) or 1.0),
                "keywords": keywords,
            })

        # ── STEP 6: Build và return response ───────────────────────────────
        return {
            "entity": {
                "name": label,
                "type": entity_props.get("entity_type", "UNKNOWN") or "UNKNOWN",
                "description": entity_props.get("description", "") or "",
                "source_id": primary_source_id,
                "file_path": file_path,
            },
            "related_entities": related_entities,
            "relationships": relationships,
        }

    except HTTPException:
        # Re-raise HTTP exceptions trực tiếp (404 entity not found)
        raise

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error("Error in get_entity_details for label='%s': %s", label, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/entities")
async def list_entities(request: Request) -> dict:
    """
    Lấy danh sách tất cả entities trong knowledge graph.

    Dùng cho sidebar listing trong Sanitize Data tab.
    Fetch toàn bộ entities (không paginate ở backend — client tự paginate).

    Response shape:
    {
      "entities": [
        {
          "name": str,
          "type": str,
          "description": str,
          "is_orphan": bool,
          "relation_count": int
        }
      ],
      "total": int
    }
    """
    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")
        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)
        rag = await get_rag_for_workspace(workspace_id)

        # ── STEP 1: Lấy toàn bộ graph với max_nodes lớn ────────────────────
        # max_depth=1 + label="*": đủ để lấy tất cả nodes và edges của chúng
        # max_nodes=10000: đủ cho hầu hết knowledge graphs thực tế
        result = await rag.get_knowledge_graph(
            node_label="*",
            max_depth=1,
            max_nodes=10000,
        )
        raw: dict = result if isinstance(result, dict) else result.model_dump()

        nodes: list = raw.get("nodes", [])
        edges: list = raw.get("edges", [])

        # ── STEP 2: Tính degree (relation_count) cho mỗi node ──────────────
        # Đếm số edges có source hoặc target = node id
        degree_map: dict[str, int] = {}
        for edge in edges:
            edge_dict: dict = edge if isinstance(edge, dict) else edge.model_dump()
            src: str = edge_dict.get("source", "")
            tgt: str = edge_dict.get("target", "")
            if src:
                degree_map[src] = degree_map.get(src, 0) + 1
            if tgt:
                degree_map[tgt] = degree_map.get(tgt, 0) + 1

        # ── STEP 3: Build entity list từ nodes ─────────────────────────────
        entities: list[dict] = []
        for node in nodes:
            node_dict: dict = node if isinstance(node, dict) else node.model_dump()
            node_id = node_dict.get("id", "")
            if node_id is None or node_id == "":
                continue

            # Neo4JStorage: node["id"] là internal element ID (e.g. "4:uuid:179" → 179).
            # node["labels"] là Neo4j type labels (["base","concept"]) — KHÔNG phải entity name.
            # Entity name thực sự nằm ở properties.entity_id.
            props: dict = node_dict.get("properties", {})
            entity_name: str = props.get("entity_id", "") or str(node_id)
            if not entity_name:
                continue

            relation_count: int = degree_map.get(node_id, 0)

            entities.append({
                "name": entity_name,
                "type": props.get("entity_type", "UNKNOWN") or "UNKNOWN",
                "description": props.get("description", "") or "",
                "is_orphan": relation_count == 0,
                "relation_count": relation_count,
            })

        # Sắp xếp theo relation_count giảm dần (entity quan trọng lên đầu)
        entities.sort(key=lambda e: e["relation_count"], reverse=True)

        return {"entities": entities, "total": len(entities)}

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error("Error in list_entities: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    


# ── Merge Endpoint ──────────────────────────────────────────────────────────

def _sanitize_for_json(obj):
    """
    Recursively convert non-JSON-serializable types (e.g. numpy.ndarray, numpy scalars)
    to Python native types so Pydantic/FastAPI can serialize the response.
    LightRAG's get_entity_info() may include embedding vectors as numpy arrays.
    """
    import numpy as np

    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    return obj


@router.post("/graph/entities/merge")
async def merge_entities(request: Request, body: EntityMergeRequest) -> dict:
    """
    Merge nhiều source entities vào một target entity trong Knowledge Graph.

    LightRAG thực hiện toàn bộ logic:
    - Validate source entities tồn tại trong KG
    - Merge entity attributes (description: concat, type: keep_first, source_id: join_unique)
    - Collect + remap tất cả edges từ sources → target
    - Drop self-loops (source–source edges trở thành target–target)
    - Deduplicate duplicate relations (merge attributes của chúng)
    - Update KG: upsert target node + remapped edges, delete source nodes + edges
    - Update Entity VDB và Relationship VDB vectors
    - Update entity_chunks và relation_chunks KV tracking (nếu có)
    - Persist tất cả storages đồng thời (asyncio.gather)

    Returns:
        200: { "status": "success", "message": "...", "data": merged_entity_info }
        400: Source entity không tồn tại trong KG (ValueError)
        500: Lỗi storage hoặc LightRAG chưa hỗ trợ amerge_entities
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    if not await acquire_workspace_lock(workspace_id, "merging"):
        raise HTTPException(429, detail="Workspace busy with another operation")

    try:
        rag = await get_rag_for_workspace(workspace_id)

        # Delegate toàn bộ merge logic cho LightRAG
        # amerge_entities() xử lý distributed locking, validation, storage updates
        result = await rag.amerge_entities(
            source_entities=body.entities_to_change,
            target_entity=body.entity_to_change_into,
        )

        # LightRAG's get_entity_info() may return embedding vectors as numpy.ndarray.
        # Sanitize before handing to FastAPI/Pydantic which cannot serialize numpy types.
        safe_result = _sanitize_for_json(result) if result is not None else None

        return {
            "status": "success",
            "message": (
                f"Successfully merged {len(body.entities_to_change)} "
                f"entities into '{body.entity_to_change_into}'"
            ),
            "data": safe_result,
        }

    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve)) from ve

    except AttributeError as ae:
        logger.error("amerge_entities not available on rag instance: %s", ae)
        raise HTTPException(
            status_code=501,
            detail="Merge entities not supported by current LightRAG version.",
        ) from ae

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error("Error in merge_entities: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    finally:
        release_workspace_lock(workspace_id)


# ── Semantic Dedup Endpoints ─────────────────────────────────────────────────

@router.post("/graph/semantic-dedup")
async def start_semantic_dedup(request: Request, body: SemanticDedupRequest) -> dict:
    """
    Submit a semantic dedup job to the persistent queue.

    Returns immediately with job_id. Background worker picks up pending jobs.
    Poll GET /api/graph/semantic-dedup/status to track progress.
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    # Check if workspace already has pending/running dedup
    async with engine.begin() as conn:
        row = await conn.execute(sqlalchemy.text(
            "SELECT id, status FROM dedup_queue "
            "WHERE workspace_id = :ws AND status IN ('pending','running') "
            "LIMIT 1"
        ), {"ws": workspace_id})
        existing = row.fetchone()

    if existing:
        raise HTTPException(429, detail=f"Workspace already has {existing.status} dedup job")

    # Insert new job into dedup_queue
    async with engine.begin() as conn:
        result = await conn.execute(sqlalchemy.text(
            "INSERT INTO dedup_queue (workspace_id, threshold, apply_merge, status) "
            "VALUES (:ws, :th, :ap, 'pending') RETURNING id"
        ), {"ws": workspace_id, "th": body.threshold, "ap": body.apply_merge})
        job_id = result.fetchone()[0]

    mode = "APPLY" if body.apply_merge else "DRY RUN"
    logger.info(
        "Semantic dedup queued: workspace=%s, threshold=%.2f, mode=%s, job_id=%s",
        workspace_id, body.threshold, mode, job_id,
    )
    return {
        "status": "queued",
        "job_id": job_id,
        "workspace_id": workspace_id,
        "message": f"Semantic dedup queued ({mode}, threshold={body.threshold:.2f}).",
    }


@router.get("/graph/semantic-dedup/status")
async def get_semantic_dedup_status(request: Request) -> dict:
    """
    Poll the current dedup job status for this workspace.

    Returns format expected by frontend:
    { running: bool, finished: bool, error: str|null, result: dict|null, progress: dict|null }
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    async with engine.begin() as conn:
        row = await conn.execute(sqlalchemy.text(
            "SELECT id, status, created_at, started_at, completed_at, error, result_json "
            "FROM dedup_queue WHERE workspace_id = :ws "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"ws": workspace_id})
        job = row.fetchone()

    if not job:
        return {"running": False, "finished": False, "error": None, "result": None, "progress": None}

    is_running = job.status in ("pending", "running")
    is_finished = job.status == "completed"
    is_failed = job.status == "failed"

    # Parse stored result JSON
    result = None
    if job.result_json:
        try:
            result = json.loads(job.result_json) if isinstance(job.result_json, str) else job.result_json
        except (json.JSONDecodeError, TypeError):
            pass

    # Get in-memory progress for running jobs
    progress = _dedup_progress.get(workspace_id) if is_running else None

    return {
        "running": is_running,
        "finished": is_finished,
        "error": job.error if is_failed else None,
        "result": result,
        "progress": progress,
    }


@router.post("/graph/semantic-dedup/cancel")
async def cancel_semantic_dedup(request: Request) -> dict:
    """
    Cancel a pending or running semantic dedup job for this workspace.
    """
    workspace_id = request.headers.get("X-Workspace-Id", "").strip()
    if not workspace_id:
        raise HTTPException(400, "Missing X-Workspace-Id header")

    async with engine.begin() as conn:
        result = await conn.execute(sqlalchemy.text(
            "UPDATE dedup_queue SET status = 'cancelled', completed_at = NOW() "
            "WHERE workspace_id = :ws AND status IN ('pending','running') "
            "RETURNING id"
        ), {"ws": workspace_id})
        cancelled = result.fetchone()

    if not cancelled:
        return {"status": "no_job", "message": "No active dedup job to cancel"}

    # Release workspace lock if it was held by the dedup worker
    release_workspace_lock(workspace_id)
    logger.info("Semantic dedup cancelled: workspace=%s, job_id=%s", workspace_id, cancelled.id)
    return {"status": "cancelled", "job_id": cancelled.id}
