import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import env from "@server/env";
import type { APIContext } from "@server/types";
import * as T from "./schema";

const router = new Router();

// URL của Python FastAPI backend (từ env, fallback về localhost:8000)
const PYTHON_URL = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

/**
 * Build headers để forward tới Python backend.
 * Bao gồm X-Internal-Secret để xác thực backend-to-backend.
 */
function buildPythonHeaders(
  userId: string,
  workspaceId: string
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Key": userId,
    "X-Workspace-Id": workspaceId,
    ...(env.INTERNAL_API_SECRET
      ? { "X-Internal-Secret": env.INTERNAL_API_SECRET }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.list
// POST /api/chat.conversations.list
// Lấy danh sách conversations của user trong workspace hiện tại
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.list",
  auth(),
  validate(T.ChatConversationsListSchema),
  async (ctx: APIContext<T.ChatConversationsListReq>) => {
    const { user } = ctx.state.auth;

    const response = await fetch(`${PYTHON_URL}/api/conversations`, {
      method: "GET",
      headers: buildPythonHeaders(user.id, user.teamId),
    });

    if (!response.ok) {
      ctx.throw(response.status >= 500 ? 502 : 404, "Not Found");
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.create
// POST /api/chat.conversations.create
// Tạo một conversation mới trong workspace
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.create",
  auth(),
  validate(T.ChatConversationsCreateSchema),
  async (ctx: APIContext<T.ChatConversationsCreateReq>) => {
    const { user } = ctx.state.auth;
    const { title } = ctx.input.body;

    const response = await fetch(`${PYTHON_URL}/api/conversations`, {
      method: "POST",
      headers: buildPythonHeaders(user.id, user.teamId),
      body: JSON.stringify({
        title: title ?? "New conversation",
        user_id: user.id,
        workspace_id: user.teamId,
      }),
    });

    if (!response.ok) {
      ctx.throw(502, "Chat service error");
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.messages.list
// POST /api/chat.messages.list
// Lấy toàn bộ messages của một conversation
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.messages.list",
  auth(),
  validate(T.ChatMessagesListSchema),
  async (ctx: APIContext<T.ChatMessagesListReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${conversation_id}/messages`,
      {
        method: "GET",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      ctx.throw(404, "Not Found");
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.messages.send
// POST /api/chat.messages.send
// Gửi tin nhắn và nhận AI response — có thể mất tới 60-120s do LightRAG
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.messages.send",
  auth(),
  validate(T.ChatMessagesSendSchema),
  async (ctx: APIContext<T.ChatMessagesSendReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id, content } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${conversation_id}/messages`,
      {
        method: "POST",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({
          content,
          user_id: user.id,
          workspace_id: user.teamId,
        }),
        // LightRAG query có thể mất nhiều thời gian — timeout 120s
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!response.ok) {
      // Set response trực tiếp thay vì ctx.throw để tránh apiErrorHandler
      // biến 401 (CLAUDE_CREDENTIAL_MISSING) thành 404 do regex /Not found/i.
      const errorBody = await response.json().catch(() => ({}));
      ctx.status = response.status < 500 ? response.status : 502;
      ctx.body = errorBody;
      return;
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.rename
// POST /api/chat.conversations.rename
// Đổi tên một conversation
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.rename",
  auth(),
  validate(T.ChatConversationsRenameSchema),
  async (ctx: APIContext<T.ChatConversationsRenameReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id, title } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${conversation_id}`,
      {
        method: "PATCH",
        headers: buildPythonHeaders(user.id, user.teamId),
        body: JSON.stringify({ title }),
      }
    );

    if (!response.ok) {
      ctx.throw(404, "Not Found");
    }

    ctx.body = await response.json();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// chat.conversations.delete
// POST /api/chat.conversations.delete
// Xóa một conversation và toàn bộ messages của nó
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "chat.conversations.delete",
  auth(),
  validate(T.ChatConversationsDeleteSchema),
  async (ctx: APIContext<T.ChatConversationsDeleteReq>) => {
    const { user } = ctx.state.auth;
    const { conversation_id } = ctx.input.body;

    const response = await fetch(
      `${PYTHON_URL}/api/conversations/${conversation_id}`,
      {
        method: "DELETE",
        headers: buildPythonHeaders(user.id, user.teamId),
      }
    );

    if (!response.ok) {
      ctx.throw(404, "Not Found");
    }

    ctx.body = await response.json();
  }
);

export default router;
