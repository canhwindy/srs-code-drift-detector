import { DataTypes } from "sequelize";
import { Column, Table, ForeignKey } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import KanbanCard from "./KanbanCard";
import User from "./User";
import Fix from "./decorators/Fix";

@Table({ tableName: "kanban_card_members", modelName: "kanban_card_member" })
@Fix
class KanbanCardMember extends IdModel {
  @ForeignKey(() => KanbanCard)
  @Column(DataTypes.UUID)
  cardId: string;

  @ForeignKey(() => User)
  @Column(DataTypes.UUID)
  userId: string;
}

export default KanbanCardMember;
