import { Octokit } from "octokit";
import Logger from "@server/logging/Logger";

interface GitHubConfig {
    token: string;
    owner: string;
    repo: string;
}

class GitHubIntegration {
    private octokit: Octokit;
    private config: GitHubConfig;
    private commitCache: Map<string, any> = new Map();

    constructor(token: string, owner: string, repo: string) {
        this.octokit = new Octokit({
            auth: token, // Github token
        });

        this.config = {
            token,
            owner, //ten nguoi dung/organization
            repo,  //ten repository
        };
    }

    // =========================METHODS TO INTERACT WITH GITHUB API===================

    //Lay danh sach commit
    async fetchCommits(
        options: {
            page?: number;   //trang thu may
            per_page?: number;  //so commit/page
            since?: string; // chi lay commit tu ngay nao
        } = {}
    ): Promise<any[]> {
        const { page = 1, per_page = 30, since } = options;

        try {
            const response = await this.octokit.rest.repos.listCommits({
                owner: this.config.owner,
                repo: this.config.repo,
                page,
                per_page,
                since,
            });

            return response.data;
        } catch (error) {
            Logger.error("Failed to fetch commits:", error);
            throw error;
        }
    }





    //Lay danh sach branch
    async fetchBranches(): Promise<any[]> {
        try {
            const response = await this.octokit.rest.repos.listBranches({
                owner: this.config.owner,
                repo: this.config.repo,
                per_page: 100,
            });

            return response.data;
        } catch (error) {
            Logger.error("Failed to fetch branches:", error);
            throw error;
        }


    }




    //Lay chi tiet 1 commit
    async getCommitDetails(sha: string): Promise<any> {
        try {
            const response = await this.octokit.rest.repos.getCommit({
                owner: this.config.owner,
                repo: this.config.repo,
                ref: sha,
            });

            return response.data;
        } catch (error) {
            Logger.error("Failed to fetch commit details:", error);
            throw error;
        }




    }


    //So sanh 2 commit 
    async compareCommits(
        base: string,          //Commit SHA or Branch name
        head: string
    ): Promise<any> {
        try {
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
                files: response.data.files,    //List file changed
            };
        } catch (error) {
            Logger.error("Failed to compare commits:", error);
            throw error;
        }


    }


    //Lay chi tiet thay doi file
    async getFileDiff(
        baseSha: string,
        headSha: string,
        filePath: string
    ): Promise<string> {
        try {
            const response = await this.octokit.rest.repos.compareCommits({
                owner: this.config.owner,
                repo: this.config.repo,
                base: baseSha,
                head: headSha,
            });
            const file = response.data.files?.find(f => f.filename === filePath);
            return file?.patch || ""; // Phan diff cua 2 file

        } catch (error) {
            Logger.error("Failed to get file diff:", error);
            throw error;
        }
    }



    /**
     * Lấy danh sách commits với caching để tránh gọi GitHub API quá nhiều lần
     * Ý nghĩa: GitHub API có rate limit (60 requests/hour cho unauthenticated, 5000 cho authenticated)
     * Cache giúp tiết kiệm API calls và tăng tốc độ response
     * 
     * @param cacheKey - Khóa để xác định cache (ví dụ: "main_branch", "develop_branch")
     * @param options - Options như page, per_page, since
     * @param cacheDuration - Thời gian cache còn hợp lệ (mặc định: 1 giờ = 3600000ms)
     * @returns Danh sách commits từ cache hoặc API mới
     */
    async fetchCommitsWithCache(
        cacheKey: string,
        options?: any,
        cacheDuration: number = 3600000 // 1 hour (3600000 milliseconds)
    ): Promise<any[]> {
        // ============== BƯỚC 1: KIỂM TRA CÓ DỮ LIỆU TRONG CACHE KHÔNG ==============
        if (this.commitCache.has(cacheKey)) {
            // Lấy dữ liệu từ cache
            const cached = this.commitCache.get(cacheKey);

            // Kiểm tra cache còn hợp lệ không:
            // (Thời gian hiện tại - thời gian lưu cache) < thời gian sống của cache?
            // Nếu true = cache còn mới, không cần fetch API mới
            // Nếu false = cache cũ rồi, cần fetch lại
            if (Date.now() - cached.timestamp < cacheDuration) {
                return cached.data; // Trả về commits từ cache thay vì gọi API
            }
            // Nếu cache hết hạn, sẽ tiếp tục fetch API mới ở dưới
        }

        // ============== BƯỚC 2: FETCH DỮ LIỆU MỚI TỪ GITHUB API ==============
        // Cache không tồn tại hoặc đã hết hạn, gọi GitHub API để lấy commits mới
        const commits = await this.fetchCommits(options);

        // ============== BƯỚC 3: LƯU DỮ LIỆU VỪA FETCH VÀO CACHE ==============
        this.commitCache.set(cacheKey, {
            data: commits,            // Dữ liệu commits vừa lấy từ API
            timestamp: Date.now(),    // Thời gian lưu cache (để sau tính xem cache còn hợp lệ không)
        });

        // Trả về commits vừa fetch được
        return commits;
    }
    async compareBranches() { }
    async getDifferences() { }



    //Kiem tra token va repository hop le
    async validateConnection(): Promise<boolean> {
        try {
            const response = await this.octokit.rest.repos.get({
                owner: this.config.owner,
                repo: this.config.repo,
            });

            return response.status === 200;
        } catch (error) {
            Logger.error("Validation error:", error);
            return false;
        }


    }


    //Ham lay noi dung 1 file code

    async getFileContent(filePath: string, branch: string = "master"): Promise<string> {
        try {
            const response = await this.octokit.rest.repos.getContent({
                owner: this.config.owner,
                repo: this.config.repo,
                path: filePath,
                ref: branch,
            });
            //Github API tra ve noi dung file dang base64
            // Decode base64 content
            if ("content" in response.data) {
                return Buffer.from(response.data.content, "base64").toString("utf-8");
            }
            return "";
        } catch (error) {
            Logger.error(`Failed to get file content: ${filePath}`, error);
            throw error;
        }
    }
    /**
     * Lấy danh sách tất cả files trong repository (dạng tree)
     * @param branch - Branch cần lấy
     * @param recursive - Lấy cả files trong subfolders
     */
    async getAllFiles(branch: string = "master", recursive: boolean = true): Promise<string[]> {
        try {
            // Lấy SHA của branch
            const branchData = await this.octokit.rest.repos.getBranch({
                owner: this.config.owner,
                repo: this.config.repo,
                branch,
            });

            const treeSha = branchData.data.commit.sha;

            // Lấy tree (danh sách files)
            const treeResponse = await this.octokit.rest.git.getTree({
                owner: this.config.owner,
                repo: this.config.repo,
                tree_sha: treeSha,
                recursive: recursive ? "1" : undefined,
            });

            // Lọc chỉ lấy files (không lấy folders)
            return treeResponse.data.tree
                .filter(item => item.type === "blob")
                .map(item => item.path || "");
        } catch (error) {
            Logger.error("Failed to get all files:", error);
            throw error;
        }
    }
    /**
     * Tìm kiếm một từ khóa trong toàn bộ repository
     * @param query - Từ khóa cần tìm (tên hàm, class, variable...)
     * @param fileExtension - Lọc theo extension (ví dụ: "cs", "ts", "java")
     */
    async searchInCode(query: string, fileExtension?: string): Promise<any[]> {
        try {
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
        } catch (error) {
            Logger.error("Failed to search in code:", error);
            throw error;
        }
    }



    async analyzeChangedFunctions(commitSha: string): Promise<ChangedFunction[]> {
        const commitDetails = await this.getCommitDetails(commitSha);
        const changedFunctions: ChangedFunction[] = [];

        for (const file of commitDetails.files) {
            if (!file.patch) {
                continue;
            }

            // Parse patch để tìm các hàm bị thay đổi
            const functions = this.extractFunctionsFromPatch(file.patch, file.filename);
            changedFunctions.push(...functions);
        }

        return changedFunctions;
    }

    /**
     * Trích xuất tên hàm từ patch (diff)
     * Hỗ trợ: C#, TypeScript, JavaScript, Java, Python
     */
    private extractFunctionsFromPatch(patch: string, fileName: string): ChangedFunction[] {
        const functions: ChangedFunction[] = [];
        const lines = patch.split("\n");

        // Regex patterns cho các ngôn ngữ khác nhau
        const patterns = {
            // C#: public async Task<T> MethodName(params)
            csharp: /(?:public|private|protected|internal)?\s*(?:static|async|virtual|override)?\s*\w+(?:<[\w\s,<>]+>)?\s+(\w+)\s*\(/,

            // TypeScript/JavaScript: function name() hoặc async name() hoặc name = () =>
            typescript: /(?:async\s+)?(?:function\s+)?(\w+)\s*(?:=\s*(?:async\s*)?\(|[\(<])/,

            // Java: public void methodName(params)
            java: /(?:public|private|protected)?\s*(?:static)?\s*\w+(?:<[\w\s,<>]+>)?\s+(\w+)\s*\(/,

            // Python: def function_name(params):
            python: /def\s+(\w+)\s*\(/,
        };

        // Xác định ngôn ngữ từ extension
        const ext = fileName.split(".").pop()?.toLowerCase();
        let pattern: RegExp;

        switch (ext) {
            case "cs": pattern = patterns.csharp; break;
            case "ts":
            case "tsx":
            case "js":
            case "jsx": pattern = patterns.typescript; break;
            case "java": pattern = patterns.java; break;
            case "py": pattern = patterns.python; break;
            default: pattern = patterns.typescript;
        }

        const oldLines: string[] = [];
        const newLines: string[] = [];
        let currentFunction: string | null = null;

        for (const line of lines) {
            // Tìm tên hàm trong dòng
            const match = line.match(pattern);
            if (match) {
                currentFunction = match[1];
            }

            if (line.startsWith("-") && !line.startsWith("---")) {
                oldLines.push(line.substring(1));
                if (currentFunction && !functions.find(f => f.name === currentFunction)) {
                    functions.push({
                        name: currentFunction,
                        fileName,
                        changeType: "modified",
                        oldCode: [],
                        newCode: [],
                    });
                }
            } else if (line.startsWith("+") && !line.startsWith("+++")) {
                newLines.push(line.substring(1));
            }
        }

        // Gán code vào các hàm tìm được
        functions.forEach(fn => {
            fn.oldCode = oldLines;
            fn.newCode = newLines;
        });

        return functions;
    }

    /**
     * Phân tích impact khi thay đổi một hàm
     * @param functionName - Tên hàm cần phân tích
     * @param definedInFile - File chứa định nghĩa hàm (optional)
     */
    async analyzeImpact(functionName: string, definedInFile?: string): Promise<ImpactAnalysis> {
        // Bước 1: Tìm tất cả files có chứa tên hàm này
        const searchResults = await this.searchInCode(functionName);

        const usedInFiles = searchResults
            .map(r => r.filePath)
            .filter(path => path !== definedInFile); // Loại bỏ file định nghĩa

        // Bước 2: Đánh giá mức độ impact
        let impactLevel: "low" | "medium" | "high" | "critical";
        const fileCount = usedInFiles.length;

        if (fileCount === 0) {
            impactLevel = "low";
        } else if (fileCount <= 3) {
            impactLevel = "medium";
        } else if (fileCount <= 10) {
            impactLevel = "high";
        } else {
            impactLevel = "critical";
        }

        return {
            functionName,
            definedInFile: definedInFile || "Unknown",
            usedInFiles,
            callsFunctions: [], // Cần phân tích sâu hơn trong file
            calledByFunctions: [], // Cần phân tích sâu hơn trong file
            impactLevel,
        };
    }

    /**
     * Phân tích impact đầy đủ cho một commit
     * @param commitSha - SHA của commit
     */
    async getCommitImpactReport(commitSha: string): Promise<CommitImpactReport> {
        // Lấy thông tin commit
        const commitDetails = await this.getCommitDetails(commitSha);

        // Phân tích các hàm bị thay đổi
        const changedFunctions = await this.analyzeChangedFunctions(commitSha);

        // Phân tích impact cho từng hàm
        const impactAnalysis: ImpactAnalysis[] = [];
        const allAffectedFiles = new Set<string>();

        for (const fn of changedFunctions) {
            const impact = await this.analyzeImpact(fn.name, fn.fileName);
            impactAnalysis.push(impact);

            impact.usedInFiles.forEach(file => allAffectedFiles.add(file));
        }

        // Tính overall impact level
        const highestImpact = impactAnalysis.reduce((highest, current) => {
            const levels = ["low", "medium", "high", "critical"];
            return levels.indexOf(current.impactLevel) > levels.indexOf(highest)
                ? current.impactLevel
                : highest;
        }, "low" as "low" | "medium" | "high" | "critical");

        return {
            commitSha,
            commitMessage: commitDetails.commit.message,
            author: commitDetails.commit.author.name,
            date: commitDetails.commit.author.date,
            changedFunctions,
            impactAnalysis,
            totalFilesAffected: allAffectedFiles.size,
            overallImpactLevel: highestImpact,
        };
    }





    /**
     * Lấy danh sách Pull Requests
     */
    async fetchPullRequests(options: {
        state?: "open" | "closed" | "all";
        page?: number;
        per_page?: number;
    } = {}): Promise<any[]> {
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

    /**
     * Lấy chi tiết một Pull Request
     */
    async getPullRequestDetails(prNumber: number): Promise<any> {
        const response = await this.octokit.rest.pulls.get({
            owner: this.config.owner,
            repo: this.config.repo,
            pull_number: prNumber,
        });

        return response.data;
    }

    /**
     * Lấy danh sách files thay đổi trong Pull Request
     */
    async getPullRequestFiles(prNumber: number): Promise<any[]> {
        const response = await this.octokit.rest.pulls.listFiles({
            owner: this.config.owner,
            repo: this.config.repo,
            pull_number: prNumber,
        });

        return response.data;
    }

    /**
     * Lấy danh sách commits trong Pull Request
     */
    async getPullRequestCommits(prNumber: number): Promise<any[]> {
        const response = await this.octokit.rest.pulls.listCommits({
            owner: this.config.owner,
            repo: this.config.repo,
            pull_number: prNumber,
        });

        return response.data;
    }

    /**
     * Phân tích các hàm thay đổi trong Pull Request
     */
    async analyzeChangedFunctionsFromPR(prNumber: number): Promise<ChangedFunction[]> {
        const files = await this.getPullRequestFiles(prNumber);
        const changedFunctions: ChangedFunction[] = [];

        for (const file of files) {
            if (!file.patch) {
                continue;
            }

            const functions = this.extractFunctionsFromPatch(file.patch, file.filename);
            changedFunctions.push(...functions);
        }

        return changedFunctions;
    }

    /**
     * Tạo báo cáo impact từ Pull Request
     */
    async getPullRequestImpactReport(prNumber: number): Promise<{
        prNumber: number;
        prTitle: string;
        prDescription: string;
        author: string;
        baseBranch: string;
        headBranch: string;
        changedFunctions: ChangedFunction[];
        impactAnalysis: ImpactAnalysis[];
        totalFilesAffected: number;
        overallImpactLevel: string;
    }> {
        const prDetails = await this.getPullRequestDetails(prNumber);
        const changedFunctions = await this.analyzeChangedFunctionsFromPR(prNumber);

        // Phân tích impact cho từng hàm
        const impactAnalysis: ImpactAnalysis[] = [];
        for (const fn of changedFunctions) {
            const impact = await this.analyzeImpact(fn.name);
            impactAnalysis.push(impact);
        }

        // Tính tổng số files bị ảnh hưởng
        const allAffectedFiles = new Set<string>();
        impactAnalysis.forEach(ia => {
            ia.usedInFiles.forEach(f => allAffectedFiles.add(f));
        });

        // Xác định mức độ ảnh hưởng tổng thể
        let overallImpactLevel = "low";
        if (allAffectedFiles.size > 10) {
            overallImpactLevel = "critical";
        } else if (allAffectedFiles.size > 5) {
            overallImpactLevel = "high";
        } else if (allAffectedFiles.size > 2) {
            overallImpactLevel = "medium";
        }

        return {
            prNumber,
            prTitle: prDetails.title,
            prDescription: prDetails.body || "",
            author: prDetails.user?.login || "Unknown",
            baseBranch: prDetails.base.ref,
            headBranch: prDetails.head.ref,
            changedFunctions,
            impactAnalysis,
            totalFilesAffected: allAffectedFiles.size,
            overallImpactLevel,
        };
    }









}
interface ChangedFunction {
    name: string;           // Tên hàm
    fileName: string;       // File chứa hàm
    changeType: "added" | "modified" | "removed";
    oldCode: string[];      // Code cũ
    newCode: string[];      // Code mới
}

/**
 * Kết quả phân tích impact đầy đủ cho một commit
 */
interface CommitImpactReport {
    commitSha: string;
    commitMessage: string;
    author: string;
    date: string;
    changedFunctions: ChangedFunction[];
    impactAnalysis: ImpactAnalysis[];
    totalFilesAffected: number;
    overallImpactLevel: "low" | "medium" | "high" | "critical";
}
interface ImpactAnalysis {
    functionName: string;           // Tên hàm bị thay đổi
    definedInFile: string;          // File định nghĩa hàm
    usedInFiles: string[];          // Danh sách files sử dụng hàm này
    callsFunctions: string[];       // Các hàm mà hàm này gọi đến
    calledByFunctions: string[];    // Các hàm gọi đến hàm này
    impactLevel: "low" | "medium" | "high" | "critical";
}
interface CommitImpactReport {
    commitSha: string;
    commitMessage: string;
    author: string;
    date: string;
    changedFunctions: ChangedFunction[];
    impactAnalysis: ImpactAnalysis[];
    totalFilesAffected: number;
    overallImpactLevel: "low" | "medium" | "high" | "critical";
}
export default GitHubIntegration;
