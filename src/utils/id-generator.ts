import type { NoteType } from '../types/notes.js';

/**
 * Generate a deterministic note ID from type and title.
 *
 * Rules:
 *   - Lowercase
 *   - Spaces and underscores become hyphens
 *   - Non-alphanumeric characters (except hyphens) are stripped
 *   - Consecutive hyphens are collapsed
 *   - Leading/trailing hyphens are trimmed
 *
 * Examples:
 *   generateId('feature', 'Auth Login')        -> 'feature-auth-login'
 *   generateId('change', 'Add Passkey Login')   -> 'change-add-passkey-login'
 */
export function generateId(type: NoteType, title: string): string {
  const slug = title
    .normalize('NFC')  // Unicode normalization for consistent macOS NFD / Linux NFC compare
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // If the title degenerates to an empty slug (e.g., "!!!" or "   "),
  // fall back to a timestamp-based slug so we never produce an ID like "feature-"
  // which would fail schema validation and collide with other degenerate titles.
  if (slug.length === 0) {
    const timestamp = Date.now().toString(36);
    return `${type}-untitled-${timestamp}`;
  }
  return `${type}-${slug}`;
}
