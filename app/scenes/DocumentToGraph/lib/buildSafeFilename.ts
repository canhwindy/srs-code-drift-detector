/**
 * Tạo tên file hợp lệ cho tài liệu khi upload vào LightRAG.
 *
 * Format: "{docId}<#>{docTitle}.md"
 * - Spaces được giữ nguyên (không dùng underscore) để ILIKE search trên title chính xác.
 * - Ký tự không hợp lệ trong filename bị xóa.
 * - Giới hạn 200 ký tự tổng.
 *
 * QUAN TRỌNG: Đây là single source of truth cho filename format.
 * Cả useSyncCollection và useAutoSyncApproved phải dùng hàm này
 * để đảm bảo duplicate detection hoạt động đúng giữa 2 flows.
 */
export function buildSafeFilename(docId: string, docTitle: string): string {
    const safe = docTitle
        .replace(/[/\\:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim() || 'untitled'

    const maxTitleLen = 200 - docId.length - 6
    const truncated = safe.length > maxTitleLen ? safe.slice(0, maxTitleLen) : safe
    return `${docId}<#>${truncated}.md`
}
