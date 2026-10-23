import { DataTypes } from "sequelize";
import { Column, Table, ForeignKey } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import KanbanCard from "./KanbanCard";
import KanbanLabel from "./KanbanLabel";
import Fix from "./decorators/Fix";

@Table({ tableName: "kanban_card_labels", modelName: "kanban_card_label" })
@Fix
class KanbanCardLabel extends IdModel {
  @ForeignKey(() => KanbanCard)
  @Column(DataTypes.UUID)
  cardId: string;

  @ForeignKey(() => KanbanLabel)
  @Column(DataTypes.UUID)
  labelId: string;
}

export default KanbanCardLabel;
