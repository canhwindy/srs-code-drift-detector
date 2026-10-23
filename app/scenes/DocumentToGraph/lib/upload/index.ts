/**
 * Main export file for upload module
 *
 * Provides a factory function to create a configured DocumentUploadService
 */

import path from 'path';
import { mkdir } from 'fs/promises';
import type { IDuplicateChecker } from '@shared/documentUpload/checkers';
import {
  CompositeDuplicateChecker,
  FilenameDuplicateChecker,
  ContentDuplicateChecker,
} from '@shared/documentUpload/checkers';
import { LocalFileStorage } from '@shared/documentUpload/storage';
import { DocumentUploadService } from './services'; // GIỮ NGUYÊN — vẫn ở app/
import type { FileValidatorConfig } from '@shared/documentUpload/validators';
import { ALLOWED_FILE_EXTENSIONS, MAX_FILE_SIZE } from '@shared/documentUpload/constants';

/** Default upload directory */
const DEFAULT_UPLOAD_DIR = path.join(process.cwd(), 'input_document');

/** Default validator configuration using shared constants */
const DEFAULT_VALIDATOR_CONFIG: FileValidatorConfig = {
  maxFileSize: MAX_FILE_SIZE,
  allowedExtensions: [...ALLOWED_FILE_EXTENSIONS], // Convert readonly array to mutable
};

/**
 * Factory function to create a configured DocumentUploadService
 *
 * @param uploadDir - Directory where files will be uploaded (default: ./input_document)
 * @param validatorConfig - Configuration for file validation
 * @param enableContentDuplicateCheck - Whether to check for content duplicates (default: true)
 * @returns Configured DocumentUploadService instance
 */
export async function createDocumentUploadService(
  uploadDir: string = DEFAULT_UPLOAD_DIR,
  validatorConfig: FileValidatorConfig = DEFAULT_VALIDATOR_CONFIG,
  enableContentDuplicateCheck: boolean = true
): Promise<DocumentUploadService> {
  // Ensure upload directory exists before creating checkers
  await mkdir(uploadDir, { recursive: true });

  // Create storage
  const storage = new LocalFileStorage(uploadDir);

  // Create duplicate checkers
  const checkers: IDuplicateChecker[] = [new FilenameDuplicateChecker(uploadDir)];

  if (enableContentDuplicateCheck) {
    checkers.push(new ContentDuplicateChecker(uploadDir));
  }

  // Create composite checker
  const duplicateChecker = new CompositeDuplicateChecker(checkers);

  // Create and return service
  return new DocumentUploadService(storage, duplicateChecker, validatorConfig);
}

// Re-export types for convenience
export type { UploadResult, ValidationResult, FileMetadata } from '@shared/documentUpload/types';
export type { FileValidatorConfig } from '@shared/documentUpload/validators';
