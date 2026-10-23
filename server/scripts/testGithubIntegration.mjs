/**
 * Test Script for GitHub Integration
 * Run: node server/scripts/testGithubIntegration.mjs
 * 
 * Configuration is read from .env file:
 * - GITHUB_TOKEN: Personal Access Token (Classic or Fine-grained)
 * - GITHUB_REPOSITORY: Repository URL (e.g., https://github.com/owner/repo)
 * 
 * For Fine-grained tokens, ensure these permissions are enabled:
 * - Repository access: Select the specific repository
 * - Permissions:
 *   - Contents: Read (for file content, commits)
 *   - Metadata: Read (required for all operations)
 *   - Pull requests: Read (for PR operations)
 *   - Commit statuses: Read (optional)
 */

import * as readline from "readline";
import { Octokit } from "octokit";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env file
config({ path: resolve(process.cwd(), ".env") });

// ============== DETECT TOKEN TYPE ==============
function getTokenType(token) {
    if (!token) return "none";
    if (token.startsWith("github_pat_")) return "fine-grained";
    if (token.startsWith("ghp_")) return "classic";
    if (token.startsWith("gho_")) return "oauth";
    if (token.startsWith("ghu_")) return "user-to-server";
    if (token.startsWith("ghs_")) return "server-to-server";
    if (token.startsWith("ghr_")) return "refresh";
    return "unknown";
}

// ============== PARSE REPOSITORY URL ==============
function parseRepoUrl(url) {
    if (!url) return null;
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
        return {
            owner: match[1],
            repo: match[2].replace(/\.git$/, "").replace(/\/$/, "")
        };
    }
    return null;
}

// ============== SIMPLE GITHUB CLIENT ==============
class GitHubClient {
    constructor(token, owner, repo) {
        // Octokit supports both classic and fine-grained tokens
        this.octokit = new Octokit({
            auth: token,
            // Add user agent for better API compatibility
            userAgent: 'outline-github-integration/1.0.0'
        });
        this.config = { token, owner, repo };
        this.tokenType = getTokenType(token);
    }

    async validateConnection() {
        try {
            const response = await this.octokit.rest.repos.get({
                owner: this.config.owner,
                repo: this.config.repo,
            });
            return response.status === 200;
        } catch (error) {
            // Provide more detailed error for fine-grained token issues
            if (error.status === 403) {
                console.log("\n⚠️  Permission denied. If using fine-grained token, check:");
                console.log("   - Repository access is granted for this specific repo");
                console.log("   - 'Metadata' permission is set to 'Read'");
                console.log("   - 'Contents' permission is set to 'Read'");
            } else if (error.status === 404) {
                console.log("\n⚠️  Repository not found. Check:");
                console.log("   - Repository URL is correct");
                console.log("   - Token has access to this repository");
                console.log("   - For private repos, ensure proper permissions");
            }
            return false;
        }
    }

    async fetchBranches() {
        const response = await this.octokit.rest.repos.listBranches({
            owner: this.config.owner,
            repo: this.config.repo,
            per_page: 100,
        });
        return response.data;
    }

    async fetchCommits(options = {}) {
        const { page = 1, per_page = 30, since } = options;
        const response = await this.octokit.rest.repos.listCommits({
            owner: this.config.owner,
            repo: this.config.repo,
            page,
            per_page,
            since,
        });
        return response.data;
    }

    async getCommitDetails(sha) {
        const response = await this.octokit.rest.repos.getCommit({
            owner: this.config.owner,
            repo: this.config.repo,
            ref: sha,
        });
        return response.data;
    }

    async compareCommits(base, head) {
        const response = await this.octokit.rest.repos.compareCommits({
            owner: this.config.owner,
            repo: this.config.repo,
            base,
            head,
        });
        return {
            status: response.data.status,
            ahead_by: response.data.ahead_by,
            behind_by: response.data.behind_by,
            total_commits: response.data.total_commits,
            files: response.data.files,
        };
    }

    async getFileDiff(baseSha, headSha, filePath) {
        const response = await this.octokit.rest.repos.compareCommits({
            owner: this.config.owner,
            repo: this.config.repo,
            base: baseSha,
            head: headSha,
        });
        const file = response.data.files?.find(f => f.filename === filePath);
        return file?.patch || "";
    }

    async getFileContent(filePath, branch = "master") {
        const response = await this.octokit.rest.repos.getContent({
            owner: this.config.owner,
            repo: this.config.repo,
            path: filePath,
            ref: branch,
        });
        if (response.data.content) {
            return Buffer.from(response.data.content, "base64").toString("utf-8");
        }
        return "";
    }

    async getAllFiles(branch = "master") {
        const branchData = await this.octokit.rest.repos.getBranch({
            owner: this.config.owner,
            repo: this.config.repo,
            branch,
        });
        const treeSha = branchData.data.commit.sha;
        const treeResponse = await this.octokit.rest.git.getTree({
            owner: this.config.owner,
            repo: this.config.repo,
            tree_sha: treeSha,
            recursive: "1",
        });
        return treeResponse.data.tree
            .filter(item => item.type === "blob")
            .map(item => item.path || "");
    }

    async searchInCode(query, fileExtension) {
        let searchQuery = `${query} repo:${this.config.owner}/${this.config.repo}`;
        if (fileExtension) {
            searchQuery += ` extension:${fileExtension}`;
        }
        const response = await this.octokit.rest.search.code({
            q: searchQuery,
            per_page: 100,
        });
        return response.data.items.map(item => ({
            fileName: item.name,
            filePath: item.path,
            url: item.html_url,
            score: item.score,
        }));
    }

    async fetchPullRequests(options = {}) {
        const { state = "all", page = 1, per_page = 30 } = options;
        const response = await this.octokit.rest.pulls.list({
            owner: this.config.owner,
            repo: this.config.repo,
            state,
            page,
            per_page,
        });
        return response.data;
    }

    async getPullRequestDetails(prNumber) {
        const response = await this.octokit.rest.pulls.get({
            owner: this.config.owner,
            repo: this.config.repo,
            pull_number: prNumber,
        });
        return response.data;
    }

    async getPullRequestFiles(prNumber) {
        const response = await this.octokit.rest.pulls.listFiles({
            owner: this.config.owner,
            repo: this.config.repo,
            pull_number: prNumber,
        });
        return response.data;
    }

    async getPullRequestCommits(prNumber) {
        const response = await this.octokit.rest.pulls.listCommits({
            owner: this.config.owner,
            repo: this.config.repo,
            pull_number: prNumber,
        });
        return response.data;
    }
}

// ============== CONFIGURATION FROM .ENV ==============
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || "";
const repoInfo = parseRepoUrl(GITHUB_REPOSITORY);

let github = null;

function initializeGitHub() {
    if (!GITHUB_TOKEN) {
        console.log("\n❌ GITHUB_TOKEN not found in .env file!");
        console.log("   Please add GITHUB_TOKEN=your_token to .env file.\n");
        return false;
    }
    if (!repoInfo) {
        console.log("\n❌ GITHUB_REPOSITORY not found or invalid in .env file!");
        console.log("   Please add GITHUB_REPOSITORY=https://github.com/owner/repo to .env file.\n");
        return false;
    }

    github = new GitHubClient(GITHUB_TOKEN, repoInfo.owner, repoInfo.repo);

    // Display token info
    const tokenType = getTokenType(GITHUB_TOKEN);
    console.log(`\n📌 Token Type: ${tokenType.toUpperCase()}`);

    if (tokenType === "fine-grained") {
        console.log("   ℹ️  Fine-grained token detected.");
        console.log("   Required permissions:");
        console.log("   - Metadata: Read (required)");
        console.log("   - Contents: Read (for commits, files)");
        console.log("   - Pull requests: Read (for PR operations)");
    }

    console.log(`📌 Repository: ${repoInfo.owner}/${repoInfo.repo}\n`);

    return true;
}

// ============== READLINE INTERFACE ==============
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const question = (prompt) => {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    });
};

// ============== MENU ==============
const MENU = `
╔══════════════════════════════════════════════════════════════╗
║           GITHUB INTEGRATION TEST MENU                       ║
╠══════════════════════════════════════════════════════════════╣
║  1.  Validate Connection                                     ║
║  2.  Fetch Branches                                          ║
║  3.  Fetch Commits                                           ║
║  4.  Get Commit Details                                      ║
║  5.  Compare Commits                                         ║
║  6.  Get File Diff                                           ║
║  7.  Get File Content                                        ║
║  8.  Get All Files in Repository                             ║
║  9.  Search in Code                                          ║
║  10. Fetch Pull Requests                                     ║
║  11. Get Pull Request Details                                ║
║  12. Get Pull Request Files                                  ║
║  13. Get Pull Request Commits                                ║
║  q.  Quit                                                    ║
╚══════════════════════════════════════════════════════════════╝
`;

// ============== TEST FUNCTIONS ==============

function checkInitialized() {
    if (!github) {
        console.log("\n❌ GitHub Integration not initialized!");
        console.log("   Please check your .env file configuration.\n");
        return false;
    }
    return true;
}

async function testValidateConnection() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Validate Connection...\n");
    try {
        const isValid = await github.validateConnection();
        if (isValid) {
            console.log("✅ Connection is VALID! Token and repository are correct.");
        } else {
            console.log("❌ Connection is INVALID! Check your token and repository.");
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testFetchBranches() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Fetch Branches...\n");
    try {
        const branches = await github.fetchBranches();
        console.log(`✅ Found ${branches.length} branches:\n`);
        branches.forEach((branch, index) => {
            console.log(`   ${index + 1}. ${branch.name}`);
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testFetchCommits() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Fetch Commits...\n");
    const pageStr = await question("Enter page number (default 1): ");
    const perPageStr = await question("Enter commits per page (default 10): ");

    const page = parseInt(pageStr) || 1;
    const per_page = parseInt(perPageStr) || 10;

    try {
        const commits = await github.fetchCommits({ page, per_page });
        console.log(`\n✅ Found ${commits.length} commits:\n`);
        commits.forEach((commit, index) => {
            const date = new Date(commit.commit.author.date).toLocaleDateString();
            const message = commit.commit.message.split("\n")[0].substring(0, 50);
            console.log(`   ${index + 1}. [${commit.sha.substring(0, 7)}] ${date} - ${message}`);
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetCommitDetails() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Get Commit Details...\n");
    const sha = await question("Enter Commit SHA: ");

    if (!sha) {
        console.log("❌ SHA is required!");
        return;
    }

    try {
        const details = await github.getCommitDetails(sha);
        console.log("\n✅ Commit Details:\n");
        console.log(`   SHA: ${details.sha}`);
        console.log(`   Author: ${details.commit.author.name} <${details.commit.author.email}>`);
        console.log(`   Date: ${details.commit.author.date}`);
        console.log(`   Message: ${details.commit.message}`);
        console.log(`   Files Changed: ${details.files?.length || 0}`);

        if (details.files && details.files.length > 0) {
            console.log("\n   Changed Files:");
            details.files.slice(0, 10).forEach((file) => {
                console.log(`     - ${file.filename} (+${file.additions}/-${file.deletions})`);
            });
            if (details.files.length > 10) {
                console.log(`     ... and ${details.files.length - 10} more files`);
            }
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testCompareCommits() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Compare Commits...\n");
    const base = await question("Enter BASE commit SHA or branch name: ");
    const head = await question("Enter HEAD commit SHA or branch name: ");

    if (!base || !head) {
        console.log("❌ Both BASE and HEAD are required!");
        return;
    }

    try {
        const comparison = await github.compareCommits(base, head);
        console.log("\n✅ Comparison Result:\n");
        console.log(`   Status: ${comparison.status}`);
        console.log(`   Ahead by: ${comparison.ahead_by} commits`);
        console.log(`   Behind by: ${comparison.behind_by} commits`);
        console.log(`   Total Commits: ${comparison.total_commits}`);
        console.log(`   Files Changed: ${comparison.files?.length || 0}`);

        if (comparison.files && comparison.files.length > 0) {
            console.log("\n   Changed Files:");
            comparison.files.slice(0, 10).forEach((file) => {
                console.log(`     - ${file.filename} (${file.status})`);
            });
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetFileDiff() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Get File Diff...\n");
    const baseSha = await question("Enter BASE commit SHA: ");
    const headSha = await question("Enter HEAD commit SHA: ");
    const filePath = await question("Enter file path: ");

    if (!baseSha || !headSha || !filePath) {
        console.log("❌ All parameters are required!");
        return;
    }

    try {
        const diff = await github.getFileDiff(baseSha, headSha, filePath);
        console.log("\n✅ File Diff:\n");
        if (diff) {
            console.log(diff);
        } else {
            console.log("   No changes found for this file.");
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetFileContent() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Get File Content...\n");
    const filePath = await question("Enter file path (e.g., README.md): ");
    const branch = await question("Enter branch name (default: master): ") || "master";

    if (!filePath) {
        console.log("❌ File path is required!");
        return;
    }

    try {
        const content = await github.getFileContent(filePath, branch);
        console.log("\n✅ File Content:\n");
        console.log("─".repeat(60));
        console.log(content.substring(0, 2000));
        if (content.length > 2000) {
            console.log(`\n... (${content.length - 2000} more characters)`);
        }
        console.log("─".repeat(60));
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetAllFiles() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Get All Files in Repository...\n");
    const branch = await question("Enter branch name (default: master): ") || "master";

    try {
        const files = await github.getAllFiles(branch);
        console.log(`\n✅ Found ${files.length} files:\n`);
        files.slice(0, 30).forEach((file, index) => {
            console.log(`   ${index + 1}. ${file}`);
        });
        if (files.length > 30) {
            console.log(`   ... and ${files.length - 30} more files`);
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testSearchInCode() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Search in Code...\n");
    const query = await question("Enter search query (function/class name): ");
    const extension = await question("Enter file extension to filter (e.g., ts, cs) or leave empty: ");

    if (!query) {
        console.log("❌ Query is required!");
        return;
    }

    try {
        const results = await github.searchInCode(query, extension || undefined);
        console.log(`\n✅ Found ${results.length} results:\n`);
        results.slice(0, 20).forEach((result, index) => {
            console.log(`   ${index + 1}. ${result.filePath}`);
            console.log(`      File: ${result.fileName}`);
            console.log(`      URL: ${result.url}`);
            console.log("");
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testFetchPullRequests() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Fetch Pull Requests...\n");
    const state = await question("Enter state (open/closed/all, default: all): ") || "all";

    try {
        const prs = await github.fetchPullRequests({ state, per_page: 10 });
        console.log(`\n✅ Found ${prs.length} Pull Requests:\n`);
        prs.forEach((pr, index) => {
            console.log(`   ${index + 1}. #${pr.number} - ${pr.title}`);
            console.log(`      State: ${pr.state} | Author: ${pr.user?.login}`);
            console.log(`      ${pr.head.ref} -> ${pr.base.ref}`);
            console.log("");
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetPullRequestDetails() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Get Pull Request Details...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);

    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }

    try {
        const pr = await github.getPullRequestDetails(prNumber);
        console.log("\n✅ Pull Request Details:\n");
        console.log(`   Number: #${pr.number}`);
        console.log(`   Title: ${pr.title}`);
        console.log(`   State: ${pr.state}`);
        console.log(`   Author: ${pr.user?.login}`);
        console.log(`   Created: ${pr.created_at}`);
        console.log(`   Merged: ${pr.merged ? "Yes" : "No"}`);
        console.log(`   Branch: ${pr.head.ref} -> ${pr.base.ref}`);
        console.log(`   Description: ${pr.body?.substring(0, 200) || "No description"}`);
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetPullRequestFiles() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Get Pull Request Files...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);

    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }

    try {
        const files = await github.getPullRequestFiles(prNumber);
        console.log(`\n✅ Found ${files.length} changed files:\n`);
        files.forEach((file, index) => {
            console.log(`   ${index + 1}. ${file.filename}`);
            console.log(`      Status: ${file.status} | +${file.additions}/-${file.deletions}`);
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetPullRequestCommits() {
    if (!checkInitialized()) return;

    console.log("\n🔍 Testing: Get Pull Request Commits...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);

    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }

    try {
        const commits = await github.getPullRequestCommits(prNumber);
        console.log(`\n✅ Found ${commits.length} commits in PR:\n`);
        commits.forEach((commit, index) => {
            const message = commit.commit.message.split("\n")[0].substring(0, 50);
            console.log(`   ${index + 1}. [${commit.sha.substring(0, 7)}] ${message}`);
            console.log(`      Author: ${commit.commit.author.name}`);
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

// ============== MAIN LOOP ==============
async function main() {
    console.log("\n" + "═".repeat(60));
    console.log("   🚀 GitHub Integration Test Tool");
    console.log("═".repeat(60));

    // Initialize GitHub from .env
    if (!initializeGitHub()) {
        console.log("\n❌ Failed to initialize GitHub Integration.");
        console.log("   Please check your .env file and try again.\n");
        rl.close();
        process.exit(1);
    }

    console.log("\n✅ GitHub configured from .env:");
    console.log("   Repository: " + repoInfo.owner + "/" + repoInfo.repo);
    console.log("   Token: " + GITHUB_TOKEN.substring(0, 10) + "...\n");

    while (true) {
        console.log(MENU);
        const choice = await question("Enter your choice: ");

        switch (choice.toLowerCase()) {
            case "1":
                await testValidateConnection();
                break;
            case "2":
                await testFetchBranches();
                break;
            case "3":
                await testFetchCommits();
                break;
            case "4":
                await testGetCommitDetails();
                break;
            case "5":
                await testCompareCommits();
                break;
            case "6":
                await testGetFileDiff();
                break;
            case "7":
                await testGetFileContent();
                break;
            case "8":
                await testGetAllFiles();
                break;
            case "9":
                await testSearchInCode();
                break;
            case "10":
                await testFetchPullRequests();
                break;
            case "11":
                await testGetPullRequestDetails();
                break;
            case "12":
                await testGetPullRequestFiles();
                break;
            case "13":

                await testGetPullRequestCommits();
                break;
            case "q":
            case "quit":
            case "exit":
                console.log("\n👋 Goodbye!\n");
                rl.close();
                process.exit(0);
            default:
                console.log("\n❌ Invalid choice. Please enter a number from the menu.\n");
        }

        await question("\nPress Enter to continue...");
    }
}

// Run the main function
main().catch(function (error) {
    console.error("Fatal error:", error);
    process.exit(1);
});