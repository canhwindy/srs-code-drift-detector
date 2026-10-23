'use client'

import React from 'react'
import { useTranslation } from "react-i18next";

interface ConfirmDialogProps {
    open: boolean
    title: string
    message: string
    confirmLabel?: string
    confirmVariant?: 'danger' | 'primary'
    // NEW PROP: Khi true → disable confirm button + hiện spinner
    // Truyền vào khi API call đang chạy để tránh double-submit
    isLoading?: boolean
    onConfirm?: () => void
    onCancel: () => void
}

export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel,
    confirmVariant = 'danger',
    isLoading = false,  // DEFAULT: false — button hoạt động bình thường
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const { t } = useTranslation();
    if (!open) { return null; }

    // STYLE: Màu button theo variant
    // Khi isLoading: thêm opacity-60 + cursor-not-allowed để báo hiệu đang xử lý
    const confirmButtonClass = [
        confirmVariant === 'danger'
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-emerald-500 text-white hover:bg-emerald-600',
        isLoading ? 'opacity-60 cursor-not-allowed' : '',
    ].join(' ')

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-[#111319] rounded-lg p-6 max-w-md w-full mx-4">
                {/* TITLE */}
                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-[#E6E6E6]">
                    {title}
                </h3>

                {/* MESSAGE */}
                <p className="text-sm text-gray-600 dark:text-[#8a8f9e] mb-4">
                    {message}
                </p>

                {/* BUTTONS */}
                <div className="flex justify-end gap-2">
                    {/* CANCEL: Disable khi đang loading để tránh close dialog giữa chừng */}
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isLoading}
                        className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-[#2a2f3e] hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {t('Cancel')}
                    </button>

                    {/* CONFIRM: Hiện spinner khi isLoading=true */}
                    {onConfirm && confirmLabel && (
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={isLoading}
                            className={`px-4 py-2 text-sm font-medium rounded-md inline-flex items-center gap-2 ${confirmButtonClass}`}
                        >
                            {/* SPINNER: SVG animate-spin, chỉ hiện khi isLoading */}
                            {isLoading && (
                                <svg
                                    className="w-3.5 h-3.5 animate-spin"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                >
                                    {/* Track (vòng xám nhạt) */}
                                    <circle
                                        className="opacity-25"
                                        cx="12" cy="12" r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                    />
                                    {/* Indicator (cung tròn đậm, xoay) */}
                                    <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                    />
                                </svg>
                            )}
                            {/* LABEL: Đổi text khi đang loading */}
                            {isLoading ? t('Processing...') : confirmLabel}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}