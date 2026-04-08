import type { RetrievalQuery } from '../../types/retrieval.js';
import type { VaultIndex } from '../../types/index-record.js';

/**
 * Lexical retrieval: first-pass candidate collection.
 * Matches query terms against title, alias, system, feature-link, source/decision, and full-text.
 */
export function lexicalRetrieval(
  query: RetrievalQuery,
  index: VaultIndex,
): Set<string> {
  const candidates = new Set<string>();
  const allTerms = [...query.feature_terms, ...query.system_terms, ...query.entity_terms];
  const searchTerms = allTerms.map((t) => t.toLowerCase());

  if (searchTerms.length === 0) return candidates;

  // 1. Title match
  for (const record of index.records.values()) {
    const titleLower = record.title.toLowerCase();
    for (const term of searchTerms) {
      if (titleLower.includes(term)) {
        candidates.add(record.id);
        break;
      }
    }
  }

  // 2. Alias match
  for (const record of index.records.values()) {
    if (candidates.has(record.id)) continue;
    for (const alias of record.aliases) {
      const aliasLower = alias.toLowerCase();
      let found = false;
      for (const term of searchTerms) {
        if (aliasLower.includes(term)) {
          candidates.add(record.id);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  // 3. System match
  for (const term of query.system_terms) {
    const termLower = term.toLowerCase();
    for (const record of index.records.values()) {
      if (record.type === 'system') {
        if (
          record.title.toLowerCase().includes(termLower) ||
          record.aliases.some((a) => a.toLowerCase().includes(termLower))
        ) {
          candidates.add(record.id);
          // Add all notes that list this system in their systems field
          for (const other of index.records.values()) {
            if (other.systems.includes(record.id)) {
              candidates.add(other.id);
            }
          }
        }
      }
    }
  }

  // 4. Feature link match
  const featureCandidates = [...candidates].filter(
    (id) => index.records.get(id)?.type === 'feature',
  );
  for (const record of index.records.values()) {
    if (record.type === 'change') {
      const targetFeature = record.feature ?? null;
      const targetFeatures = record.features ?? [];
      const allTargets = targetFeature ? [targetFeature, ...targetFeatures] : targetFeatures;
      for (const fid of featureCandidates) {
        if (allTargets.includes(fid)) {
          candidates.add(record.id);
          break;
        }
      }
    }
  }

  // 5. Source / Decision match
  for (const term of query.entity_terms) {
    const termLower = term.toLowerCase();
    for (const record of index.records.values()) {
      if (record.type === 'source' || record.type === 'decision') {
        if (
          record.title.toLowerCase().includes(termLower) ||
          record.aliases.some((a) => a.toLowerCase().includes(termLower))
        ) {
          candidates.add(record.id);
          // Include notes that reference this source/decision
          for (const other of index.records.values()) {
            if (other.sources.includes(record.id) || other.decisions.includes(record.id)) {
              candidates.add(other.id);
            }
          }
        }
      }
    }
  }

  // 6. Full-text match
  for (const record of index.records.values()) {
    if (candidates.has(record.id)) continue;
    const textLower = record.raw_text.toLowerCase();
    let matchCount = 0;
    for (const term of searchTerms) {
      if (textLower.includes(term)) {
        matchCount++;
      }
    }
    if (matchCount >= 2 || (matchCount >= 1 && searchTerms.length === 1)) {
      candidates.add(record.id);
    }
  }

  return candidates;
}
