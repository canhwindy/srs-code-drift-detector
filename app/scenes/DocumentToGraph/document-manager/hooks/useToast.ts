import { useState, useCallback, useRef } from 'react'

// ============================================================
// SECTION 1: Types
// ============================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastState {
    message: string
    type: ToastType
    visible: boolean
}

// ============================================================
// SECTION 2: Hook
// ============================================================

/**
 * useToast — Hook quản lý toast notification
 *
 * Trả về:
 *   toast     — state object để truyền vào <Toast> component
 *   showToast — function để hiện toast với message và type
 *
 * Cơ chế:
 *   - showToast() set visible=true
 *   - Sau `duration` ms, tự set visible=false
 *   - Dùng useRef để cancel timer cũ nếu showToast() được gọi liên tiếp
 *     (tránh case toast biến mất quá sớm khi user bấm nhanh)
 *
 * Usage:
 *   const { toast, showToast } = useToast()
 *   showToast('Deletion started', 'success')
 *   <Toast {...toast} />
 */
export function useToast(duration: number = 3000) {
    // STATE: Dữ liệu toast hiện tại
    const [toast, setToast] = useState<ToastState>({
        message: '',
        type: 'success',
        visible: false,
    })

    // REF: Timer ID để cancel nếu showToast() được gọi lại trước khi timer hết
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    /**
     * showToast — Hiện toast notification
     * @param message - Nội dung hiển thị
     * @param type    - Loại toast: 'success' | 'error' | 'warning' | 'info'
     */
    const showToast = useCallback((message: string, type: ToastType = 'success') => {
        // CANCEL: Xóa timer cũ nếu đang chạy (tránh dismiss sớm)
        if (timerRef.current) {
            clearTimeout(timerRef.current)
        }

        // SHOW: Set toast visible với message mới
        setToast({ message, type, visible: true })

        // AUTO-DISMISS: Ẩn toast sau `duration` ms
        timerRef.current = setTimeout(() => {
            setToast((prev) => ({ ...prev, visible: false }))
        }, duration)
    }, [duration])

    return { toast, showToast }
}