import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey, HasMany } from "sequelize-typescript";
import IdModel from "./base/IdModel";
import User from "./User";
import KanbanCard from "./KanbanCard";
import Fix from "./decorators/Fix";

@Table({ tableName: "kanban_card_comments", modelName: "kanban_card_comment" })
@Fix
class KanbanCardComment extends IdModel<KanbanCardComment> {
  @Column(DataTypes.TEXT)
  content: string;

  @Column(DataTypes.JSONB)
  attachments: Array<{
    id: string;
    name: string;
    size: number;
    contentType: string;
    url: string;
  }> | null;

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

  @BelongsTo(() => KanbanCardComment, "parentId")
  parent: KanbanCardComment;

  @ForeignKey(() => KanbanCardComment)
  @Column(DataTypes.UUID)
  parentId: string | null;

  @HasMany(() => KanbanCardComment, "parentId")
  replies: KanbanCardComment[];
}

export default KanbanCardComment;
