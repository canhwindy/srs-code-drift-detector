export type MessageRole = 'agent' | 'user';

export type MessageStatus = 'sent' | 'typing';


/**
 * Nguồn tài liệu của một citation.
 * file_path: Đường dẫn gốc từ LightRAG (ví dụ: "srs_v2.pdf")
 * document_title: Tên file dễ đọc cho UI (ví dụ: "srs_v2.pdf")
 */
export interface CitationSource {
  readonly file_path: string;
  readonly document_title: string;
}


/**
 * Một trích dẫn cụ thể từ tài liệu nguồn.
 * id: Số thứ tự citation (1, 2, 3...) — tương ứng [n] trong LightRAG output
 * quote: Đoạn text trích dẫn từ chunk tài liệu (max 400 chars)
 * source: Thông tin tài liệu nguồn
 */
export interface Citation {
  readonly id: number;
  readonly quote: string;
  readonly source: CitationSource;
}


/**
 * Một đoạn văn trong AI response, kèm danh sách citations tương ứng.
 * text: Nội dung đoạn văn (đã clean, không còn [n] markers)
 * citations: Danh sách trích dẫn cho đoạn này (có thể rỗng)
 */
export interface ParagraphWithCitations {
  readonly text: string;
  readonly citations: readonly Citation[];
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  status?: MessageStatus;
  contextCard?: ContextCard;
  actionButtons?: ActionButton[];
  /**
   * Structured paragraphs với inline citations.
   * undefined = legacy message hoặc user message → render content as markdown
   * defined = AI message với LightRAG citations → render ParagraphBlock components
   */
  paragraphs?: readonly ParagraphWithCitations[];
}

export interface ContextCard {
  icon: string;
  title: string;
  statusBadge: StatusBadge;
  lastUpdated: string;
  updatedBy: string;
  linkText: string;
  linkUrl: string;
}

export interface StatusBadge {
  text: string;
  icon: string;
  color: 'orange' | 'green' | 'red' | 'blue';
}

export interface ActionButton {
  icon: string;
  text: string;
  onClick: () => void;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  isActive?: boolean;
}

export interface ConversationGroup {
  label: string;
  conversations: Conversation[];
}

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  isActive?: boolean;
  onClick?: () => void;
}

export interface QuickAction {
  id: string;
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}
