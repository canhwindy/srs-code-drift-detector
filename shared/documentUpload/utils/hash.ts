import crypto from 'crypto';

/**
 * Utility functions for hashing
 *
 * Single Responsibility: Only handles hash computation
 */

/**
 * Compute MD5 hash of a buffer
 * @param buffer - Buffer to hash
 * @returns MD5 hash as hex string
 */
export function computeMD5Hash(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Compute MD5 hash of a string
 * @param content - String to hash
 * @returns MD5 hash as hex string
 */
export function computeMD5HashFromString(content: string): string {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}
