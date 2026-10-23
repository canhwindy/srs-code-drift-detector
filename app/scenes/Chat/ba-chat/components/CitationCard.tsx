
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileText, ExternalLink } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { toast } from 'sonner';
import useStores from '~/hooks/useStores';
import { documentPath } from '~/utils/routeHelpers';
import type { Citation } from '../types';

interface CitationBadgeProps {
    citation: Citation;
}

interface PopoverPosition {
    top: number;
    left: number;
    caretX: number;
}

export function CitationBadge({ citation }: CitationBadgeProps): JSX.Element {
    const [isBadgeHovered, setIsBadgeHovered] = useState(false);
    const [isPopoverHovered, setIsPopoverHovered] = useState(false);
    const [isNavigating, setIsNavigating] = useState(false);
    const isOpen = isBadgeHovered || isPopoverHovered;

    const [pos, setPos] = useState<PopoverPosition>({ top: 0, left: 0, caretX: 128 });
    const badgeRef = useRef<HTMLButtonElement>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { documents } = useStores();
    const history = useHistory();

    // const title: string = citation.source.document_title.split('<#>')[1] || citation.source.document_title;

    const clearCloseTimer = () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const scheduleClose = () => {
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => {
            setIsBadgeHovered(false);
            setIsPopoverHovered(false);
        }, 150);
    };

    useEffect(() => () => clearCloseTimer(), []);


    // Tính toán vị trí popover dựa trên vị trí thực của badge trong viewport
    useEffect(() => {
        if (isOpen && badgeRef.current) {
            const rect = badgeRef.current.getBoundingClientRect();

            const POPOVER_WIDTH = 256;
            const MARGIN = 8;   // khoảng cách tối thiểu từ mép viewport
            const GAP = 8;      // gap giữa badge và popover

            const centerX = rect.left + rect.width / 2;

            // Left nếu centered
            const rawLeft = centerX - POPOVER_WIDTH / 2;

            // Clamp: không vượt mép trái, không vượt mép phải
            const clampedLeft = Math.max(
                MARGIN,
                Math.min(rawLeft, window.innerWidth - POPOVER_WIDTH - MARGIN)
            );

            // Caret position tính theo popover-relative px, clamp trong [12, POPOVER_WIDTH - 12]
            const caretX = Math.max(12, Math.min(centerX - clampedLeft, POPOVER_WIDTH - 12));

            // Top: phía trên badge, dùng fixed → viewport coords trực tiếp
            const topAbove = rect.top - GAP;

            setPos({ top: topAbove, left: clampedLeft, caretX });
        }
    }, [isOpen]);

    const handleSourceClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Đóng popover
        setIsBadgeHovered(false);
        setIsPopoverHovered(false);
        setIsNavigating(true);

        const parts = citation.source.document_title.split('<#>');
        const docId = parts[0];
        const displayTitle = parts[1] || citation.source.document_title;

        try {
            // Fetch document by ID directly (from citation.source.document_title.split('<#>')[0])
            const doc = await documents.fetch(docId);

            if (doc) {
                history.push(documentPath(doc), { highlightText: citation.quote });
            } else {
                toast.error(`Không tìm thấy tài liệu "${displayTitle}"`);
            }
        } catch (_error) {
            toast.error(`Không thể mở tài liệu "${displayTitle}". Vui lòng thử lại.`);
        } finally {
            setIsNavigating(false);
        }
    };

    const popover = isOpen ? (
        <div
            id={`citation-popover-${citation.id}`}
            role="tooltip"
            onMouseEnter={() => { clearCloseTimer(); setIsPopoverHovered(true); }}
            onMouseLeave={scheduleClose}
            style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                transform: 'translateY(-100%)',
                zIndex: 9999,
                width: '256px',
            }}
            className={[
                'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-3',
                'text-[12px] text-slate-700 dark:text-slate-300',
            ].join(' ')}
        >
            {/* Source header */}
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400 min-w-0">
                    <FileText className="w-3 h-3 text-blue-500 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate" title={citation.source.document_title.split('<#>')[1] || citation.source.document_title}>
                        {citation.source.document_title.split('<#>')[1] || citation.source.document_title}
                    </span>
                </div>
                {citation.source.file_path !== 'unknown_source' && (
                    <button
                        type="button"
                        onClick={handleSourceClick}
                        disabled={isNavigating}
                        className={[
                            'flex items-center gap-0.5 text-[10px] text-blue-600 flex-shrink-0',
                            'hover:text-blue-800 hover:underline transition-colors',
                            isNavigating ? 'opacity-50 cursor-wait' : 'cursor-pointer',
                        ].join(' ')}
                    >
                        <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                        <span>{isNavigating ? '...' : 'Source'}</span>
                    </button>
                )}
            </div>

            {/* Divider */}
            <div className="border-t border-slate-200 dark:border-slate-700 mb-2" aria-hidden="true" />

            {/* Quote */}
            <blockquote className="italic text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-4">
                &ldquo;{citation.quote}&rdquo;
            </blockquote>

            {/* Caret arrow pointing down */}
            <div
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    top: '100%',
                    left: pos.caretX,
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '6px solid #e2e8f0',
                }}
            />
        </div>
    ) : null;

    return (
        <span
            className="relative inline-block"
            onMouseEnter={() => { clearCloseTimer(); setIsBadgeHovered(true); }}
            onMouseLeave={scheduleClose}
            onFocus={() => { clearCloseTimer(); setIsBadgeHovered(true); }}
            onBlur={scheduleClose}
        >
            {/* ─── Circle Badge ─── */}
            <button
                ref={badgeRef}
                type="button"
                aria-label={`Xem trích dẫn [${citation.id}]`}
                aria-describedby={`citation-popover-${citation.id}`}
                className={[
                    'inline-flex items-center justify-center',
                    'w-4 h-4 rounded-full border cursor-pointer select-none',
                    'text-[9px] font-bold align-super ml-0.5',
                    'transition-colors duration-150',
                    isBadgeHovered
                        ? 'bg-blue-200 border-blue-500 text-blue-800'
                        : 'bg-blue-100 border-blue-300 text-blue-700 hover:bg-blue-200',
                ].join(' ')}
            >
                {citation.id}
            </button>

            {/* ─── Portal Popover (thoát khỏi overflow:hidden của parent) ─── */}
            {createPortal(popover, document.body)}
        </span>
    );
}
