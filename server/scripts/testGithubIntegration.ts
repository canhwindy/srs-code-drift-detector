/**
 * Test Script for GitHub Integration
 * Run: npx ts-node server/scripts/testGithubIntegration.ts
 * Or: yarn ts-node server/scripts/testGithubIntegration.ts
 */

import * as readline from "readline";
import GitHubIntegration from "../services/githubIntergration";

// ============== CONFIGURATION ==============
// Thay đổi các giá trị này hoặc load từ localStorage/env
let GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
let GITHUB_OWNER = process.env.GITHUB_OWNER || "";
let GITHUB_REPO = process.env.GITHUB_REPO || "";

let github: GitHubIntegration | null = null;

// ============== READLINE INTERFACE ==============
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
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
║  0.  Configure GitHub Credentials                            ║
║  1.  Validate Connection                                     ║
║  2.  Fetch Branches                                          ║
║  3.  Fetch Commits                                           ║
║  4.  Get Commit Details                                      ║
║  5.  Compare Commits                                         ║
║  6.  Get File Diff                                           ║
║  7.  Get File Content                                        ║
║  8.  Get All Files in Repository                             ║
║  9.  Search in Code                                          ║
║  10. Analyze Changed Functions (from Commit)                 ║
║  11. Analyze Impact of a Function                            ║
║  12. Get Commit Impact Report                                ║
║  13. Fetch Pull Requests                                     ║
║  14. Get Pull Request Details                                ║
║  15. Get Pull Request Files                                  ║
║  16. Get Pull Request Commits                                ║
║  17. Analyze Changed Functions from PR                       ║
║  18. Get Pull Request Impact Report                          ║
║  19. Fetch Commits with Cache                                ║
║  q.  Quit                                                    ║
╚══════════════════════════════════════════════════════════════╝
`;

// ============== TEST FUNCTIONS ==============

async function configureCredentials(): Promise<void> {
    console.log("\n🔧 Configure GitHub Credentials\n");
    
    GITHUB_TOKEN = await question("Enter GitHub Token (Personal Access Token): ");
    GITHUB_OWNER = await question("Enter Repository Owner (username/organization): ");
    GITHUB_REPO = await question("Enter Repository Name: ");
    
    github = new GitHubIntegration(GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO);
    console.log("\n✅ Credentials configured successfully!");
    console.log(`   Owner: ${GITHUB_OWNER}`);
    console.log(`   Repo: ${GITHUB_REPO}`);
}

function checkInitialized(): boolean {
    if (!github) {
        console.log("\n❌ GitHub Integration not initialized!");
        console.log("   Please run option 0 to configure credentials first.\n");
        return false;
    }
    return true;
}

async function testValidateConnection(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Validate Connection...\n");
    try {
        const isValid = await github!.validateConnection();
        if (isValid) {
            console.log("✅ Connection is VALID! Token and repository are correct.");
        } else {
            console.log("❌ Connection is INVALID! Check your token and repository.");
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testFetchBranches(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Fetch Branches...\n");
    try {
        const branches = await github!.fetchBranches();
        console.log(`✅ Found ${branches.length} branches:\n`);
        branches.forEach((branch, index) => {
            console.log(`   ${index + 1}. ${branch.name}`);
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testFetchCommits(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Fetch Commits...\n");
    const pageStr = await question("Enter page number (default 1): ");
    const perPageStr = await question("Enter commits per page (default 10): ");
    
    const page = parseInt(pageStr) || 1;
    const per_page = parseInt(perPageStr) || 10;
    
    try {
        const commits = await github!.fetchCommits({ page, per_page });
        console.log(`\n✅ Found ${commits.length} commits:\n`);
        commits.forEach((commit, index) => {
            const date = new Date(commit.commit.author.date).toLocaleDateString();
            const message = commit.commit.message.split("\n")[0].substring(0, 50);
            console.log(`   ${index + 1}. [${commit.sha.substring(0, 7)}] ${date} - ${message}`);
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetCommitDetails(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get Commit Details...\n");
    const sha = await question("Enter Commit SHA: ");
    
    if (!sha) {
        console.log("❌ SHA is required!");
        return;
    }
    
    try {
        const details = await github!.getCommitDetails(sha);
        console.log("\n✅ Commit Details:\n");
        console.log(`   SHA: ${details.sha}`);
        console.log(`   Author: ${details.commit.author.name} <${details.commit.author.email}>`);
        console.log(`   Date: ${details.commit.author.date}`);
        console.log(`   Message: ${details.commit.message}`);
        console.log(`   Files Changed: ${details.files?.length || 0}`);
        
        if (details.files && details.files.length > 0) {
            console.log("\n   Changed Files:");
            details.files.slice(0, 10).forEach((file: any) => {
                console.log(`     - ${file.filename} (+${file.additions}/-${file.deletions})`);
            });
            if (details.files.length > 10) {
                console.log(`     ... and ${details.files.length - 10} more files`);
            }
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testCompareCommits(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Compare Commits...\n");
    const base = await question("Enter BASE commit SHA or branch name: ");
    const head = await question("Enter HEAD commit SHA or branch name: ");
    
    if (!base || !head) {
        console.log("❌ Both BASE and HEAD are required!");
        return;
    }
    
    try {
        const comparison = await github!.compareCommits(base, head);
        console.log("\n✅ Comparison Result:\n");
        console.log(`   Status: ${comparison.status}`);
        console.log(`   Ahead by: ${comparison.ahead_by} commits`);
        console.log(`   Behind by: ${comparison.behind_by} commits`);
        console.log(`   Total Commits: ${comparison.total_commits}`);
        console.log(`   Files Changed: ${comparison.files?.length || 0}`);
        
        if (comparison.files && comparison.files.length > 0) {
            console.log("\n   Changed Files:");
            comparison.files.slice(0, 10).forEach((file: any) => {
                console.log(`     - ${file.filename} (${file.status})`);
            });
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetFileDiff(): Promise<void> {
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
        const diff = await github!.getFileDiff(baseSha, headSha, filePath);
        console.log("\n✅ File Diff:\n");
        if (diff) {
            console.log(diff);
        } else {
            console.log("   No changes found for this file.");
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetFileContent(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get File Content...\n");
    const filePath = await question("Enter file path (e.g., README.md): ");
    const branch = await question("Enter branch name (default: master): ") || "master";
    
    if (!filePath) {
        console.log("❌ File path is required!");
        return;
    }
    
    try {
        const content = await github!.getFileContent(filePath, branch);
        console.log("\n✅ File Content:\n");
        console.log("─".repeat(60));
        console.log(content.substring(0, 2000));
        if (content.length > 2000) {
            console.log(`\n... (${content.length - 2000} more characters)`);
        }
        console.log("─".repeat(60));
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetAllFiles(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get All Files in Repository...\n");
    const branch = await question("Enter branch name (default: master): ") || "master";
    
    try {
        const files = await github!.getAllFiles(branch, true);
        console.log(`\n✅ Found ${files.length} files:\n`);
        files.slice(0, 30).forEach((file, index) => {
            console.log(`   ${index + 1}. ${file}`);
        });
        if (files.length > 30) {
            console.log(`   ... and ${files.length - 30} more files`);
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testSearchInCode(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Search in Code...\n");
    const query = await question("Enter search query (function/class name): ");
    const extension = await question("Enter file extension to filter (e.g., ts, cs) or leave empty: ");
    
    if (!query) {
        console.log("❌ Query is required!");
        return;
    }
    
    try {
        const results = await github!.searchInCode(query, extension || undefined);
        console.log(`\n✅ Found ${results.length} results:\n`);
        results.slice(0, 20).forEach((result, index) => {
            console.log(`   ${index + 1}. ${result.filePath}`);
            console.log(`      File: ${result.fileName}`);
            console.log(`      URL: ${result.url}`);
            console.log("");
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testAnalyzeChangedFunctions(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Analyze Changed Functions from Commit...\n");
    const sha = await question("Enter Commit SHA: ");
    
    if (!sha) {
        console.log("❌ SHA is required!");
        return;
    }
    
    try {
        const functions = await github!.analyzeChangedFunctions(sha);
        console.log(`\n✅ Found ${functions.length} changed functions:\n`);
        functions.forEach((fn, index) => {
            console.log(`   ${index + 1}. ${fn.name}`);
            console.log(`      File: ${fn.fileName}`);
            console.log(`      Change Type: ${fn.changeType}`);
            console.log("");
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testAnalyzeImpact(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Analyze Impact of a Function...\n");
    const functionName = await question("Enter function name: ");
    const definedInFile = await question("Enter file where function is defined (optional): ");
    
    if (!functionName) {
        console.log("❌ Function name is required!");
        return;
    }
    
    try {
        const impact = await github!.analyzeImpact(functionName, definedInFile || undefined);
        console.log("\n✅ Impact Analysis:\n");
        console.log(`   Function: ${impact.functionName}`);
        console.log(`   Defined in: ${impact.definedInFile}`);
        console.log(`   Impact Level: ${impact.impactLevel.toUpperCase()}`);
        console.log(`   Used in ${impact.usedInFiles.length} files:`);
        impact.usedInFiles.slice(0, 10).forEach((file) => {
            console.log(`     - ${file}`);
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetCommitImpactReport(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get Commit Impact Report...\n");
    const sha = await question("Enter Commit SHA: ");
    
    if (!sha) {
        console.log("❌ SHA is required!");
        return;
    }
    
    try {
        const report = await github!.getCommitImpactReport(sha);
        console.log("\n✅ Commit Impact Report:\n");
        console.log(`   Commit: ${report.commitSha.substring(0, 7)}`);
        console.log(`   Message: ${report.commitMessage.split("\n")[0]}`);
        console.log(`   Author: ${report.author}`);
        console.log(`   Date: ${report.date}`);
        console.log(`   Changed Functions: ${report.changedFunctions.length}`);
        console.log(`   Total Files Affected: ${report.totalFilesAffected}`);
        console.log(`   Overall Impact Level: ${report.overallImpactLevel.toUpperCase()}`);
        
        if (report.changedFunctions.length > 0) {
            console.log("\n   Changed Functions:");
            report.changedFunctions.forEach((fn) => {
                console.log(`     - ${fn.name} (${fn.fileName})`);
            });
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testFetchPullRequests(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Fetch Pull Requests...\n");
    const state = await question("Enter state (open/closed/all, default: all): ") || "all";
    
    try {
        const prs = await github!.fetchPullRequests({ 
            state: state as "open" | "closed" | "all",
            per_page: 10 
        });
        console.log(`\n✅ Found ${prs.length} Pull Requests:\n`);
        prs.forEach((pr, index) => {
            console.log(`   ${index + 1}. #${pr.number} - ${pr.title}`);
            console.log(`      State: ${pr.state} | Author: ${pr.user?.login}`);
            console.log(`      ${pr.head.ref} -> ${pr.base.ref}`);
            console.log("");
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetPullRequestDetails(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get Pull Request Details...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);
    
    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }
    
    try {
        const pr = await github!.getPullRequestDetails(prNumber);
        console.log("\n✅ Pull Request Details:\n");
        console.log(`   Number: #${pr.number}`);
        console.log(`   Title: ${pr.title}`);
        console.log(`   State: ${pr.state}`);
        console.log(`   Author: ${pr.user?.login}`);
        console.log(`   Created: ${pr.created_at}`);
        console.log(`   Merged: ${pr.merged ? "Yes" : "No"}`);
        console.log(`   Branch: ${pr.head.ref} -> ${pr.base.ref}`);
        console.log(`   Description: ${pr.body?.substring(0, 200) || "No description"}`);
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetPullRequestFiles(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get Pull Request Files...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);
    
    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }
    
    try {
        const files = await github!.getPullRequestFiles(prNumber);
        console.log(`\n✅ Found ${files.length} changed files:\n`);
        files.forEach((file, index) => {
            console.log(`   ${index + 1}. ${file.filename}`);
            console.log(`      Status: ${file.status} | +${file.additions}/-${file.deletions}`);
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetPullRequestCommits(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get Pull Request Commits...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);
    
    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }
    
    try {
        const commits = await github!.getPullRequestCommits(prNumber);
        console.log(`\n✅ Found ${commits.length} commits in PR:\n`);
        commits.forEach((commit, index) => {
            const message = commit.commit.message.split("\n")[0].substring(0, 50);
            console.log(`   ${index + 1}. [${commit.sha.substring(0, 7)}] ${message}`);
            console.log(`      Author: ${commit.commit.author.name}`);
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testAnalyzeChangedFunctionsFromPR(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Analyze Changed Functions from PR...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);
    
    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }
    
    try {
        const functions = await github!.analyzeChangedFunctionsFromPR(prNumber);
        console.log(`\n✅ Found ${functions.length} changed functions in PR:\n`);
        functions.forEach((fn, index) => {
            console.log(`   ${index + 1}. ${fn.name}`);
            console.log(`      File: ${fn.fileName}`);
            console.log(`      Change Type: ${fn.changeType}`);
            console.log("");
        });
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testGetPullRequestImpactReport(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Get Pull Request Impact Report...\n");
    const prNumberStr = await question("Enter Pull Request number: ");
    const prNumber = parseInt(prNumberStr);
    
    if (!prNumber) {
        console.log("❌ Valid PR number is required!");
        return;
    }
    
    try {
        const report = await github!.getPullRequestImpactReport(prNumber);
        console.log("\n✅ Pull Request Impact Report:\n");
        console.log(`   PR: #${report.prNumber}`);
        console.log(`   Title: ${report.prTitle}`);
        console.log(`   Author: ${report.author}`);
        console.log(`   Branch: ${report.headBranch} -> ${report.baseBranch}`);
        console.log(`   Changed Functions: ${report.changedFunctions.length}`);
        console.log(`   Total Files Affected: ${report.totalFilesAffected}`);
        console.log(`   Overall Impact Level: ${report.overallImpactLevel.toUpperCase()}`);
        
        if (report.changedFunctions.length > 0) {
            console.log("\n   Changed Functions:");
            report.changedFunctions.slice(0, 10).forEach((fn) => {
                console.log(`     - ${fn.name} (${fn.fileName})`);
            });
        }
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

async function testFetchCommitsWithCache(): Promise<void> {
    if (!checkInitialized()) return;
    
    console.log("\n🔍 Testing: Fetch Commits with Cache...\n");
    const cacheKey = await question("Enter cache key (e.g., main_branch): ") || "default";
    
    try {
        console.log("   Fetching (first call - may hit API)...");
        const start1 = Date.now();
        const commits1 = await github!.fetchCommitsWithCache(cacheKey, { per_page: 10 });
        const time1 = Date.now() - start1;
        console.log(`   ✅ First call: ${commits1.length} commits in ${time1}ms\n`);
        
        console.log("   Fetching again (should use cache)...");
        const start2 = Date.now();
        const commits2 = await github!.fetchCommitsWithCache(cacheKey, { per_page: 10 });
        const time2 = Date.now() - start2;
        console.log(`   ✅ Second call: ${commits2.length} commits in ${time2}ms\n`);
        
        console.log(`   Cache effectiveness: ${time1 > time2 ? "Cache is faster!" : "Similar times"}`);
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

// ============== MAIN LOOP ==============
async function main(): Promise<void> {
    console.log("\n" + "═".repeat(60));
    console.log("   🚀 GitHub Integration Test Tool");
    console.log("═".repeat(60));
    
    while (true) {
        console.log(MENU);
        const choice = await question("Enter your choice: ");
        
        switch (choice.toLowerCase()) {
            case "0":
                await configureCredentials();
                break;
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
                await testAnalyzeChangedFunctions();
                break;
            case "11":
                await testAnalyzeImpact();
                break;
            case "12":
                await testGetCommitImpactReport();
                break;
            case "13":
                await testFetchPullRequests();
                break;
            case "14":
                await testGetPullRequestDetails();
                break;
            case "15":
                await testGetPullRequestFiles();
                break;
            case "16":
                await testGetPullRequestCommits();
                break;
            case "17":
                await testAnalyzeChangedFunctionsFromPR();
                break;
            case "18":
                await testGetPullRequestImpactReport();
                break;
            case "19":
                await testFetchCommitsWithCache();
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
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
