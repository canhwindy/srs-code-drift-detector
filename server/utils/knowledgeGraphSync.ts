import Logger from "@server/logging/Logger";
import env from "@server/env";

/**
 * Type for a document returned by the LightRAG /api/documents endpoint.
 */
export interface KGDocument {
  id: string;
  file_path: string;
  status?: string;
  updated_at?: string;
}

interface KGDocumentsResponse {
  documents: KGDocument[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Build a safe filename from a document ID and title.
 * Format: `${docId}<#>${sanitizedTitle}.md`
 * Matches the client-side convention in useAutoSyncApproved.ts and useSyncCollection.ts.
 */
export function buildSafeFilename(docId: string, title: string): string {
  const sanitized =
    title
      .replace(/[/\\:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")
      .trim() || "untitled";

  const maxTitleLen = 200 - docId.length - 6;
  const truncated =
    sanitized.length > maxTitleLen ? sanitized.slice(0, maxTitleLen) : sanitized;

  return `${docId}<#>${truncated}.md`;
}

/**
 * Extract just the filename from a KG file_path.
 * KG file_path format: "/input_document/filename.md" or "filename.md"
 */
export function extractFilename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

/**
 * Fetch all documents from the LightRAG Knowledge Graph.
 * Paginates automatically if there are more than 1000 docs.
 */
export async function fetchKGDocuments(
  baseUrl: string,
  workspaceId: string
): Promise<KGDocument[]> {
  const allDocs: KGDocument[] = [];
  let page = 1;
  const pageSize = 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });

    const response = await fetch(`${baseUrl}/api/documents?${params}`, {
      headers: {
        "X-Workspace-Id": workspaceId,
        ...(env.INTERNAL_API_SECRET
          ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
          : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(
        `fetchKGDocuments failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as KGDocumentsResponse;
    allDocs.push(...data.documents);

    if (data.documents.length < pageSize) {
      break;
    }
    page++;
  }

  return allDocs;
}

/**
 * Upload a document to the LightRAG Knowledge Graph.
 * Uses Node.js FormData + Blob for multipart upload.
 */
export async function uploadToKG(
  baseUrl: string,
  markdownText: string,
  filename: string,
  workspaceId: string
): Promise<"success" | "duplicate" | "error"> {
  const blob = new Blob([markdownText], { type: "text/markdown" });
  const formData = new FormData();
  formData.append("file", blob, filename);

  const response = await fetch(`${baseUrl}/api/upload-document`, {
    method: "POST",
    headers: { "X-Workspace-Id": workspaceId },
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      (errorData as { detail?: string }).detail ||
        `Upload to KG failed: HTTP ${response.status}`
    );
  }

  const result = (await response.json()) as { status: string };
  return result.status as "success" | "duplicate" | "error";
}

/**
 * Delete one or more documents from the LightRAG Knowledge Graph.
 */
export async function deleteFromKG(
  baseUrl: string,
  docIds: string[],
  workspaceId: string
): Promise<void> {
  if (docIds.length === 0) {
    return;
  }

  const response = await fetch(`${baseUrl}/api/documents/delete`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({
      doc_ids: docIds,
      delete_file: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      (errorData as { detail?: string }).detail ||
        `Delete from KG failed: HTTP ${response.status}`
    );
  }
}

/**
 * Safely execute a KG operation with error handling and logging.
 */
export async function safeKGOperation<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    Logger.warn(`[KnowledgeGraphSync] ${operationName} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
