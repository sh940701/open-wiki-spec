import type { IndexRecord } from '../../types/index-record.js';
import type { ConflictOp, RequirementConflictPair } from '../../types/sequencing.js';

/**
 * Conflict matrix: which pairs of delta operations on the same requirement are conflicting.
 */
function isConflictingPair(opA: ConflictOp, opB: ConflictOp): boolean {
  const key = `${opA}:${opB}`;
  const conflicting = new Set([
    'MODIFIED:MODIFIED',
    'MODIFIED:REMOVED',
    'REMOVED:MODIFIED',
    'RENAMED:MODIFIED',
    'MODIFIED:RENAMED',
    'ADDED:ADDED',
    'RENAMED:REMOVED',
    'REMOVED:RENAMED',
    'RENAMED_TO:ADDED',
    'ADDED:RENAMED_TO',
  ]);
  return conflicting.has(key);
}

/**
 * Detect requirement-level conflicts across active changes.
 * Two changes conflict when they both operate on the same (feature_id, requirement_name)
 * with incompatible operations.
 */
export function detectRequirementConflicts(activeChanges: IndexRecord[]): RequirementConflictPair[] {
  const conflicts: RequirementConflictPair[] = [];

  // Build a map: (feature_id::requirement_name) -> list of { change_id, op }
  const reqMap = new Map<string, Array<{ change_id: string; op: ConflictOp }>>();

  for (const change of activeChanges) {
    for (const entry of change.delta_summary) {
      if (entry.target_type !== 'requirement') continue;

      if (entry.op === 'RENAMED') {
        // Register the old name side
        const oldKey = `${entry.target_note_id}::${entry.target_name}`;
        if (!reqMap.has(oldKey)) reqMap.set(oldKey, []);
        reqMap.get(oldKey)!.push({ change_id: change.id, op: 'RENAMED' });

        // Register the new name side
        const newKey = `${entry.target_note_id}::${entry.new_name}`;
        if (!reqMap.has(newKey)) reqMap.set(newKey, []);
        reqMap.get(newKey)!.push({ change_id: change.id, op: 'RENAMED_TO' });
      } else {
        const key = `${entry.target_note_id}::${entry.target_name}`;
        if (!reqMap.has(key)) reqMap.set(key, []);
        reqMap.get(key)!.push({ change_id: change.id, op: entry.op });
      }
    }
  }

  // Check for conflicts: any key with entries from 2+ different changes
  for (const [key, entries] of reqMap) {
    // Group by change_id
    const changeGroups = new Map<string, ConflictOp>();
    for (const entry of entries) {
      // Take the first op for each change on this key
      if (!changeGroups.has(entry.change_id)) {
        changeGroups.set(entry.change_id, entry.op);
      }
    }

    const changeIds = Array.from(changeGroups.keys());
    if (changeIds.length < 2) continue;

    // Check all pairs
    for (let i = 0; i < changeIds.length; i++) {
      for (let j = i + 1; j < changeIds.length; j++) {
        const opA = changeGroups.get(changeIds[i])!;
        const opB = changeGroups.get(changeIds[j])!;

        if (isConflictingPair(opA, opB)) {
          const sepIndex = key.indexOf('::');
          const feature_id = key.substring(0, sepIndex);
          const requirement_name = key.substring(sepIndex + 2);

          conflicts.push({
            change_a: changeIds[i],
            change_b: changeIds[j],
            feature_id,
            requirement_name,
            this_op: opA,
            other_op: opB,
            reason: `both changes operate on ${key}: ${opA} vs ${opB}`,
          });
        }
      }
    }
  }

  return conflicts;
}
