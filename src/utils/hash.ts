import { createHash } from 'node:crypto';

/**
 * Compute SHA-256 hash of content string.
 * Returns hex-encoded hash.
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
