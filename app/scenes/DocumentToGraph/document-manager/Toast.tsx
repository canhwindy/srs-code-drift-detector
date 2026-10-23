'use client'

import React from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react'
import type { ToastState } from './hooks/useToast'


// ============================================================
// SECTION 1: Config maps
// ============================================================

/**
 * Map type → màu Tailwind classes cho background + text
 * Dùng object literal thay vì switch/if để dễ mở rộng
 */
const typeStyles: Record<ToastState['type'], string> = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300',
    warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
}

/**
 * Map type → icon component từ lucide-react
 */
const typeIcons: Record<ToastState['type'], React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 flex-shrink-0" />,
    error: <XCircle className="w-4 h-4 flex-shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 flex-shrink-0" />,
    info: <Info className="w-4 h-4 flex-shrink-0" />,
}

// ============================================================
// SECTION 2: Component
// ============================================================

/**
 * Toast — Notification popup ở góc dưới-phải
 *
 * @param message - Nội dung thông báo
 * @param type    - Loại toast (ảnh hưởng màu sắc và icon)
 * @param visible - Có hiện hay không (điều khiển opacity transition)
 *
 * Kỹ thuật visibility:
 *   - Luôn render trong DOM (không dùng conditional render)
 *   - Dùng opacity + translate để animate in/out mượt mà
 *   - `pointer-events-none` khi ẩn để tránh block click
 */
export default function Toast({ message, type, visible }: ToastState) {
    return (
        // CONTAINER: Fixed position ở góc dưới-phải, z-index cao hơn dialog
        <div
            className={[
                // POSITION: Góc dưới-phải, trên tất cả elements khác
                'fixed bottom-4 right-4 z-[100]',
                // LAYOUT: Flex row với gap
                'flex items-center gap-2',
                // SIZING: Tối đa 320px để không chiếm quá nhiều màn hình
                'max-w-xs px-4 py-3',
                // SHAPE: Rounded corners + border
                'rounded-lg border shadow-lg',
                // TYPOGRAPHY: Nhỏ và đậm vừa
                'text-sm font-medium',
                // COLOR: Lấy từ map theo type
                typeStyles[type],
                // ANIMATION: Transition opacity + translateY
                // - visible=true  → opacity-100, translate-y-0 (hiện)
                // - visible=false → opacity-0, translate-y-2 (ẩn + slide nhẹ lên)
                'transition-all duration-300 ease-in-out',
                visible
                    ? 'opacity-100 translate-y-0 pointer-events-auto'
                    : 'opacity-0 translate-y-2 pointer-events-none',
            ].join(' ')}
            role="alert"
            aria-live="polite"
        >
            {/* ICON: Icon tương ứng với type */}
            {typeIcons[type]}

            {/* MESSAGE: Nội dung thông báo */}
            <span>{message}</span>
        </div>
    )
}