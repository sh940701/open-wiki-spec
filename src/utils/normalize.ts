/**
 * Normalize a string for comparison: trim, collapse whitespace, lowercase.
 */
export function normalizeString(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalize text for content hashing: trim and collapse all whitespace to single spaces.
 * Case is preserved (hashing is case-sensitive).
 * Deterministic regardless of line endings (CRLF vs LF).
 */
export function normalizeForHash(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
