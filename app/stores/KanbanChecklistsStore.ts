import { action, observable } from "mobx";
import invariant from "invariant";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";

interface ChecklistItem {
  id: string;
  title: string;
  isCompleted: boolean;
  index: string;
  checklistId: string;
  completedById?: string | null;
  completedAt?: string | null;
}

interface Checklist {
  id: string;
  title: string;
  index: string;
  cardId: string;
  items: ChecklistItem[];
  completedCount: number;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Store for managing Kanban checklists.
 */
export default class KanbanChecklistsStore {
  rootStore: RootStore;

  @observable
  data: Map<string, Checklist> = new Map();

  @observable
  isSaving = false;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
  }

  /**
   * Get checklists for a specific card.
   *
   * @param cardId - The card id.
   * @returns the checklists for the card.
   */
  getByCardId(cardId: string): Checklist[] {
    return Array.from(this.data.values())
      .filter(checklist => checklist.cardId === cardId)
      .sort((a, b) => a.index.localeCompare(b.index));
  }

  /**
   * Get a checklist by id.
   *
   * @param id - The checklist id.
   * @returns the checklist.
   */
  get(id: string): Checklist | undefined {
    return this.data.get(id);
  }

  /**
   * Create a new checklist.
   *
   * @param cardId - The card id.
   * @param title - The checklist title.
   * @returns the created checklist.
   */
  @action
  create = async (cardId: string, title: string): Promise<Checklist> => {
    this.isSaving = true;
    try {
      const res = await client.post("/kanban.checklists.create", { cardId, title });
      invariant(res?.data, "Data should be available");

      this.data.set(res.data.id, res.data);
      return res.data;
    } finally {
      this.isSaving = false;
    }
  };

  /**
   * Update a checklist.
   *
   * @param id - The checklist id.
   * @param title - The new title.
   * @returns the updated checklist.
   */
  @action
  update = async (id: string, title: string): Promise<Checklist> => {
    this.isSaving = true;
    try {
      const res = await client.post("/kanban.checklists.update", { id, title });
      invariant(res?.data, "Data should be available");

      this.data.set(res.data.id, res.data);
      return res.data;
    } finally {
      this.isSaving = false;
    }
  };

  /**
   * Delete a checklist.
   *
   * @param id - The checklist id.
   */
  @action
  delete = async (id: string): Promise<void> => {
    this.isSaving = true;
    try {
      await client.post("/kanban.checklists.delete", { id });
      this.data.delete(id);
    } finally {
      this.isSaving = false;
    }
  };

  /**
   * Add an item to a checklist.
   *
   * @param checklistId - The checklist id.
   * @param title - The item title.
   * @returns the created item.
   */
  @action
  addItem = async (checklistId: string, title: string): Promise<ChecklistItem> => {
    this.isSaving = true;
    try {
      const res = await client.post("/kanban.checklistItems.create", { checklistId, title });
      invariant(res?.data, "Data should be available");

      // Update the checklist in store
      const checklist = this.data.get(checklistId);
      if (checklist) {
        checklist.items.push(res.data);
        checklist.totalCount++;
        this.data.set(checklistId, { ...checklist });
      }

      return res.data;
    } finally {
      this.isSaving = false;
    }
  };

  /**
   * Update a checklist item.
   *
   * @param itemId - The item id.
   * @param updates - The fields to update.
   * @returns the updated item.
   */
  @action
  updateItem = async (itemId: string, updates: { title?: string; isCompleted?: boolean }): Promise<ChecklistItem> => {
    this.isSaving = true;
    try {
      const res = await client.post("/kanban.checklistItems.update", { id: itemId, ...updates });
      invariant(res?.data, "Data should be available");

      // Update the checklist in store
      const checklist = Array.from(this.data.values()).find(c =>
        c.items.some(item => item.id === itemId)
      );

      if (checklist) {
        const itemIndex = checklist.items.findIndex(item => item.id === itemId);
        if (itemIndex !== -1) {
          const wasCompleted = checklist.items[itemIndex].isCompleted;
          checklist.items[itemIndex] = res.data;

          // Update completion count
          if (res.data.isCompleted && !wasCompleted) {
            checklist.completedCount++;
          } else if (!res.data.isCompleted && wasCompleted) {
            checklist.completedCount--;
          }

          this.data.set(checklist.id, { ...checklist });
        }
      }

      return res.data;
    } finally {
      this.isSaving = false;
    }
  };

  /**
   * Delete a checklist item.
   *
   * @param itemId - The item id.
   */
  @action
  deleteItem = async (itemId: string): Promise<void> => {
    this.isSaving = true;
    try {
      await client.post("/kanban.checklistItems.delete", { id: itemId });

      // Update the checklist in store
      const checklist = Array.from(this.data.values()).find(c =>
        c.items.some(item => item.id === itemId)
      );

      if (checklist) {
        const item = checklist.items.find(i => i.id === itemId);
        checklist.items = checklist.items.filter(item => item.id !== itemId);
        checklist.totalCount--;
        if (item?.isCompleted) {
          checklist.completedCount--;
        }
        this.data.set(checklist.id, { ...checklist });
      }
    } finally {
      this.isSaving = false;
    }
  };

  /**
   * Fetch all checklists for a card.
   *
   * @param cardId - The card id.
   * @returns the checklists for the card.
   */
  @action
  fetchForCard = async (cardId: string): Promise<Checklist[]> => {
    try {
      const res = await client.post("/kanban.checklists.list", { cardId });
      if (res?.data) {
        res.data.forEach((checklist: Checklist) => {
          this.data.set(checklist.id, checklist);
        });
        return res.data;
      }
      return [];
    } catch (_error) {
      // Return empty array if endpoint doesn't exist yet
      return [];
    }
  };

  /**
   * Set checklist data directly.
   *
   * @param checklists - The checklists to set.
   */
  @action
  setData = (checklists: Checklist[]) => {
    checklists.forEach(checklist => {
      this.data.set(checklist.id, checklist);
    });
  };

  /**
   * Clear all data.
   */
  @action
  clear = () => {
    this.data.clear();
  };
}
