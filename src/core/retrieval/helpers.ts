import type { IndexRecord, VaultIndex } from '../../types/index-record.js';

const ACTIVE_CHANGE_STATUSES = new Set(['proposed', 'planned', 'in_progress']);

/**
 * Check if a status represents an active (non-applied) change.
 */
export function isActiveChangeStatus(status: string): boolean {
  return ACTIVE_CHANGE_STATUSES.has(status);
}

/**
 * Find System notes matching a search term by title or alias.
 */
export function findSystemByTerm(term: string, index: VaultIndex): IndexRecord[] {
  const termLower = term.toLowerCase();
  const results: IndexRecord[] = [];
  for (const record of index.records.values()) {
    if (record.type === 'system') {
      if (
        record.title.toLowerCase().includes(termLower) ||
        record.aliases.some((a) => a.toLowerCase().includes(termLower))
      ) {
        results.push(record);
      }
    }
  }
  return results;
}

/**
 * Detect fuzzy title similarity via word overlap (80% threshold).
 * NOT used for exact_title signal; available as a utility.
 */
export function titleSimilarity(titleLower: string, summaryLower: string): boolean {
  const cleanTitle = titleLower.replace(/^(feature|change|system|decision|source|query):\s*/, '');
  const titleWords = cleanTitle.split(/\s+/).filter((w) => w.length > 2);
  if (titleWords.length === 0) return false;

  const matchCount = titleWords.filter((w) => summaryLower.includes(w)).length;
  return matchCount / titleWords.length >= 0.8;
}
