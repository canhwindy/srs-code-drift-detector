// ============================================================
// FILE: SanitizeData/constants.ts
// Hằng số và utility function cho SanitizeData.
// ============================================================

/** Số entity tối đa hiển thị trên mỗi trang sidebar */
export const PAGE_SIZE = 10

/** Số entity tối thiểu cần chọn để Merge Entities */
export const MIN_MERGE_COUNT = 2

/**
 * Trả về Tailwind class cho badge loại entity.
 * Normalize type về uppercase trước khi lookup để handle cả
 * "PERSON" lẫn "person" từ LightRAG.
 * Trả màu xám mặc định nếu không match type nào đã biết.
 *
 * @param type - Loại entity (bất kỳ string nào từ LightRAG)
 * @returns Chuỗi Tailwind class cho badge
 */
export function getTypeBadgeClass(type: string): string {
    const colorMap: Record<string, string> = {
        PERSON: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
        ORGANIZATION: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
        LOCATION: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
        CONCEPT: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
        TECHNOLOGY: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
        EVENT: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
        METHOD: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
        DATA: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
    }
    // Normalize: "concept" → "CONCEPT", "Person" → "PERSON"
    const normalized = type.toUpperCase()
    return colorMap[normalized] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
}
