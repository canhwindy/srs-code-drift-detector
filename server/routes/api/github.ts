import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import env from "@server/env";
import GitHubIntegration from "@server/services/githubIntergration";
import GithubConfig from "@server/models/GithubConfig";
import type { GithubRepository } from "@server/models/GithubConfig";
import { publishGithubConfigEvent } from "@server/services/githubConfigPublisher";
import {
    registerRepoWithGitnexus,
    unregisterRepoFromGitnexus,
} from "@server/services/gitnexusRegistry";

const router = new Router();

/**
 * Helper function to parse repository URL and extract owner/repo
 */
function parseRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
        return null;
    }
    return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, "").replace(/\/$/, ""),
    };
}

/**
 * Helper function to get GitHub config from database for the user's team.
 * Falls back to environment variables if no DB config exists.
 *
 * When repoIndex is specified (via X-Github-Repo-Index header or query param),
 * returns that specific repository's config.
 */
async function getGitHubConfigFromDB(ctx: any): Promise<{
    apiKey: string | null;
    repository: string | null;
    webhookSecret: string | null;
    repositories: GithubRepository[];
}> {
    const { user } = ctx.state.auth;

    // 1. Try database first
    const config = await GithubConfig.findOne({
        where: { teamId: user.teamId },
    });

    if (config) {
        // Determine which repo to use
        const repoIndex = parseInt(
            ctx.request.headers["x-github-repo-index"] as string ||
            ctx.query.repoIndex as string ||
            "0"
        ) || 0;

        const repo = config.repositories[repoIndex] || config.repositories[0];

        return {
            apiKey: config.apiKey,
            repository: repo ? repo.url : null,
            webhookSecret: repo?.webhookSecret || null,
            repositories: config.repositories,
        };
    }

    // 2. Fallback to environment variables
    return {
        apiKey: env.GITHUB_API_KEY || null,
        repository: env.GITHUB_REPOSITORY || null,
        webhookSecret: null,
        repositories: [],
    };
}

// ============================================================
// Configuration CRUD endpoints
// ============================================================

/**
 * GET /api/github.config
 * Get current GitHub configuration for the workspace.
 * Any authenticated user can view the config (API key is masked).
 */
router.get("github.config", auth(), async (ctx) => {
    const { user } = ctx.state.auth;

    const config = await GithubConfig.findOne({
        where: { teamId: user.teamId },
    });

    if (!config) {
        ctx.body = {
            data: {
                configured: false,
                repositories: [],
                hasApiKey: false,
                isAdmin: user.isAdmin,
            },
        };
        return;
    }

    ctx.body = {
        data: {
            configured: true,
            repositories: config.repositories.map((r) => ({
                url: r.url,
                owner: r.owner,
                repo: r.repo,
                webhookSecretMasked: r.webhookSecret
                    ? "*".repeat(16) + r.webhookSecret.slice(-4)
                    : null,
            })),
            hasApiKey: !!config.apiKey,
            // Mask the API key - show only last 4 chars
            apiKeyMasked: config.apiKey
                ? "ghp_" + "*".repeat(16) + config.apiKey.slice(-4)
                : null,
            claudeProjectDir: config.claudeProjectDir || "",
            isAdmin: user.isAdmin,
            configuredBy: config.userId,
        },
    };
});

/**
 * POST /api/github.saveConfig
 * Save or update GitHub configuration for the workspace.
 * Only admin users can save configuration.
 */
router.post("github.saveConfig", auth(), async (ctx) => {
    const { user } = ctx.state.auth;

    if (!user.isAdmin) {
        ctx.throw(403, "Only workspace admins can configure GitHub settings");
        return;
    }

    const { apiKey, repositories, claudeProjectDir } = ctx.request.body as {
        apiKey?: string;
        repositories?: Array<{ url: string; webhookSecret?: string }>;
        claudeProjectDir?: string;
    };

    if (!repositories || repositories.length === 0) {
        ctx.throw(400, "At least one repository is required");
        return;
    }

    // Parse and validate all repository URLs
    const parsedRepos: GithubRepository[] = [];
    for (const repo of repositories) {
        if (!repo.url?.trim()) {
            continue;
        }
        const parsed = parseRepoUrl(repo.url.trim());
        if (!parsed) {
            ctx.throw(400, `Invalid repository URL: ${repo.url}`);
            return;
        }
        parsedRepos.push({
            url: repo.url.trim(),
            owner: parsed.owner,
            repo: parsed.repo,
            webhookSecret: repo.webhookSecret?.trim() || undefined,
        });
    }

    if (parsedRepos.length === 0) {
        ctx.throw(400, "At least one valid repository URL is required");
        return;
    }

    // Upsert: update if exists, create if not
    const existing = await GithubConfig.findOne({
        where: { teamId: user.teamId },
    });

    if (existing) {
        // Only update apiKey if a new (non-empty) key is provided
        if (apiKey?.trim()) {
            existing.apiKey = apiKey.trim();
        }

        // For each repo, preserve existing webhookSecret if not re-submitted
        const existingRepoMap = new Map(
            existing.repositories.map((r) => [r.url, r])
        );
        const finalRepos = parsedRepos.map((r) => {
            const prev = existingRepoMap.get(r.url);
            return {
                ...r,
                // Keep existing secret if new value is empty/not provided
                webhookSecret: r.webhookSecret || prev?.webhookSecret || undefined,
            };
        });

        existing.repositories = finalRepos;
        existing.userId = user.id;
        if (claudeProjectDir !== undefined) {
            existing.claudeProjectDir = claudeProjectDir.trim() || null;
        }
        await existing.save();

        void publishGithubConfigEvent({
            event: "config.upserted",
            teamId: user.teamId,
            apiKey: existing.apiKey,
            repositories: existing.repositories,
            claudeProjectDir: existing.claudeProjectDir,
            userId: user.id,
        });

        // Auto-register each repo with gitnexus-service for code intelligence.
        for (const repo of existing.repositories) {
            void registerRepoWithGitnexus(repo.url, existing.apiKey);
        }

        ctx.body = {
            success: true,
            data: {
                configured: true,
                repositories: existing.repositories.map((r) => ({
                    url: r.url,
                    owner: r.owner,
                    repo: r.repo,
                })),
            },
        };
    } else {
        // New config requires an API key
        if (!apiKey?.trim()) {
            ctx.throw(400, "GitHub API Key is required for initial configuration");
            return;
        }

        const config = await GithubConfig.create({
            teamId: user.teamId,
            userId: user.id,
            apiKey: apiKey.trim(),
            repositories: parsedRepos,
            claudeProjectDir: claudeProjectDir?.trim() || null,
        });

        void publishGithubConfigEvent({
            event: "config.upserted",
            teamId: user.teamId,
            apiKey: config.apiKey,
            repositories: config.repositories,
            claudeProjectDir: config.claudeProjectDir,
            userId: user.id,
        });

        // Auto-register each repo with gitnexus-service for code intelligence.
        for (const repo of config.repositories) {
            void registerRepoWithGitnexus(repo.url, config.apiKey);
        }

        ctx.body = {
            success: true,
            data: {
                configured: true,
                repositories: config.repositories.map((r) => ({
                    url: r.url,
                    owner: r.owner,
                    repo: r.repo,
                })),
            },
        };
    }
});

/**
 * POST /api/github.deleteConfig
 * Delete GitHub configuration for the workspace.
 * Only admin users can delete configuration.
 */
router.post("github.deleteConfig", auth(), async (ctx) => {
    const { user } = ctx.state.auth;

    if (!user.isAdmin) {
        ctx.throw(403, "Only workspace admins can delete GitHub configuration");
        return;
    }

    const existing = await GithubConfig.findOne({
        where: { teamId: user.teamId },
    });

    // Hard-delete: bypass ParanoidModel soft-delete so teamId unique constraint
    // does not block re-creating a config for the same team.
    await GithubConfig.destroy({
        where: { teamId: user.teamId },
        force: true,
    });

    void publishGithubConfigEvent({
        event: "config.deleted",
        teamId: user.teamId,
    });

    // Unregister each repo from gitnexus-service.
    if (existing) {
        for (const repo of existing.repositories) {
            void unregisterRepoFromGitnexus(repo.url);
        }
    }

    ctx.body = {
        success: true,
    };
});

/**
 * POST /api/github.testConnection
 * Test GitHub connection with provided credentials.
 * Only admin users can test connection.
 */
router.post("github.testConnection", auth(), async (ctx) => {
    const { user } = ctx.state.auth;

    if (!user.isAdmin) {
        ctx.throw(403, "Only workspace admins can test GitHub connection");
        return;
    }

    const { apiKey, repository } = ctx.request.body as {
        apiKey?: string;
        repository?: string;
    };

    if (!apiKey) {
        ctx.throw(400, "GitHub API Key not provided");
        return;
    }

    if (!repository) {
        ctx.throw(400, "GitHub Repository not provided");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid GitHub repository URL format");
        return;
    }

    try {
        const github = new GitHubIntegration(
            apiKey,
            repoInfo.owner,
            repoInfo.repo
        );

        const branches = await github.fetchBranches();

        ctx.body = {
            success: true,
            data: {
                owner: repoInfo.owner,
                repo: repoInfo.repo,
                branchCount: branches.length,
                branches: branches.slice(0, 10).map((b: any) => b.name),
            },
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to connect to GitHub");
    }
});

// ============================================================
// GitHub data endpoints (read from DB config)
// ============================================================

/**
 * GET /api/github.branches
 * Fetch all branches from repository
 * Query params: repoIndex (optional, default: 0)
 */
router.get("github.branches", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        const branches = await github.fetchBranches();

        ctx.body = {
            success: true,
            data: branches.map((b: any) => ({
                name: b.name,
                sha: b.commit.sha,
            })),
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to fetch branches");
    }
});

/**
 * GET /api/github.commits
 * Fetch commits from repository
 * Query params: page, per_page, repoIndex
 */
router.get("github.commits", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const page = parseInt(ctx.query.page as string) || 1;
    const per_page = parseInt(ctx.query.per_page as string) || 30;

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        const commits = await github.fetchCommits({ page, per_page });

        ctx.body = {
            success: true,
            data: commits.map((c: any) => ({
                sha: c.sha,
                message: c.commit.message,
                author: c.commit.author.name,
                date: c.commit.author.date,
            })),
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to fetch commits");
    }
});

/**
 * GET /api/github.pullRequests
 * Fetch pull requests from repository
 * Query params: state (open/closed/all), repoIndex
 */
router.get("github.pullRequests", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const state = (ctx.query.state as "open" | "closed" | "all") || "all";

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        const pullRequests = await github.fetchPullRequests({ state });

        ctx.body = {
            success: true,
            data: pullRequests.map((pr: any) => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                author: pr.user?.login,
                createdAt: pr.created_at,
                mergedAt: pr.merged_at,
            })),
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to fetch pull requests");
    }
});

/**
 * GET /api/github.fileContent
 * Get content of a specific file from repository
 * Query params: path (required), branch, raw, repoIndex
 */
router.get("github.fileContent", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const filePath = ctx.query.path as string;
    const branch = (ctx.query.branch as string) || "master";
    const raw = ctx.query.raw === "true";

    if (!filePath) {
        ctx.throw(400, "File path is required. Use ?path=src/file.ts");
        return;
    }

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        const content = await github.getFileContent(filePath, branch);

        if (raw) {
            ctx.set("Content-Type", "text/plain; charset=utf-8");
            ctx.body = content;
            return;
        }

        const ext = filePath.split(".").pop()?.toLowerCase() || "";
        const languageMap: Record<string, string> = {
            "ts": "typescript", "tsx": "typescript",
            "js": "javascript", "jsx": "javascript",
            "cs": "csharp", "py": "python", "java": "java",
            "go": "go", "rs": "rust", "cpp": "cpp", "c": "c",
            "h": "c", "hpp": "cpp", "rb": "ruby", "php": "php",
            "swift": "swift", "kt": "kotlin", "scala": "scala",
            "sql": "sql", "json": "json", "yaml": "yaml",
            "yml": "yaml", "xml": "xml", "html": "html",
            "css": "css", "scss": "scss", "md": "markdown",
        };

        ctx.body = {
            success: true,
            data: {
                path: filePath,
                branch,
                language: languageMap[ext] || ext || "plaintext",
                content,
                lines: content.split("\n").length,
                size: content.length,
            },
        };
    } catch (error: any) {
        if (error.status === 404) {
            ctx.throw(404, `File not found: ${filePath} on branch ${branch}`);
        } else {
            ctx.throw(400, error.message || "Failed to fetch file content");
        }
    }
});

/**
 * GET /api/github.files
 * Get list of all files in repository
 * Query params: branch, filter, repoIndex
 */
router.get("github.files", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const branch = (ctx.query.branch as string) || "master";
    const filter = ctx.query.filter as string;

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        let files = await github.getAllFiles(branch, true);

        if (filter) {
            const extensions = filter.split(",").map(e => e.trim().toLowerCase());
            files = files.filter(f => {
                const ext = f.split(".").pop()?.toLowerCase() || "";
                return extensions.includes(ext);
            });
        }

        ctx.body = {
            success: true,
            data: { branch, totalFiles: files.length, files },
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to fetch files");
    }
});

/**
 * GET /api/github.commitDetails
 * Get details of a specific commit
 * Query params: sha (required), repoIndex
 */
router.get("github.commitDetails", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const sha = ctx.query.sha as string;
    if (!sha) {
        ctx.throw(400, "Commit SHA is required. Use ?sha=abc123");
        return;
    }

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        const details = await github.getCommitDetails(sha);

        ctx.body = {
            success: true,
            data: {
                sha: details.sha,
                message: details.commit.message,
                author: {
                    name: details.commit.author.name,
                    email: details.commit.author.email,
                    date: details.commit.author.date,
                },
                files: details.files?.map((f: any) => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch,
                })) || [],
            },
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to fetch commit details");
    }
});

/**
 * GET /api/github.compareCommits
 * Compare two commits
 * Query params: base (required), head (required), repoIndex
 */
router.get("github.compareCommits", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const base = ctx.query.base as string;
    const head = ctx.query.head as string;

    if (!base || !head) {
        ctx.throw(400, "Both base and head are required. Use ?base=abc&head=def");
        return;
    }

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        const comparison = await github.compareCommits(base, head);

        ctx.body = {
            success: true,
            data: comparison,
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to compare commits");
    }
});

/**
 * GET /api/github.searchCode
 * Search for code in repository
 * Query params: query (required), extension, repoIndex
 */
router.get("github.searchCode", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const query = ctx.query.query as string;
    const extension = ctx.query.extension as string;

    if (!query) {
        ctx.throw(400, "Search query is required. Use ?query=functionName");
        return;
    }

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);
        const results = await github.searchInCode(query, extension);

        ctx.body = {
            success: true,
            data: results,
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to search code");
    }
});

/**
 * GET /api/github.pullRequestDetail
 * Get PR commits and changed files
 * Query params: prNumber (required), repoIndex
 */
router.get("github.pullRequestDetail", auth(), async (ctx) => {
    const { apiKey, repository } = await getGitHubConfigFromDB(ctx);

    if (!apiKey || !repository) {
        ctx.throw(400, "GitHub not configured. Please ask an admin to configure GitHub settings.");
        return;
    }

    const repoInfo = parseRepoUrl(repository);
    if (!repoInfo) {
        ctx.throw(400, "Invalid repository URL");
        return;
    }

    const prNumber = parseInt(ctx.query.prNumber as string);
    if (!prNumber) {
        ctx.throw(400, "PR number is required. Use ?prNumber=123");
        return;
    }

    try {
        const github = new GitHubIntegration(apiKey, repoInfo.owner, repoInfo.repo);

        const [commits, files] = await Promise.all([
            github.getPullRequestCommits(prNumber),
            github.getPullRequestFiles(prNumber),
        ]);

        ctx.body = {
            success: true,
            data: {
                commits: commits.map((c: any) => ({
                    sha: c.sha,
                    message: c.commit.message,
                    author: c.commit.author?.name || c.author?.login,
                    date: c.commit.author?.date,
                    htmlUrl: c.html_url,
                })),
                files: files.map((f: any) => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch,
                    sha: f.sha,
                })),
            },
        };
    } catch (error: any) {
        ctx.throw(400, error.message || "Failed to fetch PR details");
    }
});

/**
 * POST /api/github.pipelineConfig
 * Internal endpoint for gap-finding pipeline (claude_runner.py).
 * Authenticated via X-Pipeline-Api-Key header.
 */
router.post("github.pipelineConfig", async (ctx) => {
    const pipelineKey = ctx.get("X-Pipeline-Api-Key");
    if (!pipelineKey || pipelineKey !== env.PIPELINE_API_KEY) {
        ctx.throw(401, "Invalid pipeline API key");
        return;
    }

    // Resolve config by repo ("owner/repo-name") if provided — each team has different repos
    const repoParam = ctx.request.body?.repo as string | undefined;
    let config: GithubConfig | null = null;

    if (repoParam) {
        const parts = repoParam.split("/");
        if (parts.length >= 2) {
            const [owner, repoName] = parts;
            const { literal } = await import("sequelize");
            config = await GithubConfig.findOne({
                where: literal(`repositories @> :json::jsonb`),
                replacements: { json: JSON.stringify([{ owner, repo: repoName }]) },
            } as any);
        }
    }

    // Fallback: first available config (single-team setups)
    if (!config) {
        config = await GithubConfig.findOne();
    }

    if (!config) {
        ctx.throw(404, "No GitHub configuration found");
        return;
    }

    ctx.body = {
        ok: true,
        data: {
            github_token: config.apiKey,
            repositories: config.repositories,
            claude_project_dir: config.claudeProjectDir || "",
            team_id: config.teamId,
        },
    };
});

/**
 * GET /api/github.internalConfig
 * Internal endpoint for Python backend to fetch GitHub config by teamId.
 * Auth: X-Internal-Api-Key header must match PIPELINE_API_KEY env var.
 * Query param: teamId (required)
 */
router.get("github.internalConfig", async (ctx) => {
    const internalKey = ctx.request.headers["x-internal-api-key"] as string;
    const pipelineKey = env.PIPELINE_API_KEY;

    if (!pipelineKey || !internalKey || internalKey !== pipelineKey) {
        ctx.throw(401, "Unauthorized");
        return;
    }

    const teamId = ctx.query.teamId as string;
    if (!teamId) {
        ctx.throw(400, "teamId query param required");
        return;
    }

    const config = await GithubConfig.findOne({ where: { teamId } });
    if (!config) {
        ctx.body = { ok: true, data: null };
        return;
    }

    ctx.body = {
        ok: true,
        data: {
            apiKey: config.apiKey,
            repositories: config.repositories,
        },
    };
});

export default router;
