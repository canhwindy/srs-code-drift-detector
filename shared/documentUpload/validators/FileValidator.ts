/**
 * File validation logic
 *
 * Single Responsibility: Only validates file properties (type, size)
 */

import type { ValidationResult } from '../types';

/** Configuration for file validation */
export interface FileValidatorConfig {
  maxFileSize: number; // in bytes
  allowedExtensions: string[];
}

export class FileValidator {
  constructor(private config: FileValidatorConfig) { }

  /**
   * Validate file type based on extension
   */
  validateFileType(fileName: string): ValidationResult {
    const extension = fileName.split('.').pop()?.toLowerCase();

    if (!extension) {
      return {
        isValid: false,
        error: 'File has no extension',
      };
    }

    if (!this.config.allowedExtensions.includes(extension)) {
      return {
        isValid: false,
        error: `Unsupported file type: .${extension}. Allowed types: ${this.config.allowedExtensions.join(', ')}`,
      };
    }

    return { isValid: true };
  }

  /**
   * Validate file size
   */
  validateFileSize(fileSize: number): ValidationResult {
    if (fileSize > this.config.maxFileSize) {
      const maxSizeMB = (this.config.maxFileSize / (1024 * 1024)).toFixed(2);
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      return {
        isValid: false,
        error: `File too large. Maximum size: ${maxSizeMB}MB, uploaded: ${fileSizeMB}MB`,
      };
    }

    return { isValid: true };
  }

  /**
   * Validate both type and size
   */
  validate(fileName: string, fileSize: number): ValidationResult {
    const typeValidation = this.validateFileType(fileName);
    if (!typeValidation.isValid) {
      return typeValidation;
    }

    const sizeValidation = this.validateFileSize(fileSize);
    if (!sizeValidation.isValid) {
      return sizeValidation;
    }

    return { isValid: true };
  }
}
