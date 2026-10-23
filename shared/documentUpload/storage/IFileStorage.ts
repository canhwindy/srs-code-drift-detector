/**
 * Interface for file storage operations
 *
 * Dependency Inversion Principle: High-level modules depend on this abstraction
 * Allows swapping storage implementations (local, S3, etc.) without changing business logic
 */

import type { FileMetadata } from '../types';

export interface IFileStorage {
  /**
   * Save a file to storage
   * @param fileName - Name of the file
   * @param buffer - File content buffer
   * @returns Promise with file metadata
   */
  save(fileName: string, buffer: Buffer): Promise<FileMetadata>;

  /**
   * Check if a file exists
   * @param fileName - Name of the file
   * @returns Promise with boolean indicating existence
   */
  exists(fileName: string): Promise<boolean>;

  /**
   * Get file metadata
   * @param fileName - Name of the file
   * @returns Promise with file metadata or null if not found
   */
  getMetadata(fileName: string): Promise<FileMetadata | null>;

  /**
   * Delete a file
   * @param fileName - Name of the file
   * @returns Promise with boolean indicating success
   */
  delete(fileName: string): Promise<boolean>;
}
