/**
 * Composite duplicate checker that runs multiple checks
 *
 * Design Pattern: Composite Pattern
 * Allows combining multiple duplicate checking strategies
 * Follows Open/Closed Principle: Can add new checkers without modifying this class
 */

import type { IDuplicateChecker } from './IDuplicateChecker';
import type { DuplicateCheckResult } from '../types';

export class CompositeDuplicateChecker implements IDuplicateChecker {
  constructor(private checkers: IDuplicateChecker[]) { }

  /**
   * Run all checkers in sequence
   * Returns the first positive duplicate result found
   */
  async check(fileName: string, fileBuffer: Buffer): Promise<DuplicateCheckResult> {
    for (const checker of this.checkers) {
      const result = await checker.check(fileName, fileBuffer);

      if (result.isDuplicate) {
        // Found a duplicate, return immediately
        return result;
      }
    }

    // No duplicates found
    return {
      isDuplicate: false,
    };
  }

  /**
   * Add a new checker to the composite
   * Follows Open/Closed Principle: extending functionality without modification
   */
  addChecker(checker: IDuplicateChecker): void {
    this.checkers.push(checker);
  }
}
