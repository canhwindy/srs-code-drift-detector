import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Document } from "@server/models";
import {
  buildSafeFilename,
  deleteFromKG,
  extractFilename,
  fetchKGDocuments,
  safeKGOperation,
  uploadToKG,
} from "@server/utils/knowledgeGraphSync";
import { Minute } from "@shared/utils/time";
import { TaskPriority } from "./base/BaseTask";
import type { Props } from "./base/CronTask";
import { CronTask, TaskInterval } from "./base/CronTask";

/**
 * SyncKnowledgeGraphTask — Hourly full reconciliation between Outline DB
 * and the LightRAG Knowledge Graph.
 *
 * Ensures that:
 * 1. All documents with status "Approved" exist in KG
 * 2. KG .md documents that no longer match any Approved doc are removed
 *
 * This task acts as a safety net for the real-time
 * KnowledgeGraphSyncProcessor, catching any events that were missed.
 */
export default class SyncKnowledgeGraphTask extends CronTask {
  public async perform({ limit, partition }: Props) {
    const pythonBackendUrl = env.PYTHON_BACKEND_URL;
    if (!pythonBackendUrl) {
      Logger.debug(
        "task",
        "SyncKnowledgeGraph: PYTHON_BACKEND_URL not configured, skipping"
      );
      return;
    }

    Logger.info("task", "SyncKnowledgeGraph: starting hourly reconciliation");

    // 1. Fetch all Approved documents from Outline DB (include teamId for per-workspace sync)
    const approvedDocs = await Document.scope("withoutState").findAll({
      where: {
        status: "Approved",
        ...this.getPartitionWhereClause("id", partition),
      },
      attributes: ["id", "title", "text", "teamId"],
      limit,
    });

    // 2. Group approved docs by teamId (workspace) and reconcile each separately
    const docsByTeam = new Map<string, Document[]>();
    for (const doc of approvedDocs) {
      const teamId = doc.teamId;
      if (!docsByTeam.has(teamId)) {
        docsByTeam.set(teamId, []);
      }
      docsByTeam.get(teamId)!.push(doc);
    }

    let totalAdded = 0;
    let totalRemoved = 0;

    for (const [teamId, teamDocs] of docsByTeam) {
      // 3. Fetch KG documents for this workspace
      const kgDocs = await safeKGOperation("fetchKGDocuments", () =>
        fetchKGDocuments(pythonBackendUrl, teamId)
      );
      if (!kgDocs) {
        Logger.warn(
          "SyncKnowledgeGraph: failed to fetch KG documents for workspace, skipping",
          { teamId }
        );
        continue;
      }

      // 4. Build lookup maps
      const approvedFilenames = new Map<string, Document>();
      for (const doc of teamDocs) {
        approvedFilenames.set(buildSafeFilename(doc.id, doc.title), doc);
      }

      const kgFilenameToId = new Map<string, string>();
      for (const kgDoc of kgDocs) {
        const fname = extractFilename(kgDoc.file_path);
        kgFilenameToId.set(fname, kgDoc.id);
      }

      // 5. ADD: Approved docs missing from KG
      for (const [filename, doc] of approvedFilenames) {
        if (!kgFilenameToId.has(filename)) {
          const result = await safeKGOperation("uploadToKG", () =>
            uploadToKG(
              pythonBackendUrl,
              `# ${doc.title}\n\n${doc.text ?? ""}`,
              filename,
              teamId
            )
          );
          if (result === "success") {
            totalAdded++;
          }
        }
      }

      // 6. REMOVE: KG .md docs that don't match any Approved doc
      //    Only remove .md files (auto-sync convention).
      //    PDFs, DOCXs etc. uploaded manually are safe.
      for (const [filename, kgDocId] of kgFilenameToId) {
        if (filename.endsWith(".md") && !approvedFilenames.has(filename)) {
          const result = await safeKGOperation("deleteFromKG", () =>
            deleteFromKG(pythonBackendUrl, [kgDocId], teamId)
          );
          if (result !== null) {
            totalRemoved++;
          }
        }
      }
    }

    Logger.info(
      "task",
      `SyncKnowledgeGraph: reconciliation complete — added ${totalAdded}, removed ${totalRemoved}, approved total ${approvedDocs.length}, workspaces ${docsByTeam.size}`
    );
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Background,
    };
  }

  public get cron() {
    return {
      interval: TaskInterval.Hour,
      partitionWindow: 15 * Minute.ms,
    };
  }
}
