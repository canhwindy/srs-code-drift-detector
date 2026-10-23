// server/services/ExternalApiService.ts
import fetch from "@server/utils/fetch";
import env from "@server/env";
import Logger from "@server/logging/Logger";

interface DashboardInfoParams {
    id: string;
    teamId: string;
    userId: string;
}

interface DashboardCreateParams {
    title: string;
    description?: string;
    type: string;
    config?: Record<string, unknown>;
    dataSource?: string;
    teamId: string;
    createdById: string;
}

interface DashboardUpdateParams {
    id: string;
    title?: string;
    description?: string;
    type?: string;
    config?: Record<string, unknown>;
    dataSource?: string;
    index?: string;
    teamId: string;
    userId: string;
}

interface DashboardDeleteParams {
    id: string;
    teamId: string;
    userId: string;
}

class ExternalApiService {
    private baseUrl: string | undefined;

    constructor() {
        this.baseUrl = env.EXTERNAL_API_URL;
    }

    /**
     * Make a request to the external API.
     */
    private async request<T>(
        endpoint: string,
        options: {
            method?: string;
            body?: object;
        } = {}
    ): Promise<T> {
        const { method, body } = options;

        if (!this.baseUrl) {
            Logger.warn("EXTERNAL_API_URL is not configured", { endpoint });
            throw new Error("External API URL is not configured");
        }

        try {
            Logger.info("http", `External API request: ${method} ${endpoint}`, {
                baseUrl: this.baseUrl
            });

            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(env.EXTERNAL_API_KEY && {
                        Authorization: `Bearer ${env.EXTERNAL_API_KEY}`,
                    }),
                },
                body: (method !== "GET" && method !== "HEAD" && body)
                    ? JSON.stringify(body)
                    : undefined,
            });

            if (!response.ok) {
                const errorText = await response.text();
                const err = new Error(`External API error: ${response.status}`);

                Logger.error("External API request failed", err, {
                    status: response.status,
                    response: errorText,
                    endpoint,
                });

                throw err;

            }

            const data = await response.text();
            Logger.info("http", `External API response received`, {
                response: data.toString().slice(0, 1000)
            });
            return JSON.parse(data) as Promise<T>;
        } catch (error) {
            Logger.error("External API request error", error as Error, {
                endpoint,
                baseUrl: this.baseUrl,
            }); throw error;
        }
    }


    // ==================== BA Dashboard ====================

    /**
     * Get list of pending approval items from external API.
     * Maps API response to expected format.
     */
    async getPendingApprovals() {
        // API trả về mảng trực tiếp, cần wrap lại
        const rawData = await this.request<any[]>("/api/GapFindings", { method: "GET" });

        // Map data từ API sang format mà frontend cần
        const items = (rawData || []).map((item: any) => ({
            id: item.id,
            useCaseId: item.useCase?.id || "",
            title: item.title,
            pullRequestId: item.pullRequestId || "",
            description: item.description || "",
            severity: item.severity || "low",
            status: item.status || "pending",
            createdBy: item.createdBy || "",
            createdAt: item.createdAt || "",
            updatedAt: item.updatedAt || "",
            useCase: {
                id: item.useCase?.id || "",
                collectionId: item.useCase?.collectionId || "",
                urlId: item.useCase?.urlId || "",
                name: item.useCase?.name || "",
                ucId: item.useCase?.ucId || "",
                createdAt: item.useCase?.createdAt || "",
                updatedAt: item.useCase?.updatedAt || "",
                collection: null,
            },
            agentProposalsIfApproved: {
                type: item.agentProposalsIfApproved?.type || "",
                newText: item.agentProposalsIfApproved?.newText || "",
                summary: item.agentProposalsIfApproved?.summary || "",
            }
        }));

        return { items, total: items.length };
    }

    /**
     * Get dashboard item details from external API.
     */
    async getDashboardInfo(params: DashboardInfoParams) {
        return this.request<any>(`/api/GapFindings/${params.id}`, { method: "GET" });
    }

    /**
     * Create a new dashboard item via external API.
     */
    async createDashboard(params: DashboardCreateParams) {
        return this.request<any>("/api/GapFindings", { method: "POST", body: params });
    }

    /**
     * Update a dashboard item via external API.
     */
    async updateDashboard(params: DashboardUpdateParams) {
        return this.request<any>("/api/GapFindings", { method: "PUT", body: params });
    }

    /**
     * Delete a dashboard item via external API.
     */
    async deleteDashboard(params: DashboardDeleteParams) {
        return this.request<{ success: boolean }>("/api/GapFindings", { method: "DELETE", body: params });
    }

    async getAgentProposals(gapFindingId: string): Promise<{
        id: string,
        proposalType: string,
        summary: string,
        oldText: string,
        newText: string,
        status: string,
        createdAt: string,
        updatedAt: string,
    }[]> {
        const rawData = await this.request<any>(`/api/AgentProposals/gapfinding/${gapFindingId}/`, { method: "GET" });
        const items = Array.isArray(rawData) ? rawData : [rawData];

        return items.map((item: any) => ({
            id: item?.id || item?.Id || "",
            proposalType: item?.proposalType || item?.ProposalType || "",
            summary: item?.summary || item?.Summary || "",
            oldText: item?.oldText || item?.OldText || "",
            newText: item?.newText || item?.NewText || "",
            status: item?.status || item?.Status || "",
            createdAt: item?.createdAt || item?.CreatedAt || "",
            updatedAt: item?.updatedAt || item?.UpdatedAt || "",
        }));
    }

    /**
     * Get number of gap findings by status from external API.
     */
    async getNumberOfGapFindingsByStatus(): Promise<any> {
        const rawData = await this.request<any>("/api/GapFindings/status/count", { method: "GET" });
        // Handle both array response [{ ... }] and object response { ... }
        const data = Array.isArray(rawData) ? rawData[0] : rawData;
        const result = {
            numberOfApprovedGapFindings: data?.numberOfApprovedGapFindings || 0,
            numberOfPendingGapFindings: data?.numberOfPendingGapFindings || 0,
            numberOfRejectedGapFindings: data?.numberOfRejectedGapFindings || 0,
        }
        return result;
    }

    /**
     * Update gap finding status via external API.
     */
    async updateGapFindingStatus(gapFindingId: string, status: string): Promise<{ success: boolean }> {
        return this.request<{ success: boolean }>(`/api/GapFindings/${gapFindingId}/updatestatus`, {
            method: "PUT",
            body: { status },
        });
    }

    /**
     * Update agent proposal status via external API.
     */
    async updateAgentProposalStatus(proposalId: string, status: string): Promise<{ success: boolean }> {
        return this.request<{ success: boolean }>(`/api/AgentProposals/${proposalId}/updatestatus`, {
            method: "PUT",
            body: { status },
        });
    }

    /**
     * Get test results for a gap finding from external API.
     */
    async getTestResults(gapFindingId: string): Promise<{
        id: string;
        gapFindingId: string;
        title: string;
        description: string;
        code_to_srs: "mismatch" | "match" | "missing" | "surplus";
    }[]> {
        const rawData = await this.request<any[]>(`/api/TestResults/gapfinding/${gapFindingId}`, { method: "GET" });
        const items = Array.isArray(rawData) ? rawData : [rawData];
        return items.map((item: any) => ({
            id: item?.id || item?.Id || "",
            gapFindingId: item?.gapFindingId || item?.GapFindingId || "",
            title: item?.title || item?.Title || "",
            description: item?.description || item?.Description || "",
            code_to_srs: item?.code_to_srs || item?.codeToSrs || item?.CodeToSrs || "match",
        }));
    }
}

export default new ExternalApiService();

