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

  // Build a set of change-pair keys that have an actual requirement-level
  // conflict so Feature-level `conflict_candidate` pairs that DON'T also
  // hit a requirement collision can be surfaced as warnings instead of
  // errors. Two Changes that touch the same Feature but modify disjoint
  // requirements are serialization-unsafe (whoever applies second needs
  // a rebase of base_fingerprint) but they do not step on each other's
  // content — an error-level verdict was overly strict and caused
  // false-positive CI failures.
  const hasRequirementConflict = new Set<string>();
  for (const c of result.requirement_conflicts) {
    const a = c.change_a;
    const b = c.change_b;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    hasRequirementConflict.add(key);
  }

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
      const pairKey =
        pair.change_a < pair.change_b
          ? `${pair.change_a}|${pair.change_b}`
          : `${pair.change_b}|${pair.change_a}`;
      const alsoRequirementLevel = hasRequirementConflict.has(pairKey);
      issues.push({
        dimension: 'coherence',
        // Downgrade to warning when the Feature-level overlap does NOT
        // coincide with a requirement-level collision. The pair is still
        // worth surfacing because serialization order matters, but it
        // shouldn't block a pass.
        severity: alsoRequirementLevel ? 'error' : 'warning',
        code: 'TOUCHES_OVERLAP_CONFLICT',
        message:
          `Changes "${pair.change_a}" and "${pair.change_b}" both touch Feature(s): ${pair.overlapping_features.join(', ')}` +
          (alsoRequirementLevel
            ? ' — with overlapping requirement(s); apply order must be resolved.'
            : ' — at Feature level only; apply in order and rebase base_fingerprint if needed.'),
        note_id: pair.change_a,
        suggestion: alsoRequirementLevel
          ? 'Resolve the requirement collision manually; auto-apply is blocked.'
          : 'Apply one change, then rebase the other\'s Delta Summary base_fingerprint against the new Feature content.',
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
 * Check Feature ↔ Change bidirectional backlink consistency.
 *
 * When `propose` creates a Change targeting a Feature, it updates the
 * Feature's `changes:` frontmatter field via `updateFeatureChangesField`.
 * If that step fails (or if the user manually creates a Change), the
 * backlink is missing. This check detects the mismatch so users can fix
 * either side.
 */
export function checkFeatureChangeBacklinks(
  allRecords: IndexRecord[],
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const features = new Map<string, IndexRecord>();
  const changes: IndexRecord[] = [];

  for (const r of allRecords) {
    if (r.type === 'feature') features.set(r.id, r);
    if (r.type === 'change') changes.push(r);
  }

  for (const change of changes) {
    const featureIds: string[] = [];
    if (change.feature) featureIds.push(change.feature);
    if (change.features) featureIds.push(...change.features);

    for (const fId of featureIds) {
      const feature = features.get(fId);
      if (!feature) continue; // Caught by INVALID_FRONTMATTER_REF

      // Feature.changes should contain a reference to this Change
      const featureLinksBack = feature.changes?.includes(change.id) ?? false;
      if (!featureLinksBack) {
        issues.push({
          dimension: 'coherence',
          severity: 'warning',
          code: 'MISSING_LINK',
          message:
            `Change "${change.id}" declares feature "${fId}" but the Feature's ` +
            `\`changes\` frontmatter does not link back to this Change.`,
          note_id: change.id,
          note_path: change.path,
          suggestion:
            `Add "[[${change.title}]]" to the \`changes:\` list in Feature "${fId}" frontmatter.`,
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
      const depRecord = index.records.get(dep);
      if (!depRecord) {
        issues.push({
          dimension: 'coherence',
          severity: 'error',
          code: 'BROKEN_DEPENDS_ON',
          message: `Change "${change.id}" depends_on "${dep}" which does not exist in the vault`,
          note_id: change.id,
          note_path: change.path,
          suggestion: 'Fix the depends_on entry or create the missing Change note.',
        });
      } else if (depRecord.type !== 'change') {
        issues.push({
          dimension: 'coherence',
          severity: 'warning',
          code: 'INVALID_DEPENDS_ON_TYPE',
          message: `Change "${change.id}" depends_on "${dep}" which is a ${depRecord.type}, not a change`,
          note_id: change.id,
          note_path: change.path,
          suggestion: 'depends_on should reference Change notes only.',
        });
      }
    }
  }

  return issues;
}
