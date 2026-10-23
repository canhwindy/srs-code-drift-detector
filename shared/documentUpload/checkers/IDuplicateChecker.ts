/**
 * Interface for duplicate checking strategies
 *
 * This interface follows the Dependency Inversion Principle:
 * - High-level modules depend on this abstraction
 * - Low-level modules (concrete checkers) implement this interface
 */

import type { DuplicateCheckResult } from '../types'; // '../types' = shared/documentUpload/types.ts

export interface IDuplicateChecker {
  /**
   * Kiểm tra xem một file có phải duplicate không
   * @param fileName - Tên file cần kiểm tra
   * @param fileBuffer - Nội dung file dạng Buffer
   * @returns Promise chứa kết quả kiểm tra
   */
  check(fileName: string, fileBuffer: Buffer): Promise<DuplicateCheckResult>;
}