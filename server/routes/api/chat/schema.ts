import { z } from "zod";
import { BaseSchema } from "../schema";

// ─────────────────────────────────────────────────────────
// chat.conversations.list
// POST /api/chat.conversations.list
// Lấy danh sách conversations của user trong workspace hiện tại
// ─────────────────────────────────────────────────────────
export const ChatConversationsListSchema = BaseSchema.extend({
  body: z.object({
    workspace_id: z.string().min(1, "workspace_id is required"),
  }),
});
export type ChatConversationsListReq = z.infer<
  typeof ChatConversationsListSchema
>;

// ─────────────────────────────────────────────────────────
// chat.conversations.create
// POST /api/chat.conversations.create
// Tạo một conversation mới trong workspace
// ─────────────────────────────────────────────────────────
export const ChatConversationsCreateSchema = BaseSchema.extend({
  body: z.object({
    workspace_id: z.string().min(1, "workspace_id is required"),
    title: z.string().optional(),
  }),
});
export type ChatConversationsCreateReq = z.infer<
  typeof ChatConversationsCreateSchema
>;

// ─────────────────────────────────────────────────────────
// chat.messages.list
// POST /api/chat.messages.list
// Lấy toàn bộ messages của một conversation
// ─────────────────────────────────────────────────────────
export const ChatMessagesListSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1, "conversation_id is required"),
    workspace_id: z.string().min(1, "workspace_id is required"),
  }),
});
export type ChatMessagesListReq = z.infer<typeof ChatMessagesListSchema>;

// ─────────────────────────────────────────────────────────
// chat.messages.send
// POST /api/chat.messages.send
// Gửi tin nhắn và nhận AI response
// ─────────────────────────────────────────────────────────
export const ChatMessagesSendSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1, "conversation_id is required"),
    workspace_id: z.string().min(1, "workspace_id is required"),
    content: z.string().min(1, "content cannot be empty"),
  }),
});
export type ChatMessagesSendReq = z.infer<typeof ChatMessagesSendSchema>;

// ─────────────────────────────────────────────────────────
// chat.conversations.rename
// POST /api/chat.conversations.rename
// Đổi tên một conversation
// ─────────────────────────────────────────────────────────
export const ChatConversationsRenameSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1, "conversation_id is required"),
    workspace_id: z.string().min(1, "workspace_id is required"),
    title: z.string().min(1, "title cannot be empty"),
  }),
});
export type ChatConversationsRenameReq = z.infer<
  typeof ChatConversationsRenameSchema
>;

// ─────────────────────────────────────────────────────────
// chat.conversations.delete
// POST /api/chat.conversations.delete
// Xóa một conversation và toàn bộ messages của nó
// ─────────────────────────────────────────────────────────
export const ChatConversationsDeleteSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1, "conversation_id is required"),
    workspace_id: z.string().min(1, "workspace_id is required"),
  }),
});
export type ChatConversationsDeleteReq = z.infer<
  typeof ChatConversationsDeleteSchema
>;
