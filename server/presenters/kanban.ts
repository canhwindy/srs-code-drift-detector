import type KanbanBoard from "@server/models/KanbanBoard";
import type KanbanList from "@server/models/KanbanList";
import type KanbanCard from "@server/models/KanbanCard";
import { KANBAN_PRIORITIES } from "@server/models/KanbanCard";
import type KanbanChecklist from "@server/models/KanbanChecklist";
import type KanbanChecklistItem from "@server/models/KanbanChecklistItem";
import type KanbanCardComment from "@server/models/KanbanCardComment";

/**
 * Present a kanban board.
 *
 * @param board - The kanban board to present.
 * @returns the board data.
 */
export default function presentKanbanBoard(board: KanbanBoard) {
  return {
    id: board.id,
    name: board.name,
    description: board.description,
    color: board.color,
    index: board.index,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    createdBy: board.createdBy ? {
      id: board.createdBy.id,
      name: board.createdBy.name,
      avatarUrl: board.createdBy.avatarUrl,
    } : null,
  };
}

/**
 * Present a kanban board with full details including lists and cards.
 *
 * @param board - The kanban board to present.
 * @returns the board data with lists and cards.
 */
export function presentKanbanBoardWithDetails(board: KanbanBoard & {
  lists?: KanbanList[];
}) {
  return {
    ...presentKanbanBoard(board),
    lists: board.lists?.map(presentKanbanList) || [],
    priorities: KANBAN_PRIORITIES,
  };
}

/**
 * Present a kanban list.
 *
 * @param list - The kanban list to present.
 * @returns the list data.
 */
export function presentKanbanList(list: KanbanList & { cards?: KanbanCard[] }) {
  return {
    id: list.id,
    name: list.name,
    index: list.index,
    boardId: list.boardId,
    cards: list.cards?.map(presentKanbanCard) || [],
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

/**
 * Present a kanban card.
 *
 * @param card - The kanban card to present.
 * @returns the card data.
 */
export function presentKanbanCard(card: KanbanCard) {
  const priorityInfo = card.priority
    ? KANBAN_PRIORITIES.find(p => p.value === card.priority)
    : null;

  const lastCompletedEntry = card.implementHistory
    ?.filter(h => h.status === "completed")
    .at(-1);

  return {
    id: card.id,
    title: card.title,
    description: card.description,
    color: card.color,
    index: card.index,
    listId: card.listId,
    dueDate: card.dueDate,
    priority: card.priority,
    priorityLabel: priorityInfo?.label || null,
    priorityColor: priorityInfo?.color || null,
    members: card.members?.map(member => ({
      id: member.id,
      name: member.name,
      avatarUrl: member.avatarUrl,
      email: member.email,
    })) || [],
    relatedDocuments: card.relatedDocuments || [],
    implementStatus: card.implementStatus ?? "idle",
    implementError: card.implementError ?? null,
    implementPreview: card.implementPreview ?? null,
    implementedDocumentId: card.implementedDocumentId ?? null,
    implementedAt: card.implementedAt ?? null,
    implementedByName: lastCompletedEntry?.userName ?? null,
    implementHistory: card.implementHistory ?? [],
    impactAnalysis: card.impactAnalysis ?? null,
    createdBy: {
      id: card.createdBy.id,
      name: card.createdBy.name,
      avatarUrl: card.createdBy.avatarUrl,
    },
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

/**
 * Present a kanban checklist.
 *
 * @param checklist - The kanban checklist to present.
 * @returns the checklist data.
 */
export function presentKanbanChecklist(checklist: KanbanChecklist & { items?: KanbanChecklistItem[] }) {
  const items = checklist.items || [];
  const completedCount = items.filter(item => item.isCompleted).length;

  return {
    id: checklist.id,
    title: checklist.title,
    index: checklist.index,
    cardId: checklist.cardId,
    items: items.map(item => ({
      id: item.id,
      title: item.title,
      isCompleted: item.isCompleted,
      index: item.index,
      completedById: item.completedById,
      completedAt: item.completedAt,
    })),
    completedCount,
    totalCount: items.length,
    createdAt: checklist.createdAt,
    updatedAt: checklist.updatedAt,
  };
}

/**
 * Present a kanban card comment.
 *
 * @param comment - The kanban card comment to present.
 * @returns the comment data.
 */
export function presentKanbanCardComment(comment: KanbanCardComment): Record<string, unknown> {
  return {
    id: comment.id,
    content: comment.content,
    cardId: comment.cardId,
    parentId: comment.parentId || null,
    createdBy: comment.createdBy ? {
      id: comment.createdBy.id,
      name: comment.createdBy.name,
      avatarUrl: comment.createdBy.avatarUrl,
    } : null,
    replies: comment.replies?.map(reply => presentKanbanCardComment(reply)) || [],
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}
