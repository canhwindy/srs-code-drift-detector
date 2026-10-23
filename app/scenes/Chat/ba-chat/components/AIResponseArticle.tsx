'use client';


import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ParagraphBlock } from './ParagraphBlock';
import type { ParagraphWithCitations } from '../types';


interface AIResponseArticleProps {
  /** Full markdown content (luôn có — dùng khi không có paragraphs) */
  content: string;
  /** Optional timestamp */
  timestamp?: string;
  /**
   * Structured paragraphs với inline citations.
   * undefined = render content as markdown (legacy/fallback)
   * defined = render ParagraphBlock components
   */
  paragraphs?: readonly ParagraphWithCitations[];
}

interface CodeBlockProps {
  code: string;
  language?: string;
}



/**
 * Hiển thị code block với syntax highlighting cơ bản và nút copy.
 */
function CodeBlock({ code, language }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-6">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 rounded-t-xl">
        <span className="text-xs text-slate-400 font-mono uppercase">
          {language ?? 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="p-1.5 hover:bg-slate-700 rounded transition-colors cursor-pointer"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>
      </div>
      <pre className="bg-slate-900 rounded-b-xl p-4 overflow-x-auto">
        <code className="text-[14px] text-slate-100 font-mono leading-relaxed">
          {code}
        </code>
      </pre>
    </div>
  );
}



/**
 * Các component tùy chỉnh cho react-markdown.
 * Mỗi key tương ứng một HTML tag markdown sẽ render ra.
 */
const MARKDOWN_COMPONENTS: Components = {
  // --- Block elements ---

  h1: ({ children }) => (
    <h1 className="text-[14px] font-bold text-slate-900 dark:text-slate-100 mt-5 mb-2">
      {children}
    </h1>
  ),

  h2: ({ children }) => (
    <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 mt-5 mb-2">
      {children}
    </h2>
  ),

  h3: ({ children }) => (
    <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100 mt-4 mb-1.5">
      {children}
    </h3>
  ),

  p: ({ children }) => (
    <p className="text-slate-800 dark:text-slate-200 leading-relaxed my-1.5">{children}</p>
  ),

  ul: ({ children }) => (
    <ul className="my-2 space-y-1 pl-5 list-disc marker:text-slate-400 dark:marker:text-slate-500">
      {children}
    </ul>
  ),

  ol: ({ children }) => (
    <ol className="my-2 space-y-1 pl-5 list-decimal marker:text-slate-400 dark:marker:text-slate-500">
      {children}
    </ol>
  ),

  li: ({ children }) => (
    <li className="text-slate-800 dark:text-slate-200 leading-relaxed">{children}</li>
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-slate-200 dark:border-slate-600 pl-4 my-3 text-slate-600 dark:text-slate-400 italic">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="border-slate-200 dark:border-slate-700 my-4" />,

  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-[13px] border-collapse">{children}</table>
    </div>
  ),

  thead: ({ children }) => (
    <thead className="bg-slate-100 dark:bg-slate-800">{children}</thead>
  ),

  th: ({ children }) => (
    <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-300">
      {children}
    </th>
  ),

  td: ({ children }) => (
    <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-700 dark:text-slate-300">
      {children}
    </td>
  ),

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline"
    >
      {children}
    </a>
  ),

  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>
  ),

  em: ({ children }) => (
    <em className="italic text-slate-700 dark:text-slate-300">{children}</em>
  ),

  pre: ({ children }) => <>{children}</>,

  code: ({ className, children }) => {
    const language = /language-(\w+)/.exec(className ?? '')?.[1];

    if (language !== undefined) {
      return (
        <CodeBlock
          code={String(children).replace(/\n$/, '')}
          language={language}
        />
      );
    }

    return (
      <code className="bg-slate-100 dark:bg-slate-700 rounded px-1 py-0.5 text-[12px] font-mono text-slate-700 dark:text-slate-300">
        {children}
      </code>
    );
  },
};



/**
 * Hiển thị tin nhắn của AI agent dưới dạng bài viết có markdown.
 * @param content   - Nội dung markdown từ backend
 * @param timestamp - Thời gian gửi (tùy chọn)
 */
export function AIResponseArticle({
  content,
  timestamp,
  paragraphs,
}: AIResponseArticleProps): JSX.Element {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Có paragraphs data → dùng structured rendering với citations
  const useStructuredMode: boolean =
    paragraphs !== undefined && paragraphs.length > 0;

  return (
    <article className="w-full max-w-full min-w-0 overflow-hidden">
      {/* Timestamp */}
      {timestamp !== undefined && (
        <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">
          BA Agent • {timestamp}
        </div>
      )}

      {/* Content container */}
      <div className="relative group">
        {/* Nút copy toàn bộ message */}
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          aria-label="Copy response"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-600" />
          ) : (
            <Copy className="w-4 h-4 text-slate-600" />
          )}
        </button>

        {/* ─── STRUCTURED MODE: Paragraphs với inline citations ─── */}
        {useStructuredMode ? (
          <div className="text-[13px] leading-[1.6] min-w-0 max-w-full">
            {paragraphs!.map((paragraph, idx) => (
              <ParagraphBlock
                key={idx}
                paragraph={paragraph}
                index={idx}
              />
            ))}
          </div>
        ) : (
          /* ─── MARKDOWN MODE: Fallback cho legacy messages ─── */
          <div className="text-[13px] leading-[1.6] min-w-0 max-w-full">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={MARKDOWN_COMPONENTS}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </article>
  );
}

