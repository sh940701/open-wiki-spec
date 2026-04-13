/**
 * Correctness dimension checks.
 * Operation validation matrix, stale detection, status transitions, schema match, drift.
 */
import type { VaultIndex, IndexRecord } from '../../../types/index.js';
import type { VerifyIssue } from '../../../types/verify.js';
import {
  isSchemaVersionSupported,
  SUPPORTED_SCHEMA_VERSIONS,
  computeSchemaFingerprint,
  BASELINE_SCHEMA_FINGERPRINT,
} from '../../index/schema-version.js';

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
        // Surface both possible causes explicitly — we can't distinguish
        // "legitimately stale because another Change applied first" from
        // "the author copy-pasted or mistyped the hash and it was never a
        // real prior value" without traversing git history. Giving users
        // both diagnoses up front saves a confused debugging round-trip.
        message:
          `${entry.op} "${entry.target_name}": base_fingerprint mismatch. ` +
          `Expected ${entry.base_fingerprint}, current is ${currentReq.content_hash}. ` +
          `Either another Change was applied since this Delta Summary was written, ` +
          `or the base_fingerprint was typed/copied incorrectly and never matched the Feature.`,
        note_id: change.id,
        note_path: change.path,
        suggestion:
          'Re-read the current Feature requirement and paste its actual content_hash into the Delta Summary base_fingerprint. ' +
          'If you believe your hash is correct, check `git log -p` on the Feature file to see which Change last modified it.',
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
    // Must have all prerequisites met (planned-level checks)
    const missing = checkPlannedPrerequisites(change);
    if (missing.length > 0) {
      issues.push({
        dimension: 'correctness',
        severity: 'error',
        code: 'INVALID_STATUS_TRANSITION',
        message: `Change "${change.id}" is "in_progress" but missing planned-level prerequisites: ${missing.join(', ')}`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Status cannot skip from proposed directly to in_progress. Fill sections first.',
      });
    }

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

  if (change.status === 'applied') {
    // Applied changes must have all prerequisites met and all tasks done
    const missing = checkPlannedPrerequisites(change);
    if (missing.length > 0) {
      issues.push({
        dimension: 'correctness',
        severity: 'error',
        code: 'INVALID_STATUS_TRANSITION',
        message: `Change "${change.id}" is "applied" but missing prerequisites: ${missing.join(', ')}. ` +
          `Status may have been set manually (e.g., proposed → applied via file edit), bypassing the apply workflow.`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Run the apply workflow instead of editing the status field directly.',
      });
    }

    const unfinishedTasks = change.tasks.filter((t) => !t.done);
    if (unfinishedTasks.length > 0) {
      issues.push({
        dimension: 'correctness',
        severity: 'error',
        code: 'INVALID_STATUS_TRANSITION',
        message: `Change "${change.id}" is "applied" but has ${unfinishedTasks.length} unchecked task(s). ` +
          `The apply workflow requires all tasks to be checked before transitioning.`,
        note_id: change.id,
        note_path: change.path,
        suggestion: 'Either complete the remaining tasks, or revert the status field to "in_progress".',
      });
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
export function checkSchemaVersionMatch(_note: IndexRecord, declaredVersion: string, index?: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  if (!index) return issues;

  // Add index-level schema_mismatch warnings
  for (const w of index.warnings) {
    if (w.type === 'schema_mismatch') {
      issues.push({
        dimension: 'correctness' as const,
        severity: 'error' as const,
        code: 'SCHEMA_MISMATCH',
        message: w.message,
        note_path: w.note_path,
        suggestion: 'Create or fix wiki/00-meta/schema.md with a valid schema_version field.',
      });
    }
  }

  // Gate: unsupported schema version
  if (declaredVersion && declaredVersion !== 'unknown' && !isSchemaVersionSupported(declaredVersion)) {
    issues.push({
      dimension: 'correctness' as const,
      severity: 'error' as const,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Vault schema version "${declaredVersion}" is not supported by this ows version. Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
      suggestion: 'Upgrade the vault schema or use a matching ows version.',
    });
  }

  // Tripwire: schema shape changed without bumping CURRENT_SCHEMA_VERSION.
  // Warns developers (not end users) that required/optional sections diverged
  // from the baseline — a silent breaking change.
  const runtimeFingerprint = computeSchemaFingerprint();
  if (runtimeFingerprint !== BASELINE_SCHEMA_FINGERPRINT) {
    issues.push({
      dimension: 'correctness' as const,
      severity: 'warning' as const,
      code: 'BREAKING_CHANGE_WITHOUT_VERSION_BUMP',
      message:
        `ows schema shape changed (fingerprint ${runtimeFingerprint}) but CURRENT_SCHEMA_VERSION was not bumped. ` +
        `Baseline: ${BASELINE_SCHEMA_FINGERPRINT}. Vaults built with the old shape may break silently.`,
      suggestion:
        'Bump CURRENT_SCHEMA_VERSION in src/core/index/schema-version.ts and update BASELINE_SCHEMA_FINGERPRINT to match.',
    });
  }

  return issues;
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
