import { Op, QueryTypes } from "sequelize";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Attachment } from "@server/models";
import { sequelize } from "@server/storage/database";
import { TaskPriority } from "./base/BaseTask";
import type { Props } from "./base/CronTask";
import { CronTask, TaskInterval } from "./base/CronTask";

/**
 * Finds and deletes "orphaned" attachments – attachments whose id is no longer
 * referenced in any document body or comment body.
 *
 * Runs hourly. The grace period (FILE_STORAGE_ORPHAN_CLEANUP_HOURS) gives users
 * time to undo before the file is permanently removed from storage.
 */
export default class CleanupOrphanedAttachmentsTask extends CronTask {
  public async perform({ limit }: Props) {
    const cleanupHours = env.FILE_STORAGE_ORPHAN_CLEANUP_HOURS;

    if (!cleanupHours || cleanupHours <= 0) {
      return;
    }

    const cutoffMs = cleanupHours * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - cutoffMs);

    Logger.info(
      "task",
      `Cleaning up orphaned attachments older than ${cleanupHours}h (cutoff: ${cutoff.toISOString()})…`
    );

    try {
      // --- Part 1: Attachments linked to a document ---
      const docOrphans = await sequelize.query<{ id: string }>(
        `
        SELECT a."id"
        FROM attachments a
        INNER JOIN documents d ON d."id" = a."documentId"
        WHERE a."documentId" IS NOT NULL
          AND a."expiresAt" IS NULL
          AND a."createdAt" < :cutoff
          AND d."text" NOT LIKE '%' || CAST(a."id" AS TEXT) || '%'
        LIMIT :limit
        `,
        {
          replacements: { cutoff: cutoff.toISOString(), limit },
          type: QueryTypes.SELECT,
        }
      );

      Logger.info("task", `Found ${docOrphans.length} orphaned document attachments`);

      // --- Part 2: Attachments with no documentId (comments, etc.) ---
      // These are orphaned if their id doesn't appear in any comment data
      // or any document text across the entire workspace.
      const noDocOrphans = await sequelize.query<{ id: string }>(
        `
        SELECT a."id"
        FROM attachments a
        WHERE a."documentId" IS NULL
          AND a."expiresAt" IS NULL
          AND a."createdAt" < :cutoff
          AND NOT EXISTS (
            SELECT 1 FROM documents d
            WHERE d."text" LIKE '%' || CAST(a."id" AS TEXT) || '%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM comments c
            WHERE CAST(c."data" AS TEXT) LIKE '%' || CAST(a."id" AS TEXT) || '%'
          )
        LIMIT :limit
        `,
        {
          replacements: { cutoff: cutoff.toISOString(), limit },
          type: QueryTypes.SELECT,
        }
      );

      Logger.info("task", `Found ${noDocOrphans.length} orphaned non-document attachments`);

      // Combine and delete
      const allOrphanIds = [
        ...docOrphans.map((o) => o.id),
        ...noDocOrphans.map((o) => o.id),
      ];

      if (allOrphanIds.length === 0) {
        Logger.info("task", "No orphaned attachments to clean up");
        return;
      }

      const attachments = await Attachment.findAll({
        where: { id: { [Op.in]: allOrphanIds } },
      });

      // destroy() triggers @BeforeDestroy hook → FileStorage.deleteFile()
      await Promise.all(attachments.map((a) => a.destroy()));

      Logger.info(
        "task",
        `Removed ${attachments.length} orphaned attachments from storage`
      );
    } catch (error) {
      Logger.error(
        "Failed to clean up orphaned attachments",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  public get cron() {
    return {
      interval: TaskInterval.Hour,
    };
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Background,
    };
  }
}
