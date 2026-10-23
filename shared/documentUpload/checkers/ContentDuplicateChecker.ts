/**
 * Checks for duplicate files based on content hash (MD5)
 *
 * Single Responsibility: Only checks content duplication
 */

import type { IDuplicateChecker } from './IDuplicateChecker';
import type { DuplicateCheckResult } from '../types';
import { computeMD5Hash } from '../utils/hash';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

export class ContentDuplicateChecker implements IDuplicateChecker {
  constructor(private uploadDir: string) { }

  async check(fileName: string, fileBuffer: Buffer): Promise<DuplicateCheckResult> {
    const currentHash = computeMD5Hash(fileBuffer);

    try {
      // Get all files in upload directory
      const files = await readdir(this.uploadDir);

      // Check each existing file's hash
      for (const existingFileName of files) {
        // Skip checking against itself
        if (existingFileName === fileName) {
          continue;
        }

        const existingFilePath = path.join(this.uploadDir, existingFileName);

        try {
          const existingFileBuffer = await readFile(existingFilePath);
          const existingHash = computeMD5Hash(existingFileBuffer);

          if (existingHash === currentHash) {
            // Found a file with identical content
            return {
              isDuplicate: true,
              reason: 'content',
              existingFilePath,
              existingFileHash: existingHash,
            };
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }

      // No duplicate content found
      return {
        isDuplicate: false,
      };
    } catch {
      // If we can't read the directory, assume no duplicates
      return {
        isDuplicate: false,
      };
    }
  }
}
