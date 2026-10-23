import type { ServerResponse } from "http";
import httpProxy from "http-proxy";
import type { Context, Next } from "koa";
import env from "@server/env";
import Logger from "@server/logging/Logger";

type ProxyRoute = {
  prefix: string;
  target: string | undefined;
};

const routes: ProxyRoute[] = [
  { prefix: "/python-api", target: env.PYTHON_BACKEND_URL },
  { prefix: "/filesplit-api", target: env.FILE_SPLIT_API_URL },
  { prefix: "/cliproxy", target: env.CLIPROXY_BASE_URL },
  { prefix: "/gapfinding", target: env.GAPFINDING_BASE_URL },
];

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
  proxyTimeout: 120_000,
});

proxy.on("error", (err, _req, res) => {
  Logger.warn(`serviceProxy upstream error: ${err.message}`);
  const response = res as ServerResponse | undefined;
  if (response && !response.headersSent) {
    try {
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: "Bad gateway", detail: err.message })
      );
    } catch {
      // response already ended
    }
  }
});

/**
 * Forward requests under known prefixes to their upstream service containers.
 * Keeps the client browser talking to a single origin; internal URLs stay in env.
 */
export default function serviceProxy() {
  return async (ctx: Context, next: Next) => {
    const route = routes.find(
      (r) =>
        !!r.target &&
        (ctx.path === r.prefix || ctx.path.startsWith(r.prefix + "/"))
    );

    if (!route || !route.target) {
      return next();
    }

    ctx.respond = false;

    const strippedPath = ctx.path.slice(route.prefix.length) || "/";
    ctx.req.url = strippedPath + (ctx.search || "");

    await new Promise<void>((resolve, reject) => {
      ctx.res.on("close", resolve);
      ctx.res.on("finish", resolve);
      proxy.web(
        ctx.req,
        ctx.res,
        { target: route.target! },
        (err?: Error) => {
          if (err) {
            reject(err);
          }
        }
      );
    });
  };
}
