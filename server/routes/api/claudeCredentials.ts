import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import env from "@server/env";
import type { APIContext } from "@server/types";

const router = new Router();

const PYTHON_URL = env.PYTHON_BACKEND_URL ?? "http://localhost:8000";

function buildHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Key": userId,
    ...(env.INTERNAL_API_SECRET ? { "X-Internal-Secret": env.INTERNAL_API_SECRET } : {}),
  };
}

router.post(
  "claudeCredentials.status",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const res = await fetch(`${PYTHON_URL}/api/claude-credentials`, {
      headers: buildHeaders(user.id),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

router.post(
  "claudeCredentials.verify",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const res = await fetch(`${PYTHON_URL}/api/claude-credentials/verify`, {
      headers: buildHeaders(user.id),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

router.post(
  "claudeCredentials.save",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const { credentials_json } = ctx.request.body as { credentials_json: string };

    const res = await fetch(`${PYTHON_URL}/api/claude-credentials`, {
      method: "POST",
      headers: buildHeaders(user.id),
      body: JSON.stringify({ credentials_json }),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

router.post(
  "claudeCredentials.delete",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const res = await fetch(`${PYTHON_URL}/api/claude-credentials`, {
      method: "DELETE",
      headers: buildHeaders(user.id),
    });
    if (!res.ok) {
      ctx.throw(res.status >= 500 ? 502 : res.status);
    }
    ctx.body = { data: await res.json() };
  }
);

export default router;
