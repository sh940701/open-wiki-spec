import type { IndexRecord } from '../../types/index-record.js';
import type {
  SequencingResult,
  TouchesSeverity,
  RequirementConflictSeverity,
  StaleBaseEntry,
} from '../../types/sequencing.js';
import type { SequencingSummary } from '../../types/retrieval.js';
import { computeTouchesSeverity } from './touches-analyzer.js';
import { detectRequirementConflicts } from './requirement-conflict-detector.js';
import { computeDeterministicOrder } from './ordering.js';
import { checkBaseFingerprints } from './stale-detector.js';
import { detectOutOfOrderErrors } from './out-of-order-detector.js';

const ACTIVE_STATUSES = new Set(['proposed', 'planned', 'in_progress']);

/**
 * Main entry point: analyze all active changes for sequencing.
 * Returns severity, conflicts, ordering, stale bases, and reasons.
 */
export function analyzeSequencing(
  index: Map<string, IndexRecord>,
): SequencingResult {
  const allRecords = Array.from(index.values());
  const activeChanges = allRecords.filter(
    (r) => r.type === 'change' && ACTIVE_STATUSES.has(r.status),
  );

  // 1. Compute pairwise touches severity
  const pairwise_severities = [];
  for (let i = 0; i < activeChanges.length; i++) {
    for (let j = i + 1; j < activeChanges.length; j++) {
      const result = computeTouchesSeverity(activeChanges[i], activeChanges[j], index);
      if (result.severity !== 'parallel_safe') {
        pairwise_severities.push(result);
      }
    }
  }

  // 2. Detect requirement-level conflicts
  const requirement_conflicts = detectRequirementConflicts(activeChanges);

  // 3. Compute deterministic ordering (pass full index for external dep resolution)
  const { ordering, cycles } = computeDeterministicOrder(activeChanges, index);

  // 4. Check base fingerprints for all active changes
  const stale_bases: StaleBaseEntry[] = [];
  for (const change of activeChanges) {
    stale_bases.push(...checkBaseFingerprints(change, index));
  }

  // 4b. Detect out-of-order status errors
  const allChanges = allRecords.filter((r) => r.type === 'change');
  const out_of_order_errors = detectOutOfOrderErrors(allChanges, index);

  // 5. Annotate ordering with conflict info
  for (const entry of ordering) {
    const conflicting = requirement_conflicts
      .filter((c) => c.change_a === entry.id || c.change_b === entry.id)
      .map((c) => (c.change_a === entry.id ? c.change_b : c.change_a));
    entry.conflicts_with = [...new Set(conflicting)];
  }

  // 6. Compute overall status (worst severity)
  // Precedence: conflict_critical > blocked > conflict_candidate > needs_review > parallel_safe
  let overallStatus: TouchesSeverity | RequirementConflictSeverity = 'parallel_safe';
  if (requirement_conflicts.length > 0) {
    overallStatus = 'conflict_critical';
  } else if (pairwise_severities.some((s) => s.severity === 'blocked')) {
    overallStatus = 'blocked';
  } else if (pairwise_severities.some((s) => s.severity === 'conflict_candidate')) {
    overallStatus = 'conflict_candidate';
  } else if (pairwise_severities.some((s) => s.severity === 'needs_review')) {
    overallStatus = 'needs_review';
  }

  // 7. Collect related changes
  const relatedSet = new Set<string>();
  for (const s of pairwise_severities) {
    relatedSet.add(s.change_a);
    relatedSet.add(s.change_b);
  }
  for (const c of requirement_conflicts) {
    relatedSet.add(c.change_a);
    relatedSet.add(c.change_b);
  }

  // 8. Build reasons
  const reasons: string[] = [];
  if (cycles.length > 0) {
    reasons.push(`${cycles.length} dependency cycle(s) detected`);
  }
  if (stale_bases.length > 0) {
    reasons.push(`${stale_bases.length} stale base fingerprint(s) found`);
  }
  if (out_of_order_errors.length > 0) {
    reasons.push(
      `${out_of_order_errors.length} out-of-order sequencing error(s): change(s) jumped ahead of dependencies`,
    );
  }
  for (const s of pairwise_severities) {
    reasons.push(...s.reasons);
  }
  for (const c of requirement_conflicts) {
    reasons.push(c.reason);
  }

  return {
    status: overallStatus,
    pairwise_severities,
    requirement_conflicts,
    ordering,
    cycles,
    stale_bases,
    out_of_order_errors,
    reasons,
    related_changes: Array.from(relatedSet),
  };
}

/**
 * Produce a compact summary for embedding in retrieval output.
 */
export function summarizeForRetrieval(result: SequencingResult): SequencingSummary {
  return {
    status: result.status,
    related_changes: result.related_changes,
    reasons: result.reasons,
  };
}
