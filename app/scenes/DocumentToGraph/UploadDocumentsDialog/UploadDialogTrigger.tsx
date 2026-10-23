// ============================================
// File: UploadDocumentsDialog/UploadDialogTrigger.tsx
// ============================================

'use client';

import React from 'react';
import { useTranslation } from "react-i18next";
import { Upload } from 'lucide-react';
import type { UploadDialogTriggerProps } from './UploadDocumentsDialog.types';

/**
 * Trigger button that opens the upload documents dialog.
 * Renders as a styled button with an upload icon.
 */
export function UploadDialogTrigger({
    tooltipText,
    label,
}: UploadDialogTriggerProps) {
    const { t } = useTranslation();
    const resolvedTooltipText = tooltipText ?? t('Upload documents');
    const resolvedLabel = label ?? t('Upload');

    return (
        <button
            type="button"
            title={resolvedTooltipText}
            aria-label={resolvedTooltipText}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
            {/* Upload icon */}
            <Upload className="h-4 w-4" aria-hidden="true" />
            {resolvedLabel}
        </button>
    );
}

export default UploadDialogTrigger;
