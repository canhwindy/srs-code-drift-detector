'use client';

import type { Conversation } from '../types';
import { Columns2, MoreHorizontal, Plus } from 'lucide-react';

interface ChatHistorySidebarProps {
  conversations: Conversation[];
  onSelectConversation: (id: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onNewChat?: () => void;
}

export function ChatHistorySidebar({
  onNewChat,
  conversations,
  onSelectConversation,
  isCollapsed = false,
  onToggleCollapse,
}: ChatHistorySidebarProps) {
  return (
    <>
      {/* ── Collapsed strip ──────────────────────────────────────── */}
      {isCollapsed && (
        <div className="w-12 bg-slate-800 flex flex-col items-center py-3 gap-2 border-r border-slate-700 flex-shrink-0">
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all duration-200 cursor-pointer"
          >
            <Columns2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Expanded sidebar ─────────────────────────────────────── */}
      {!isCollapsed && (
        <div className="w-[260px] bg-slate-800 flex flex-col h-full flex-shrink-0 border-r border-slate-700">
          {/* Recents Header with Collapse Button */}
          <div className="px-3 py-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3">Recents</h2>
            <button
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all duration-200 cursor-pointer"
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto px-3">
            <div className="space-y-0.5">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => onSelectConversation(conversation.id)}
                  aria-current={conversation.isActive ? 'page' : undefined}
                  className={`group w-full text-left px-3 py-2 rounded-lg transition-colors duration-200 cursor-pointer flex items-center gap-2 ${conversation.isActive
                    ? 'bg-slate-700 text-blue-400 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-700/50 hover:text-slate-100'
                    }`}
                >
                  <span className="text-sm truncate flex-1">{conversation.title}</span>
                  <MoreHorizontal className="w-4 h-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />
                </button>
              ))}
            </div>
          </div>

          {/* Footer buttons */}
          <div className="p-3 flex flex-col gap-2">
            <button
              onClick={onNewChat}
              aria-label="New chat"
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors duration-200 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New chat</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
