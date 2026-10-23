import { observable } from "mobx";
import type KanbanListsStore from "~/stores/KanbanListsStore";
import ParanoidModel from "./base/ParanoidModel";
import Field from "./decorators/Field";

/**
 * Represents a Kanban list (column).
 */
export default class KanbanList extends ParanoidModel {
  static modelName = "KanbanList";

  store: KanbanListsStore;

  /** The name of the list. */
  @Field
  @observable
  name: string;

  /** The sort index for the list. */
  @Field
  @observable
  index: string;

  /** The ID of the board this list belongs to. */
  @Field
  @observable
  boardId: string;
}
