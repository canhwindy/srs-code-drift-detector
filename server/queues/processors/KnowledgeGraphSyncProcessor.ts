import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Document } from "@server/models";
import type { DocumentEvent, Event } from "@server/types";
import {
  buildSafeFilename,
  deleteFromKG,
  extractFilename,
  fetchKGDocuments,
  safeKGOperation,
  uploadToKG,
} from "@server/utils/knowledgeGraphSync";
import BaseProcessor from "./BaseProcessor";

/**
 * KnowledgeGraphSyncProcessor — Reacts to document update/delete events
 * and syncs the Knowledge Graph in real-time.
 *
 * When a document's status is "Approved" → ensure it exists in KG.
 * When a document's status is NOT "Approved" → remove it from KG if present.
 * When a document is deleted → remove it from KG if present.
 *
 * NOTE: The `status` field has @SkipChangeset, so event.changes does NOT
 * contain status info. We always check the document's current status and
 * compare with KG state.
 */
export default class KnowledgeGraphSyncProcessor extends BaseProcessor {
  static applicableEvents: Event["name"][] = [
    "documents.update",
    "documents.delete",
  ];

  async perform(event: DocumentEvent): Promise<void> {
    const pythonBackendUrl = env.PYTHON_BACKEND_URL;
    if (!pythonBackendUrl) {
      return;
    }

    const workspaceId = event.teamId;

    const document = await Document.findByPk(event.documentId, {
      paranoid: false,
      attributes: ["id", "title", "text", "status", "deletedAt"],
    });

    if (!document) {
      return;
    }

    const filename = buildSafeFilename(document.id, document.title);

    if (event.name === "documents.delete" || document.deletedAt) {
      // Document was deleted — remove from KG if it exists
      await this.removeFromKGIfExists(pythonBackendUrl, filename, workspaceId);
      return;
    }

    if (document.status === "Approved") {
      // Document is Approved — ensure it exists in KG
      await this.ensureInKG(pythonBackendUrl, document, filename, workspaceId);
    } else {
      // Document is NOT Approved — remove from KG if it exists
      await this.removeFromKGIfExists(pythonBackendUrl, filename, workspaceId);
    }
  }

  /**
   * Upload document to KG if it doesn't already exist.
   */
  private async ensureInKG(
    baseUrl: string,
    document: Document,
    filename: string,
    workspaceId: string
  ): Promise<void> {
    const kgDocs = await safeKGOperation("fetchKGDocuments", () =>
      fetchKGDocuments(baseUrl, workspaceId)
    );
    if (!kgDocs) {
      return;
    }

    const exists = kgDocs.some(
      (d) => extractFilename(d.file_path) === filename
    );
    if (exists) {
      return;
    }

    const result = await safeKGOperation("uploadToKG", () =>
      uploadToKG(
        baseUrl,
        `# ${document.title}\n\n${document.text ?? ""}`,
        filename,
        workspaceId
      )
    );

    if (result === "success") {
      Logger.info(
        "processor",
        `KnowledgeGraphSync: uploaded "${filename}" to KG`
      );
    }
  }

  /**
   * Remove document from KG if it exists there.
   */
  private async removeFromKGIfExists(
    baseUrl: string,
    filename: string,
    workspaceId: string
  ): Promise<void> {
    const kgDocs = await safeKGOperation("fetchKGDocuments", () =>
      fetchKGDocuments(baseUrl, workspaceId)
    );
    if (!kgDocs) {
      return;
    }

    const kgDoc = kgDocs.find(
      (d) => extractFilename(d.file_path) === filename
    );
    if (!kgDoc) {
      return;
    }

    await safeKGOperation("deleteFromKG", () =>
      deleteFromKG(baseUrl, [kgDoc.id], workspaceId)
    );

    Logger.info(
      "processor",
      `KnowledgeGraphSync: removed "${filename}" from KG`
    );
  }
}
