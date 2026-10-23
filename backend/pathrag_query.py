"""
PathRAG: Path-based retrieval for LightRAG.

Adapted from https://github.com/BUPT-GAMMA/PathRAG
Replaces LightRAG's 1-hop edge retrieval with multi-hop path discovery (1-3 hops).

Instead of modifying the LightRAG library directly, this module monkey-patches
`lightrag.operate._find_most_related_edges_from_entities` at startup.

Usage (in rag_state.py or main.py):
    from pathrag_query import patch_lightrag_with_pathrag
    patch_lightrag_with_pathrag()
"""

import asyncio
import logging
from collections import defaultdict

import networkx as nx

from lightrag.base import BaseGraphStorage, QueryParam
from lightrag.constants import GRAPH_FIELD_SEP

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Neo4j subgraph extraction
# ---------------------------------------------------------------------------

async def _get_subgraph_for_entities(
    knowledge_graph_inst: BaseGraphStorage,
    entity_ids: list[str],
    max_hops: int = 3,
    max_subgraph_nodes: int = 500,
) -> list[tuple[str, str]]:
    """Extract a small subgraph within max_hops of the given entities.

    Accesses the Neo4JStorage driver directly to run an efficient Cypher query.
    Falls back to a Python-based BFS if the storage doesn't expose a Neo4j driver.
    """
    # Try Neo4j native Cypher (fast path)
    driver = getattr(knowledge_graph_inst, "_driver", None)
    database = getattr(knowledge_graph_inst, "_DATABASE", None)
    workspace = getattr(knowledge_graph_inst, "workspace", "default")

    if driver and database:
        return await _get_subgraph_cypher(
            driver, database, workspace, entity_ids, max_hops, max_subgraph_nodes
        )

    # Fallback: Python BFS using existing storage methods
    return await _get_subgraph_bfs(
        knowledge_graph_inst, entity_ids, max_hops, max_subgraph_nodes
    )


async def _get_subgraph_cypher(
    driver, database: str, workspace: str, entity_ids: list[str],
    max_hops: int, max_nodes: int,
) -> list[tuple[str, str]]:
    """Use Neo4j Cypher to extract subgraph efficiently."""
    # Determine workspace label (same logic as Neo4JStorage._get_workspace_label)
    workspace_label = f"LIGHTRAG_{workspace.upper()}"

    async with driver.session(database=database, default_access_mode="READ") as session:
        query = f"""
        // Step 1: Collect start nodes
        MATCH (start:`{workspace_label}`)
        WHERE start.entity_id IN $entity_ids
        WITH collect(DISTINCT start) AS starts
        // Step 2: Expand neighborhood
        CALL {{
            WITH starts
            UNWIND starts AS s
            MATCH path = (s)-[*1..{max_hops}]-(n:`{workspace_label}`)
            RETURN DISTINCT n
            LIMIT $max_nodes
        }}
        WITH collect(DISTINCT n) AS neighbors, starts
        // Step 3: Merge starts + neighbors into one list
        WITH starts + neighbors AS subgraph_nodes
        // Step 4: Get all edges between subgraph nodes
        UNWIND subgraph_nodes AS a
        MATCH (a)-[r]-(b)
        WHERE b IN subgraph_nodes AND a.entity_id IS NOT NULL AND b.entity_id IS NOT NULL
        RETURN DISTINCT a.entity_id AS source, b.entity_id AS target
        """
        result = await session.run(query, entity_ids=entity_ids, max_nodes=max_nodes)
        edges = []
        seen = set()
        async for record in result:
            src, tgt = record["source"], record["target"]
            if src and tgt and src != tgt:
                edge_key = tuple(sorted((src, tgt)))
                if edge_key not in seen:
                    seen.add(edge_key)
                    edges.append((src, tgt))
        await result.consume()

    logger.info(
        f"PathRAG subgraph (Cypher): {len(edges)} edges "
        f"from {len(entity_ids)} source entities (max_hops={max_hops})"
    )
    return edges


async def _get_subgraph_bfs(
    knowledge_graph_inst: BaseGraphStorage,
    entity_ids: list[str],
    max_hops: int,
    max_nodes: int,
) -> list[tuple[str, str]]:
    """Fallback: BFS using get_node_edges() for non-Neo4j backends."""
    visited = set(entity_ids)
    frontier = list(entity_ids)
    all_edges = []
    seen_edges = set()

    for hop in range(max_hops):
        if len(visited) >= max_nodes:
            break
        next_frontier = []
        edge_results = await asyncio.gather(
            *[knowledge_graph_inst.get_node_edges(nid) for nid in frontier]
        )
        for node_id, edges in zip(frontier, edge_results):
            if not edges:
                continue
            for src, tgt in edges:
                edge_key = tuple(sorted((src, tgt)))
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    all_edges.append((src, tgt))
                neighbor = tgt if src == node_id else src
                if neighbor not in visited and len(visited) < max_nodes:
                    visited.add(neighbor)
                    next_frontier.append(neighbor)
        frontier = next_frontier

    logger.info(
        f"PathRAG subgraph (BFS): {len(all_edges)} edges, "
        f"{len(visited)} nodes from {len(entity_ids)} source entities"
    )
    return all_edges


# ---------------------------------------------------------------------------
# PathRAG path discovery (DFS)
# ---------------------------------------------------------------------------

def _pathrag_find_paths(
    nx_graph: nx.Graph, target_nodes: list[str]
) -> tuple[dict, list, list, list]:
    """DFS to discover all paths (1-3 hops) between pairs of target nodes.

    Returns:
        result: dict (source, target) -> {"paths": [...], "edges": [...]}
        one_hop_paths, two_hop_paths, three_hop_paths
    """
    result = defaultdict(lambda: {"paths": [], "edges": set()})
    one_hop, two_hop, three_hop = [], [], []

    valid_targets = [n for n in target_nodes if nx_graph.has_node(n)]

    def dfs(current, target, path, depth):
        if depth > 3:
            return
        if current == target and depth > 0:
            result[(path[0], target)]["paths"].append(list(path))
            for u, v in zip(path[:-1], path[1:]):
                result[(path[0], target)]["edges"].add(tuple(sorted((u, v))))
            if depth == 1:
                one_hop.append(list(path))
            elif depth == 2:
                two_hop.append(list(path))
            elif depth == 3:
                three_hop.append(list(path))
            return
        if not nx_graph.has_node(current):
            return
        for neighbor in nx_graph.neighbors(current):
            if neighbor not in path:
                dfs(neighbor, target, path + [neighbor], depth + 1)

    for n1 in valid_targets:
        for n2 in valid_targets:
            if n1 != n2:
                dfs(n1, n2, [n1], 0)

    for key in result:
        result[key]["edges"] = list(result[key]["edges"])

    return dict(result), one_hop, two_hop, three_hop


# ---------------------------------------------------------------------------
# PathRAG BFS weighted scoring
# ---------------------------------------------------------------------------

def _pathrag_weight_paths(
    paths: list[list[str]],
    source: str,
    target: str,
    threshold: float = 0.3,
    alpha: float = 0.8,
) -> list[tuple[list[str], float]]:
    """BFS weighted path scoring.

    Assigns edge weights based on frequency, propagates with decay (alpha),
    filters below threshold.
    """
    if not paths:
        return []

    edge_weights = defaultdict(float)
    follow_dict: dict[str, set[str]] = {}

    for p in paths:
        for i in range(len(p) - 1):
            cur, nxt = p[i], p[i + 1]
            if cur not in follow_dict:
                follow_dict[cur] = set()
            follow_dict[cur].add(nxt)

    if source not in follow_dict:
        return []

    # Propagate weights through the path graph
    for neighbor in follow_dict[source]:
        edge_weights[(source, neighbor)] += 1 / len(follow_dict[source])

        if neighbor == target:
            continue

        if edge_weights[(source, neighbor)] > threshold and neighbor in follow_dict:
            for second in follow_dict[neighbor]:
                w = edge_weights[(source, neighbor)] * alpha / len(follow_dict[neighbor])
                edge_weights[(neighbor, second)] += w

                if second == target:
                    continue

                if edge_weights[(neighbor, second)] > threshold and second in follow_dict:
                    for third in follow_dict[second]:
                        w2 = edge_weights[(neighbor, second)] * alpha / len(follow_dict[second])
                        edge_weights[(second, third)] += w2

    # Score each path by average edge weight
    combined = []
    for p in paths:
        pw = sum(edge_weights.get((p[i], p[i + 1]), 0) for i in range(len(p) - 1))
        combined.append((p, pw / max(len(p) - 1, 1)))

    return combined


# ---------------------------------------------------------------------------
# Main replacement function
# ---------------------------------------------------------------------------

async def _find_most_related_edges_pathrag(
    node_datas: list[dict],
    query_param: QueryParam,
    knowledge_graph_inst: BaseGraphStorage,
    max_paths: int = 15,
) -> list[dict]:
    """PathRAG replacement for _find_most_related_edges_from_entities.

    1. Extracts a small subgraph (3-hop neighborhood) via Neo4j Cypher
    2. Builds a lightweight NetworkX graph from that subgraph
    3. Finds paths (1-3 hops) between query entities via DFS
    4. Weights paths using BFS frequency-based decay
    5. Builds natural language path descriptions
    6. Returns in the SAME dict format as the original function

    Auto-fallback to original 1-hop if anything fails.
    """
    # Use saved original function for fallback (avoids infinite recursion from monkey-patch)
    _original = _original_find_edges

    source_nodes = [dp["entity_name"] for dp in node_datas]

    if _original is None or len(source_nodes) < 2:
        from lightrag.operate import _find_most_related_edges_from_entities as _fallback
        return await _fallback(node_datas, query_param, knowledge_graph_inst)

    # Step 1: Extract subgraph
    try:
        subgraph_edges = await _get_subgraph_for_entities(
            knowledge_graph_inst, source_nodes, max_hops=3, max_subgraph_nodes=500
        )
    except Exception as e:
        logger.warning(f"PathRAG subgraph extraction failed: {e}, falling back to 1-hop")
        return await _original(node_datas, query_param, knowledge_graph_inst)

    if not subgraph_edges:
        logger.warning("PathRAG: empty subgraph, falling back to 1-hop")
        return await _original(node_datas, query_param, knowledge_graph_inst)

    # Step 2: Build small NetworkX graph
    G = nx.Graph()
    G.add_edges_from(subgraph_edges)
    G.add_nodes_from(source_nodes)

    logger.info(
        f"PathRAG: subgraph {G.number_of_nodes()} nodes, "
        f"{G.number_of_edges()} edges from {len(source_nodes)} source entities"
    )

    # Step 3: Find all paths between source entities
    path_result, one_hop, two_hop, three_hop = _pathrag_find_paths(G, source_nodes)

    if not path_result:
        logger.warning("PathRAG: no paths found, falling back to 1-hop")
        return await _original(node_datas, query_param, knowledge_graph_inst)

    # Step 4: Weight paths using BFS decay
    all_weighted = []
    for n1 in source_nodes:
        for n2 in source_nodes:
            if n1 != n2 and (n1, n2) in path_result:
                paths = path_result[(n1, n2)]["paths"]
                weighted = _pathrag_weight_paths(paths, n1, n2, threshold=0.3, alpha=0.8)
                all_weighted.extend(weighted)

    # Sort by weight, deduplicate
    all_weighted.sort(key=lambda x: x[1], reverse=True)
    seen = set()
    unique_paths = []
    for path, weight in all_weighted:
        pk = tuple(path)
        if pk not in seen:
            seen.add(pk)
            unique_paths.append((path, weight))

    # Mix in proportional 1/2/3-hop paths (PathRAG strategy)
    hop_mix = []
    if one_hop:
        hop_mix.extend(one_hop[: len(one_hop) // 2])
    if two_hop:
        hop_mix.extend(two_hop[: len(two_hop) // 2])
    if three_hop:
        hop_mix.extend(three_hop[: len(three_hop) // 2])

    final_paths = []
    final_seen = set()
    for path, weight in unique_paths[:max_paths]:
        pk = tuple(path)
        if pk not in final_seen:
            final_seen.add(pk)
            final_paths.append((path, weight))

    for path in hop_mix:
        if len(final_paths) >= max_paths:
            break
        pk = tuple(path)
        if pk not in final_seen:
            final_seen.add(pk)
            final_paths.append((path, 0.0))

    logger.info(
        f"PathRAG: {len(final_paths)} paths selected "
        f"(1-hop: {len(one_hop)}, 2-hop: {len(two_hop)}, 3-hop: {len(three_hop)})"
    )

    # Step 5: Build path descriptions in LightRAG-compatible format
    all_edges_data = await _build_path_descriptions(
        final_paths, knowledge_graph_inst
    )

    if not all_edges_data:
        logger.warning("PathRAG: no valid paths built, falling back to 1-hop")
        return await _original(node_datas, query_param, knowledge_graph_inst)

    logger.info(f"PathRAG: returning {len(all_edges_data)} path-based relations")
    return all_edges_data


async def _build_path_descriptions(
    final_paths: list[tuple[list[str], float]],
    knowledge_graph_inst: BaseGraphStorage,
) -> list[dict]:
    """Build NL path descriptions and return in LightRAG edge format.

    For each path, fetches node/edge data and constructs a description like:
    "The entity A is a TYPE(...) through edge(keyword) connects to B.
     The entity B is a TYPE(...) through edge(keyword) connects to C."
    """
    all_edges_data = []

    # Batch-collect all unique node/edge IDs needed
    all_node_ids = set()
    all_edge_pairs = []
    for path, _ in final_paths:
        for node_id in path:
            all_node_ids.add(node_id)
        for i in range(len(path) - 1):
            all_edge_pairs.append((path[i], path[i + 1]))

    # Batch fetch nodes
    all_node_ids = list(all_node_ids)
    try:
        nodes_dict = await knowledge_graph_inst.get_nodes_batch(all_node_ids)
    except Exception:
        # Fallback to individual fetches
        node_results = await asyncio.gather(
            *[knowledge_graph_inst.get_node(nid) for nid in all_node_ids]
        )
        nodes_dict = dict(zip(all_node_ids, node_results))

    # Batch fetch edges (try both directions)
    edges_dict = {}
    try:
        batch_pairs = [{"src": s, "tgt": t} for s, t in all_edge_pairs]
        edges_dict = await knowledge_graph_inst.get_edges_batch(batch_pairs)
    except Exception:
        pass

    # Fetch missing edges individually (try reverse direction)
    for src, tgt in all_edge_pairs:
        if (src, tgt) not in edges_dict or edges_dict[(src, tgt)] is None:
            edge = await knowledge_graph_inst.get_edge(src, tgt)
            if edge is None:
                edge = await knowledge_graph_inst.get_edge(tgt, src)
            if edge is not None:
                edges_dict[(src, tgt)] = edge

    # Build descriptions
    for path, weight in final_paths:
        parts = []
        path_keywords = []
        path_source_ids = []
        valid = True

        for i in range(len(path) - 1):
            src, tgt = path[i], path[i + 1]
            edge = edges_dict.get((src, tgt))
            src_node = nodes_dict.get(src)
            tgt_node = nodes_dict.get(tgt)

            if edge is None or src_node is None or tgt_node is None:
                valid = False
                break

            edge_kw = edge.get("keywords", "related")
            src_desc = (
                f"The entity {src} is a {src_node.get('entity_type', 'UNKNOWN')} "
                f"with the description({src_node.get('description', '')})"
            )
            parts.append(f"{src_desc} through edge({edge_kw}) connects to {tgt}")

            if edge.get("keywords"):
                path_keywords.append(edge["keywords"])
            if edge.get("source_id"):
                path_source_ids.append(edge["source_id"])

        if not valid or not parts:
            continue

        # Add final node description
        last_node = nodes_dict.get(path[-1])
        if last_node:
            parts.append(
                f"The entity {path[-1]} is a {last_node.get('entity_type', 'UNKNOWN')} "
                f"with the description({last_node.get('description', '')})"
            )

        all_edges_data.append({
            "src_tgt": (path[0], path[-1]),
            "description": ". ".join(parts),
            "weight": weight if weight > 0 else 1.0,
            "rank": len(all_edges_data),
            "keywords": GRAPH_FIELD_SEP.join(path_keywords) if path_keywords else "",
            "source_id": GRAPH_FIELD_SEP.join(path_source_ids) if path_source_ids else "",
            "path_hops": len(path) - 1,
            "path_nodes": path,
        })

    return all_edges_data


# ---------------------------------------------------------------------------
# Monkey-patch installer
# ---------------------------------------------------------------------------

_original_find_edges = None


def patch_lightrag_with_pathrag(enable: bool = True):
    """Monkey-patch LightRAG's operate module to use PathRAG path-based retrieval.

    Call this ONCE at startup (e.g., in main.py or rag_state.py).

    Args:
        enable: True to enable PathRAG, False to restore original behavior.
    """
    import lightrag.operate as operate_module

    global _original_find_edges

    if enable:
        # Save original function for fallback
        if _original_find_edges is None:
            _original_find_edges = operate_module._find_most_related_edges_from_entities

        operate_module._find_most_related_edges_from_entities = (
            _find_most_related_edges_pathrag
        )
        logger.info("PathRAG: monkey-patched LightRAG with path-based retrieval")
    else:
        if _original_find_edges is not None:
            operate_module._find_most_related_edges_from_entities = _original_find_edges
            logger.info("PathRAG: restored original 1-hop retrieval")
