// ============================================
// File: UploadDocumentsDialog/UploadDocumentsDialog.tsx
// ============================================

'use client';

import React, { useState, useCallback } from 'react';
import { useTranslation } from "react-i18next";
import { X } from 'lucide-react';
import type { UploadDocumentsDialogProps, FileErrors, FileStatuses } from './UploadDocumentsDialog.types';
import { UploadDialogContent } from './UploadDialogContent';
import { MAX_FILE_COUNT, MAX_FILE_SIZE, getAllowedFileTypesDescription } from '@shared/documentUpload/constants';
import { uploadDocument } from '../lib/api';

/** Result returned by the /api/upload endpoint for each file */


/**
 * Main UploadDocumentsDialog component.
 *
 * Composes a modal overlay containing a file dropzone.
 * When files are accepted, they are uploaded to the server via /api/upload.
 * Only after successful save to disk, the parent is notified via onDocumentsUploaded.
 */
export default function UploadDocumentsDialog({
    isOpen,
    onClose,
    onDocumentsUploaded,
    workspaceId,
}: UploadDocumentsDialogProps) {
    const { t } = useTranslation();

    /** Per-file error messages, keyed by filename */
    const [fileErrors, setFileErrors] = useState<FileErrors>({});
    /** Whether files are currently being uploaded to the server */
    const [isUploading, setIsUploading] = useState(false);

    // ─────────────────────────────────────────────────────────────────────
    // Tại sao cần state riêng thay vì dùng fileErrors?
    // - fileErrors chỉ lưu lỗi (string) khi upload thất bại
    // - fileStatuses lưu TẤT CẢ trạng thái bao gồm 'uploading' và 'success'
    // - FileDropzone dùng fileStatuses để render icon tương ứng cho từng file
    // ─────────────────────────────────────────────────────────────────────
    const [fileStatuses, setFileStatuses] = useState<FileStatuses>({});

    // Handle backdrop click
    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && !isUploading) {
            onClose();
        }
    };

    // Handle accepted files — upload to server, then notify parent on success
    const handleUpload = useCallback(
        async (files: File[]) => {
            setIsUploading(true);

            // Collect per-file errors và successful files
            const errors: FileErrors = {};
            const successFiles: File[] = [];

            // ─────────────────────────────────────────────────────────────
            // Khởi tạo tất cả files với status 'idle' ngay khi nhận
            // Sau đó cập nhật từng file trong loop
            // ─────────────────────────────────────────────────────────────
            const initialStatuses: FileStatuses = {};
            files.forEach((file) => {
                initialStatuses[file.name] = 'idle';
            });
            setFileStatuses((prev) => ({ ...prev, ...initialStatuses }));


            // LOOP: Upload từng file, không dừng khi có lỗi
            // (user được thấy lỗi của từng file riêng biệt)
            for (const file of files) {
                setFileStatuses((prev) => ({ ...prev, [file.name]: 'uploading' }));
                try {
                    // GỌI Python FastAPI: POST http://localhost:8000/api/upload-document
                    // Trả về UploadResponse: { status, message, track_id?, file_name, file_size? }
                    const result = await uploadDocument(file, workspaceId);

                    if (result.status === 'success') {
                        // File đã lưu vào backend/input_document/, LightRAG sẽ xử lý
                        setFileStatuses((prev) => ({ ...prev, [file.name]: 'success' }));
                        successFiles.push(file);
                    } else if (result.status === 'duplicate') {
                        setFileStatuses((prev) => ({ ...prev, [file.name]: 'duplicate' }));
                        // File trùng — hiển thị lỗi cho user
                        errors[file.name] = t("Duplicate file: {{message}}", { message: result.message });
                    } else {
                        setFileStatuses((prev) => ({ ...prev, [file.name]: 'error' }));
                        // status === 'error'
                        errors[file.name] = result.message || t('Upload failed');
                    }
                } catch (err) {
                    setFileStatuses((prev) => ({ ...prev, [file.name]: 'error' }));
                    // Network error, backend không chạy, v.v.
                    errors[file.name] = err instanceof Error ? err.message : t('Upload failed');
                }
            }
            // Hiển thị lỗi nếu có
            if (Object.keys(errors).length > 0) {
                setFileErrors((prev) => ({ ...prev, ...errors }));
            }

            // Thông báo cho parent với danh sách file upload thành công
            // Parent (DocumentManagers) sẽ gọi fetchDocuments() để refresh bảng
            if (successFiles.length > 0) {
                onDocumentsUploaded?.(successFiles);
            }

            setIsUploading(false);
        },
        [onDocumentsUploaded, workspaceId]
    );

    // Handle rejected files by recording their errors
    const handleReject = useCallback(
        (rejections: { fileName: string; errorMessage: string }[]) => {
            rejections.forEach(({ fileName, errorMessage }) => {
                setFileErrors((prev) => ({ ...prev, [fileName]: errorMessage }));
            });
        },
        []
    );

    return (
        <>
            {/* Modal overlay + content */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={handleBackdropClick}
                    role="presentation"
                    aria-hidden="false"
                >
                    {/* Close button (top-right) */}
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isUploading}
                        className="absolute right-4 top-4 rounded-sm p-1 text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
                        aria-label="Close dialog"
                    >
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>

                    <UploadDialogContent
                        title={t("Upload Documents")}
                        description={t("Drag and drop your files here or click to browse.")}
                        maxFileCount={MAX_FILE_COUNT}
                        maxSize={MAX_FILE_SIZE}
                        fileTypesDescription={getAllowedFileTypesDescription()}
                        fileErrors={fileErrors}
                        fileStatuses={fileStatuses}
                        onUpload={handleUpload}
                        onReject={handleReject}
                    />
                </div>
            )}
        </>
    );
}
