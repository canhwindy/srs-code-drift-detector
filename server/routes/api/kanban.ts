import Router from "koa-router";
import { Op } from "sequelize";
import env from "@server/env";
import { sequelize } from "@server/storage/database";
import { ValidationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { KanbanBoard, KanbanList, KanbanCard, KanbanCardMember, KanbanChecklist, KanbanChecklistItem, KanbanCardComment, User, Event, Attachment, Document } from "@server/models";
import { authorize } from "@server/policies";
import presentKanbanBoard, {
  presentKanbanBoardWithDetails,
  presentKanbanList,
  presentKanbanCard,
  presentKanbanChecklist,
  presentKanbanCardComment,
} from "@server/presenters/kanban";
import type { APIContext } from "@server/types";
import pagination from "./middlewares/pagination";
import * as T from "./kanban/schema";
import KanbanCardAddMemberNotificationsTask from "@server/queues/tasks/KanbanCardAddMemberNotificationsTask";
import KanbanMentionNotificationsTask from "@server/queues/tasks/KanbanMentionNotificationsTask";
import KanbanImplementTask from "@server/queues/tasks/KanbanImplementTask";

import { parseMentions } from "@server/utils/parseMentions";
import documentCreator from "@server/commands/documentCreator";
import documentUpdater from "@server/commands/documentUpdater";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";

const router = new Router<any, any>();

// Boards

router.post(
  "kanban.boards.create",
  auth(),
  validate(T.KanbanBoardsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanBoardsCreateReq>) => {
    const { name, description, color } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    authorize(user, "createKanbanBoard", user.team);

    const board = await KanbanBoard.create(
      {
        name,
        description,
        color,
        teamId: user.teamId,
        createdById: user.id,
      } as any,
      { transaction }
    );

    // Create default lists (sequential to avoid concurrent queries on same connection)
    for (const list of [
      { name: "To Do", index: "a0" },
      { name: "In Progress", index: "a1" },
      { name: "Done", index: "a2" },
    ]) {
      await KanbanList.create(
        { ...list, boardId: board.id } as any,
        { transaction }
      );
    }

    await Event.create(
      {
        name: "kanban_boards.create",
        modelId: board.id,
        teamId: user.teamId,
        actorId: user.id,
        ip: ctx.request.ip,
      },
      { transaction }
    );

    await board.reload({
      include: [{ model: User, as: "createdBy" }],
      transaction,
    });

    ctx.body = {
      data: presentKanbanBoard(board),
    };
  }
);

router.post(
  "kanban.boards.list",
  auth(),
  pagination(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;

    const boards = await KanbanBoard.findAll({
      where: {
        teamId: user.teamId,
      },
      include: [{ model: User, as: "createdBy" }],
      order: [["index", "ASC"]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });

    ctx.body = {
      pagination: ctx.state.pagination,
      data: boards.map(presentKanbanBoard),
    };
  }
);

router.post(
  "kanban.boards.info",
  auth(),
  validate(T.KanbanBoardsInfoSchema),
  async (ctx: APIContext<T.KanbanBoardsInfoReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const board = await KanbanBoard.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      include: [
        { model: User, as: "createdBy" },
        {
          model: KanbanList,
          as: "lists",
          separate: true,
          order: [["index", "ASC"]],
          include: [
            {
              model: KanbanCard,
              as: "cards",
              separate: true,
              order: [["index", "ASC"]],
              include: [
                { model: User, as: "members" },
                { model: User, as: "createdBy" },
              ],
            },
          ],
        },
      ],
    });

    if (!board) {
      throw ValidationError("Board not found");
    }

    ctx.body = {
      data: presentKanbanBoardWithDetails(board),
    };
  }
);

router.post(
  "kanban.boards.update",
  auth(),
  validate(T.KanbanBoardsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanBoardsUpdateReq>) => {
    const { id, name, description, color, index } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const board = await KanbanBoard.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      transaction,
    });

    if (!board) {
      throw ValidationError("Board not found");
    }

    authorize(user, "update", board);

    if (name !== undefined) { board.name = name; }
    if (description !== undefined) { board.description = description; }
    if (color !== undefined) { board.color = color; }
    if (index !== undefined) { board.index = parseInt(index, 10); }

    await board.save({ transaction });

    await Event.create(
      {
        name: "kanban_boards.update",
        modelId: board.id,
        teamId: user.teamId,
        actorId: user.id,
        ip: ctx.request.ip,
      },
      { transaction }
    );

    await board.reload({
      include: [{ model: User, as: "createdBy" }],
      transaction,
    });

    ctx.body = {
      data: presentKanbanBoard(board),
    };
  }
);

router.post(
  "kanban.boards.delete",
  auth(),
  validate(T.KanbanBoardsDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanBoardsDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const board = await KanbanBoard.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      transaction,
    });

    if (!board) {
      throw ValidationError("Board not found");
    }

    authorize(user, "delete", board);

    await board.destroy({ transaction });

    await Event.create(
      {
        name: "kanban_boards.delete",
        modelId: board.id,
        teamId: user.teamId,
        actorId: user.id,
        ip: ctx.request.ip,
      },
      { transaction }
    );

    ctx.body = {
      success: true,
    };
  }
);

// Lists

router.post(
  "kanban.lists.create",
  auth(),
  validate(T.KanbanListsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanListsCreateReq>) => {
    const { boardId, name, index } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const board = await KanbanBoard.findOne({
      where: {
        id: boardId,
        teamId: user.teamId,
      },
      transaction,
    });

    if (!board) {
      throw ValidationError("Board not found");
    }

    authorize(user, "update", board);

    const list = await KanbanList.create(
      {
        name,
        index: index as any,
        boardId,
      } as any,
      { transaction }
    );

    ctx.body = {
      data: presentKanbanList(list),
    };
  }
);

router.post(
  "kanban.lists.update",
  auth(),
  validate(T.KanbanListsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanListsUpdateReq>) => {
    const { id, name, index } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const list = await KanbanList.findByPk(id, {
      include: [
        {
          model: KanbanBoard,
          as: "board",
          where: { teamId: user.teamId },
        },
      ],
      transaction,
    });

    if (!list) {
      throw ValidationError("List not found");
    }

    authorize(user, "update", list.board);

    if (name !== undefined) { list.name = name; }
    if (index !== undefined) { list.index = index; }

    await list.save({ transaction });

    ctx.body = {
      data: presentKanbanList(list),
    };
  }
);

router.post(
  "kanban.lists.delete",
  auth(),
  validate(T.KanbanListsDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanListsDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const list = await KanbanList.findByPk(id, {
      include: [
        {
          model: KanbanBoard,
          as: "board",
          where: { teamId: user.teamId },
        },
      ],
      transaction,
    });

    if (!list) {
      throw ValidationError("List not found");
    }

    authorize(user, "update", list.board);

    await list.destroy({ transaction });

    ctx.body = {
      success: true,
    };
  }
);

// Cards

router.post(
  "kanban.cards.create",
  auth(),
  validate(T.KanbanCardsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsCreateReq>) => {
    const { listId, title, description, color, index, dueDate, priority } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const list = await KanbanList.findByPk(listId, {
      include: [
        {
          model: KanbanBoard,
          as: "board",
          where: { teamId: user.teamId },
        },
      ],
      transaction,
    });

    if (!list) {
      throw ValidationError("List not found");
    }

    authorize(user, "update", list.board);

    const card = await KanbanCard.create(
      {
        title,
        description,
        color,
        index: index as any,
        dueDate: dueDate ?? null,
        priority: priority ?? null,
        listId,
        createdById: user.id,
      } as any,
      { transaction }
    );

    await card.reload({
      include: [
        { model: User, as: "members" },
        { model: User, as: "createdBy" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanCard(card),
    };
  }
);

router.post(
  "kanban.cards.update",
  auth(),
  validate(T.KanbanCardsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsUpdateReq>) => {
    const { id, title, description, color, index, listId, dueDate, priority } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    // Track the previous values for events
    const previousListId = card.listId;
    const previousListName = card.list?.name;
    const previousTitle = card.title;
    const previousDescription = card.description;
    const previousDueDate = card.dueDate;

    if (title !== undefined) {
      card.title = title;
    }
    if (description !== undefined) {
      card.description = description;
    }
    if (color !== undefined) {
      card.color = color;
    }
    if (index !== undefined) {
      card.index = index;
    }
    if (listId !== undefined) {
      card.listId = listId;
    }
    if (dueDate !== undefined) {
      card.dueDate = dueDate;
    }
    if (priority !== undefined) {
      card.priority = priority;
    }

    await card.save({ transaction });

    // Create title change event
    if (title !== undefined && title !== previousTitle) {
      await Event.create(
        {
          name: "kanban_cards.title_update",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            cardTitle: card.title,
            previousTitle,
            newTitle: title,
          },
        },
        { transaction }
      );
    }

    // Create description change event
    if (description !== undefined && description !== previousDescription) {
      await Event.create(
        {
          name: "kanban_cards.description_update",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            cardTitle: card.title,
            previousDescription: previousDescription || "",
            newDescription: description || "",
          },
        },
        { transaction }
      );
    }

    // Create due date change event
    if (dueDate !== undefined && String(dueDate) !== String(previousDueDate)) {
      await Event.create(
        {
          name: "kanban_cards.duedate_update",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            cardTitle: card.title,
            previousDueDate: previousDueDate ? previousDueDate.toISOString() : null,
            newDueDate: dueDate ? new Date(dueDate).toISOString() : null,
          },
        },
        { transaction }
      );
    }

    // Create move event if list changed
    if (listId !== undefined && listId !== previousListId) {
      const newList = await KanbanList.findByPk(listId, { transaction });
      await Event.create(
        {
          name: "kanban_cards.move",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            cardTitle: card.title,
            previousListId,
            previousListName,
            newListId: listId,
            newListName: newList?.name,
          },
        },
        { transaction }
      );
    }

    await card.reload({
      include: [
        { model: User, as: "members" },
        { model: User, as: "createdBy" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanCard(card),
    };
  }
);

router.post(
  "kanban.cards.delete",
  auth(),
  validate(T.KanbanCardsDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    await card.destroy({ transaction });

    ctx.body = {
      success: true,
    };
  }
);

// Card info

router.post(
  "kanban.cards.info",
  auth(),
  validate(T.KanbanCardsInfoSchema),
  async (ctx: APIContext<T.KanbanCardsInfoReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
        { model: User, as: "members" },
        { model: User, as: "createdBy" },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    ctx.body = {
      data: presentKanbanCard(card),
    };
  }
);

// Card Member assignment

router.post(
  "kanban.cards.addMember",
  auth(),
  validate(T.KanbanCardsAddMemberSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsAddMemberReq>) => {
    const { cardId, userId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    const targetUser = await User.findOne({
      where: { id: userId, teamId: user.teamId },
      transaction,
    });

    if (!targetUser) {
      throw ValidationError("User not found");
    }

    // Check if already assigned
    const existing = await KanbanCardMember.findOne({
      where: { cardId, userId },
      transaction,
    });

    if (!existing) {
      await KanbanCardMember.create(
        { cardId, userId },
        { transaction }
      );

      // Create event for adding member
      await Event.create(
        {
          name: "kanban_cards.add_member",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            cardTitle: card.title,
            memberId: userId,
            memberName: targetUser.name,
            memberEmail: targetUser.email,
          },
        },
        { transaction }
      );

      // Schedule notification for the added member
      await new KanbanCardAddMemberNotificationsTask().schedule({
        name: "kanban_cards.add_member",
        modelId: card.id,
        teamId: user.teamId,
        actorId: user.id,
        userId: userId,
        cardId: card.id,
      });
    }

    await card.reload({
      include: [
        { model: User, as: "members" },
        { model: User, as: "createdBy" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanCard(card),
    };
  }
);

router.post(
  "kanban.cards.removeMember",
  auth(),
  validate(T.KanbanCardsRemoveMemberSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsRemoveMemberReq>) => {
    const { cardId, userId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    // Get the member being removed for the event
    const removedUser = await User.findByPk(userId, { transaction });

    await KanbanCardMember.destroy({
      where: { cardId, userId },
      transaction,
    });

    // Create event for removing member
    if (removedUser) {
      await Event.create(
        {
          name: "kanban_cards.remove_member",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            cardTitle: card.title,
            memberId: userId,
            memberName: removedUser.name,
            memberEmail: removedUser.email,
          },
        },
        { transaction }
      );
    }

    await card.reload({
      include: [
        { model: User, as: "members" },
        { model: User, as: "createdBy" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanCard(card),
    };
  }
);

// Card Related Documents

router.post(
  "kanban.cards.addRelatedDocument",
  auth(),
  validate(T.KanbanCardsAddRelatedDocumentSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsAddRelatedDocumentReq>) => {
    const { cardId, documentId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    const document = await Document.findByPk(documentId, { transaction });
    if (!document) {
      throw ValidationError("Document not found");
    }

    const existing = card.relatedDocuments || [];

    // Check if already linked
    if (existing.some((d) => d.id === documentId)) {
      throw ValidationError("Document is already linked to this card");
    }

    card.relatedDocuments = [
      ...existing,
      { id: document.id, title: document.title, url: document.url },
    ];

    await card.save({ transaction });

    await Event.create(
      {
        name: "kanban_cards.add_related_document",
        modelId: card.id,
        teamId: user.teamId,
        actorId: user.id,
        ip: ctx.request.ip,
        data: {
          cardTitle: card.title,
          documentId: document.id,
          documentTitle: document.title,
        },
      },
      { transaction }
    );

    await card.reload({
      include: [
        { model: User, as: "members" },
        { model: User, as: "createdBy" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanCard(card),
    };
  }
);

router.post(
  "kanban.cards.removeRelatedDocument",
  auth(),
  validate(T.KanbanCardsRemoveRelatedDocumentSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsRemoveRelatedDocumentReq>) => {
    const { cardId, documentId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    const existing = card.relatedDocuments || [];
    const removed = existing.find((d) => d.id === documentId);

    card.relatedDocuments = existing.filter((d) => d.id !== documentId);

    await card.save({ transaction });

    if (removed) {
      await Event.create(
        {
          name: "kanban_cards.remove_related_document",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            cardTitle: card.title,
            documentId: removed.id,
            documentTitle: removed.title,
          },
        },
        { transaction }
      );
    }

    await card.reload({
      include: [
        { model: User, as: "members" },
        { model: User, as: "createdBy" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanCard(card),
    };
  }
);

// Card Activities

router.post(
  "kanban.cards.activities",
  auth(),
  validate(T.KanbanCardsActivitiesSchema),
  async (ctx: APIContext<T.KanbanCardsActivitiesReq>) => {
    const { cardId } = ctx.input.body;
    const { user } = ctx.state.auth;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    // Get all events related to this card
    const events = await Event.findAll({
      where: {
        [Op.or]: [
          { modelId: cardId },
          { documentId: cardId }, // Some events might use documentId
        ],
        name: {
          [Op.like]: "kanban_cards.%",
        },
      },
      include: [
        { model: User, as: "actor" },
      ],
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    // Get ALL comments for this card (flat list)
    const allComments = await KanbanCardComment.findAll({
      where: { cardId },
      include: [{ model: User, as: "createdBy" }],
      order: [["createdAt", "ASC"]],
    });

    // Format function for a reply with nested replies
    interface FormattedReply {
      id: string;
      content: string;
      createdAt: Date;
      createdBy: {
        id: string;
        name: string;
        avatarUrl: string | null;
      } | null;
      replies: FormattedReply[];
      attachments?: Array<{
        id: string;
        name: string;
        size: number;
        contentType: string;
        url: string;
      }>;
    }

    // Build nested reply structure recursively
    const buildReplyTree = (comment: KanbanCardComment): FormattedReply => {
      const childComments = allComments.filter(c => c.parentId === comment.id);
      return {
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt,
        createdBy: comment.createdBy ? {
          id: comment.createdBy.id,
          name: comment.createdBy.name,
          avatarUrl: comment.createdBy.avatarUrl,
        } : null,
        replies: childComments.map(child => buildReplyTree(child)),
        attachments: comment.attachments || undefined,
      };
    };

    // Get top-level comments and build their reply trees
    const topLevelComments = allComments.filter(c => c.parentId === null);

    // Merge events and comments
    const activities = [
      ...events.map(event => ({
        id: event.id,
        name: event.name,
        data: event.data || {},
        createdAt: event.createdAt,
        actor: event.actor ? {
          id: event.actor.id,
          name: event.actor.name,
          avatarUrl: event.actor.avatarUrl,
        } : null,
      })),
      ...topLevelComments.map(comment => {
        const replyTree = buildReplyTree(comment);
        return {
          id: comment.id,
          name: "kanban_cards.comment",
          data: {
            comment: comment.content,
            commentId: comment.id,
            replies: replyTree.replies,
            attachments: comment.attachments || undefined,
          },
          createdAt: comment.createdAt,
          actor: comment.createdBy ? {
            id: comment.createdBy.id,
            name: comment.createdBy.name,
            avatarUrl: comment.createdBy.avatarUrl,
          } : null,
        };
      }),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    ctx.body = {
      data: activities,
    };
  }
);

// Card Comments

router.post(
  "kanban.cards.addComment",
  auth(),
  validate(T.KanbanCardsAddCommentSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanCardsAddCommentReq>) => {
    const { cardId, comment, parentId, attachmentIds } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    // If parentId is provided, verify the parent comment exists
    if (parentId) {
      const parentComment = await KanbanCardComment.findByPk(parentId, { transaction });
      if (!parentComment) {
        throw ValidationError("Parent comment not found");
      }
      if (parentComment.cardId !== cardId) {
        throw ValidationError("Parent comment does not belong to this card");
      }
    }

    // Process attachments if provided
    let attachments: Array<{ id: string; name: string; size: number; contentType: string; url: string }> = [];
    if (attachmentIds && attachmentIds.length > 0) {
      const foundAttachments = await Attachment.findAll({
        where: {
          id: attachmentIds,
          userId: user.id,
          teamId: user.teamId,
        },
        transaction,
      });

      if (foundAttachments.length !== attachmentIds.length) {
        throw ValidationError("Some attachments not found or unauthorized");
      }

      attachments = foundAttachments.map(att => ({
        id: att.id,
        name: att.name,
        size: att.size,
        contentType: att.contentType,
        url: att.url,
      }));
    }

    const cardComment = await KanbanCardComment.create(
      {
        cardId,
        content: comment as string,
        createdById: user.id,
        parentId,
        attachments: attachments as any,
      } as any,
      { transaction }
    );

    // Parse mentions and send notifications
    const mentionedUserIds = await parseMentions(comment, user.teamId);
    Logger.info("task", `Mention parsing result for comment`, {
      comment,
      mentionedUserIds,
      teamId: user.teamId,
    });

    if (mentionedUserIds.length > 0) {
      await new KanbanMentionNotificationsTask().schedule({
        name: "kanban_cards.mentioned",
        modelId: card.id,
        teamId: user.teamId,
        actorId: user.id,
        cardId: card.id,
        commentId: cardComment.id,
        content: comment,
        mentionedUserIds,
      });
      Logger.info("task", `Scheduled mention notification task`, {
        cardId: card.id,
        mentionedUserIds,
      });
    }

    // Note: We don't create an Event for comments because comments are stored
    // separately in KanbanCardComment table and merged in fetchActivities

    await cardComment.reload({
      include: [{ model: User, as: "createdBy" }],
      transaction,
    });

    ctx.body = {
      data: presentKanbanCardComment(cardComment),
    };
  }
);

// Checklists

router.post(
  "kanban.checklists.list",
  auth(),
  validate(T.KanbanChecklistsListSchema),
  async (ctx: APIContext<T.KanbanChecklistsListReq>) => {
    const { cardId } = ctx.input.body;
    const { user } = ctx.state.auth;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "read", card.list.board);

    const checklists = await KanbanChecklist.findAll({
      where: { cardId },
      include: [
        {
          model: KanbanChecklistItem,
          as: "items",
          order: [["index", "ASC"]],
        },
      ],
      order: [["index", "ASC"]],
    });

    ctx.body = {
      data: checklists.map(presentKanbanChecklist),
    };
  }
);

router.post(
  "kanban.checklists.create",
  auth(),
  validate(T.KanbanChecklistsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanChecklistsCreateReq>) => {
    const { cardId, title } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const card = await KanbanCard.findByPk(cardId, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
      transaction,
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", card.list.board);

    // Get max index
    const maxChecklist = await KanbanChecklist.findOne({
      where: { cardId },
      order: [["index", "DESC"]],
      transaction,
    });

    const index = maxChecklist ? String.fromCharCode(maxChecklist.index.charCodeAt(0) + 1) : "a";

    const checklist = await KanbanChecklist.create(
      {
        cardId,
        title,
        index,
        createdById: user.id,
      } as any,
      { transaction }
    );

    await Event.create(
      {
        name: "kanban_cards.checklist_create",
        modelId: cardId,
        teamId: user.teamId,
        actorId: user.id,
        data: { checklistTitle: title },
        ip: ctx.request.ip,
      },
      { transaction }
    );

    await checklist.reload({
      include: [
        { model: User, as: "createdBy" },
        { model: KanbanChecklistItem, as: "items" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanChecklist(checklist),
    };
  }
);

router.post(
  "kanban.checklists.update",
  auth(),
  validate(T.KanbanChecklistsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanChecklistsUpdateReq>) => {
    const { id, title } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const checklist = await KanbanChecklist.findByPk(id, {
      include: [
        {
          model: KanbanCard,
          as: "card",
          include: [
            {
              model: KanbanList,
              as: "list",
              include: [
                {
                  model: KanbanBoard,
                  as: "board",
                  where: { teamId: user.teamId },
                },
              ],
            },
          ],
        },
      ],
      transaction,
    });

    if (!checklist) {
      throw ValidationError("Checklist not found");
    }

    authorize(user, "update", checklist.card.list.board);

    if (title !== undefined) {
      checklist.title = title;
    }

    await checklist.save({ transaction });

    await checklist.reload({
      include: [
        { model: User, as: "createdBy" },
        { model: KanbanChecklistItem, as: "items" },
      ],
      transaction,
    });

    ctx.body = {
      data: presentKanbanChecklist(checklist),
    };
  }
);

router.post(
  "kanban.checklists.delete",
  auth(),
  validate(T.KanbanChecklistsDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanChecklistsDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const checklist = await KanbanChecklist.findByPk(id, {
      include: [
        {
          model: KanbanCard,
          as: "card",
          include: [
            {
              model: KanbanList,
              as: "list",
              include: [
                {
                  model: KanbanBoard,
                  as: "board",
                  where: { teamId: user.teamId },
                },
              ],
            },
          ],
        },
      ],
      transaction,
    });

    if (!checklist) {
      throw ValidationError("Checklist not found");
    }

    authorize(user, "update", checklist.card.list.board);

    await checklist.destroy({ transaction });

    ctx.body = {
      success: true,
    };
  }
);

// Checklist Items

router.post(
  "kanban.checklistItems.create",
  auth(),
  validate(T.KanbanChecklistItemsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanChecklistItemsCreateReq>) => {
    const { checklistId, title } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const checklist = await KanbanChecklist.findByPk(checklistId, {
      include: [
        {
          model: KanbanCard,
          as: "card",
          include: [
            {
              model: KanbanList,
              as: "list",
              include: [
                {
                  model: KanbanBoard,
                  as: "board",
                  where: { teamId: user.teamId },
                },
              ],
            },
          ],
        },
      ],
      transaction,
    });

    if (!checklist) {
      throw ValidationError("Checklist not found");
    }

    authorize(user, "update", checklist.card.list.board);

    // Get max index
    const maxItem = await KanbanChecklistItem.findOne({
      where: { checklistId },
      order: [["index", "DESC"]],
      transaction,
    });

    const index = maxItem ? String.fromCharCode(maxItem.index.charCodeAt(0) + 1) : "a";

    const item = await KanbanChecklistItem.create(
      {
        checklistId,
        title,
        index,
        isCompleted: false,
      } as any,
      { transaction }
    );

    await Event.create(
      {
        name: "kanban_cards.checklist_item_create",
        modelId: checklist.cardId,
        teamId: user.teamId,
        actorId: user.id,
        data: { itemTitle: title, checklistTitle: checklist.title },
        ip: ctx.request.ip,
      },
      { transaction }
    );

    ctx.body = {
      data: {
        id: item.id,
        title: item.title,
        isCompleted: item.isCompleted,
        index: item.index,
        checklistId: item.checklistId,
      },
    };
  }
);

router.post(
  "kanban.checklistItems.update",
  auth(),
  validate(T.KanbanChecklistItemsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanChecklistItemsUpdateReq>) => {
    const { id, title, isCompleted } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const item = await KanbanChecklistItem.findByPk(id, {
      include: [
        {
          model: KanbanChecklist,
          as: "checklist",
          include: [
            {
              model: KanbanCard,
              as: "card",
              include: [
                {
                  model: KanbanList,
                  as: "list",
                  include: [
                    {
                      model: KanbanBoard,
                      as: "board",
                      where: { teamId: user.teamId },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      transaction,
    });

    if (!item) {
      throw ValidationError("Checklist item not found");
    }

    authorize(user, "update", item.checklist.card.list.board);

    if (title !== undefined) {
      item.title = title;
    }

    if (isCompleted !== undefined) {
      const wasCompleted = item.isCompleted;
      item.isCompleted = isCompleted;

      if (isCompleted && !wasCompleted) {
        item.completedById = user.id;
        item.completedAt = new Date();

        await Event.create(
          {
            name: "kanban_cards.checklist_item_complete",
            modelId: item.checklist.cardId,
            teamId: user.teamId,
            actorId: user.id,
            data: { itemTitle: item.title },
            ip: ctx.request.ip,
          },
          { transaction }
        );
      } else if (!isCompleted && wasCompleted) {
        item.completedById = null;
        item.completedAt = null;

        await Event.create(
          {
            name: "kanban_cards.checklist_item_uncomplete",
            modelId: item.checklist.cardId,
            teamId: user.teamId,
            actorId: user.id,
            data: { itemTitle: item.title },
            ip: ctx.request.ip,
          },
          { transaction }
        );
      }
    }

    await item.save({ transaction });

    ctx.body = {
      data: {
        id: item.id,
        title: item.title,
        isCompleted: item.isCompleted,
        index: item.index,
        checklistId: item.checklistId,
        completedById: item.completedById,
        completedAt: item.completedAt,
      },
    };
  }
);

router.post(
  "kanban.checklistItems.delete",
  auth(),
  validate(T.KanbanChecklistItemsDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.KanbanChecklistItemsDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const item = await KanbanChecklistItem.findByPk(id, {
      include: [
        {
          model: KanbanChecklist,
          as: "checklist",
          include: [
            {
              model: KanbanCard,
              as: "card",
              include: [
                {
                  model: KanbanList,
                  as: "list",
                  include: [
                    {
                      model: KanbanBoard,
                      as: "board",
                      where: { teamId: user.teamId },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      transaction,
    });

    if (!item) {
      throw ValidationError("Checklist item not found");
    }

    authorize(user, "update", item.checklist.card.list.board);

    await item.destroy({ transaction });

    ctx.body = {
      success: true,
    };
  }
);

// User search for @mentions autocomplete

router.post(
  "kanban.users.searchMentionable",
  auth(),
  validate(T.KanbanUsersSearchMentionableSchema),
  async (ctx: APIContext<T.KanbanUsersSearchMentionableReq>) => {
    const { query, limit = 10 } = ctx.input.body;
    const { user } = ctx.state.auth;

    const users = await User.findAll({
      where: {
        teamId: user.teamId,
        suspendedAt: null,
        ...(query && {
          name: {
            [Op.iLike]: `%${query}%`,
          },
        }),
      },
      limit: Math.min(limit, 50),
      order: [["name", "ASC"]],
      attributes: ["id", "name", "avatarUrl"],
    });

    ctx.body = {
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
      })),
    };
  }
);

// Synchronous: calls Python /kanban/analyze-impact and returns impact analysis result directly
router.post(
  "kanban.cards.analyzeImpact",
  auth(),
  validate(T.KanbanCardsAnalyzeImpactSchema),
  async (ctx: APIContext<T.KanbanCardsAnalyzeImpactReq>) => {
    // LLM calls (retrieve-candidates + analyze-impact) can take several minutes.
    // Override the global server.setTimeout(REQUEST_TIMEOUT=10s) for this socket.
    ctx.req.socket?.setTimeout(900_000);

    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", (card as any).list.board);

    const pythonBackendUrl = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

    // ── Fetch related document content ──────────────────────────────────────
    const relatedDocsMeta = card.relatedDocuments ?? [];
    const relatedDocIds = relatedDocsMeta.map((d: { id: string }) => d.id);

    const relatedDocTexts = relatedDocIds.length > 0
      ? await Document.findAll({
        where: { id: relatedDocIds },
        attributes: ["id", "urlId", "text"],
      })
      : [];

    const docTextMap = new Map(relatedDocTexts.map((d) => [d.id, d.text]));

    const relatedDocsWithContent = relatedDocsMeta.map((d: { id: string; title: string; url: string }) => ({
      id: d.id,
      title: d.title,
      url: d.url,
      content: docTextMap.get(d.id) ?? null,
    }));

    const teamId = (card as any).list?.board?.teamId;
    Logger.info("task", `retrieve-candidates card board info: ${(card as any).list?.board}`);
    Logger.info("task", `retrieve-candidates board team id: ${teamId}`);
    // ── LightRAG candidate retrieval ─────────────────────────────────────────
    type CandidateDoc = { id: string; title: string; url: string; content: string | null };

    function stripExt(filename: string): string {
      return filename.replace(/\.[^/.]+$/, "");
    }

    let candidateDocuments: CandidateDoc[] = [];

    try {
      const ragResponse = await fetch(
        `${pythonBackendUrl}/kanban/retrieve-candidates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Key": user.id,
            "X-Workspace-Id": teamId ?? "",
            ...(env.INTERNAL_API_SECRET
              ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
              : {}),
          },
          body: JSON.stringify({
            card_title: card.title,
            card_description: card.description ?? null,
          }),
          signal: AbortSignal.timeout(900_000),
        }
      );

      if (ragResponse.ok) {
        const ragResult = (await ragResponse.json()) as {
          candidates: Array<{ file_path: string; content_snippet: string }>;
        };
        const ragCandidates = ragResult.candidates ?? [];

        if (ragCandidates.length > 0 && teamId) {
          const docResults = await Promise.all(
            ragCandidates.map(async (candidate): Promise<CandidateDoc | null> => {
              const filePath = candidate.file_path;
              const sepIdx = filePath.indexOf("<#>");
              let doc: InstanceType<typeof Document> | null = null;

              if (sepIdx !== -1) {
                const docId = filePath.slice(0, sepIdx).trim();
                if (!docId || relatedDocIds.includes(docId)) { return null; }
                doc = await Document.findOne({
                  where: { id: docId, teamId },
                  attributes: ["id", "title", "urlId", "text"],
                });
              } else {
                const name = stripExt(filePath).trim();
                if (!name) { return null; }
                const docs = await Document.findAll({
                  where: {
                    teamId,
                    title: { [Op.iLike]: `%${name}%` },
                    ...(relatedDocIds.length > 0 ? { id: { [Op.notIn]: relatedDocIds } } : {}),
                  },
                  limit: 1,
                  attributes: ["id", "title", "urlId", "text"],
                });
                doc = docs[0] ?? null;
              }

              if (!doc) { return null; }
              return { id: doc.id, title: doc.title, url: Document.getPath({ title: doc.title, urlId: doc.urlId }), content: doc.text ?? null };
            })
          );

          const seen = new Set<string>();
          candidateDocuments = docResults
            .filter((d): d is CandidateDoc => d !== null)
            .filter((d) => {
              if (seen.has(d.id)) { return false; }
              seen.add(d.id);
              return true;
            });
        }
      }
    } catch {
      // LightRAG failed — fall back to SQL below
    }

    // ── SQL fallback if no candidates from LightRAG ──────────────────────────
    if (candidateDocuments.length === 0 && teamId) {
      const titleWords = card.title.split(" ").slice(0, 3).join("%");
      if (titleWords.length > 0) {
        const fallbackRows = await Document.findAll({
          where: {
            teamId,
            title: { [Op.iLike]: `%${titleWords}%` },
            ...(relatedDocIds.length > 0 ? { id: { [Op.notIn]: relatedDocIds } } : {}),
          },
          limit: 5,
          attributes: ["id", "title", "urlId", "text"],
        });
        candidateDocuments = fallbackRows.map((d) => ({
          id: d.id,
          title: d.title,
          url: Document.getPath({ title: d.title, urlId: d.urlId }),
          content: d.text ?? null,
        }));
      }
    }

    // ── Call Python /kanban/analyze-impact (synchronous) ─────────────────────
    const response = await fetch(`${pythonBackendUrl}/kanban/analyze-impact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Key": user.id,
        ...(env.INTERNAL_API_SECRET
          ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
          : {}),
      },
      body: JSON.stringify({
        card_id: card.id,
        card_title: card.title,
        card_description: card.description ?? null,
        related_documents: relatedDocsMeta,
        related_documents_with_content: relatedDocsWithContent,
        candidate_documents: candidateDocuments,
      }),
      signal: AbortSignal.timeout(900_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let parsed: { detail?: { error_code?: string; message?: string } | string } = {};
      try { parsed = JSON.parse(errorBody); } catch { /* not JSON */ }
      const detail = parsed.detail;
      if (detail && typeof detail === "object" && detail.error_code) {
        throw ValidationError(detail.message ?? errorBody);
      }
      throw ValidationError(`Python backend error ${response.status}: ${errorBody}`);
    }

    const result = (await response.json()) as {
      has_impacts: boolean;
      impacts: Array<{
        affected_document_id: string | null;
        affected_document_title: string;
        affected_document_url: string | null;
        description: string;
      }>;
    };

    const impactAnalysis = {
      hasImpacts: result.has_impacts,
      impacts: result.impacts.map((i) => ({
        affectedDocumentId: i.affected_document_id,
        affectedDocumentTitle: i.affected_document_title,
        affectedDocumentUrl: i.affected_document_url ?? null,
        description: i.description,
      })),
    };

    await card.update({ impactAnalysis } as any);

    ctx.body = {
      data: impactAnalysis,
    };
  }
);

// Clear persisted impact analysis result from a card
router.post(
  "kanban.cards.clearImpactAnalysis",
  auth(),
  validate(T.KanbanCardsClearImpactAnalysisSchema),
  async (ctx: APIContext<T.KanbanCardsClearImpactAnalysisReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", (card as any).list.board);

    await card.update({ impactAnalysis: null } as any);

    ctx.body = {
      data: { id: card.id },
    };
  }
);

// Update the persisted impact analysis impacts list (add/edit/delete items)
router.post(
  "kanban.cards.updateImpactAnalysis",
  auth(),
  validate(T.KanbanCardsUpdateImpactAnalysisSchema),
  async (ctx: APIContext<T.KanbanCardsUpdateImpactAnalysisReq>) => {
    const { id, impacts } = ctx.input.body;
    const { user } = ctx.state.auth;

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    authorize(user, "update", (card as any).list.board);

    const impactAnalysis = {
      hasImpacts: impacts.length > 0,
      impacts,
    };

    await card.update({ impactAnalysis } as any);

    ctx.body = {
      data: { id: card.id },
    };
  }
);

// Non-blocking: schedules background task, returns immediately with status "running"
router.post(
  "kanban.cards.implement",
  auth(),
  validate(T.KanbanCardsImplementSchema),
  async (ctx: APIContext<T.KanbanCardsImplementReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    // Atomic guard + set running
    const card = await sequelize.transaction(async (t) => {
      const lockedCard = await KanbanCard.findByPk(id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!lockedCard) {
        throw ValidationError("Card not found");
      }

      if (
        lockedCard.implementStatus === "running" ||
        lockedCard.implementStatus === "preview_ready"
      ) {
        throw ValidationError("Card is already being processed");
      }

      await lockedCard.update(
        { implementStatus: "running", implementError: null, implementPreview: null },
        { transaction: t }
      );

      const cardWithJoins = await KanbanCard.findByPk(id, {
        include: [
          {
            model: KanbanList,
            as: "list",
            include: [
              {
                model: KanbanBoard,
                as: "board",
                where: { teamId: user.teamId },
              },
            ],
          },
          { model: User, as: "createdBy" },
          { model: User, as: "members" },
        ],
        transaction: t,
      });

      if (!cardWithJoins) {
        throw ValidationError("Card not found");
      }

      authorize(user, "update", cardWithJoins.list.board);

      return cardWithJoins;
    });

    // Schedule background task — do not await
    const task = new KanbanImplementTask();
    await task.schedule({ cardId: card.id, userId: user.id, ip: ctx.request.ip });

    ctx.body = { data: presentKanbanCard(card) };
  }
);

// Confirm implement: execute document operation from stored preview
router.post(
  "kanban.cards.implement.confirm",
  auth(),
  validate(T.KanbanCardsImplementConfirmSchema),
  async (ctx: APIContext<T.KanbanCardsImplementConfirmReq>) => {
    const { id, deleteDocumentIds, createDocumentIndexes, updateDocumentChanges } = ctx.input.body;
    const { user } = ctx.state.auth;

    Logger.info("task", `kanban.cards.implement.confirm: id=${id}, userId=${user.id}, userEmail=${user.email}`);

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
        { model: User, as: "createdBy" },
        { model: User, as: "members" },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    if (card.implementStatus !== "preview_ready") {
      throw ValidationError("Card is not ready to confirm");
    }

    const preview = card.implementPreview;
    if (!preview) {
      throw ValidationError("No preview data found");
    }

    authorize(user, "update", card.list.board);

    await sequelize.transaction(async (t) => {
      ctx.state.transaction = t;
      ctx.context.transaction = t;

      let documentId: string | null = null;
      let createdDocs: { id: string; title: string; url: string }[] = [];
      let allFailedEdits: string[] = [];

      try {
        if (preview.action === "create_document") {
          const docs = preview.documentsToCreate ?? [];
          const indexes = createDocumentIndexes ?? docs.map((_, i) => i);
          const docsToCreate = indexes.map((i) => docs[i]).filter(Boolean);

          if (docsToCreate.length === 0) {
            throw new Error("No documents selected to create");
          }

          for (const doc of docsToCreate) {
            const collId =
              doc.collectionId ??
              (card.relatedDocuments?.[0]
                ? await getDocumentCollection(card.relatedDocuments[0].id, user.teamId)
                : null);

            const newDoc = await documentCreator(ctx, {
              title: doc.title,
              text: doc.content,
              collectionId: collId,
              publish: false,
            });

            createdDocs.push({ id: newDoc.id, title: newDoc.title, url: newDoc.url });
          }

          documentId = createdDocs[0]?.id ?? null;
        } else if (preview.action === "update_document") {
          const allChanges = preview.documentChanges ?? [];
          if (allChanges.length === 0) {
            throw new Error("No document changes specified for update_document action");
          }

          // Build a map of documentId → selected edit indices (undefined = apply all)
          const editIndicesMap = updateDocumentChanges
            ? new Map(updateDocumentChanges.map((uc) => [uc.documentId, uc.selectedEditIndices]))
            : null;

          const documentChanges = editIndicesMap
            ? allChanges.filter((c) => editIndicesMap.has(c.documentId))
            : allChanges;

          for (const change of documentChanges) {
            const doc = await Document.unscoped()
              .scope([
                "withState",
                { method: ["withMembership", user.id] },
              ])
              .findOne({
                where: {
                  id: change.documentId,
                  teamId: user.teamId,
                  deletedAt: null,
                  archivedAt: null,
                },
                transaction: t,
              });
            Logger.info("task", `kanban confirm: processing document change for documentId=${change.documentId}`);

            if (!doc) {
              Logger.warn(
                `kanban confirm: document not found: ${change.documentId}, skipping`
              );
              continue;
            }

            Logger.info("task", `kanban confirm: checking auth for doc ${doc.id}`, {
              isActive: doc.isActive,
              collectionId: doc.collectionId,
              isDraft: doc.isDraft,
              createdById: doc.createdById,
              userId: user.id,
              state: doc.state
            });
            authorize(user, "update", doc);

            const allTextEdits = (change.textEdits ?? []) as Array<{
              oldString: string;
              newString: string;
              description: string;
            }>;
            const selectedIndices = editIndicesMap?.get(change.documentId);
            const textEdits = selectedIndices
              ? allTextEdits.filter((_, i) => selectedIndices.includes(i))
              : allTextEdits;
            Logger.info("task", `kanban confirm: textEdits for documentId=${change.documentId}`, { textEdits });
            if (textEdits.length === 0) {
              // No specific edits — nothing to change for this document
              documentId = documentId ?? doc.id;
              continue;
            }

            const failedEditDescriptions: string[] = [];
            let newText = await DocumentHelper.toMarkdown(doc, { includeTitle: false });
            for (const edit of textEdits) {
              if (edit.oldString === "") {
                // Append mode
                newText = newText + "\n" + edit.newString;
              } else if (newText.includes(edit.oldString)) {
                newText = newText.replace(edit.oldString, edit.newString);
              } else {
                // Fallback: try matching with optional <br> tags at whitespace positions.
                // This handles the case where the AI agent stripped <br> from oldString
                // even though the document contains them in table cells.
                let applied = false;
                if (edit.oldString.length > 10) {
                  try {
                    const escapedOld = edit.oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const flexiblePattern = escapedOld.replace(/(?:\\ )+/g, "(?:\\s*<br\\s*\\/?>\\s*|\\s+)");
                    const flexRegex = new RegExp(flexiblePattern, "g");
                    const matches = [...newText.matchAll(flexRegex)];
                    if (matches.length === 1) {
                      newText = newText.replace(flexRegex, edit.newString);
                      Logger.info("task",
                        `kanban confirm: <br>-normalized match applied for doc ${change.documentId}`
                      );
                      applied = true;
                    }
                  } catch {
                    // regex build failed, fall through to warn
                  }
                }
                if (!applied) {
                  const preview = edit.oldString.slice(0, 60);
                  const desc = edit.description
                    ? `"${edit.description}" (${preview}...)`
                    : `"${preview}..."`;
                  failedEditDescriptions.push(desc);
                  Logger.warn(
                    `kanban confirm: textEdit oldString not found in doc ${change.documentId}: "${edit.oldString.slice(0, 80)}"`
                  );
                }
              }
            }
            allFailedEdits.push(...failedEditDescriptions);
            Logger.info("task", `kanban confirm: newText for documentId=${change.documentId}`, { newText });
            await documentUpdater(ctx, {
              document: doc,
              text: newText,
            });

            documentId = documentId ?? doc.id;
            Logger.info("task", `kanban confirm: completed document update for documentId=${change.documentId}`);
          }
        }
        if (preview.action === "delete_document" && deleteDocumentIds && deleteDocumentIds.length > 0) {
          for (const docId of deleteDocumentIds) {
            try {
              const docToDelete = await Document.findByPk(docId, { userId: user.id, transaction: t });
              if (!docToDelete) { continue; }
              authorize(user, "delete", docToDelete);
              await docToDelete.delete(user);
              await Event.createFromContext(ctx, {
                name: "documents.delete",
                documentId: docToDelete.id,
                collectionId: docToDelete.collectionId,
                data: { title: docToDelete.title },
              });
            } catch (deleteErr) {
              Logger.warn(`KanbanConfirm: cannot delete document ${docId}: ${deleteErr}`);
            }
          }
        }
        // "none": không thực hiện thao tác nào
      } catch (error: unknown) {
        const docErrorMessage =
          error instanceof Error ? error.message : "Document operation failed";
        await card.update(
          {
            implementStatus: "failed",
            implementError: docErrorMessage,
            implementHistory: [
              ...(card.implementHistory ?? []),
              {
                at: new Date().toISOString(),
                status: "failed",
                error: docErrorMessage,
                userId: user.id,
                userName: user.name,
              },
            ],
          },
          { transaction: t }
        );
        throw ValidationError(`Document operation failed: ${docErrorMessage}`);
      }

      // Find or create "Reviewing" list
      const boardId = card.list.boardId;

      let reviewingList = await KanbanList.findOne({
        where: { boardId, name: "Reviewing" },
        transaction: t,
      });

      if (!reviewingList) {
        const allLists = await KanbanList.findAll({
          where: { boardId },
          order: [["index", "DESC"]],
          limit: 1,
          transaction: t,
        });

        const lastIndex = allLists[0]?.index ?? "a0";
        const newIndex = lastIndex + "z";

        reviewingList = await KanbanList.create(
          {
            name: "Reviewing",
            boardId,
            index: newIndex,
            teamId: user.teamId,
            createdById: user.id,
          } as any,
          { transaction: t }
        );
      }

      const existingRelated = card.relatedDocuments || [];
      const existingRelatedIds = new Set(existingRelated.map((d) => d.id));
      const newDocsToAdd = createdDocs.filter((d) => !existingRelatedIds.has(d.id));

      await card.update(
        {
          listId: reviewingList.id,
          implementStatus: "completed",
          implementError: null,
          implementPreview: null,
          implementedDocumentId: documentId,
          implementedAt: new Date(),
          implementedById: user.id,
          implementHistory: [
            ...(card.implementHistory ?? []),
            {
              at: new Date().toISOString(),
              status: "completed",
              documentId: documentId ?? undefined,
              documentIds: createdDocs.length > 0 ? createdDocs.map((d) => d.id) : undefined,
              userId: user.id,
              userName: user.name,
              preview: preview,
            },
          ],
          ...(newDocsToAdd.length > 0
            ? {
              relatedDocuments: [
                ...existingRelated.filter(
                  (d): d is { id: string; title: string; url: string } => d !== null
                ),
                ...newDocsToAdd,
              ],
            }
            : {}),
        },
        { transaction: t }
      );

      await card.reload({
        include: [
          { model: User, as: "createdBy" },
          { model: User, as: "members" },
          { model: User, as: "implementedBy" },
        ],
        transaction: t,
      });

      await Event.create(
        {
          name: "kanban_cards.implement",
          modelId: card.id,
          teamId: user.teamId,
          actorId: user.id,
          ip: ctx.request.ip,
          data: {
            action: preview.action,
            documentId,
            reasoning: preview.reasoning,
          },
        },
        { transaction: t }
      );

      ctx.body = {
        data: presentKanbanCard(card),
        reviewingList: {
          id: reviewingList.id,
          name: reviewingList.name,
          index: reviewingList.index,
          boardId: reviewingList.boardId,
        },
        ...(allFailedEdits.length > 0 ? { warnings: allFailedEdits } : {}),
      };
    });
  }
);

// Cancel implement: reset preview_ready back to idle
router.post(
  "kanban.cards.implement.cancel",
  auth(),
  validate(T.KanbanCardsImplementCancelSchema),
  async (ctx: APIContext<T.KanbanCardsImplementCancelReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const card = await KanbanCard.findByPk(id, {
      include: [
        {
          model: KanbanList,
          as: "list",
          include: [
            {
              model: KanbanBoard,
              as: "board",
              where: { teamId: user.teamId },
            },
          ],
        },
        { model: User, as: "createdBy" },
        { model: User, as: "members" },
      ],
    });

    if (!card) {
      throw ValidationError("Card not found");
    }

    if (card.implementStatus !== "preview_ready") {
      throw ValidationError("Card is not in preview_ready state");
    }

    authorize(user, "update", card.list.board);

    await card.update({
      implementStatus: "idle",
      implementPreview: null,
      implementError: null,
    });

    ctx.body = { data: presentKanbanCard(card) };
  }
);

async function getDocumentCollection(
  documentId: string,
  teamId: string
): Promise<string | null> {
  const doc = await Document.findOne({
    where: { id: documentId, teamId },
    attributes: ["collectionId"],
  });
  return doc?.collectionId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban Template Proxy Routes
// Proxy tới Python backend với X-Internal-Secret — browser không bao giờ thấy secret
// ─────────────────────────────────────────────────────────────────────────────

const PYTHON_BACKEND_URL = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

function buildTemplateHeaders(userId: string, teamId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Key": userId,
    "X-Workspace-Id": teamId,
    ...(env.INTERNAL_API_SECRET ? { "X-Internal-Secret": env.INTERNAL_API_SECRET } : {}),
  };
}

router.post(
  "kanban.templates.list",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const url = new URL(`${PYTHON_BACKEND_URL}/kanban/templates`);
    url.searchParams.set("user_id", user.id);
    url.searchParams.set("team_id", user.teamId);

    const res = await fetch(url.toString(), {
      headers: buildTemplateHeaders(user.id, user.teamId),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

router.post(
  "kanban.templates.create",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const { name, content } = ctx.request.body as { name: string; content: string };

    const res = await fetch(`${PYTHON_BACKEND_URL}/kanban/templates`, {
      method: "POST",
      headers: buildTemplateHeaders(user.id, user.teamId),
      body: JSON.stringify({ user_id: user.id, team_id: user.teamId, name, content }),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

router.post(
  "kanban.templates.update",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const { id, name, content } = ctx.request.body as { id: string; name: string; content: string };

    const res = await fetch(`${PYTHON_BACKEND_URL}/kanban/templates/${id}`, {
      method: "PUT",
      headers: buildTemplateHeaders(user.id, user.teamId),
      body: JSON.stringify({ name, content }),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

router.post(
  "kanban.templates.delete",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const { id } = ctx.request.body as { id: string };

    const res = await fetch(`${PYTHON_BACKEND_URL}/kanban/templates/${id}`, {
      method: "DELETE",
      headers: buildTemplateHeaders(user.id, user.teamId),
    });
    if (!res.ok && res.status !== 204) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.status = 204;
  }
);

router.post(
  "kanban.templates.select",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const { id } = ctx.request.body as { id: string };
    const url = new URL(`${PYTHON_BACKEND_URL}/kanban/templates/${id}/select`);
    url.searchParams.set("user_id", user.id);
    url.searchParams.set("team_id", user.teamId);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: buildTemplateHeaders(user.id, user.teamId),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

router.post(
  "kanban.templates.deselect",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const url = new URL(`${PYTHON_BACKEND_URL}/kanban/templates/deselect-active`);
    url.searchParams.set("user_id", user.id);
    url.searchParams.set("team_id", user.teamId);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: buildTemplateHeaders(user.id, user.teamId),
    });
    if (!res.ok && res.status !== 204) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.status = 204;
  }
);

export default router;
