import type { ScoredCandidate } from '../../types/retrieval.js';
import type { VaultIndex } from '../../types/index-record.js';
import { isActiveChangeStatus } from './helpers.js';

/**
 * Internal warning representation with structured details.
 */
export interface RetrievalWarning {
  type: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Collect warnings from index and retrieval-specific concerns.
 * Returns internal RetrievalWarning objects; the pipeline serializes to string[].
 */
export function collectWarnings(
  index: VaultIndex,
  candidates: ScoredCandidate[],
): RetrievalWarning[] {
  const warnings: RetrievalWarning[] = [];

  // Pass through relevant index warnings
  for (const w of index.warnings) {
    if (w.type === 'duplicate_id') {
      warnings.push({
        type: 'duplicate_id',
        message: w.message,
      });
    }
  }

  // Unresolved wikilinks involving candidates
  const candidateIds = new Set(candidates.map((c) => c.id));
  const candidatePaths = new Set<string>();
  for (const c of candidates) {
    const record = index.records.get(c.id);
    if (record) candidatePaths.add(record.path);
  }

  for (const w of index.warnings) {
    if (w.type === 'unresolved_wikilink' && candidatePaths.has(w.note_path)) {
      warnings.push({
        type: 'unresolved_wikilink',
        message: w.message,
      });
    }
    if (w.type === 'ambiguous_alias' && candidatePaths.has(w.note_path)) {
      warnings.push({
        type: 'ambiguous_alias',
        message: w.message,
      });
    }
  }

  // Schema mismatch
  if (index.schema_version === 'unknown') {
    warnings.push({
      type: 'schema_mismatch',
      message: 'No schema.md found or schema_version is missing',
    });
  }

  // Active change touch-surface collision
  const activeChangeCandidates = candidates.filter(
    (c) => c.type === 'change' && isActiveChangeStatus(index.records.get(c.id)?.status ?? ''),
  );
  for (let i = 0; i < activeChangeCandidates.length; i++) {
    for (let j = i + 1; j < activeChangeCandidates.length; j++) {
      const recA = index.records.get(activeChangeCandidates[i].id);
      const recB = index.records.get(activeChangeCandidates[j].id);
      if (!recA || !recB) continue;
      const sharedTouches = recA.touches.filter((t) => recB.touches.includes(t));
      if (sharedTouches.length > 0) {
        const hasDependency =
          recA.depends_on.includes(recB.id) || recB.depends_on.includes(recA.id);
        if (!hasDependency) {
          warnings.push({
            type: 'active_change_touch_collision',
            message: `Active changes "${recA.id}" and "${recB.id}" touch the same surface (${sharedTouches.join(', ')}) without explicit dependency`,
            details: {
              change_a: recA.id,
              change_b: recB.id,
              shared_surfaces: sharedTouches,
            },
          });
        }
      }
    }
  }

  return warnings;
}
