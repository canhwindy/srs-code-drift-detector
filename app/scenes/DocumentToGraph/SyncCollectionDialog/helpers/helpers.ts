// CONSTANTS: Tách magic numbers ra thành named constants ở module level.

import { apiFetchDocuments } from "../../lib/api"

// Dễ tìm kiếm, dễ thay đổi, không bị lặp lại trong code.
const KG_DELETE_POLL_INTERVAL_MS = 1_500
const KG_DELETE_TIMEOUT_MS = 20_000

/**
 * Kết quả trả về của waitForKgDocsDeleted.
 *
 * Caller dùng kết quả này để log hoặc điều chỉnh UX:
 * - 'deleted'       : Tất cả docs đã biến mất khỏi KG — happy path.
 * - 'timeout'       : Hết 20s mà vẫn còn docs → upload vẫn diễn ra,
 *                     có thể nhận lại 'duplicate' từ backend.
 * - 'aborted'       : signal.abort() được gọi (user đóng dialog) → không upload.
 * - 'network_error' : apiFetchDocuments() throw → dừng poll, tiến hành upload.
 */
type WaitResult = 'deleted' | 'timeout' | 'aborted' | 'network_error'

/**
 * Options cho waitForKgDocsDeleted — dùng object thay vì naked parameter
 * để dễ mở rộng sau mà không phải thay đổi call site.
 */
interface WaitForKgDocsDeletedOptions {
    /** Thời gian tối đa chờ (ms). Default: KG_DELETE_TIMEOUT_MS (20s) */
    timeoutMs?: number
    /** Khoảng cách giữa các lần poll (ms). Default: KG_DELETE_POLL_INTERVAL_MS (1.5s) */
    pollIntervalMs?: number
    /**
     * AbortSignal để hủy polling từ bên ngoài.
     *
     * Truyền signal của AbortController tạo trong hook — khi component
     * unmount hoặc user đóng dialog, gọi controller.abort() để dừng poll ngay.
     * Tránh stale requests và setState sau khi component đã unmount.
     */
    signal?: AbortSignal
    /** Workspace ID forwarded as X-Workspace-Id header to Python backend */
    workspaceId?: string
}

/**
 * Chờ cho đến khi các KG documents được xóa khỏi backend.
 *
 * Mechanism: Poll apiFetchDocuments() theo `pollIntervalMs` cho đến khi
 * tất cả `kgDocIds` biến mất khỏi danh sách documents, hoặc hết `timeoutMs`,
 * hoặc `signal` bị abort.
 *
 * Dùng sau khi gọi apiDeleteDocuments() — vì deletion là async
 * (background task), cần chờ trước khi upload bản mới để tránh
 * nhận lại status 'duplicate'.
 *
 * @param kgDocIds - Mảng LightRAG doc_id cần chờ xóa
 * @param options  - Tuỳ chọn timeout, poll interval, và AbortSignal
 * @returns WaitResult — lý do hàm kết thúc
 */
export async function waitForKgDocsDeleted(
    kgDocIds: string[],
    options: WaitForKgDocsDeletedOptions = {},
): Promise<WaitResult> {
    const {
        timeoutMs = KG_DELETE_TIMEOUT_MS,
        pollIntervalMs = KG_DELETE_POLL_INTERVAL_MS,
        signal,
        workspaceId,
    } = options

    // BUILD: Set để lookup O(1) thay vì Array.includes O(n)
    const toDelete = new Set<string>(kgDocIds)

    // DEADLINE: Tính thời điểm timeout
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        // ABORT CHECK: Kiểm tra trước khi sleep — tránh 1 vòng lặp thừa
        if (signal?.aborted === true) {
            return 'aborted'
        }

        // SLEEP: Nghỉ giữa các lần poll, nhưng thoát ngay nếu signal abort.
        // Promise<boolean> = true nếu bị interrupt, false nếu sleep bình thường.
        const interrupted = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => { resolve(false) }, pollIntervalMs)
            // Lắng nghe abort một lần duy nhất — tự cleanup sau khi trigger
            signal?.addEventListener('abort', () => {
                clearTimeout(timer)
                resolve(true)
            }, { once: true })
        })

        if (interrupted) {
            return 'aborted'
        }

        try {
            // TẠI SAO cần fetch toàn bộ docs ở đây?
            //
            // Vấn đề: LightRAG không có endpoint kiểm tra từng doc theo ID.
            //   Không có: GET /api/documents/:id  → 200 (tồn tại) / 404 (đã xóa)
            //   Không có: POST /api/documents/exists  { ids: string[] } → { exists: boolean[] }
            //
            // Giải pháp hiện tại (workaround):
            //   Fetch toàn bộ danh sách docs → kiểm tra ID cần xóa có còn trong list không.
            //
            // Tại sao pageSize=1000 thay vì mặc định 50?
            //   Vì ta cần fetch đủ TẤT CẢ docs trong 1 request để không bỏ sót.
            //   Nếu dùng pageSize=50 và doc cần kiểm tra nằm ở page 2 trở đi
            //   → ta nghĩ nó đã xóa trong khi thực ra chỉ là không nằm ở page 1.
            //
            // ⚠️ Giới hạn: Nếu workspace có > 1000 docs, vẫn có thể bỏ sót.
            //   (Xem phần "Cách tối ưu hơn" trong giải thích bên dưới)
            const result = await apiFetchDocuments(undefined, 1, 1000, 'updated_at', 'desc', undefined, workspaceId)

            // CHECK: Dùng Set.has() → O(1) lookup, không dùng Array.includes() → O(n)
            // Nếu KHÔNG còn doc nào trong toDelete → tất cả đã bị xóa khỏi KG
            const stillPresent = result.documents.some((d) => toDelete.has(d.id))

            if (!stillPresent) {
                return 'deleted'
            }
        } catch {
            // NETWORK ERROR: Dừng polling, tiến hành upload (có thể vẫn bị duplicate)
            return 'network_error'
        }
    }

    // TIMEOUT: Hết thời gian chờ — caller quyết định có tiến hành upload không
    return 'timeout'
}