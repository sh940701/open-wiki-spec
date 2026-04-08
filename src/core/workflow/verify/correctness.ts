/**
 * Correctness dimension checks.
 * Operation validation matrix, stale detection, status transitions, schema match, drift.
 */
import type { VaultIndex, IndexRecord } from '../../../types/index.js';
import type { VerifyIssue } from '../../../types/verify.js';

/**
 * Run the operation validation matrix for a Change's Delta Summary.
 * Pre-apply: checks preconditions (requirement must/must not exist).
 * Post-apply: checks postconditions (requirement state after apply).
 */
export function runOperationValidationMatrix(change: IndexRecord, index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  for (const entry of change.delta_summary) {
    if (entry.target_type !== 'requirement') continue;

    const featureRecord = index.records.get(entry.target_note_id);
    if (!featureRecord) {
      issues.push({
        dimension: 'correctness',
        severity: 'error',
        code: 'INVALID_FRONTMATTER_REF',
        message: `Delta references non-existent Feature "${entry.target_note_id}"`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Check the target_note_id in the Delta Summary entry.',
      });
      continue;
    }

    const existingReqs = new Map(featureRecord.requirements.map((r) => [r.name, r]));

    if (change.status === 'applied') {
      // Post-apply validation
      switch (entry.op) {
        case 'ADDED':
          if (!existingReqs.has(entry.target_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_ADDED',
              message: `ADDED requirement "${entry.target_name}" not found in Feature after apply`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          break;
        case 'MODIFIED': {
          const req = existingReqs.get(entry.target_name);
          if (!req) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_MODIFIED',
              message: `MODIFIED requirement "${entry.target_name}" not found in Feature after apply`,
              note_id: change.id,
              note_path: change.path,
            });
          } else if (entry.base_fingerprint && req.content_hash === entry.base_fingerprint) {
            issues.push({
              dimension: 'correctness',
              severity: 'warning',
              code: 'MODIFIED_NO_CHANGE',
              message: `MODIFIED requirement "${entry.target_name}" content_hash unchanged after apply`,
              note_id: change.id,
              note_path: change.path,
              suggestion: 'The requirement content was not actually changed. Consider removing this MODIFIED entry.',
            });
          }
          break;
        }
        case 'REMOVED':
          if (existingReqs.has(entry.target_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_REMOVED',
              message: `REMOVED requirement "${entry.target_name}" still exists in Feature after apply`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          break;
        case 'RENAMED':
          if (existingReqs.has(entry.target_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_RENAMED',
              message: `RENAMED old name "${entry.target_name}" still exists in Feature`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          if (entry.new_name && !existingReqs.has(entry.new_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_RENAMED',
              message: `RENAMED new name "${entry.new_name}" not found in Feature`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          break;
      }
    } else {
      // Pre-apply validation (proposed/planned/in_progress)
      switch (entry.op) {
        case 'ADDED':
          if (existingReqs.has(entry.target_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_ADDED',
              message: `ADDED requirement "${entry.target_name}" already exists in Feature (pre-apply)`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          break;
        case 'MODIFIED':
          if (!existingReqs.has(entry.target_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_MODIFIED',
              message: `MODIFIED requirement "${entry.target_name}" does not exist in Feature (pre-apply)`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          break;
        case 'REMOVED':
          if (!existingReqs.has(entry.target_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_REMOVED',
              message: `REMOVED requirement "${entry.target_name}" does not exist in Feature (pre-apply)`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          break;
        case 'RENAMED':
          if (!existingReqs.has(entry.target_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_RENAMED',
              message: `RENAMED old name "${entry.target_name}" does not exist in Feature`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          if (entry.new_name && existingReqs.has(entry.new_name)) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'DELTA_MISMATCH_RENAMED',
              message: `RENAMED new name "${entry.new_name}" already exists in Feature`,
              note_id: change.id,
              note_path: change.path,
            });
          }
          break;
      }
    }
  }

  return issues;
}

/**
 * Check for stale base_fingerprint values in Delta Summary entries.
 * A stale base means another Change was applied since this Delta Summary was written.
 */
export function checkStaleBase(change: IndexRecord, index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  for (const entry of change.delta_summary) {
    if (entry.op === 'ADDED') continue;

    if (entry.base_fingerprint === null) {
      issues.push({
        dimension: 'correctness',
        severity: 'warning',
        code: 'STALE_BASE',
        message: `${entry.op} entry for "${entry.target_name}" has no base_fingerprint`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Add a base_fingerprint to track requirement content at the time of writing.',
      });
      continue;
    }

    // Migrated entries skip stale check (original base unknown)
    if (entry.base_fingerprint === 'migrated') {
      continue;
    }

    const featureRecord = index.records.get(entry.target_note_id);
    if (!featureRecord) continue; // Caught by ref resolution

    const currentReq = featureRecord.requirements.find((r) => r.name === entry.target_name);
    if (!currentReq) continue; // Caught by operation validation

    if (currentReq.content_hash !== entry.base_fingerprint) {
      issues.push({
        dimension: 'correctness',
        severity: 'error',
        code: 'STALE_BASE',
        message: `${entry.op} "${entry.target_name}": base_fingerprint mismatch. Expected ${entry.base_fingerprint}, current is ${currentReq.content_hash}. Another Change may have been applied since this Delta Summary was written.`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Re-read the current Feature requirement and update the Delta Summary base_fingerprint.',
      });
    }
  }

  return issues;
}

/**
 * Check status transition validity.
 * Validates that prerequisites are met for the current status.
 */
export function checkStatusTransition(change: IndexRecord, index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  if (change.status === 'planned') {
    const missing = checkPlannedPrerequisites(change);
    if (missing.length > 0) {
      issues.push({
        dimension: 'correctness',
        severity: 'error',
        code: 'INVALID_STATUS_TRANSITION',
        message: `Change "${change.id}" is "planned" but missing prerequisites: ${missing.join(', ')}`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Fill in the missing sections before transitioning to planned.',
      });
    }
  }

  if (change.status === 'in_progress') {
    for (const dep of change.depends_on) {
      const depRecord = index.records.get(dep);
      if (depRecord && depRecord.status !== 'applied') {
        issues.push({
          dimension: 'correctness',
          severity: 'error',
          code: 'BROKEN_DEPENDS_ON',
          message: `Change "${change.id}" is "in_progress" but depends_on "${dep}" is "${depRecord.status}"`,
          note_id: change.id,
          note_path: change.path,
          suggestion: `Wait for "${dep}" to be applied before starting implementation.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Check that a note's schema_version matches the declared vault schema version.
 */
/**
 * Check schema version consistency at the vault level.
 * Note: The index build copies the vault's schema version onto every record,
 * so per-record comparison is always a no-op. Instead, we surface index-level
 * schema_mismatch warnings (e.g., missing schema.md).
 */
export function checkSchemaVersionMatch(_note: IndexRecord, _declaredVersion: string, index?: VaultIndex): VerifyIssue[] {
  if (!index) return [];
  return index.warnings
    .filter((w) => w.type === 'schema_mismatch')
    .map((w) => ({
      dimension: 'correctness' as const,
      severity: 'error' as const,
      code: 'SCHEMA_MISMATCH',
      message: w.message,
      note_path: w.note_path,
      suggestion: 'Create or fix wiki/00-meta/schema.md with a valid schema_version field.',
    }));
}

/**
 * Check drift between Delta Summary and current Feature state based on Change status.
 * Drift is acceptable during active work but is an error for applied Changes.
 */
export function checkDriftForStatus(
  change: IndexRecord,
  index: VaultIndex,
  coveredByMatrix?: Set<string>,
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  if (change.delta_summary.length === 0) return issues;

  for (const entry of change.delta_summary) {
    if (entry.target_type !== 'requirement') continue;

    // Skip entries already covered by operation validation matrix
    const entryKey = `${entry.target_note_id}::${entry.target_name}`;
    if (coveredByMatrix?.has(entryKey)) continue;

    const featureRecord = index.records.get(entry.target_note_id);
    if (!featureRecord) continue;

    const existingReq = featureRecord.requirements.find((r) => r.name === entry.target_name);

    switch (change.status) {
      case 'proposed':
      case 'planned':
      case 'in_progress':
        // Drift is expected/tolerated during active work
        break;

      case 'applied':
        if (entry.op === 'ADDED' && !existingReq) {
          issues.push({
            dimension: 'correctness',
            severity: 'error',
            code: 'EXCESSIVE_DRIFT',
            message: `Change "${change.id}" is applied but ADDED requirement "${entry.target_name}" is missing from Feature "${entry.target_note_id}"`,
            note_id: change.id,
            note_path: change.path,
            suggestion: 'Either the Feature was not updated during apply, or the requirement was subsequently removed.',
          });
        }
        if (entry.op === 'REMOVED' && existingReq) {
          issues.push({
            dimension: 'correctness',
            severity: 'error',
            code: 'EXCESSIVE_DRIFT',
            message: `Change "${change.id}" is applied but REMOVED requirement "${entry.target_name}" still exists in Feature "${entry.target_note_id}"`,
            note_id: change.id,
            note_path: change.path,
            suggestion: 'The Feature was not updated during apply. Re-run apply or update manually.',
          });
        }
        if (entry.op === 'MODIFIED' && existingReq) {
          if (entry.base_fingerprint && existingReq.content_hash === entry.base_fingerprint) {
            issues.push({
              dimension: 'correctness',
              severity: 'error',
              code: 'EXCESSIVE_DRIFT',
              message: `Change "${change.id}" is applied but MODIFIED requirement "${entry.target_name}" content_hash is unchanged in Feature "${entry.target_note_id}"`,
              note_id: change.id,
              note_path: change.path,
              suggestion: 'The requirement was not actually modified during apply.',
            });
          }
        }
        break;
    }
  }

  return issues;
}

/**
 * Check for unfilled apply markers in Feature bodies after a Change is applied.
 * Markers like `<!-- ADDED by change: ...` or `<!-- MODIFIED by change: ...` indicate
 * the agent never filled in the content after apply inserted the markers.
 */
export function checkUnfilledApplyMarkers(change: IndexRecord, index: VaultIndex): VerifyIssue[] {
  if (change.status !== 'applied') return [];

  const issues: VerifyIssue[] = [];
  const MARKER_PATTERN = /<!--\s*(?:ADDED|MODIFIED) by change:\s*/;

  // Collect unique target feature ids from delta summary
  const targetFeatureIds = new Set<string>();
  for (const entry of change.delta_summary) {
    if (entry.op === 'ADDED' || entry.op === 'MODIFIED') {
      targetFeatureIds.add(entry.target_note_id);
    }
  }

  for (const featureId of targetFeatureIds) {
    const featureRecord = index.records.get(featureId);
    if (!featureRecord) continue;

    if (MARKER_PATTERN.test(featureRecord.raw_text)) {
      issues.push({
        dimension: 'correctness',
        severity: 'error',
        code: 'UNFILLED_APPLY_MARKER',
        message: `Feature "${featureId}" still contains unfilled apply markers after change "${change.id}" was applied`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Fill in the marker placeholders in the Feature body, then re-run verify.',
      });
    }
  }

  return issues;
}

/** Check hard prerequisites for planned status */
function checkPlannedPrerequisites(change: IndexRecord): string[] {
  const missing: string[] = [];
  if (!change.headings.includes('Why')) missing.push('Why section');
  if (change.delta_summary.length === 0) missing.push('Delta Summary');
  if (change.tasks.length === 0) missing.push('Tasks');
  if (!change.headings.includes('Validation')) missing.push('Validation section');
  return missing;
}
