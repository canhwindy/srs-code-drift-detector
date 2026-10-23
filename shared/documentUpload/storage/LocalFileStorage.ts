/**
 * Local filesystem implementation of IFileStorage
 *
 * Single Responsibility: Only handles local file I/O operations
 */

import type { IFileStorage } from './IFileStorage';
import type { FileMetadata } from '@shared/documentUpload/types';
import { writeFile, access, stat, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { computeMD5Hash } from '@shared/documentUpload/utils/hash';

export class LocalFileStorage implements IFileStorage {
  constructor(private uploadDir: string) { }

  /**
   * Ensure upload directory exists
   */
  private async ensureDirectory(): Promise<void> {
    await mkdir(this.uploadDir, { recursive: true });
  }

  async save(fileName: string, buffer: Buffer): Promise<FileMetadata> {
    await this.ensureDirectory();

    const filePath = path.join(this.uploadDir, fileName);
    await writeFile(filePath, buffer);

    const hash = computeMD5Hash(buffer);

    return {
      fileName,
      filePath,
      size: buffer.length,
      hash,
      uploadedAt: new Date(),
    };
  }

  async exists(fileName: string): Promise<boolean> {
    const filePath = path.join(this.uploadDir, fileName);

    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(fileName: string): Promise<FileMetadata | null> {
    const filePath = path.join(this.uploadDir, fileName);

    try {
      const stats = await stat(filePath);

      return {
        fileName,
        filePath,
        size: stats.size,
        uploadedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  async delete(fileName: string): Promise<boolean> {
    const filePath = path.join(this.uploadDir, fileName);

    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
