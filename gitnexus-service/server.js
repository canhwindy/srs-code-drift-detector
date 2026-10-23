/**
 * GitNexus Service — Repo lifecycle manager + MCP server launcher.
 *
 * Manages git repos: clone, pull, delete, and runs `npx gitnexus analyze`
 * to build code-intelligence indexes. Repos are stored in /data/repos/
 * on a shared Docker volume so the gapfinding container can read them.
 *
 * Also registers indexed repos into the gitnexus global registry and starts
 * `gitnexus serve` on GITNEXUS_SERVE_PORT (default 4748) to expose the MCP
 * endpoint at /api/mcp for Claude Code.
 *
 * Endpoints:
 *   POST   /api/repos/register   — Clone repo + run gitnexus analyze
 *   GET    /api/repos/:name/status — Check repo status
 *   POST   /api/repos/:name/pull  — Pull latest + re-analyze
 *   DELETE /api/repos/:name       — Remove repo
 *   GET    /api/repos             — List all repos
 *   GET    /health                — Liveness probe
 */

const express = require("express");
const { execFile, spawn } = require("child_process");
const { simpleGit } = require("simple-git");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || "4747", 10);
const SERVE_PORT = parseInt(process.env.GITNEXUS_SERVE_PORT || "4748", 10);
const REPOS_DIR = process.env.REPOS_DIR || "/data/repos";

// ── In-memory state ──────────────────────────────────────────────────────────

/**
 * @type {Map<string, {
 *   status: "queued"|"cloning"|"analyzing"|"ready"|"error",
 *   repo_url?: string,
 *   branch?: string,
 *   last_indexed?: string,
 *   error?: string,
 *   stats?: object
 * }>}
 */
const repos = new Map();

/** Simple serial queue — gitnexus analyze is CPU-heavy, run one at a time. */
const jobQueue = [];
let jobRunning = false;

function enqueue(fn) {
  jobQueue.push(fn);
  drainQueue();
}

async function drainQueue() {
  if (jobRunning || jobQueue.length === 0) return;
  jobRunning = true;
  const job = jobQueue.shift();
  try {
    await job();
  } catch (err) {
    console.error("[Queue] Job failed:", err.message);
  }
  jobRunning = false;
  drainQueue();
}

// ── Gitnexus binary resolution ───────────────────────────────────────────────

/**
 * Returns [cmd, baseArgs] for running a gitnexus subcommand.
 *
 * When GITNEXUS_BIN=npx, `npx --yes gitnexus` suffers from the npm 10.x
 * arborist bug at runtime. We work around it by finding the pre-cached CLI
 * in ~/.npm/_npx/ and invoking `node <path>` directly.
 */
let _gitnexusCmdCache = null;
function getGitnexusCmd() {
  if (_gitnexusCmdCache) return _gitnexusCmdCache;

  const gitnexusBin = process.env.GITNEXUS_BIN || "gitnexus";

  if (gitnexusBin === "npx") {
    // Walk the npx cache to find the pre-warmed gitnexus CLI
    const npxCache = path.join(process.env.HOME || "/root", ".npm", "_npx");
    if (fs.existsSync(npxCache)) {
      for (const hash of fs.readdirSync(npxCache)) {
        const cliPath = path.join(
          npxCache, hash, "node_modules", "gitnexus", "dist", "cli", "index.js"
        );
        if (fs.existsSync(cliPath)) {
          console.log(`[Gitnexus] Using cached CLI: ${cliPath}`);
          _gitnexusCmdCache = ["node", [cliPath]];
          return _gitnexusCmdCache;
        }
      }
    }
    // Fallback to npx (may hit the arborist bug)
    console.warn("[Gitnexus] npx cache not found, falling back to npx --yes");
    _gitnexusCmdCache = ["npx", ["--yes", "gitnexus"]];
    return _gitnexusCmdCache;
  }

  _gitnexusCmdCache = [gitnexusBin, []];
  return _gitnexusCmdCache;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function repoDir(name) {
  return path.join(REPOS_DIR, name);
}

function deriveRepoName(repoUrl) {
  // "https://github.com/org/repo.git" → "repo"; also strips a trailing slash.
  const trimmed = repoUrl.replace(/\/+$/, "");
  const match = trimmed.match(/\/([^/]+?)(\.git)?$/);
  return match ? match[1] : null;
}

function buildCloneUrl(repoUrl, accessToken) {
  if (!accessToken) return repoUrl;
  try {
    const url = new URL(repoUrl);
    url.username = accessToken;
    url.password = "x-oauth-basic";
    return url.toString();
  } catch {
    return repoUrl;
  }
}

function readMeta(name) {
  const metaPath = path.join(repoDir(name), ".gitnexus", "meta.json");
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Run `npx gitnexus analyze` in the repo directory.
 * Returns a promise that resolves when done.
 */
function runAnalyze(name) {
  return new Promise((resolve, reject) => {
    const dir = repoDir(name);
    console.log(`[Analyze] Starting: ${name} (${dir})`);

    const [cmd, baseArgs] = getGitnexusCmd();
    const child = spawn(cmd, [...baseArgs, "analyze"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`[Analyze] Done: ${name}`);
        resolve(stdout);
      } else {
        console.error(`[Analyze] STDERR:\n${stderr}`);
        console.error(`[Analyze] STDOUT:\n${stdout}`);
        const msg = `gitnexus analyze failed (exit ${code}): ${stderr.slice(-2000)}`;
        reject(new Error(msg));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn gitnexus: ${err.message}`));
    });
  });
}

/**
 * Remove a repo entry from the global registry (~/.gitnexus/registry.json).
 * gitnexus CLI không có subcommand unregister — edit file trực tiếp, filter
 * theo path (robust hơn name vì name trong registry do meta.json quyết định,
 * có thể khác với repo slug trên disk).
 */
function unregisterFromRegistry(name) {
  const registryPath = path.join(
    process.env.HOME || "/root",
    ".gitnexus",
    "registry.json"
  );
  if (!fs.existsSync(registryPath)) return;

  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;

    const targetPath = repoDir(name);
    const remaining = entries.filter((e) => e && e.path !== targetPath);

    if (remaining.length === entries.length) {
      console.log(`[Unregister] No registry entry for ${name} (path=${targetPath})`);
      return;
    }

    fs.writeFileSync(registryPath, JSON.stringify(remaining, null, 2));
    console.log(`[Unregister] Removed ${name} from registry`);
  } catch (err) {
    console.warn(`[Unregister] Failed to update registry for ${name}: ${err.message}`);
  }
}

/**
 * Run `npx gitnexus index <dir>` to register an analyzed repo in the global
 * registry (~/.gitnexus/registry.json) so `gitnexus serve` can serve it.
 */
function runIndex(name) {
  return new Promise((resolve, reject) => {
    const dir = repoDir(name);
    const [cmd, baseArgs] = getGitnexusCmd();
    const child = spawn(cmd, [...baseArgs, "index", dir], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`[Index] Registered in global registry: ${name}`);
        resolve();
      } else {
        const msg = `gitnexus index failed (exit ${code}): ${stderr.slice(-500)}`;
        reject(new Error(msg));
      }
    });
    child.on("error", (err) => reject(new Error(`Failed to spawn gitnexus: ${err.message}`)));
  });
}

/**
 * Register all already-analyzed repos (those with .gitnexus/meta.json) into
 * the global registry. Called once at startup before starting gitnexus serve.
 */
async function indexExistingRepos() {
  if (!fs.existsSync(REPOS_DIR)) return;
  const entries = fs.readdirSync(REPOS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const dir = repoDir(name);
    if (!fs.existsSync(path.join(dir, ".git"))) continue;
    if (!readMeta(name)) continue; // not yet indexed, skip
    try {
      await runIndex(name);
    } catch (err) {
      console.warn(`[Startup] Could not register ${name}: ${err.message}`);
    }
  }
}

/**
 * Start `gitnexus serve` as a long-running child process on SERVE_PORT.
 * Exposes MCP endpoint at /api/mcp (StreamableHTTP transport).
 * Auto-restarts on exit.
 */
function startGitNexusServe() {
  const [cmd, baseArgs] = getGitnexusCmd();

  console.log(`[Serve] Starting gitnexus serve on port ${SERVE_PORT}...`);

  const child = spawn(
    cmd,
    [...baseArgs, "serve", "--port", String(SERVE_PORT), "--host", "0.0.0.0"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    }
  );

  child.stdout.on("data", (d) => process.stdout.write(`[Serve] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[Serve] ${d}`));

  child.on("close", (code) => {
    console.error(`[Serve] Process exited with code ${code}. Restarting in 5s...`);
    setTimeout(startGitNexusServe, 5000);
  });

  child.on("error", (err) => {
    console.error(`[Serve] Failed to spawn: ${err.message}. Retrying in 5s...`);
    setTimeout(startGitNexusServe, 5000);
  });
}

/**
 * Start `gitnexus eval-server` as a long-running child process on EVAL_PORT.
 * Exposes REST HTTP API: POST /query, /context, /impact, /cypher, /detect-changes
 * Used by the Python backend (outline-backend) for gap-finding code intelligence.
 * Auto-restarts on exit.
 */
const EVAL_PORT = parseInt(process.env.GITNEXUS_EVAL_PORT || "4848", 10);
// eval-server chỉ bind 127.0.0.1 — chạy trên port nội bộ, proxy ra 0.0.0.0:EVAL_PORT
const EVAL_INTERNAL_PORT = EVAL_PORT + 1; // 4849 by default

/**
 * Tạo HTTP reverse proxy: 0.0.0.0:EVAL_PORT → 127.0.0.1:EVAL_INTERNAL_PORT
 * Cho phép các container khác (outline-backend) gọi được eval-server.
 */
function startEvalProxy() {
  const http = require("http");
  const proxy = http.createServer((req, res) => {
    const options = {
      hostname: "127.0.0.1",
      port: EVAL_INTERNAL_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });
    proxyReq.on("error", (err) => {
      res.writeHead(502);
      res.end(`Eval-server not ready: ${err.message}`);
    });
    req.pipe(proxyReq, { end: true });
  });
  proxy.listen(EVAL_PORT, "0.0.0.0", () => {
    console.log(`[EvalProxy] Forwarding 0.0.0.0:${EVAL_PORT} → 127.0.0.1:${EVAL_INTERNAL_PORT}`);
  });
  proxy.on("error", (err) => {
    console.error(`[EvalProxy] Proxy error: ${err.message}`);
  });
}

function startGitNexusEvalServer() {
  const [cmd, baseArgs] = getGitnexusCmd();

  console.log(`[EvalServer] Starting gitnexus eval-server on port ${EVAL_INTERNAL_PORT} (internal)...`);

  const child = spawn(
    cmd,
    [...baseArgs, "eval-server", "--port", String(EVAL_INTERNAL_PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    }
  );

  child.stdout.on("data", (d) => process.stdout.write(`[EvalServer] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[EvalServer] ${d}`));

  child.on("close", (code) => {
    console.error(`[EvalServer] Process exited with code ${code}. Restarting in 5s...`);
    setTimeout(startGitNexusEvalServer, 5000);
  });

  child.on("error", (err) => {
    console.error(`[EvalServer] Failed to spawn: ${err.message}. Retrying in 5s...`);
    setTimeout(startGitNexusEvalServer, 5000);
  });
}

async function cloneAndAnalyze(name, repoUrl, accessToken, branch) {
  const dir = repoDir(name);
  const entry = repos.get(name);

  try {
    // Clone
    entry.status = "cloning";
    const cloneUrl = buildCloneUrl(repoUrl, accessToken);

    if (fs.existsSync(path.join(dir, ".git"))) {
      console.log(`[Git] Repo exists, pulling: ${name}`);
      const git = simpleGit(dir);
      await git.pull();
    } else {
      console.log(`[Git] Cloning: ${name}`);
      const opts = ["--depth", "1"];
      if (branch) opts.push("--branch", branch);
      await simpleGit().clone(cloneUrl, dir, opts);
    }

    if (branch) {
      const git = simpleGit(dir);
      await git.checkout(branch);
    }

    // Analyze
    entry.status = "analyzing";
    await runAnalyze(name);

    // Register in global registry for MCP access
    try {
      await runIndex(name);
    } catch (err) {
      console.warn(`[CloneAndAnalyze] Registry registration failed for ${name}: ${err.message}`);
    }

    // Read stats
    const meta = readMeta(name);
    entry.status = "ready";
    entry.last_indexed = meta?.indexedAt || new Date().toISOString();
    entry.stats = meta?.stats || {};
    entry.error = undefined;
  } catch (err) {
    entry.status = "error";
    entry.error = err.message;
    console.error(`[CloneAndAnalyze] ${name}: ${err.message}`);
  }
}

async function pullAndAnalyze(name) {
  const dir = repoDir(name);
  const entry = repos.get(name);

  if (!entry) throw new Error(`Repo '${name}' not registered`);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    throw new Error(`Repo '${name}' not found on disk`);
  }

  try {
    entry.status = "analyzing";
    entry.error = undefined;

    console.log(`[Git] Pulling: ${name}`);
    const git = simpleGit(dir);
    await git.pull();

    await runAnalyze(name);

    // Re-register in global registry (refreshes the entry)
    try {
      await runIndex(name);
    } catch (err) {
      console.warn(`[PullAndAnalyze] Registry re-registration failed for ${name}: ${err.message}`);
    }

    const meta = readMeta(name);
    entry.status = "ready";
    entry.last_indexed = meta?.indexedAt || new Date().toISOString();
    entry.stats = meta?.stats || {};
  } catch (err) {
    entry.status = "error";
    entry.error = err.message;
    console.error(`[PullAndAnalyze] ${name}: ${err.message}`);
  }
}

// ── Startup: scan existing repos ─────────────────────────────────────────────

function scanExistingRepos() {
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
    return;
  }

  const entries = fs.readdirSync(REPOS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const dir = repoDir(name);

    if (!fs.existsSync(path.join(dir, ".git"))) continue;

    const meta = readMeta(name);
    if (meta) {
      // Already indexed
      repos.set(name, {
        status: "ready",
        last_indexed: meta.indexedAt,
        stats: meta.stats || {},
      });
      console.log(`[Startup] Found indexed repo: ${name}`);
    } else {
      // Has git but no index — queue for analyze
      repos.set(name, { status: "queued" });
      console.log(`[Startup] Found unindexed repo, queuing: ${name}`);
      enqueue(() => {
        const e = repos.get(name);
        e.status = "analyzing";
        return runAnalyze(name).then(() => {
          const m = readMeta(name);
          e.status = "ready";
          e.last_indexed = m?.indexedAt || new Date().toISOString();
          e.stats = m?.stats || {};
        }).catch((err) => {
          e.status = "error";
          e.error = err.message;
        });
      });
    }
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", repos_count: repos.size });
});

app.get("/api/repos", (_req, res) => {
  const list = [];
  for (const [name, info] of repos) {
    list.push({ name, ...info });
  }
  res.json(list);
});

app.get("/api/repos/:name/status", (req, res) => {
  const { name } = req.params;
  const entry = repos.get(name);
  if (!entry) {
    return res.status(404).json({ error: `Repo '${name}' not found` });
  }
  res.json({ name, ...entry });
});

app.post("/api/repos/register", (req, res) => {
  const { repo_url, access_token, branch, repo_name } = req.body;

  if (!repo_url) {
    return res.status(400).json({ error: "repo_url is required" });
  }

  const name = repo_name || deriveRepoName(repo_url);
  if (!name) {
    return res.status(400).json({ error: "Could not derive repo name from URL" });
  }

  // If already processing, return current status
  const existing = repos.get(name);
  if (existing && ["cloning", "analyzing"].includes(existing.status)) {
    return res.status(202).json({ repo_name: name, ...existing });
  }

  repos.set(name, {
    status: "queued",
    repo_url,
    branch: branch || undefined,
  });

  enqueue(() => cloneAndAnalyze(name, repo_url, access_token, branch));

  res.status(202).json({ repo_name: name, status: "queued" });
});

app.post("/api/repos/:name/pull", (req, res) => {
  const { name } = req.params;
  const entry = repos.get(name);

  if (!entry) {
    return res.status(404).json({ error: `Repo '${name}' not registered` });
  }

  if (["cloning", "analyzing"].includes(entry.status)) {
    return res.status(202).json({ repo_name: name, ...entry });
  }

  // Accept optional access_token for re-auth
  const { access_token } = req.body || {};

  enqueue(() => pullAndAnalyze(name));

  res.status(202).json({ repo_name: name, status: "queued" });
});

app.delete("/api/repos/:name", (req, res) => {
  const { name } = req.params;
  const dir = repoDir(name);

  repos.delete(name);

  // Remove from global registry BEFORE deleting repo dir — nếu để ngược lại,
  // unregisterFromRegistry không phát hiện được (registry path trỏ vào dir đã mất)
  // nhưng thực ra ta filter theo path string nên vẫn ok. Dù vậy để thứ tự này rõ ràng hơn.
  unregisterFromRegistry(name);

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[Delete] Removed: ${name}`);
  }

  res.status(204).end();
});

// ── Start ────────────────────────────────────────────────────────────────────
//
// Index refresh strategy: driven by PR merged events (gap_finding_module publishes
// to pr_events, backend pr_event_worker calls POST /api/repos/:name/pull).
// Không còn periodic poll — tiết kiệm IO + tránh re-analyze khi không có thay đổi.

scanExistingRepos();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`gitnexus-service listening on port ${PORT}`);
  console.log(`  Repos dir: ${REPOS_DIR}`);
  console.log(`  Repos found: ${repos.size}`);
});

// Register already-indexed repos into the global gitnexus registry, then
// start `gitnexus serve` (MCP) and `gitnexus eval-server` (REST API for backend).
indexExistingRepos()
  .then(() => {
    startGitNexusServe();
    startEvalProxy();
    startGitNexusEvalServer();
  })
  .catch((err) => {
    console.error(`[Startup] indexExistingRepos error: ${err.message}`);
    startGitNexusServe();       // start anyway — new repos will register after analyze
    startEvalProxy();
    startGitNexusEvalServer();
  });
