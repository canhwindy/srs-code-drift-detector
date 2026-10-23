import { action, computed } from "mobx";
import invariant from "invariant";
import KanbanList from "~/models/KanbanList";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";

/**
 * Store for managing Kanban lists.
 */
export default class KanbanListsStore extends Store<KanbanList> {
  apiEndpoint = "kanban.lists";

  constructor(rootStore: RootStore) {
    super(rootStore, KanbanList);
  }

  /**
   * Returns lists sorted by index, excluding deleted items.
   */
  @computed
  get orderedData(): KanbanList[] {
    return Array.from(this.data.values())
      .filter(list => !list.deletedAt)
      .sort((a, b) => {
        const aIdx = a.index || "";
        const bIdx = b.index || "";
        // Use simple string comparison for fractional-index (ASCII-based)
        if (aIdx < bIdx) { return -1; }
        if (aIdx > bIdx) { return 1; }
        return 0;
      });
  }

  /**
   * Move a list to a new position.
   *
   * @param listId - The list id to move.
   * @param index - The new index position.
   */
  @action
  move = async (listId: string, index: string) => {
    const res = await client.post("/kanban.lists.update", {
      id: listId,
      index,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };
}
