import { action, runInAction } from "mobx";
import invariant from "invariant";
import KanbanBoard from "~/models/KanbanBoard";

import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";

/**
 * Store for managing Kanban boards.
 */
export default class KanbanBoardsStore extends Store<KanbanBoard> {
  apiEndpoint = "kanban.boards";

  constructor(rootStore: RootStore) {
    super(rootStore as any, KanbanBoard);
  }

  /**
   * Fetch a board with all its details (lists, cards, labels).
   *
   * @param id - The board id to fetch.
   * @returns the board data.
   */
  @action
  fetchWithDetails = async (id: string): Promise<KanbanBoard> => {
    this.isFetching = true;

    try {
      const res = await client.post("/kanban.boards.info", { id });
      invariant(res?.data, "Data should be available");

      const { data } = res;
      const board = this.add(data);

      runInAction("KanbanBoardsStore#fetchWithDetails", () => {
        // Add lists to store
        if (data.lists) {
          data.lists.forEach((listData: any) => {
            this.rootStore.kanbanLists.add(listData);

            // Add cards to store
            if (listData.cards) {
              listData.cards.forEach((cardData: any) => {
                this.rootStore.kanbanCards.add(cardData);
              });
            }
          });
        }

        this.isLoaded = true;
      });

      return board;
    } finally {
      this.isFetching = false;
    }
  };

  /**
   * Move a board to a new position.
   *
   * @param boardId - The board id to move.
   * @param index - The new index position.
   */
  @action
  move = async (boardId: string, index: string) => {
    const res = await client.post("/kanban.boards.update", {
      id: boardId,
      index,
    });
    invariant(res?.data, "Data should be available");

    this.add(res.data);
  };

  /**
   * Search for mentionable users by name.
   *
   * @param query - the search query.
   * @returns an array of users matching the query.
   */
  searchMentionableUsers = async (query: string): Promise<Array<{
    id: string;
    name: string;
    avatarUrl?: string | null;
  }>> => {
    const res = await client.post("/kanban.users.searchMentionable", { query });
    return res?.data || [];
  };
}
