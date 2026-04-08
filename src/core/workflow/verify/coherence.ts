/**
 * Coherence dimension checks.
 * Cross-note consistency, parallel change conflict detection, decision consistency.
 * 
 * Per ownership rules (00-unified-types.md), conflict detection at the touches
 * and requirement level is owned by sequencing-engine (plan 06).
 * This module delegates to analyzeSequencing() and maps results to VerifyIssue[].
 */
import type { VaultIndex, IndexRecord } from '../../../types/index.js';
import type { VerifyIssue } from '../../../types/verify.js';
import { analyzeSequencing } from '../../sequencing/index.js';

/**
 * Check for conflicts between active changes by delegating to the
 * sequencing engine's analyzeSequencing(). Maps pairwise severity
 * results and requirement conflict pairs to VerifyIssue[].
 */
export function checkConflictsViaSequencing(
  activeChanges: IndexRecord[],
  index: VaultIndex,
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  // Delegate to sequencing engine (expects Map<string, IndexRecord>)
  const result = analyzeSequencing(index.records);

  // Map pairwise touches severities to VerifyIssue
  for (const pair of result.pairwise_severities) {
    if (pair.severity === 'blocked') {
      issues.push({
        dimension: 'coherence',
        severity: 'error',
        code: 'TOUCHES_OVERLAP_BLOCKED',
        message: `Change "${pair.change_a}" is blocked by "${pair.change_b}": ${pair.reasons.join('; ')}`,
        note_id: pair.change_a,
        suggestion: 'Resolve the dependency before proceeding.',
      });
    } else if (pair.severity === 'conflict_candidate') {
      issues.push({
        dimension: 'coherence',
        severity: 'error',
        code: 'TOUCHES_OVERLAP_CONFLICT',
        message: `Changes "${pair.change_a}" and "${pair.change_b}" both touch Feature(s): ${pair.overlapping_features.join(', ')} -- conflict_candidate`,
        note_id: pair.change_a,
        suggestion: 'User confirmation required. Auto-apply is blocked.',
      });
    } else if (pair.severity === 'needs_review') {
      issues.push({
        dimension: 'coherence',
        severity: 'warning',
        code: 'TOUCHES_OVERLAP_NEEDS_REVIEW',
        message: `Changes "${pair.change_a}" and "${pair.change_b}" both touch System(s): ${pair.overlapping_systems.join(', ')} -- needs_review`,
        note_id: pair.change_a,
        suggestion: 'Confirm that these changes affect independent areas of the shared surface.',
      });
    }
  }

  // Map requirement-level conflicts to VerifyIssue
  for (const conflict of result.requirement_conflicts) {
    issues.push({
      dimension: 'coherence',
      severity: 'error',
      code: 'REQUIREMENT_CONFLICT_CRITICAL',
      message: `Requirement-level conflict: Changes "${conflict.change_a}" (${conflict.this_op}) and "${conflict.change_b}" (${conflict.other_op}) both target "${conflict.feature_id}::${conflict.requirement_name}" -- conflict_critical`,
      note_id: conflict.change_a,
      suggestion: 'Neither change can be auto-applied. User must resolve the conflict.',
    });
  }

  // Map dependency cycles to VerifyIssue
  for (const cycle of result.cycles) {
    issues.push({
      dimension: 'coherence',
      severity: 'error',
      code: 'DEPENDENCY_CYCLE',
      message: cycle.message,
      note_id: cycle.cycle[0],
      suggestion: 'Break the dependency cycle by removing one depends_on link.',
    });
  }

  // Map out-of-order errors to VerifyIssue
  for (const ooo of result.out_of_order_errors) {
    issues.push({
      dimension: 'coherence',
      severity: 'error',
      code: 'OUT_OF_ORDER',
      message: ooo.message,
      note_id: ooo.change_id,
      suggestion: 'Complete dependencies before advancing this change.',
    });
  }

  return issues;
}



/**
 * Check for structural description inconsistencies between notes.
 */
export function checkDescriptionConsistency(allNotes: IndexRecord[]): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const features = allNotes.filter((n) => n.type === 'feature');
  const changes = allNotes.filter((n) => n.type === 'change' && n.status !== 'applied');

  for (const change of changes) {
    const featureId = change.feature ?? change.features?.[0];
    if (!featureId) continue;
    const feature = features.find((f) => f.id === featureId);
    if (!feature) continue;

    const removedCount = change.delta_summary.filter(
      (e) => e.op === 'REMOVED' && e.target_note_id === featureId,
    ).length;
    const totalReqs = feature.requirements.length;

    if (totalReqs > 0 && removedCount === totalReqs && feature.status === 'active') {
      issues.push({
        dimension: 'coherence',
        severity: 'warning',
        code: 'CONFLICTING_DESCRIPTIONS',
        message: `Change "${change.id}" removes all requirements from Feature "${featureId}" but Feature status is still "active"`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Consider whether the Feature should be deprecated after this Change is applied.',
      });
    }
  }

  // Check archived Decision vs active Feature
  const decisions = allNotes.filter((n) => n.type === 'decision');
  for (const decision of decisions) {
    if (decision.status !== 'archived') continue;
    for (const featureId of decision.features ?? []) {
      const feature = features.find((f) => f.id === featureId);
      if (feature && feature.status === 'active' && feature.decisions?.includes(decision.id)) {
        issues.push({
          dimension: 'coherence',
          severity: 'info',
          code: 'CONFLICTING_DESCRIPTIONS',
          message: `Active Feature "${featureId}" references archived Decision "${decision.id}"`,
          note_id: decision.id,
          suggestion: 'Consider updating the Feature to reference a current Decision or remove the link.',
        });
      }
    }
  }

  return issues;
}

/**
 * Check decision consistency: overlapping active decisions on same feature,
 * and missing backlinks.
 */
export function checkDecisionConsistency(
  allDecisions: IndexRecord[],
  allFeatures: IndexRecord[],
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  // Check 1: Two active Decisions linked to same Feature with overlapping topics
  const featureDecisionMap = new Map<string, IndexRecord[]>();
  for (const decision of allDecisions) {
    if (decision.status === 'archived') continue;
    for (const featureId of decision.features ?? []) {
      if (!featureDecisionMap.has(featureId)) {
        featureDecisionMap.set(featureId, []);
      }
      featureDecisionMap.get(featureId)!.push(decision);
    }
  }

  for (const [featureId, decisions] of featureDecisionMap) {
    if (decisions.length < 2) continue;
    for (let i = 0; i < decisions.length; i++) {
      for (let j = i + 1; j < decisions.length; j++) {
        const sharedHeadings = decisions[i].headings.filter(
          (h) => decisions[j].headings.includes(h) && h !== 'Context' && h !== 'Decision',
        );
        const sharedTags = decisions[i].tags.filter((t) => decisions[j].tags.includes(t));
        if (sharedHeadings.length > 0 || sharedTags.length > 1) {
          issues.push({
            dimension: 'coherence',
            severity: 'warning',
            code: 'INCONSISTENT_DECISION',
            message: `Decisions "${decisions[i].id}" and "${decisions[j].id}" are both active and linked to Feature "${featureId}" with overlapping topics (shared: ${[...sharedHeadings, ...sharedTags].join(', ')})`,
            note_id: decisions[i].id,
            suggestion: 'Review whether these Decisions conflict or should be consolidated.',
          });
        }
      }
    }
  }

  // Check 2: Decision references Feature that does not link back
  for (const decision of allDecisions) {
    for (const featureId of decision.features ?? []) {
      const feature = allFeatures.find((f) => f.id === featureId);
      if (feature && !feature.decisions?.includes(decision.id)) {
        issues.push({
          dimension: 'coherence',
          severity: 'info',
          code: 'INCONSISTENT_DECISION',
          message: `Decision "${decision.id}" references Feature "${featureId}" but the Feature does not link back to the Decision`,
          note_id: decision.id,
          suggestion: 'Add the Decision to the Feature frontmatter decisions list.',
        });
      }
    }
  }

  return issues;
}

/**
 * Check that all depends_on targets actually exist in the index.
 */
export function checkDependsOnConsistency(
  activeChanges: IndexRecord[],
  index: VaultIndex,
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  for (const change of activeChanges) {
    for (const dep of change.depends_on) {
      if (!index.records.has(dep)) {
        issues.push({
          dimension: 'coherence',
          severity: 'error',
          code: 'BROKEN_DEPENDS_ON',
          message: `Change "${change.id}" depends_on "${dep}" which does not exist in the vault`,
          note_id: change.id,
          note_path: change.path,
          suggestion: 'Fix the depends_on entry or create the missing Change note.',
        });
      }
    }
  }

  return issues;
}
