import type { IndexRecord } from '../../types/index-record.js';
import type { TouchesSeverity, TouchesSeverityResult } from '../../types/sequencing.js';

/**
 * Compute touches severity between two changes.
 * Four severity levels: parallel_safe < needs_review < conflict_candidate < blocked
 */
export function computeTouchesSeverity(
  changeA: IndexRecord,
  changeB: IndexRecord,
  index: Map<string, IndexRecord>,
): TouchesSeverityResult {
  // Step 1: Check blocked status (depends_on with incomplete target)
  if (changeA.depends_on.includes(changeB.id) && changeB.status !== 'applied') {
    return {
      severity: 'blocked',
      change_a: changeA.id,
      change_b: changeB.id,
      overlapping_features: [],
      overlapping_systems: [],
      reasons: [`${changeA.id} depends on ${changeB.id} which is not yet applied (status: ${changeB.status})`],
    };
  }
  if (changeB.depends_on.includes(changeA.id) && changeA.status !== 'applied') {
    return {
      severity: 'blocked',
      change_a: changeA.id,
      change_b: changeB.id,
      overlapping_features: [],
      overlapping_systems: [],
      reasons: [`${changeB.id} depends on ${changeA.id} which is not yet applied (status: ${changeA.status})`],
    };
  }

  // Step 2: Compute touch surface overlap
  const touchesA = new Set(changeA.touches);
  const touchesB = new Set(changeB.touches);
  const overlap: string[] = [];
  for (const id of touchesA) {
    if (touchesB.has(id)) {
      overlap.push(id);
    }
  }

  if (overlap.length === 0) {
    return {
      severity: 'parallel_safe',
      change_a: changeA.id,
      change_b: changeB.id,
      overlapping_features: [],
      overlapping_systems: [],
      reasons: ['no touch overlap'],
    };
  }

  // Step 3: Classify overlap by type
  const overlapping_features: string[] = [];
  const overlapping_systems: string[] = [];
  for (const id of overlap) {
    const record = index.get(id);
    if (!record) continue;
    if (record.type === 'feature') {
      overlapping_features.push(id);
    } else if (record.type === 'system') {
      overlapping_systems.push(id);
    }
  }

  // Step 4: Determine severity
  if (overlapping_features.length > 0) {
    return {
      severity: 'conflict_candidate',
      change_a: changeA.id,
      change_b: changeB.id,
      overlapping_features,
      overlapping_systems,
      reasons: [`both touch Feature(s): ${overlapping_features.join(', ')}`],
    };
  } else if (overlapping_systems.length > 0) {
    return {
      severity: 'needs_review',
      change_a: changeA.id,
      change_b: changeB.id,
      overlapping_features: [],
      overlapping_systems,
      reasons: [`both touch System(s): ${overlapping_systems.join(', ')} but different Features`],
    };
  }

  // Fallback: overlap on non-feature/system targets
  return {
    severity: 'parallel_safe',
    change_a: changeA.id,
    change_b: changeB.id,
    overlapping_features: [],
    overlapping_systems: [],
    reasons: ['overlap on non-feature/system targets'],
  };
}
