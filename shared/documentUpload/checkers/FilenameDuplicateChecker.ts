/**
 * Checks for duplicate files based on filename
 *
 * Single Responsibility: Only checks filename duplication
 */

import type { IDuplicateChecker } from './IDuplicateChecker';
import type { DuplicateCheckResult } from '../types';
import { access } from 'fs/promises';
import path from 'path';

export class FilenameDuplicateChecker implements IDuplicateChecker {
  constructor(private uploadDir: string) { }

  async check(fileName: string, _fileBuffer: Buffer): Promise<DuplicateCheckResult> {
    const filePath = path.join(this.uploadDir, fileName);

    try {
      // Check if file exists
      await access(filePath);

      // File exists - it's a duplicate
      return {
        isDuplicate: true,
        reason: 'filename',
        existingFilePath: filePath,
      };
    } catch {
      // File doesn't exist - not a duplicate
      return {
        isDuplicate: false,
      };
    }
  }
}
