import { DataTypes } from "sequelize";
import KanbanChecklistItem from "./KanbanChecklistItem";
import { Column, Table, BelongsTo, ForeignKey, HasMany } from "sequelize-typescript";
import ParanoidModel from "./base/ParanoidModel";
import User from "./User";
import KanbanCard from "./KanbanCard";
import Fix from "./decorators/Fix";

@Table({ tableName: "kanban_checklists", modelName: "kanban_checklist" })
@Fix
class KanbanChecklist extends ParanoidModel<KanbanChecklist> {
  @Column
  title: string;

  @Column(DataTypes.STRING)
  index: string;

  // associations

  @BelongsTo(() => KanbanCard, "cardId")
  card: KanbanCard;

  @ForeignKey(() => KanbanCard)
  @Column(DataTypes.UUID)
  cardId: string;

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataTypes.UUID)
  createdById: string;

  @HasMany(() => KanbanChecklistItem, "checklistId")
  items: KanbanChecklistItem[];
}

export default KanbanChecklist;
