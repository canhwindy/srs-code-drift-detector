/**
 * Core types and interfaces for the upload system
 */

/** Result of a duplicate check operation */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: 'filename' | 'content';
  existingFilePath?: string;
  existingFileHash?: string;
}

/** Result of a file upload operation */
export interface UploadResult {
  fileName: string;
  size: number;
  savedPath: string;
  success: boolean;
  error?: string;
  isDuplicate?: boolean;
  duplicateReason?: string;
}

/** Validation result for a file */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/** File metadata */
export interface FileMetadata {
  fileName: string;
  filePath: string;
  size: number;
  hash?: string;
  uploadedAt: Date;
}
