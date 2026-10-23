import { computed } from "mobx";
import KanbanLabel from "~/models/KanbanLabel";
import type RootStore from "./RootStore";
import Store from "./base/Store";

/**
 * Store for managing Kanban labels.
 */
export default class KanbanLabelsStore extends Store<KanbanLabel> {
  apiEndpoint = "kanban.labels";

  constructor(rootStore: RootStore) {
    super(rootStore, KanbanLabel);
  }

  /**
   * Returns all labels excluding deleted items.
   */
  @computed
  get orderedData(): KanbanLabel[] {
    return Array.from(this.data.values())
      .filter(label => !label.delete);
  }
}
