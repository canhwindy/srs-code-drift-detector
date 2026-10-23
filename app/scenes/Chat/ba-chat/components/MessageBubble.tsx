import type { Message } from '../types';
import { ContextCard } from './ContextCard';
import { AIResponseArticle } from './AIResponseArticle';

interface MessageBubbleProps {
  message: Message;
}


export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isAgent: boolean = message.role === 'agent';

  // Agent messages: full-width article layout với citations
  if (isAgent) {
    return (
      <div className="mb-10 w-full min-w-0">
        {/* Truyền paragraphs xuống — undefined nếu legacy message */}
        <AIResponseArticle
          content={message.content}
          timestamp={message.timestamp}
          paragraphs={message.paragraphs}
        />

        {/* Action Buttons */}
        {message.actionButtons !== undefined && message.actionButtons.length > 0 && (
          <div className="flex gap-2 mt-4">
            {message.actionButtons.map((button, index) => (
              <button
                key={index}
                type="button"
                onClick={button.onClick}
                className="text-[12px] px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors duration-200 cursor-pointer"
              >
                {button.text}
              </button>
            ))}
          </div>
        )}

        {/* Context Card */}
        {message.contextCard !== undefined && (
          <div className="mt-4 max-w-2xl">
            <ContextCard card={message.contextCard} />
          </div>
        )}
      </div>
    );
  }

  // User messages: compact bubble
  return (
    <div className="mb-8 flex justify-end">
      <div className="max-w-3xl">
        <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5 text-right">You</div>
        <div className="text-slate-900 dark:text-slate-100">
          <p className="text-[13px] leading-[1.6] whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}
