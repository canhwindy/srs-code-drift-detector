import env from "@server/env";
import Logger from "@server/logging/Logger";
import { KanbanCard, KanbanList, KanbanBoard, User, Event, Document } from "@server/models";
import { BaseTask, TaskPriority } from "./base/BaseTask";

type Props = {
  cardId: string;
  userId: string;
  ip: string;
};

/**
 * Background task that calls the Python AI backend to generate an implement
 * preview for a Kanban card, stores the result in the DB, and emits a
 * WebSocket event so the frontend can update the button state.
 */
export default class KanbanImplementTask extends BaseTask<Props> {
  public async perform({ cardId, userId, ip }: Props): Promise<void> {
    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
            },
          ],
        },
        { model: User, as: "createdBy" },
        { model: User, as: "members" },
      ],
    });

    if (!card) {
      Logger.warn(`KanbanImplementTask: card ${cardId} not found`);
      return;
    }

    if (card.implementStatus !== "running") {
      Logger.warn(
        `KanbanImplementTask: card ${cardId} status is ${card.implementStatus}, expected 'running'. Skipping.`
      );
      return;
    }

    const pythonBackendUrl = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

    // Fetch document content for related documents
    const relatedDocsMeta = card.relatedDocuments ?? [];
    const relatedDocIds = relatedDocsMeta.map((d) => d.id);

    const relatedDocTexts = relatedDocIds.length > 0
      ? await Document.findAll({
        where: { id: relatedDocIds },
        attributes: ["id", "urlId", "text"],
      })
      : [];

    // Build map of id → text for quick lookup
    const docTextMap = new Map(relatedDocTexts.map((d) => [d.id, d.text]));

    const relatedDocsWithContent = relatedDocsMeta.map((d) => ({
      id: d.id,
      title: d.title,
      url: d.url,
      content: docTextMap.get(d.id) ?? null,
    }));

    const teamId = card.list?.board?.teamId;

    // ─── Impact Analysis Items từ DB ───────────────────────────────────────
    const impactAnalysisResult = card.impactAnalysis as {
      hasImpacts: boolean;
      impacts: Array<{
        affectedDocumentId: string | null;
        affectedDocumentTitle: string;
        affectedDocumentUrl: string | null;
        description: string;
      }>;
    } | null;

    const rawImpacts = impactAnalysisResult?.impacts ?? [];

    // Tìm các impact item có affectedDocumentId hợp lệ nhưng chưa có trong docTextMap
    const impactDocIdsToFetch = rawImpacts
      .map((i) => i.affectedDocumentId)
      .filter((id): id is string => !!id && !docTextMap.has(id));

    // Batch fetch một lần nếu cần
    if (impactDocIdsToFetch.length > 0) {
      const extraDocs = await Document.findAll({
        where: { id: impactDocIdsToFetch },
        attributes: ["id", "text"],
      });
      extraDocs.forEach((d) => docTextMap.set(d.id, d.text ?? null));
    }

    // Build impact items payload
    const impactAnalysisItems = rawImpacts.map((item) => ({
      affected_document_id: item.affectedDocumentId ?? null,
      affected_document_title: item.affectedDocumentTitle,
      affected_document_url: item.affectedDocumentUrl ?? null,
      description: item.description,
      content: item.affectedDocumentId
        ? (docTextMap.get(item.affectedDocumentId) ?? null)
        : null,
    }));

    Logger.info(
      "task",
      `KanbanImplementTask: ${impactAnalysisItems.length} impact item(s) for card ${cardId}`
    );

    let aiResult: {
      action: string;
      documents_to_create: Array<{
        title: string;
        content: string;
        collection_id: string | null;
      }> | null;
      target_document_id: string | null;
      document_changes: Array<{
        document_id: string;
        document_title: string;
        changes_summary: string[];
        is_user_provided: boolean;
        text_edits?: Array<{
          old_string: string;
          new_string: string;
          description: string;
        }>;
      }> | null;
      delete_document_ids: string[] | null;
      delete_document_titles: string[] | null;
      reasoning: string;
    };

    try {
      const response = await fetch(`${pythonBackendUrl}/kanban/implement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Key": userId,
          ...(env.INTERNAL_API_SECRET
            ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
            : {}),
        },
        body: JSON.stringify({
          card_id: card.id,
          card_title: card.title,
          card_description: card.description,
          related_documents: card.relatedDocuments ?? [],
          related_documents_with_content: relatedDocsWithContent,
          impact_analysis_items: impactAnalysisItems,
          outline_user_id: userId,
          team_id: teamId ?? "",
        }),
        signal: AbortSignal.timeout(1000_000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let parsedError: { detail?: { error_code?: string; message?: string } | string } = {};
        try { parsedError = JSON.parse(errorBody); } catch { /* not JSON */ }
        const detail = parsedError.detail;
        if (detail && typeof detail === "object" && detail.error_code) {
          const err = new Error(detail.message ?? errorBody) as Error & { errorCode: string };
          err.errorCode = detail.error_code;
          throw err;
        }
        if (typeof detail === "string") {
          throw new Error(detail);
        }
        throw new Error(`Python backend error ${response.status}: ${errorBody}`);
      }

      aiResult = (await response.json()) as typeof aiResult;

    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "AI backend error";
      const errorCode = (error as Error & { errorCode?: string }).errorCode;
      Logger.warn(`KanbanImplementTask: AI call failed for card ${cardId}: ${errorMessage}`);

      const implementErrorPayload = errorCode
        ? JSON.stringify({ error_code: errorCode, message: errorMessage })
        : errorMessage;

      await KanbanCard.update(
        {
          implementStatus: "failed",
          implementError: implementErrorPayload,
          implementHistory: [
            ...(card.implementHistory ?? []),
            {
              at: new Date().toISOString(),
              status: "failed",
              error: errorMessage,
              userId,
            },
          ],
        },
        { where: { id: cardId } }
      );

      // Emit event so frontend can show the failed state
      if (teamId) {
        await Event.create({
          name: "kanban_cards.implement.failed",
          modelId: card.id,
          teamId,
          actorId: userId,
          ip,
        });
      }

      return;
    }

    // Store preview + update status
    const documentChanges = aiResult.document_changes?.map((c) => ({
      documentId: c.document_id,
      documentTitle: c.document_title,
      changesSummary: c.changes_summary,
      isUserProvided: c.is_user_provided,
      textEdits: c.text_edits?.map((e) => ({
        oldString: e.old_string,
        newString: e.new_string,
        description: e.description,
      })) ?? [],
    })) ?? null;

    // Enrich delete document URLs from DB
    let deleteDocumentUrls: (string | null)[] | undefined;
    const deleteDocumentIds = aiResult.delete_document_ids ?? null;
    const deleteDocumentTitles = aiResult.delete_document_titles ?? null;

    if (aiResult.action === "delete_document" && deleteDocumentIds && deleteDocumentIds.length > 0) {
      const deleteDocs = await Document.findAll({
        where: { id: deleteDocumentIds },
        attributes: ["id", "title", "urlId"],
      });

      deleteDocumentUrls = deleteDocumentIds.map((id) => {
        const doc = deleteDocs.find((d) => d.id === id);
        if (!doc) { return null; }
        return Document.getPath({ title: doc.title, urlId: doc.urlId });
      });
    }

    const documentsToCreate = (aiResult.documents_to_create ?? []).map((d) => ({
      title: d.title,
      content: d.content,
      collectionId: d.collection_id ?? null,
    }));

    await card.update({
      implementStatus: "preview_ready",
      implementPreview: {
        action: (aiResult.action as "create_document" | "update_document" | "delete_document" | "none") || "none",
        documentsToCreate: documentsToCreate.length > 0 ? documentsToCreate : undefined,
        targetDocumentId: aiResult.target_document_id ?? null,
        collectionId: null,
        reasoning: aiResult.reasoning ?? "",
        documentChanges,
        ...(deleteDocumentIds !== null && { deleteDocumentIds }),
        ...(deleteDocumentTitles !== null && { deleteDocumentTitles }),
        ...(deleteDocumentUrls !== undefined && { deleteDocumentUrls }),
      },
      implementError: null,
    });

    if (!teamId) {
      Logger.warn(`KanbanImplementTask: could not determine teamId for card ${cardId}`);
      return;
    }

    // Trigger WebSocket notification
    await Event.create({
      name: "kanban_cards.implement.preview_ready",
      modelId: card.id,
      teamId,
      actorId: userId,
      ip,
    });

    Logger.info(
      "task",
      `KanbanImplementTask: preview ready for card ${cardId}, action=${aiResult.action}`
    );
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Normal,
    };
  }

  public async onFailed({ cardId, userId }: Props): Promise<void> {
    await KanbanCard.update(
      {
        implementStatus: "failed",
        implementError: "Background implement task failed. Please try again.",
      },
      { where: { id: cardId } }
    );
    Logger.warn(`KanbanImplementTask: onFailed for card ${cardId} by user ${userId}`);
  }
}