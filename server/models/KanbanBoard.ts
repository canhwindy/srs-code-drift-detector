import { DataTypes } from "sequelize";
import type { SaveOptions, Transaction } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey, HasMany, Scopes, BeforeValidate, BeforeSave } from "sequelize-typescript";
import ParanoidModel from "./base/ParanoidModel";
import User from "./User";
import Team from "./Team";
import KanbanList from "./KanbanList";
import Fix from "./decorators/Fix";

@Scopes(() => ({
  withLists: {
    include: [
      {
        model: KanbanList,
        as: "lists",
        separate: true,
        order: [["index", "ASC"]],
      },
    ],
  },
}))
@Table({ tableName: "kanban_boards", modelName: "kanban_board" })
@Fix
class KanbanBoard extends ParanoidModel<KanbanBoard> {
  @Column
  name: string;

  @Column(DataTypes.TEXT)
  description: string | null;

  @Column(DataTypes.JSONB)
  color: string | null;

  @Column(DataTypes.INTEGER)
  index: number;

  // associations

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataTypes.UUID)
  createdById: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataTypes.UUID)
  teamId: string;

  @HasMany(() => KanbanList, "boardId")
  lists: KanbanList[];

  // hooks

  @BeforeValidate
  static async setDefaultIndex(model: KanbanBoard, options: { transaction?: Transaction }) {
    if (!model.index) {
      const maxIndex = await this.max<number, KanbanBoard>("index", {
        where: {
          teamId: model.teamId,
        },
        transaction: options.transaction,
      });
      model.index = maxIndex !== null ? maxIndex + 1 : 0;
    }
  }

  @BeforeSave
  static async onBeforeSave(model: KanbanBoard, options: SaveOptions<KanbanBoard>) {
    if (model.changed("index")) {
      await this.sequelize!.query(
        `
        UPDATE kanban_boards 
        SET index = index + 1 
        WHERE "teamId" = :teamId 
          AND index >= :newIndex 
          AND id != :id 
          AND "deletedAt" IS NULL
        `,
        {
          replacements: {
            teamId: model.teamId,
            newIndex: model.index,
            id: model.id,
          },
          transaction: options.transaction,
        }
      );
    }
  }
}

export default KanbanBoard;
