/**
 * Main service for document upload operations
 *
 * Single Responsibility: Orchestrates upload workflow
 * Dependency Inversion: Depends on abstractions (interfaces) not concrete implementations
 */

import type { IDuplicateChecker } from '@shared/documentUpload/checkers';
import { FileValidator } from '@shared/documentUpload/validators';
import type { FileValidatorConfig } from '@shared/documentUpload/validators';
import type { IFileStorage } from '@shared/documentUpload/storage';
import type { UploadResult } from '@shared/documentUpload/types';

export class DocumentUploadService {
  private validator: FileValidator;

  constructor(
    private storage: IFileStorage,
    private duplicateChecker: IDuplicateChecker,
    validatorConfig: FileValidatorConfig
  ) {
    this.validator = new FileValidator(validatorConfig);
  }

  /**
   * Upload a single file with validation and duplicate checking
   *
   * @param file - File to upload
   * @returns Promise with upload result
   */
  async uploadFile(file: File): Promise<UploadResult> {
    try {
      // Step 1: Validate file type and size
      const validation = this.validator.validate(file.name, file.size);
      if (!validation.isValid) {
        return {
          fileName: file.name,
          size: file.size,
          savedPath: '',
          success: false,
          error: validation.error,
        };
      }

      // Step 2: Convert file to buffer
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Step 3: Check for duplicates
      const duplicateCheck = await this.duplicateChecker.check(file.name, buffer);

      if (duplicateCheck.isDuplicate) {
        return {
          fileName: file.name,
          size: file.size,
          savedPath: '',
          success: false,
          isDuplicate: true,
          duplicateReason: duplicateCheck.reason,
          error: this.getDuplicateErrorMessage(duplicateCheck.reason, duplicateCheck.existingFilePath),
        };
      }

      // Step 4: Save file to storage
      await this.storage.save(file.name, buffer);

      return {
        fileName: file.name,
        size: file.size,
        savedPath: `/input_document/${file.name}`,
        success: true,
      };
    } catch (err) {
      return {
        fileName: file.name,
        size: file.size,
        savedPath: '',
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Upload multiple files
   *
   * @param files - Array of files to upload
   * @returns Promise with array of upload results
   */
  async uploadFiles(files: File[]): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    for (const file of files) {
      const result = await this.uploadFile(file);
      results.push(result);
    }

    return results;
  }

  /**
   * Get human-readable error message for duplicates
   */
  private getDuplicateErrorMessage(
    reason?: 'filename' | 'content',
    existingFilePath?: string
  ): string {
    if (reason === 'filename') {
      return `File with name already exists: ${existingFilePath || 'unknown path'}`;
    } else if (reason === 'content') {
      return `File with identical content already exists: ${existingFilePath || 'unknown path'}`;
    }
    return 'Duplicate file detected';
  }
}
