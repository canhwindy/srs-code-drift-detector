// ============================================
// File: UploadDocumentsDialog/FileDropzone.tsx
// ============================================

'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from "react-i18next";
import { AlertCircle, Upload, FileText, X, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import type { FileErrors, FileStatuses } from './UploadDocumentsDialog.types';
import {
    isAllowedFileType,
    getFileExtension,
    formatFileSize,
    getAllowedFileTypesDescription,
    MAX_FILE_SIZE,
    MAX_FILE_COUNT,
} from '@shared/documentUpload/constants';


interface FileDropzoneProps {
    /** Maximum number of files allowed */
    maxFileCount?: number;
    /** Maximum file size in bytes */
    maxSize?: number;
    /** Hint text for accepted file types */
    description?: string;
    /** Per-file error messages */
    fileErrors?: FileErrors;

    fileStatuses?: FileStatuses;
    /** Called when valid files are selected */
    onUpload?: (files: File[]) => void;
    /** Called when files are rejected */
    onReject?: (files: File[]) => void;
}

/** Validation error type */
interface ValidationError {
    file: File;
    reason: 'type' | 'size' | 'count';
    message: string;
}

function FileStatusIcon({ status }: { status: string | undefined }) {
    if (!status || status === 'idle') {
        // Chưa bắt đầu upload — không hiện icon gì
        return null;
    }

    if (status === 'uploading') {
        // Đang upload → spinner quay
        return (
            <Loader2
                className="h-4 w-4 animate-spin text-blue-500"
                aria-label="Uploading..."
            />
        );
    }

    if (status === 'success') {
        // Upload thành công → checkmark xanh
        return (
            <CheckCircle2
                className="h-4 w-4 text-green-500"
                aria-label="Upload successful"
            />
        );
    }

    if (status === 'duplicate') {
        // File trùng → warning vàng
        return (
            <AlertTriangle
                className="h-4 w-4 text-yellow-500"
                aria-label="Duplicate file"
            />
        );
    }

    if (status === 'error') {
        // Lỗi → X đỏ
        return (
            <AlertCircle
                className="h-4 w-4 text-red-500"
                aria-label="Upload failed"
            />
        );
    }

    return null;
}

/**
 * A drag-and-drop file dropzone with file list and error states.
 * Now includes comprehensive validation: file type, size, and count.
 */
export function FileDropzone({
    maxFileCount = MAX_FILE_COUNT,
    maxSize = MAX_FILE_SIZE,
    description,
    fileErrors = {},
    fileStatuses = {},
    onUpload,
    onReject,
}: FileDropzoneProps) {
    const { t } = useTranslation();
    /**
     * Lưu danh sách các file đã được chấp nhận (hợp lệ) từ các lần kéo thả hoặc chọn file.
     * Cần dùng state vì danh sách này thay đổi theo tương tác người dùng (thêm/xoá file),
     * và mỗi khi state thay đổi React sẽ re-render lại giao diện để hiển thị danh sách mới nhất.
     */
    const [files, setFiles] = useState<File[]>([]);
    /** Whether a file is currently being dragged over the dropzone area */
    const [isDragOver, setIsDragOver] = useState(false);
    /** Ref to the hidden <input type="file"> element, used to programmatically trigger the file browser */
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Use auto-generated description if not provided
    const displayDescription = description || `${getAllowedFileTypesDescription()} (max ${formatFileSize(maxSize)})`;

    /**
     * Validate a single file
     * Returns null if valid, or ValidationError if invalid
     */
    const validateFile = useCallback(
        (file: File, currentAcceptedCount: number): ValidationError | null => {
            // 1. Check file type
            if (!isAllowedFileType(file.name)) {
                const extension = getFileExtension(file.name) || 'unknown';
                return {
                    file,
                    reason: 'type',
                    message: t("Unsupported file type: .{{ext}}", { ext: extension }),
                };
            }

            // 2. Check file size
            if (file.size > maxSize) {
                return {
                    file,
                    reason: 'size',
                    message: t("File too large ({{size}}). Max: {{max}}", { size: formatFileSize(file.size), max: formatFileSize(maxSize) }),
                };
            }

            // 3. Check file count limit
            if (files.length + currentAcceptedCount >= maxFileCount) {
                return {
                    file,
                    reason: 'count',
                    message: t("Maximum {{count}} files allowed", { count: maxFileCount }),
                };
            }

            return null; // Valid
        },
        [maxSize, maxFileCount, files.length]
    );

    const handleFiles = useCallback(
        (selectedFiles: FileList | null) => {
            if (!selectedFiles) { return; }

            const accepted: File[] = [];
            const rejected: File[] = [];
            const errors: ValidationError[] = [];

            Array.from(selectedFiles).forEach((file) => {
                const validationError = validateFile(file, accepted.length);

                if (validationError) {
                    rejected.push(file);
                    errors.push(validationError);
                } else {
                    accepted.push(file);
                }
            });

            if (rejected.length > 0) {
                onReject?.(rejected);
            }

            if (accepted.length > 0) {
                setFiles((prev) => [...prev, ...accepted]);
                onUpload?.(accepted);
            }
        },
        [validateFile, onReject, onUpload]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setIsDragOver(false);
            handleFiles(e.dataTransfer.files);
        },
        [handleFiles]
    );

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragOver(false);
    }, []);

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(e.target.files);
        // Reset value so same file can be re-selected
        if (fileInputRef.current) { fileInputRef.current.value = ''; }
    };

    const handleRemoveFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    /**
     * Gộp tên file từ hai nguồn để hiển thị đầy đủ danh sách:
     * - `files`: các file đã vượt qua validation ở client (đúng định dạng, không quá dung lượng, không vượt giới hạn số lượng).
     * - `fileErrors`: lỗi do server trả về sau khi upload (ví dụ: file trùng nội dung, lỗi xử lý phía server).
     *   Một file trong `files` vẫn có thể xuất hiện trong `fileErrors` nếu server từ chối sau khi đã nhận file,
     *   nên cần dùng Set để tránh hiển thị trùng lặp cùng một file.
     */
    const allFileNames = new Set([
        ...files.map((f) => f.name),
        ...Object.keys(fileErrors),
    ]);

    return (
        <div className="flex flex-col gap-4">
            {/* Dropzone area */}
            <div
                role="button"
                tabIndex={0}
                aria-label="Drop files here or click to browse"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={handleBrowseClick}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleBrowseClick();
                    }
                }}
                className={`
          relative flex flex-col items-center justify-center gap-2
          rounded-lg border-2 border-dashed p-8 text-center
          transition-colors cursor-pointer
          ${isDragOver
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-gray-300 bg-gray-50 hover:border-gray-400 dark:border-[#2a2f3e] dark:bg-[#1f232e]/50 dark:hover:border-gray-500'
                    }
        `}
            >
                {/* Upload icon */}
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-[#2a2f3e]">
                    <Upload className="h-6 w-6 text-gray-500 dark:text-[#8a8f9e]" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700 dark:text-[#E6E6E6]">
                        {t("Drag & drop files here, or")}{' '}
                        <span className="text-blue-600 underline dark:text-blue-400">{t("browse")}</span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-[#8a8f9e]">
                        {displayDescription}
                    </p>
                </div>

                {/* Hidden file input */}
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple={maxFileCount > 1}
                    className="hidden"
                    onChange={handleInputChange}
                    aria-hidden="true"
                    tabIndex={-1}
                />
            </div>

            {/* File list */}
            {allFileNames.size > 0 && (
                <div
                    className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-gray-200 p-3 dark:border-[#2a2f3e]"
                    role="list"
                    aria-label="Uploaded files"
                >
                    {Array.from(allFileNames).map((fileName) => {
                        const file = files.find((f) => f.name === fileName);
                        const error = fileErrors[fileName];
                        const fileIndex = files.findIndex((f) => f.name === fileName);
                        const uploadStatus = fileStatuses[fileName];

                        const cardBorderClass =
                            uploadStatus === 'success' ? 'border-green-200 dark:border-green-800' :
                                uploadStatus === 'error' ? 'border-red-200 dark:border-red-800' :
                                    uploadStatus === 'duplicate' ? 'border-yellow-200 dark:border-yellow-800' :
                                        uploadStatus === 'uploading' ? 'border-blue-200 dark:border-blue-800' :
                                            'border-gray-100 dark:border-[#2a2f3e]'; // idle / default


                        return (
                            <div
                                key={fileName}
                                role="listitem"
                                className={`flex items-center gap-3 rounded-md border bg-white p-2.5 dark:bg-[#1f232e] transition-colors ${cardBorderClass}`}
                            >
                                {/* File icon */}
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-[#2a2f3e]">
                                    <FileText className="h-[18px] w-[18px] text-gray-500 dark:text-[#8a8f9e]" aria-hidden="true" />
                                </div>

                                {/* File info */}
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <div className="flex items-center justify-between">
                                        <p className="truncate text-sm font-medium text-gray-700 dark:text-[#E6E6E6]">
                                            {fileName}
                                        </p>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {file && (
                                                <span className="text-xs text-gray-400">
                                                    {formatFileSize(file.size)}
                                                </span>
                                            )}
                                            {/* ─────────────────────────────────────────
                                                THÊM MỚI: Status icon (spinner/check/error)
                                                Hiển thị bên cạnh kích thước file
                                                ───────────────────────────────────────── */}
                                            <FileStatusIcon status={uploadStatus} />
                                        </div>
                                    </div>

                                    {/* Error / status message */}
                                    {error && (
                                        <div className="flex items-center gap-1.5">
                                            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" aria-hidden="true" />
                                            <p className="text-xs text-red-500 dark:text-red-400" role="alert">
                                                {error}
                                            </p>
                                        </div>
                                    )}

                                    {/*Success message khi upload xong */}
                                    {!error && uploadStatus === 'success' && (
                                        <p className="text-xs text-green-600 dark:text-green-400">
                                            {t("Saved to directory")}
                                        </p>
                                    )}

                                    {/*Uploading message */}
                                    {uploadStatus === 'uploading' && (
                                        <p className="text-xs text-blue-500 dark:text-blue-400">
                                            {t("Uploading...")}
                                        </p>
                                    )}
                                </div>

                                {/* Remove button — ẩn khi đang upload hoặc đã success */}
                                {fileIndex >= 0 && uploadStatus !== 'uploading' && uploadStatus !== 'success' && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveFile(fileIndex);
                                        }}
                                        className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#2a2f3e] dark:hover:text-gray-300"
                                        aria-label={`Remove ${fileName}`}
                                    >
                                        <X className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default FileDropzone;
