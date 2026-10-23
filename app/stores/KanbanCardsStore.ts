import { action, computed, runInAction } from "mobx";
import invariant from "invariant";
import KanbanCard from "~/models/KanbanCard";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";
import type { AnalyzeImpactItem, AnalyzeImpactResult } from "~/components/Kanban/types";
import type { SelectedDocumentChange } from "~/components/Kanban/UpdateDocumentModal";

/**
 * Store for managing Kanban cards.
 */
export default class KanbanCardsStore extends Store<KanbanCard> {
  apiEndpoint = "kanban.cards";

  private _implementingCards = new Set<string>();

  // MAX_CONCURRENT phải khớp với _claude_semaphore = asyncio.Semaphore(3) trong backend/rag_state.py
  private static readonly MAX_CONCURRENT = 3;
  private _implementQueue: Array<{ cardId: string; resolve: () => void }> = [];
  private _activeImplementCount = 0;

  constructor(rootStore: RootStore) {
    super(rootStore, KanbanCard);
  }

  /**
   * Returns cards sorted by index, excluding deleted items.
   */
  @computed
  get orderedData(): KanbanCard[] {
    return Array.from(this.data.values())
      .filter(card => !card.deletedAt)
      .sort((a, b) => {
        const aIdx = a.index || "";
        const bIdx = b.index || "";
        // Use simple string comparison for fractional-index (ASCII-based)
        if (aIdx < bIdx) {
          return -1;
        }
        if (aIdx > bIdx) {
          return 1;
        }
        return 0;
      });
  }

  /**
   * Move a card to a new position or list.
   *
   * @param cardId - The card id to move.
   * @param listId - Optional new list id.
   * @param index - The new index position.
   */
  @action
  move = async (cardId: string, listId: string | undefined, index: string) => {
    const res = await client.post("/kanban.cards.update", {
      id: cardId,
      listId,
      index,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };


  /**
   * Update the priority of a card.
   *
   * @param cardId - The card id.
   * @param priority - The priority value (Blocked, Critical, High, Medium) or null to clear.
   */
  @action
  updatePriority = async (cardId: string, priority: string | null) => {
    const res = await client.post("/kanban.cards.update", {
      id: cardId,
      priority,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  /**
   * Add a member to a card.
   *
   * @param cardId - The card id.
   * @param userId - The user id to add.
   */
  @action
  addMember = async (cardId: string, userId: string) => {
    const res = await client.post("/kanban.cards.addMember", { cardId, userId });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  /**
   * Remove a member from a card.
   *
   * @param cardId - The card id.
   * @param userId - The user id to remove.
   */
  @action
  removeMember = async (cardId: string, userId: string) => {
    const res = await client.post("/kanban.cards.removeMember", { cardId, userId });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  /**
   * Update the due date of a card.
   *
   * @param cardId - The card id.
   * @param dueDate - The new due date, or null to clear.
   */
  @action
  updateDueDate = async (cardId: string, dueDate: Date | null) => {
    const res = await client.post("/kanban.cards.update", {
      id: cardId,
      dueDate: dueDate ? dueDate.toISOString() : null,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  /**
   * Fetch activity events for a card.
   *
   * @param cardId - The card id.
   * @returns the list of activity events.
   */
  @action
  fetchActivities = async (cardId: string) => {
    try {
      const res = await client.post("/kanban.cards.activities", { cardId });
      return res?.data || [];
    } catch (_error) {
      // Return empty array if endpoint doesn't exist yet
      return [];
    }
  };

  /**
   * Add a related document to a card.
   *
   * @param cardId - The card id.
   * @param documentId - The document id to link.
   */
  @action
  addRelatedDocument = async (cardId: string, documentId: string) => {
    const res = await client.post("/kanban.cards.addRelatedDocument", {
      cardId,
      documentId,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  /**
   * Remove a related document from a card.
   *
   * @param cardId - The card id.
   * @param documentId - The document id to unlink.
   */
  @action
  removeRelatedDocument = async (cardId: string, documentId: string) => {
    const res = await client.post("/kanban.cards.removeRelatedDocument", {
      cardId,
      documentId,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  /**
   * Add a comment to a card.
   *
   * @param cardId - The card id.
   * @param comment - The comment text.
   * @param parentId - Optional parent comment id for replies.
   * @param attachmentIds - Optional array of attachment IDs.
   */
  @action
  addComment = async (cardId: string, comment: string, parentId?: string, attachmentIds?: string[]) => {
    const res = await client.post("/kanban.cards.addComment", {
      cardId,
      comment,
      parentId,
      attachmentIds: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  @action
  implement = async (cardId: string): Promise<void> => {
    const card = this.get(cardId);
    if (!card) {
      return;
    }

    // In-memory guard to prevent double-click
    if (this._implementingCards.has(cardId)) {
      return;
    }
    this._implementingCards.add(cardId);

    // Nếu hết slot (≥ MAX_CONCURRENT đang chạy) → xếp hàng, hiển thị "Queue #N"
    if (this._activeImplementCount >= KanbanCardsStore.MAX_CONCURRENT) {
      await new Promise<void>((resolve) => {
        this._implementQueue.push({ cardId, resolve });
        runInAction(() => {
          card.implementStatus = "queued";
          card.queuePosition = this._implementQueue.length;
          card.implementError = null;
        });
      });
      // Promise resolved → có slot trống → tiếp tục gọi API
    }

    // Đã có slot — cập nhật UI và gọi API
    this._activeImplementCount++;
    runInAction(() => {
      card.implementStatus = "running";
      card.queuePosition = null;
      card.implementError = null;
      card.implementPreview = null;
    });
    this._refreshQueuePositions();

    try {
      // Server schedules background task and returns immediately with status "running"
      const res = await client.post("/kanban.cards.implement", { id: cardId }, { retry: false });
      invariant(res?.data, "Data should be available");
      this.add(res.data);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Implement failed";

      runInAction(() => {
        card.implementStatus = "failed";
        card.implementError = errorMessage;
      });

      throw error;
    } finally {
      this._implementingCards.delete(cardId);
      this._activeImplementCount--;
      this._dequeueNext();
    }
  };

  @action
  private _dequeueNext(): void {
    if (this._implementQueue.length === 0) {
      return;
    }
    if (this._activeImplementCount >= KanbanCardsStore.MAX_CONCURRENT) {
      return;
    }
    const next = this._implementQueue.shift();
    if (!next) {
      return;
    }
    this._refreshQueuePositions();
    next.resolve();
  }

  @action
  private _refreshQueuePositions(): void {
    this._implementQueue.forEach(({ cardId }, index) => {
      const card = this.get(cardId);
      if (card) {
        card.queuePosition = index + 1;
      }
    });
  }

  @action
  confirmImplement = async (
    cardId: string,
    deleteDocumentIds?: string[],
    createDocumentIndexes?: number[],
    updateDocumentChanges?: SelectedDocumentChange[]
  ): Promise<{ warnings?: string[] }> => {
    const res = await client.post(
      "/kanban.cards.implement.confirm",
      {
        id: cardId,
        ...(deleteDocumentIds !== undefined && { deleteDocumentIds }),
        ...(createDocumentIndexes !== undefined && { createDocumentIndexes }),
        ...(updateDocumentChanges !== undefined && { updateDocumentChanges }),
      },
      { retry: false }
    );
    invariant(res?.data, "Data should be available");
    this.add(res.data);
    if (res.reviewingList) {
      this.rootStore.kanbanLists.add(res.reviewingList);
    }
    return { warnings: res.warnings as string[] | undefined };
  };

  @action
  cancelImplement = async (cardId: string): Promise<void> => {
    const res = await client.post(
      "/kanban.cards.implement.cancel",
      { id: cardId },
      { retry: false }
    );
    invariant(res?.data, "Data should be available");
    this.add(res.data);
  };

  /**
   * Call Python /kanban/analyze-impact synchronously, persist result to DB,
   * and update the card in the local store.
   */
  @action
  analyzeImpact = async (cardId: string): Promise<AnalyzeImpactResult> => {
    const res = await client.post(
      "/kanban.cards.analyzeImpact",
      { id: cardId },
      { retry: false }
    );
    invariant(res?.data, "Data should be available");
    const result = res.data as AnalyzeImpactResult;
    const card = this.get(cardId);
    if (card) {
      card.impactAnalysis = result;
    }
    return result;
  };

  /**
   * Clear persisted impact analysis result from DB and local store.
   */
  @action
  clearImpactAnalysis = async (cardId: string): Promise<void> => {
    await client.post(
      "/kanban.cards.clearImpactAnalysis",
      { id: cardId },
      { retry: false }
    );
    const card = this.get(cardId);
    if (card) {
      card.impactAnalysis = null;
    }
  };

  /**
   * Overwrite the impacts list of an existing impact analysis result,
   * persisting to DB and updating the local store.
   */
  @action
  updateImpactAnalysis = async (
    cardId: string,
    impacts: AnalyzeImpactItem[]
  ): Promise<void> => {
    await client.post(
      "/kanban.cards.updateImpactAnalysis",
      { id: cardId, impacts },
      { retry: false }
    );
    const card = this.get(cardId);
    if (card?.impactAnalysis) {
      card.impactAnalysis = {
        hasImpacts: impacts.length > 0,
        impacts,
      };
    }
  };
}
