import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey } from "sequelize-typescript";
import ParanoidModel from "./base/ParanoidModel";
import User from "./User";
import KanbanChecklist from "./KanbanChecklist";
import Fix from "./decorators/Fix";

@Table({ tableName: "kanban_checklist_items", modelName: "kanban_checklist_item" })
@Fix
class KanbanChecklistItem extends ParanoidModel<KanbanChecklistItem> {
  @Column
  title: string;

  @Column(DataTypes.BOOLEAN)
  isCompleted: boolean;

  @Column(DataTypes.STRING)
  index: string;

  // associations

  @BelongsTo(() => KanbanChecklist, "checklistId")
  checklist: KanbanChecklist;

  @ForeignKey(() => KanbanChecklist)
  @Column(DataTypes.UUID)
  checklistId: string;

  @BelongsTo(() => User, "completedById")
  completedBy: User | null;

  @ForeignKey(() => User)
  @Column(DataTypes.UUID)
  completedById: string | null;

  @Column(DataTypes.DATE)
  completedAt: Date | null;
}

export default KanbanChecklistItem;
