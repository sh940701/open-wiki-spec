import type { IndexRecord } from '../../types/index-record.js';
import type { OutOfOrderError } from '../../types/sequencing.js';

const STATUS_RANK: Record<string, number> = {
  proposed: 0,
  planned: 1,
  in_progress: 2,
  applied: 3,
};

/**
 * Detect out-of-order sequencing errors.
 * A change is "out of order" when it has jumped ahead of its dependencies
 * (e.g., in_progress while its dependency is still proposed).
 */
export function detectOutOfOrderErrors(
  allChanges: IndexRecord[],
  index: Map<string, IndexRecord>,
): OutOfOrderError[] {
  const errors: OutOfOrderError[] = [];

  for (const change of allChanges) {
    if (change.type !== 'change') continue;

    const changeRank = STATUS_RANK[change.status] ?? -1;
    // Only in_progress or applied can be "ahead"
    if (changeRank < 2) continue;

    for (const depId of change.depends_on) {
      const dep = index.get(depId);
      if (!dep) {
        // Missing dependency: reported by blocked_by in ordering
        continue;
      }

      const depRank = STATUS_RANK[dep.status] ?? -1;
      // Dependency is behind AND not yet applied -> out-of-order
      if (depRank < changeRank && depRank < 3) {
        errors.push({
          change_id: change.id,
          change_status: change.status,
          dependency_id: depId,
          dependency_status: dep.status,
          message: `${change.id} (${change.status}) jumped ahead of dependency ${depId} (${dep.status})`,
        });
      }
    }
  }

  return errors;
}
