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
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${type}-${slug}`;
}
