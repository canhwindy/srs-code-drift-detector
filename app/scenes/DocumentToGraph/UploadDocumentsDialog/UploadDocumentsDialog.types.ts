// ============================================
// File: UploadDocumentsDialog/UploadDocumentsDialog.types.ts
// ============================================

/** Error messages keyed by filename */
export type FileErrors = Record<string, string>;

// ─────────────────────────────────────────────────────────────────────────
// THÊM MỚI: Trạng thái upload của từng file riêng biệt
//
// idle      → File đã được thêm vào list, chưa bắt đầu upload
// uploading → Đang POST tới Python FastAPI /api/upload-document
// success   → Server trả về { status: "success" } → file đã lưu vào disk
// duplicate → Server trả về { status: "duplicate" } → file đã tồn tại
// error     → Network error hoặc server trả về { status: "error" }
// ─────────────────────────────────────────────────────────────────────────
export type FileUploadStatus = 'idle' | 'uploading' | 'success' | 'duplicate' | 'error';

/** Upload status for all files, keyed by filename */
export type FileStatuses = Record<string, FileUploadStatus>;


/** Supported file rejection error detail */
export interface FileRejectionDetail {
    /** Original filename */
    fileName: string;
    /** Human-readable error message */
    errorMessage: string;
}

/** Props for the main UploadDocumentsDialog component */
export interface UploadDocumentsDialogProps {
    /** Callback fired after documents are uploaded successfully, passes the uploaded files */
    onDocumentsUploaded?: (files: File[]) => void;
    /** Whether the dialog should open */
    isOpen: boolean;
    /** Callback fired when the dialog should close */
    onClose: () => void;
    /** Workspace ID forwarded as X-Workspace-Id header to Python backend */
    workspaceId?: string;
}

/** Props for the dialog trigger button */
export interface UploadDialogTriggerProps {
    /** Tooltip text for the button */
    tooltipText?: string;
    /** Button label */
    label?: string;
}

/** Props for the dialog content area */
export interface UploadDialogContentProps {
    /** Title displayed in the dialog header */
    title: string;
    /** Description displayed below the title */
    description: string;
    /** Maximum number of files allowed */
    maxFileCount?: number;
    /** Maximum file size in bytes */
    maxSize?: number;
    /** Hint text for accepted file types */
    fileTypesDescription?: string;
    /** Per-file error messages */
    fileErrors?: FileErrors;
    /** Per-file upload statuses (idle | uploading | success | duplicate | error) */
    fileStatuses?: FileStatuses;
    /** Called when files are accepted for upload */
    onUpload?: (files: File[]) => void;
    /** Called when files are rejected by the dropzone */
    onReject?: (rejections: FileRejectionDetail[]) => void;
}
