import type { IndexRecord } from '../../types/index-record.js';
import type { StaleBaseEntry } from '../../types/sequencing.js';

/**
 * Check base fingerprints for a single change against the current index.
 * Returns stale entries where the base_fingerprint no longer matches the
 * requirement's current content_hash.
 */
export function checkBaseFingerprints(
  change: IndexRecord,
  index: Map<string, IndexRecord>,
): StaleBaseEntry[] {
  const staleEntries: StaleBaseEntry[] = [];

  for (const entry of change.delta_summary) {
    // ADDED has no base to compare
    if (entry.op === 'ADDED') continue;

    // Missing fingerprint: verify will report separately
    if (entry.base_fingerprint === null) continue;

    // Special migration marker: "migrated" means the base fingerprint
    // was not available at migration time. Skip stale detection so
    // migrated vaults don't emit false positive warnings.
    if (entry.base_fingerprint === 'migrated') continue;

    const featureRecord = index.get(entry.target_note_id);
    // Broken reference: reported by verify
    if (!featureRecord) continue;

    // Find the requirement in the feature's requirements array
    const reqKey = `${entry.target_note_id}::${entry.target_name}`;
    const currentReq = featureRecord.requirements.find((r) => r.key === reqKey);

    if (!currentReq) {
      // Requirement doesn't exist in feature
      if (entry.op === 'MODIFIED' || entry.op === 'RENAMED') {
        staleEntries.push({
          change_id: change.id,
          delta_entry: entry,
          expected_hash: entry.base_fingerprint,
          actual_hash: 'MISSING',
          feature_id: entry.target_note_id,
          requirement_key: reqKey,
        });
      }
      continue;
    }

    if (currentReq.content_hash !== entry.base_fingerprint) {
      staleEntries.push({
        change_id: change.id,
        delta_entry: entry,
        expected_hash: entry.base_fingerprint,
        actual_hash: currentReq.content_hash,
        feature_id: entry.target_note_id,
        requirement_key: reqKey,
      });
    }
  }

  return staleEntries;
}
