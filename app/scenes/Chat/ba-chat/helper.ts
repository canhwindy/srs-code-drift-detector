// ─────────────────────────────────────────────────────────────
// HELPER: Chuyển MessageRecord (backend) → Message (frontend)
// ─────────────────────────────────────────────────────────────
// Backend lưu role "assistant", frontend hiển thị role "agent".
// Hàm này làm cầu nối giữa 2 convention.

import type { Conversation, Message, ParagraphWithCitations } from './types';


/**
 * Raw message record từ backend API.
 * Định nghĩa rõ ràng shape thay vì dùng any — type safety khi map.
 */
interface BackendMessageRecord {
    id: string;
    role: string;
    content: string;
    created_at: string;
    /** Optional — chỉ có trong AI messages với LightRAG citations */
    paragraphs?: readonly ParagraphWithCitations[];
}


/**
 * Raw conversation record từ backend API.
 */
interface BackendConversationRecord {
    id: string;
    title: string;
    preview: string;
    updated_at: string;
}


// ─────────────────────────────────────────────────────────────
export function toDisplayMessage(m: BackendMessageRecord): Message {
    return {
        id: m.id,
        // Map "assistant" → "agent" để khớp với MessageRole trong types.ts
        role: m.role === 'assistant' ? 'agent' : 'user',
        content: m.content,
        timestamp: new Date(m.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        }),
        // Map paragraphs nếu có (undefined nếu không có → backward compat)
        // spread với undefined key sẽ bị bỏ qua trong object literal
        ...(m.paragraphs !== undefined && { paragraphs: m.paragraphs }),
    };
}



// ─────────────────────────────────────────────────────────────
// HELPER: Chuyển ConversationRecord (backend) → Conversation (frontend)
// ─────────────────────────────────────────────────────────────
export function toDisplayConversation(
    c: BackendConversationRecord,
    isActive: boolean = false,
): Conversation {
    return {
        id: c.id,
        title: c.title,
        preview: c.preview,
        // Format ngày: "Feb 25" — dùng locale mặc định
        timestamp: new Date(c.updated_at).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
        }),
        isActive,
    };
}