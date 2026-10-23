import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import { getFileFromRequest } from "@server/utils/koa";
import validate from "@server/middlewares/validate";
import env from "@server/env";
import type { APIContext } from "@server/types";
import * as T from "./schema";

const router = new Router();

const PYTHON_URL = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

/**
 * Build headers to forward to Python backend.
 * Includes X-Internal-Secret for backend-to-backend auth.
 */
function buildPythonHeaders(
  userId: string,
  workspaceId: string
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Key": userId,
    "X-Workspace-Id": workspaceId,
    ...(env.INTERNAL_API_SECRET
      ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY ROUTES — Read-only graph data proxied from Python backend
// ─────────────────────────────────────────────────────────────────────────────

// graph.data.list
// POST /api/graph.data.list → GET python/api/graphs
router.post(
  "graph.data.list",
  auth(),
  validate(T.GraphDataListSchema),
  async (ctx: APIContext<T.GraphDataListReq>) => {
    const { user } = ctx.state.auth;
    const { label, max_depth, max_nodes } = ctx.input.body;
    const qs = new URLSearchParams({
      label: label ?? "*",
      max_depth: String(max_depth ?? 3),
      max_nodes: String(max_nodes ?? 1000),
    });

    const response = await fetch(`${PYTHON_URL}/api/graphs?${qs}`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Graph query failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.labels.popular
// POST /api/graph.labels.popular → GET python/api/graph/label/popular
router.post(
  "graph.labels.popular",
  auth(),
  validate(T.GraphLabelsPopularSchema),
  async (ctx: APIContext<T.GraphLabelsPopularReq>) => {
    const { user } = ctx.state.auth;
    const { limit } = ctx.input.body;
    const qs = new URLSearchParams({ limit: String(limit ?? 50) });

    const response = await fetch(
      `${PYTHON_URL}/api/graph/label/popular?${qs}`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Labels query failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.labels.search
// POST /api/graph.labels.search → GET python/api/graph/label/search
router.post(
  "graph.labels.search",
  auth(),
  validate(T.GraphLabelsSearchSchema),
  async (ctx: APIContext<T.GraphLabelsSearchReq>) => {
    const { user } = ctx.state.auth;
    const { q, limit } = ctx.input.body;
    const qs = new URLSearchParams({
      q: q ?? "",
      limit: String(limit ?? 50),
    });

    const response = await fetch(
      `${PYTHON_URL}/api/graph/label/search?${qs}`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Label search failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.data.nx
// POST /api/graph.data.nx → GET python/api/graphs/nx
router.post(
  "graph.data.nx",
  auth(),
  validate(T.GraphDataNxSchema),
  async (ctx: APIContext<T.GraphDataNxReq>) => {
    const { user } = ctx.state.auth;
    const { label, max_depth, max_nodes } = ctx.input.body;
    const qs = new URLSearchParams({
      label: label ?? "*",
      max_depth: String(max_depth ?? 3),
      max_nodes: String(max_nodes ?? 500),
    });

    const response = await fetch(`${PYTHON_URL}/api/graphs/nx?${qs}`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "NX graph query failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.entities.details
// POST /api/graph.entities.details → GET python/api/entity/details
router.post(
  "graph.entities.details",
  auth(),
  validate(T.GraphEntitiesDetailsSchema),
  async (ctx: APIContext<T.GraphEntitiesDetailsReq>) => {
    const { user } = ctx.state.auth;
    const { label } = ctx.input.body;
    const qs = new URLSearchParams({ label });

    const response = await fetch(
      `${PYTHON_URL}/api/entity/details?${qs}`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Entity details failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.entities.list
// POST /api/graph.entities.list → GET python/api/entities
router.post(
  "graph.entities.list",
  auth(),
  validate(T.GraphEntitiesListSchema),
  async (ctx: APIContext<T.GraphEntitiesListReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(`${PYTHON_URL}/api/entities`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Entities list failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION ROUTES — Write operations proxied to Python backend
// ─────────────────────────────────────────────────────────────────────────────

// graph.entities.merge
// POST /api/graph.entities.merge → POST python/api/graph/entities/merge
router.post(
  "graph.entities.merge",
  auth(),
  validate(T.GraphEntitiesMergeSchema),
  async (ctx: APIContext<T.GraphEntitiesMergeReq>) => {
    const { user } = ctx.state.auth;
    const { entities_to_change, entity_to_change_into } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/graph/entities/merge`,
      {
        method: "POST",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({ entities_to_change, entity_to_change_into }),
        signal: AbortSignal.timeout(300_000),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Merge failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.dedup.start
// POST /api/graph.dedup.start → POST python/api/graph/semantic-dedup
router.post(
  "graph.dedup.start",
  auth(),
  validate(T.GraphDedupStartSchema),
  async (ctx: APIContext<T.GraphDedupStartReq>) => {
    const { user } = ctx.state.auth;
    const { threshold, apply_merge } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/graph/semantic-dedup`,
      {
        method: "POST",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({ threshold, apply_merge }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Dedup start failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.dedup.status
// POST /api/graph.dedup.status → GET python/api/graph/semantic-dedup/status
router.post(
  "graph.dedup.status",
  auth(),
  validate(T.GraphDedupStatusSchema),
  async (ctx: APIContext<T.GraphDedupStatusReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(
      `${PYTHON_URL}/api/graph/semantic-dedup/status`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Dedup status failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.dedup.cancel
// POST /api/graph.dedup.cancel → POST python/api/graph/semantic-dedup/cancel
router.post(
  "graph.dedup.cancel",
  auth(),
  validate(T.GraphDedupCancelSchema),
  async (ctx: APIContext<T.GraphDedupCancelReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(
      `${PYTHON_URL}/api/graph/semantic-dedup/cancel`,
      {
        method: "POST",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Dedup cancel failed"
      );
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT ROUTES — Document management proxied to Python backend
// ─────────────────────────────────────────────────────────────────────────────

// graph.documents.scan
// POST /api/graph.documents.scan → POST python/api/documents/scan
router.post(
  "graph.documents.scan",
  auth(),
  validate(T.GraphDocumentsScanSchema),
  async (ctx: APIContext<T.GraphDocumentsScanReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(`${PYTHON_URL}/api/documents/scan`, {
      method: "POST",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Scan failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.documents.delete
// POST /api/graph.documents.delete → DELETE python/api/documents/delete
router.post(
  "graph.documents.delete",
  auth(),
  validate(T.GraphDocumentsDeleteSchema),
  async (ctx: APIContext<T.GraphDocumentsDeleteReq>) => {
    const { user } = ctx.state.auth;
    const { doc_ids, delete_file } = ctx.input.body;

    const response = await fetch(`${PYTHON_URL}/api/documents/delete`, {
      method: "DELETE",
      headers: buildPythonHeaders(user.id, user.teamId),
      body: JSON.stringify({ doc_ids, delete_file }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Delete failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.documents.clear
// POST /api/graph.documents.clear → DELETE python/api/documents/clear
router.post(
  "graph.documents.clear",
  auth(),
  validate(T.GraphDocumentsClearSchema),
  async (ctx: APIContext<T.GraphDocumentsClearReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(`${PYTHON_URL}/api/documents/clear`, {
      method: "DELETE",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Clear failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.pipeline.status
// POST /api/graph.pipeline.status → GET python/api/pipeline/status
router.post(
  "graph.pipeline.status",
  auth(),
  validate(T.GraphPipelineStatusSchema),
  async (ctx: APIContext<T.GraphPipelineStatusReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(`${PYTHON_URL}/api/pipeline/status`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Pipeline status failed"
      );
    }

    ctx.body = await response.json();
  }
);

// graph.documents.upload
// POST /api/graph.documents.upload → POST python/api/upload-document (multipart)
router.post(
  "graph.documents.upload",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const file = getFileFromRequest(ctx.request);

    if (!file) {
      ctx.throw(400, "No file provided");
      return;
    }

    const fs = await import("fs");
    const fileBuffer = fs.readFileSync(file.filepath);
    const blob = new Blob([fileBuffer], { type: file.mimetype ?? "application/octet-stream" });

    // Dùng native FormData (Node.js 18+) — fetch tự set Content-Type + boundary đúng
    const fd = new FormData();
    fd.append("file", blob, file.originalFilename ?? "upload");

    // KHÔNG set Content-Type — để fetch tự generate boundary
    const headers: Record<string, string> = {
      "X-User-Key": user.id,
      "X-Workspace-Id": user.teamId,
      ...(env.INTERNAL_API_SECRET
        ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
        : {}),
    };

    const response = await fetch(`${PYTHON_URL}/api/upload-document`, {
      method: "POST",
      headers,
      body: fd,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Upload failed"
      );
    }

    // apiResponse middleware overwrites the `status` field with HTTP status code.
    // Rename Python's upload status to `upload_status` so the frontend can read it.
    const pyData = await response.json() as Record<string, unknown>;
    ctx.body = { ...pyData, upload_status: pyData["status"] };
  }
);

// graph.documents.list
// POST /api/graph.documents.list → GET python/api/documents
router.post(
  "graph.documents.list",
  auth(),
  validate(T.GraphDocumentsListSchema),
  async (ctx: APIContext<T.GraphDocumentsListReq>) => {
    const { user } = ctx.state.auth;
    const { status, search, page, page_size, sort_field, sort_direction } =
      ctx.input.body;

    const qs = new URLSearchParams({
      page: String(page ?? 1),
      page_size: String(page_size ?? 20),
      sort_field: sort_field ?? "updated_at",
      sort_direction: sort_direction ?? "desc",
    });
    if (status) {
      qs.set("status", status);
    }
    if (search) {
      qs.set("search", search);
    }

    const response = await fetch(`${PYTHON_URL}/api/documents?${qs}`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      ctx.throw(
        response.status >= 500 ? 502 : response.status,
        (err as Record<string, string>).detail ?? "Documents list failed"
      );
    }

    ctx.body = await response.json();
  }
);

export default router;
