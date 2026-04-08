import type { DeltaPlan, DeltaEntry, StaleReport, StaleCheckResult } from './types.js';
import type { Requirement } from '../../../types/requirement.js';
import { computeHash } from '../../../utils/hash.js';
import { normalizeForHash } from '../../../utils/normalize.js';

/**
 * Check all Delta Summary entries for stale base_fingerprints.
 *
 * For each MODIFIED/REMOVED/RENAMED entry:
 *   1. Find the target requirement in the Feature note
 *   2. Compute current content_hash
 *   3. Compare with base_fingerprint
 *   4. If different: the base has changed -> stale
 */
export function detectStale(
  plan: DeltaPlan,
  featureRequirements: Map<string, Map<string, Requirement>>,
): StaleReport {
  const staleEntries: StaleCheckResult[] = [];
  const cleanEntries: StaleCheckResult[] = [];

  for (const entry of plan.entries) {
    if (entry.targetType !== 'requirement') continue;

    if (entry.op === 'ADDED') {
      cleanEntries.push({
        entry,
        isStale: false,
        currentHash: null,
        expectedHash: null,
      });
      continue;
    }

    // MODIFIED, REMOVED, or RENAMED
    const noteKey = entry.targetNoteId ?? entry.targetNote;
    const requirements = featureRequirements.get(noteKey);

    if (!requirements) {
      staleEntries.push({
        entry,
        isStale: true,
        currentHash: null,
        expectedHash: entry.baseFingerprint,
        reason: `Target Feature note not found: ${entry.targetNote}`,
      });
      continue;
    }

    const reqName = entry.targetName;
    const requirement = requirements.get(reqName);

    if (!requirement) {
      staleEntries.push({
        entry,
        isStale: true,
        currentHash: null,
        expectedHash: entry.baseFingerprint,
        reason: `Requirement "${reqName}" not found in ${entry.targetNote}`,
      });
      continue;
    }

    const currentHash = computeRequirementHash(requirement);

    // Skip stale check for migrated entries (base_fingerprint = "migrated")
    if (entry.baseFingerprint === 'migrated') {
      cleanEntries.push({
        entry,
        isStale: false,
        currentHash,
        expectedHash: entry.baseFingerprint,
        reason: 'Migrated entry — stale check skipped',
      });
      continue;
    }

    if (entry.baseFingerprint && currentHash !== entry.baseFingerprint) {
      staleEntries.push({
        entry,
        isStale: true,
        currentHash,
        expectedHash: entry.baseFingerprint,
        reason: `Base changed: expected ${entry.baseFingerprint}, current ${currentHash}`,
      });
    } else {
      cleanEntries.push({
        entry,
        isStale: false,
        currentHash,
        expectedHash: entry.baseFingerprint,
      });
    }
  }

  return {
    hasStaleEntries: staleEntries.length > 0,
    staleEntries,
    cleanEntries,
    blocked: staleEntries.length > 0,
  };
}

/**
 * Compute content_hash for a requirement.
 */
export function computeRequirementHash(requirement: Requirement): string {
  const normalized = [
    normalizeForHash(requirement.normative),
    ...requirement.scenarios.map((s) => normalizeForHash(s.raw_text)),
  ].join('\n');

  return `sha256:${computeHash(normalized)}`;
}
