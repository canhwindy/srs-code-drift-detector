import { DataTypes } from "sequelize";
import { Column, Table, BelongsTo, ForeignKey, HasMany, Scopes } from "sequelize-typescript";
import ParanoidModel from "./base/ParanoidModel";
import KanbanBoard from "./KanbanBoard";
import KanbanCard from "./KanbanCard";
import Fix from "./decorators/Fix";

@Scopes(() => ({
  withCards: {
    include: [
      {
        model: KanbanCard,
        as: "cards",
        separate: true,
        order: [["index", "ASC"]],
      },
    ],
  },
}))
@Table({ tableName: "kanban_lists", modelName: "kanban_list" })
@Fix
class KanbanList extends ParanoidModel<KanbanList> {
  @Column
  name: string;

  @Column(DataTypes.STRING)
  index: string;

  // associations

  @BelongsTo(() => KanbanBoard, "boardId")
  board: KanbanBoard;

  @ForeignKey(() => KanbanBoard)
  @Column(DataTypes.UUID)
  boardId: string;

  @HasMany(() => KanbanCard, "listId")
  cards: KanbanCard[];

  // hooks

  // TODO: Fix hook implementation
  // @BeforeValidate
  // static async setDefaultIndex(model: KanbanList) {
  //   if (!model.index && model.index !== 0) {
  //     const maxIndex = await KanbanList.max<number, KanbanList>("index", {
  //       where: {
  //         boardId: model.boardId,
  //       },
  //     });
  //     model.index = maxIndex !== null ? maxIndex + 1 : 0;
  //   }
  // }

  // @BeforeSave
  // static async beforeSave(model: KanbanList, options: SaveOptions<KanbanList>) {
  //   if (model.changed("index")) {
  //     await this.sequelize!.query(
  //       `
  //       UPDATE kanban_lists 
  //       SET index = index + 1 
  //       WHERE "boardId" = :boardId 
  //         AND index >= :newIndex 
  //         AND id != :id 
  //         AND "deletedAt" IS NULL
  //       `,
  //       {
  //         replacements: {
  //           boardId: model.boardId,
  //           newIndex: model.index,
  //           id: model.id,
  //         },
  //         transaction: options.transaction,
  //       }
  //     );
  //   }
  // }
}

export default KanbanList;
