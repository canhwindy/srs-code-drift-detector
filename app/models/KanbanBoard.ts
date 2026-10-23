import { observable } from "mobx";
import type KanbanBoardsStore from "~/stores/KanbanBoardsStore";
import ParanoidModel from "./base/ParanoidModel";
import Field from "./decorators/Field";

/**
 * Represents a Kanban board.
 */
export default class KanbanBoard extends ParanoidModel {
  static modelName = "KanbanBoard";

  store: KanbanBoardsStore;

  /** The name of the board. */
  @Field
  @observable
  name: string;

  /** The description of the board. */
  @Field
  @observable
  description?: string;

  /** The color of the board. */
  @Field
  @observable
  color?: string;

  /** The sort index for the board. */
  @Field
  @observable
  index: number;

  /** The ID of the user who created the board. */
  @Field
  @observable
  createdById: string;
}
