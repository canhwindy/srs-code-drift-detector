import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey, BelongsToMany } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import KanbanBoard from "./KanbanBoard";
import KanbanCard from "./KanbanCard";
import Fix from "./decorators/Fix";

@Table({ tableName: "kanban_labels", modelName: "kanban_label" })
@Fix
class KanbanLabel extends IdModel {
  @Column
  name: string;

  @Column({ defaultValue: "#3B82F6" })
  color: string;

  // associations

  @BelongsTo(() => KanbanBoard, "boardId")
  board: KanbanBoard;

  @ForeignKey(() => KanbanBoard)
  @Column(DataTypes.UUID)
  boardId: string;

  @BelongsToMany(() => KanbanCard, () => require("./KanbanCardLabel").default)
  cards: KanbanCard[];
}

export default KanbanLabel;
