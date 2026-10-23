/**
 * GitHub API Helper
 * Reads GitHub credentials from database via API endpoints.
 * Uses cookie-based authentication (same as Outline's standard ApiClient).
 */
import { getCookie } from "tiny-cookie";
import { CSRF } from "@shared/constants";

/**
 * Get headers for GitHub API requests
 */
function getHeaders(repoIndex?: number): Record<string, string> {
    const headers: Record<string, string> = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    };

    // Add CSRF token for mutating requests
    const csrfToken = getCookie(CSRF.cookieName);
    if (csrfToken) {
        headers[CSRF.headerName] = csrfToken;
    }

    if (repoIndex !== undefined && repoIndex > 0) {
        headers["X-Github-Repo-Index"] = String(repoIndex);
    }

    return headers;
}

/**
 * GitHub API client for Outline
 * All GitHub credentials are stored in the database and read server-side.
 * Authentication is handled via cookies (same-origin).
 */
export class GitHubApiClient {
    private baseUrl: string;
    private repoIndex: number;

    constructor(baseUrl: string = "/api", repoIndex: number = 0) {
        this.baseUrl = baseUrl;
        this.repoIndex = repoIndex;
    }

    private getHeaders(): Record<string, string> {
        return getHeaders(this.repoIndex);
    }

    private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...this.getHeaders(),
                ...(options.headers as Record<string, string> || {}),
            },
        });

        if (!response.ok) {
            let errorMessage: string;
            try {
                const errorJson = await response.json();
                errorMessage = errorJson.message || `Request failed: ${response.status}`;
            } catch {
                errorMessage = await response.text();
            }
            throw new Error(errorMessage);
        }

        const json = await response.json();
        return json;
    }

    /**
     * GET /api/github.config
     */
    async getConfig(): Promise<{
        configured: boolean;
        repositories: Array<{ url: string; owner: string; repo: string; webhookSecretMasked?: string | null }>;
        hasApiKey: boolean;
        apiKeyMasked: string | null;
        claudeProjectDir?: string;
        isAdmin: boolean;
        configuredBy?: string;
    }> {
        const json = await this.request<any>(`${this.baseUrl}/github.config`);
        return json.data;
    }

    /**
     * POST /api/github.saveConfig
     */
    async saveConfig(data: {
        apiKey: string;
        repositories: Array<{ url: string; webhookSecret?: string }>;
        claudeProjectDir?: string;
    }): Promise<{
        configured: boolean;
        repositories: Array<{ url: string; owner: string; repo: string }>;
    }> {
        const json = await this.request<any>(`${this.baseUrl}/github.saveConfig`, {
            method: "POST",
            body: JSON.stringify(data),
        });
        return json.data;
    }

    /**
     * POST /api/github.deleteConfig
     */
    async deleteConfig(): Promise<void> {
        await this.request(`${this.baseUrl}/github.deleteConfig`, {
            method: "POST",
        });
    }

    /**
     * POST /api/github.testConnection
     */
    async testConnection(apiKey: string, repository: string): Promise<{
        owner: string;
        repo: string;
        branchCount: number;
        branches: string[];
    }> {
        const json = await this.request<any>(`${this.baseUrl}/github.testConnection`, {
            method: "POST",
            body: JSON.stringify({ apiKey, repository }),
        });
        return json.data;
    }

    /**
     * GET /api/github.pullRequestDetail
     */
    async getPullRequestDetail(prNumber: number): Promise<{
        commits: Array<{
            sha: string;
            message: string;
            author: string;
            date: string;
            htmlUrl: string;
        }>;
        files: Array<{
            filename: string;
            status: string;
            additions: number;
            deletions: number;
            patch?: string;
            sha: string;
        }>;
    }> {
        const json = await this.request<any>(
            `${this.baseUrl}/github.pullRequestDetail?prNumber=${prNumber}`
        );
        return json.data;
    }

    /**
     * GET /api/github.branches
     */
    async getBranches(): Promise<Array<{ name: string; sha: string }>> {
        const json = await this.request<any>(`${this.baseUrl}/github.branches`);
        return json.data;
    }

    /**
     * GET /api/github.commits
     */
    async getCommits(page = 1, perPage = 30): Promise<Array<{
        sha: string;
        message: string;
        author: string;
        date: string;
    }>> {
        const json = await this.request<any>(
            `${this.baseUrl}/github.commits?page=${page}&per_page=${perPage}`
        );
        return json.data;
    }

    /**
     * GET /api/github.pullRequests
     */
    async getPullRequests(state: "open" | "closed" | "all" = "all"): Promise<Array<{
        number: number;
        title: string;
        state: string;
        author: string;
        createdAt: string;
        mergedAt: string | null;
    }>> {
        const json = await this.request<any>(
            `${this.baseUrl}/github.pullRequests?state=${state}`
        );
        return json.data;
    }

    /**
     * GET /api/github.files
     */
    async getFiles(branch = "master", filter?: string): Promise<{
        branch: string;
        totalFiles: number;
        files: string[];
    }> {
        let url = `${this.baseUrl}/github.files?branch=${encodeURIComponent(branch)}`;
        if (filter) {
            url += `&filter=${encodeURIComponent(filter)}`;
        }
        const json = await this.request<any>(url);
        return json.data;
    }

    /**
     * GET /api/github.fileContent
     */
    async getFileContent(path: string, branch = "master"): Promise<{
        path: string;
        branch: string;
        language: string;
        content: string;
        lines: number;
        size: number;
    }> {
        const json = await this.request<any>(
            `${this.baseUrl}/github.fileContent?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`
        );
        return json.data;
    }

    /**
     * GET /api/github.commitDetails
     */
    async getCommitDetails(sha: string): Promise<{
        sha: string;
        message: string;
        author: {
            name: string;
            email: string;
            date: string;
        };
        files: Array<{
            filename: string;
            status: string;
            additions: number;
            deletions: number;
            patch?: string;
        }>;
    }> {
        const json = await this.request<any>(
            `${this.baseUrl}/github.commitDetails?sha=${encodeURIComponent(sha)}`
        );
        return json.data;
    }

    /**
     * GET /api/github.compareCommits
     */
    async compareCommits(base: string, head: string): Promise<any> {
        const json = await this.request<any>(
            `${this.baseUrl}/github.compareCommits?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`
        );
        return json.data;
    }

    /**
     * GET /api/github.searchCode
     */
    async searchCode(query: string, extension?: string): Promise<any> {
        let url = `${this.baseUrl}/github.searchCode?query=${encodeURIComponent(query)}`;
        if (extension) {
            url += `&extension=${encodeURIComponent(extension)}`;
        }
        const json = await this.request<any>(url);
        return json.data;
    }
}

export default GitHubApiClient;
