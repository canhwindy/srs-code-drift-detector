import { observable } from "mobx";
import type KanbanLabelsStore from "~/stores/KanbanLabelsStore";
import Model from "./base/Model";
import Field from "./decorators/Field";

/**
 * Represents a Kanban label.
 */
export default class KanbanLabel extends Model {
  static modelName = "KanbanLabel";

  store: KanbanLabelsStore;

  /** The name of the label. */
  @Field
  @observable
  name: string;

  /** The color of the label. */
  @Field
  @observable
  color: string;

  /** The ID of the board this label belongs to. */
  @Field
  @observable
  boardId: string;
}
