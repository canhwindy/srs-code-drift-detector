
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo } from 'react';
import { CitationBadge } from './CitationCard';
import type { Citation, ParagraphWithCitations } from '../types';


// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

interface ParagraphBlockProps {
    paragraph: ParagraphWithCitations;
    index: number;
}


// ─────────────────────────────────────────────────────────────
// Rehype plugin: chuyển [n] text thành <cite-badge> inline node
// ─────────────────────────────────────────────────────────────
// Được gọi bởi react-markdown's rehypePlugins dưới dạng [fn, options].
// Unified gọi fn(options) → trả về transformer (tree) => void.

interface RehypeCitationsOptions {
    ids: Set<number>;
}

function rehypeCitations(options: RehypeCitationsOptions) {
    return (tree: any): void => {
        walkNode(tree, options.ids);
    };
}

/** Duyệt đệ quy qua hast tree, tách text nodes chứa [n] thành cite-badge elements */
function walkNode(node: any, ids: Set<number>): void {
    if (!node.children || !Array.isArray(node.children)) { return; }

    let i = 0;
    while (i < node.children.length) {
        const child = node.children[i];

        if (child.type === 'text' && /\[\d+\]/.test(child.value as string)) {
            const replacements = splitTextToBadgeNodes(child.value as string, ids);
            // Chỉ thay thế nếu thực sự có badge nodes (tránh loop vô ích)
            if (replacements.length > 1 || replacements[0]?.type === 'element') {
                node.children.splice(i, 1, ...replacements);
                i += replacements.length;
                continue;
            }
        } else {
            walkNode(child, ids);
        }
        i++;
    }
}

/** Tách một text string thành mảng hast nodes xen kẽ text và cite-badge */
function splitTextToBadgeNodes(text: string, ids: Set<number>): any[] {
    const nodes: any[] = [];
    const pattern = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
        const id = parseInt(match[1], 10);
        if (!ids.has(id)) { continue; } // Không có citation tương ứng → giữ nguyên

        if (match.index > lastIndex) {
            nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) });
        }
        nodes.push({
            type: 'element',
            tagName: 'cite-badge',
            // Dùng camelCase vì hast convert data-* về camelCase khi truyền vào React props
            properties: { citationId: String(id) },
            children: [],
        });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        nodes.push({ type: 'text', value: text.slice(lastIndex) });
    }

    // Nếu không tìm thấy match nào → trả về node gốc
    return nodes.length > 0 ? nodes : [{ type: 'text', value: text }];
}


// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

/**
 * Hiển thị một đoạn văn trong AI response.
 *
 * Dùng một ReactMarkdown duy nhất với rehype plugin để inject
 * CitationBadge đúng vị trí [n] inline trong văn bản.
 * Không tách thành nhiều ReactMarkdown instance để tránh block-level break.
 */
export function ParagraphBlock({ paragraph, index }: ParagraphBlockProps): JSX.Element {
    const hasContent = paragraph.text.trim().length > 0;

    // Build citation map id → Citation (memoized theo citations array)
    const citationMap = useMemo(
        () => new Map<number, Citation>(paragraph.citations.map((c) => [c.id, c])),
        [paragraph.citations],
    );

    const citationIds = useMemo(() => new Set(citationMap.keys()), [citationMap]);

    // Rehype plugin chỉ active khi có citations
    const rehypePlugins = useMemo(
        () =>
            citationIds.size > 0
                ? ([[rehypeCitations, { ids: citationIds }]] as any)
                : ([] as any),
        [citationIds],
    );

    // Components map — 'cite-badge' nhận citationId prop từ hast properties
    const components = useMemo(
        () => ({
            p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
            strong: ({ children }: { children?: React.ReactNode }) => (
                <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>
            ),
            em: ({ children }: { children?: React.ReactNode }) => (
                <em className="italic text-slate-700 dark:text-slate-300">{children}</em>
            ),
            code: ({ children }: { children?: React.ReactNode }) => (
                <code className="bg-slate-100 dark:bg-slate-700 rounded px-1 py-0.5 text-[12px] font-mono text-slate-700 dark:text-slate-300">
                    {children}
                </code>
            ),
            a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline"
                >
                    {children}
                </a>
            ),
            h1: ({ children }: { children?: React.ReactNode }) => (
                <h1 className="text-[14px] font-bold text-slate-900 dark:text-slate-100 mt-4 mb-1.5">{children}</h1>
            ),
            h2: ({ children }: { children?: React.ReactNode }) => (
                <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 mt-3 mb-1">{children}</h2>
            ),
            h3: ({ children }: { children?: React.ReactNode }) => (
                <h3 className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 mt-2 mb-1">{children}</h3>
            ),
            hr: () => <hr className="border-slate-200 dark:border-slate-700 my-3" />,

            ul: ({ children }: { children?: React.ReactNode }) => (
                <ul className="my-1.5 pl-5 list-disc marker:text-slate-400 dark:marker:text-slate-500 space-y-0.5">{children}</ul>
            ),
            ol: ({ children }: { children?: React.ReactNode }) => (
                <ol className="my-1.5 pl-5 list-decimal marker:text-slate-400 dark:marker:text-slate-500 space-y-0.5">{children}</ol>
            ),
            li: ({ children }: { children?: React.ReactNode }) => (
                <li className="text-slate-800 dark:text-slate-200 leading-relaxed">{children}</li>
            ),

            table: ({ children }: { children?: React.ReactNode }) => (
                <div className="overflow-x-auto my-2">
                    <table className="w-full text-[12px] border-collapse">{children}</table>
                </div>
            ),
            thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-slate-100 dark:bg-slate-800">{children}</thead>,
            tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
            tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
            th: ({ children }: { children?: React.ReactNode }) => (
                <th className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-left font-semibold text-slate-700 dark:text-slate-300">
                    {children}
                </th>
            ),
            td: ({ children }: { children?: React.ReactNode }) => (
                <td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-slate-700 dark:text-slate-300">{children}</td>
            ),

            // Custom element từ rehype plugin — nhận citationId qua hast properties
            'cite-badge': (props: any) => {
                const id = parseInt(props.citationId ?? props['citation-id'] ?? '0', 10);
                const citation = citationMap.get(id);
                return citation ? <CitationBadge citation={citation} /> : null;
            },
        }),
        [citationMap],
    );

    if (!hasContent) { return <div className="mb-3" key={index} />; }

    return (
        <div className="mb-3 min-w-0" key={index}>
            <div className="text-slate-800 dark:text-slate-200 leading-relaxed text-[13px] min-w-0">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={rehypePlugins}
                    components={components as any}
                >
                    {paragraph.text}
                </ReactMarkdown>
            </div>
        </div>
    );
}
