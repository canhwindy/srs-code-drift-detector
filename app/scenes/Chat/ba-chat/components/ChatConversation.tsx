'use client';

import { useState, useRef, useEffect } from 'react';
import type { Message, QuickAction, Conversation } from '../types';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { QuickActions } from './QuickActions';
import { ChevronDown, Send, Plus, Pencil, Trash2 } from 'lucide-react';

interface ChatConversationProps {
  messages: Message[];
  quickActions: QuickAction[];
  onSendMessage: (message: string) => void;
  isTyping?: boolean;
  chatTitle?: string;
  conversations?: Conversation[];
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onRenameConversation?: (id: string, newTitle: string) => void;
  onDeleteConversation?: (id: string) => void;
}

export function ChatConversation({
  messages,
  quickActions,
  onSendMessage,
  isTyping = false,
  chatTitle = 'BA Agent Chat',
  conversations,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
}: ChatConversationProps) {
  const [inputValue, setInputValue] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // STATE CHO RENAME FEATURE:
  // editingConvId: ID của conversation đang được edit tên (null = không có)
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  // hoveredConvId: ID của conversation đang hover — dùng inline style để tránh phụ thuộc Tailwind variant
  const [hoveredConvId, setHoveredConvId] = useState<string | null>(null);
  // editingTitle: Giá trị tạm thời đang gõ trong input rename
  const [editingTitle, setEditingTitle] = useState('');

  // confirmDeleteConvId: ID của conversation đang chờ user xác nhận xóa
  // null = không hiển thị dialog
  // string = hiển thị dialog xác nhận xóa conversation có ID này
  const [confirmDeleteConvId, setConfirmDeleteConvId] = useState<string | null>(null);

  // HANDLER: User click icon thùng rác — mở confirmation dialog
  const handleDeleteClick = (convId: string, e: React.MouseEvent) => {
    // STOP PROPAGATION: Ngăn event lan lên div cha (tránh chọn conversation)
    e.stopPropagation();
    // Lưu ID → trigger hiển thị confirmation dialog
    setConfirmDeleteConvId(convId);
  };

  // HANDLER: User xác nhận xóa (click nút "Xóa" trong dialog)
  const handleConfirmDelete = () => {
    if (confirmDeleteConvId) {
      // Gọi callback lên page.tsx để thực hiện xóa trong DB
      onDeleteConversation?.(confirmDeleteConvId);
    }
    // Đóng dialog
    setConfirmDeleteConvId(null);
  };

  // HANDLER: User hủy xóa (click "Hủy" hoặc click ngoài dialog)
  const handleCancelDelete = () => {
    setConfirmDeleteConvId(null);
  };

  // HANDLER: Bắt đầu edit tên conversation
  // Gọi khi user click icon bút chì
  const handleStartRename = (conv: Conversation, e: React.MouseEvent) => {
    // STOP PROPAGATION: Ngăn event lan lên button cha (sẽ đóng dropdown)
    e.stopPropagation();
    // Set conversation đang được edit và pre-fill tên hiện tại
    setEditingConvId(conv.id);
    setEditingTitle(conv.title);
  };

  // HANDLER: Xác nhận đổi tên
  // Gọi khi user nhấn Enter hoặc blur khỏi input
  const handleConfirmRename = (convId: string) => {
    // Gọi callback từ page.tsx để save (nếu có tên mới)
    if (editingTitle.trim()) {
      onRenameConversation?.(convId, editingTitle);
    }
    // Reset editing state — đóng input
    setEditingConvId(null);
    setEditingTitle('');
  };

  // HANDLER: Hủy đổi tên (nhấn Escape)
  const handleCancelRename = () => {
    setEditingConvId(null);
    setEditingTitle('');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSend = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 min-w-0 overflow-hidden flex flex-col bg-white dark:bg-[#111319]">
      {/* Header */}
      <div
        className="flex-shrink-0 z-10 bg-white/80 dark:bg-[#111319]/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-700/60 px-6 py-2.5 flex items-center justify-between relative"
        ref={dropdownRef}
      >
        {/* Title button — opens dropdown */}
        <button
          onClick={() => setIsDropdownOpen((v) => !v)}
          className="flex items-center gap-1.5 hover:opacity-75 transition-opacity cursor-pointer"
        >
          <p className="text-[14px] font-semibold text-[#1C2A3A] dark:text-slate-100">{chatTitle}</p>
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#1C2A3A] dark:text-slate-100 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Right action buttons */}
        <div className="flex items-center gap-1">
          {/* Plus button — new conversation */}
          {onNewChat && (
            <button
              onClick={onNewChat}
              aria-label="New conversation"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-150 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}

        </div>

        {/* Dropdown conversation list */}
        {isDropdownOpen && conversations && conversations.length > 0 && (
          <div className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onMouseEnter={() => setHoveredConvId(conv.id)}
                onMouseLeave={() => setHoveredConvId(null)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${conv.isActive ? 'bg-blue-50 dark:bg-slate-700' : ''}`}
              >
                {/* CASE A: Đang edit tên conversation này */}
                {editingConvId === conv.id ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter → confirm
                      if (e.key === 'Enter') { handleConfirmRename(conv.id); }
                      // Escape → cancel
                      if (e.key === 'Escape') { handleCancelRename(); }
                      // Ngăn event lan lên (tránh đóng dropdown)
                      e.stopPropagation();
                    }}
                    onBlur={() => handleConfirmRename(conv.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-[13px] font-medium text-slate-800 dark:text-slate-200 border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700"
                  />
                ) : (
                  /* CASE B: Hiển thị bình thường (không edit) */
                  <button
                    onClick={() => {
                      onSelectConversation?.(conv.id);
                      setIsDropdownOpen(false);
                    }}
                    className="flex-1 min-w-0 text-left flex flex-col gap-0.5 cursor-pointer"
                  >
                    <span
                      className={`text-[13px] font-medium truncate ${conv.isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}`}
                    >
                      {conv.title}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                      {conv.preview} · {conv.timestamp}
                    </span>
                  </button>
                )}

                {/* Icon bút chì — chỉ hiện khi hover, ẩn khi đang edit */}
                {/* Action icons — chỉ hiện khi hover, ẩn khi đang edit */}
                {editingConvId !== conv.id && (
                  <div className="flex items-center flex-shrink-0">
                    {/* Icon bút chì — đổi tên conversation */}
                    <button
                      onClick={(e) => handleStartRename(conv, e)}
                      aria-label={`Rename ${conv.title}`}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all duration-150 cursor-pointer"
                      style={{
                        opacity: hoveredConvId === conv.id ? 1 : 0,
                        transition: 'opacity 150ms ease',
                      }}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>

                    {/* Icon thùng rác — xóa conversation */}
                    <button
                      onClick={(e) => handleDeleteClick(conv.id, e)}
                      aria-label={`Delete ${conv.title}`}
                      className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-150 cursor-pointer"
                      style={{
                        opacity: hoveredConvId === conv.id ? 1 : 0,
                        transition: 'opacity 150ms ease',
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="px-6 py-6">
          {messages.length === 0 ? (
            <QuickActions actions={quickActions} />
          ) : (
            <>
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isTyping && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 z-10 px-6 pt-6 pb-2 bg-gradient-to-t from-white/90 dark:from-[#111319]/90 via-white/70 dark:via-[#111319]/70 to-transparent backdrop-blur-md">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 flex items-end gap-2">
          <textarea
            placeholder="Reply..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              // Auto-resize textarea
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 140) + 'px';
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label="Message input"
            className="flex-1 resize-none py-1.5 bg-transparent border-0 text-[14px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none leading-[1.4]"
            style={{ minHeight: '28px', maxHeight: '140px', height: '28px', overflow: 'hidden' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            aria-label="Send message"
            className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer flex items-center justify-center shadow-sm flex-shrink-0 mb-0.5"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-1.5 mb-1">
          BA Agent can make mistakes. Verify important information with SRS documents.
        </p>
      </div>

      {/* ConfirmDelete Dialog — hiển thị khi user click icon thùng rác */}
      {confirmDeleteConvId && (
        // OVERLAY: Nền mờ phủ toàn màn hình — click vào để hủy
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
          onClick={handleCancelDelete}
        >
          {/* DIALOG BOX: e.stopPropagation() ngăn click bên trong đóng overlay */}
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6 w-80 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* TITLE */}
            <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-100 mb-2">
              Delete conversation?
            </h3>

            {/* DESCRIPTION */}
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-5">
              All messages in this conversation will be permanently deleted.
              This action cannot be undone.
            </p>

            {/* ACTION BUTTONS */}
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                className="px-4 py-2 text-[13px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
