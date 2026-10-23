/**
 * Type definitions for Card Detail components.
 */

export interface Member {
  id: string;
  name: string;
  avatarUrl: string;
  email: string;
}

export interface RelatedDocument {
  id: string;
  title: string;
  url: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  url: string;
}

export interface CommentReply {
  id: string;
  content: string;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
    avatarUrl?: string;
  } | null;
  replies?: CommentReply[];
  attachments?: Attachment[];
}

export interface ActivityEvent {
  id: string;
  name: string;
  data: {
    previousListName?: string;
    newListName?: string;
    title?: string;
    description?: string;
    comment?: string;
    commentId?: string;
    replies?: CommentReply[];
    attachments?: Attachment[];
    checklistTitle?: string;
    itemTitle?: string;
    // Title update
    previousTitle?: string;
    newTitle?: string;
    // Description update
    previousDescription?: string;
    newDescription?: string;
    // Due date update
    previousDueDate?: string | null;
    newDueDate?: string | null;
    // Member changes
    memberId?: string;
    memberName?: string;
    memberEmail?: string;
  };
  createdAt: string;
  actor: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
}

export interface ChecklistItem {
  id: string;
  title: string;
  isCompleted: boolean;
  index: string;
  checklistId: string;
}

export interface Checklist {
  id: string;
  title: string;
  cardId: string;
  items: ChecklistItem[];
  completedCount: number;
  totalCount: number;
}
