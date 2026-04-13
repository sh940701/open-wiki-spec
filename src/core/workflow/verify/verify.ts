/**
 * Verify orchestrator.
 * Runs all verification checks across completeness, correctness, coherence,
 * and vault integrity dimensions. Takes a VaultIndex and returns a VerifyReport.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { VaultIndex, IndexRecord } from '../../../types/index.js';
import type { VerifyIssue, VerifyDimension, VerifyReport } from '../../../types/verify.js';
import { VERIFY_REPORT_SCHEMA_VERSION } from '../../../types/verify.js';
import {
  duplicateIdCheck,
  missingIdCheck,
  unresolvedWikilinkCheck,
  ambiguousAliasCheck,
  orphanNoteCheck,
  archivePlacementCheck,
  invalidFrontmatterTypeCheck,
  emptyTypedNoteCheck,
  titleIdCollisionCheck,
  secretLeakCheck,
} from './vault-integrity.js';
import {
  checkFeatureCompleteness,
  checkChangeCompleteness,
  checkMinimumSections,
} from './completeness.js';
import {
  runOperationValidationMatrix,
  checkStaleBase,
  checkStatusTransition,
  checkSchemaVersionMatch,
  checkDriftForStatus,
  checkUnfilledApplyMarkers,
} from './correctness.js';
import {
  checkConflictsViaSequencing,
  checkDescriptionConsistency,
  checkDecisionConsistency,
  checkDependsOnConsistency,
  checkFeatureChangeBacklinks,
} from './coherence.js';

export interface VerifyOptions {
  /** Verify only a specific change by id */
  changeId?: string;
  /** Verify only a specific note by id */
  noteId?: string;
  /** Skip coherence checks */
  skipCoherence?: boolean;
  /** Strict mode: treat warnings as errors for pass/fail */
  strict?: boolean;
}

/**
 * Main verify entry point.
 * Stateless: takes a VaultIndex, does NOT build its own index.
 */
export function verify(index: VaultIndex, options?: VerifyOptions): VerifyReport {
  const issues: VerifyIssue[] = [];
  const allRecords = Array.from(index.records.values());
  const schemaVersion = index.schema_version;

  // Concurrency warning: an in-flight `ows apply` holds wiki/.ows-lock and
  // shuffles Feature files through temp/backup names. If verify runs while
  // that's happening, buildIndex silently skips ENOENT on moved files and
  // produces a phantom "everything is missing" report. Detect the lock up
  // front and emit an info issue so operators know the verify results are
  // against a half-mutated vault.
  if (index.vaultRoot) {
    const lockPath = join(index.vaultRoot, 'wiki', '.ows-lock');
    if (existsSync(lockPath)) {
      issues.push({
        dimension: 'vault_integrity',
        severity: 'info',
        code: 'APPLY_IN_PROGRESS',
        message:
          'wiki/.ows-lock is present — another process is running `ows apply`. ' +
          'Verify results may reflect a half-mutated state (files may be in ' +
          'temp/backup names). Re-run verify after apply completes.',
        suggestion: 'Wait for the apply to finish, then run `ows verify` again.',
      });
    }
  }

  // Determine which records to check based on options
  let targetRecords = allRecords;
  if (options?.changeId) {
    const targetChange = index.records.get(options.changeId);
    if (targetChange) {
      // Archived changes: verify scope is narrower. Archived changes are
      // historical records and shouldn't run pre-apply correctness checks
      // (they've already been applied) or be treated like active ones for
      // coherence. Surface an info-level note so users know the
      // interpretation of the report.
      const isArchived = targetChange.path.startsWith('wiki/99-archive/');
      if (isArchived) {
        issues.push({
          dimension: 'vault_integrity',
          severity: 'info',
          code: 'ARCHIVED_TARGET',
          message:
            `Change "${options.changeId}" is archived. Verify runs with reduced scope — ` +
            'no pre-apply matrix, no status transition check. Use `ows list --json` to see active changes.',
          note_id: targetChange.id,
          note_path: targetChange.path,
        });
      }
      // Include the target change and its directly related notes
      const relatedIds = new Set<string>([options.changeId]);
      if (targetChange.feature) relatedIds.add(targetChange.feature);
      if (targetChange.features) targetChange.features.forEach((f) => relatedIds.add(f));
      targetChange.systems.forEach((s) => relatedIds.add(s));
      targetChange.depends_on.forEach((d) => relatedIds.add(d));

      targetRecords = allRecords.filter((r) => relatedIds.has(r.id));
    }
  } else if (options?.noteId) {
    const target = index.records.get(options.noteId);
    if (target) {
      targetRecords = [target];
    }
  }

  // 1. Vault integrity checks (always run on full index)
  issues.push(...duplicateIdCheck(index));
  issues.push(...missingIdCheck(index));
  issues.push(...unresolvedWikilinkCheck(index));
  issues.push(...ambiguousAliasCheck(index));
  issues.push(...orphanNoteCheck(index));
  issues.push(...archivePlacementCheck(index));
  issues.push(...invalidFrontmatterTypeCheck(index));
  issues.push(...emptyTypedNoteCheck(index));
  issues.push(...titleIdCollisionCheck(index));
  issues.push(...secretLeakCheck(targetRecords));

  // 2. Completeness checks
  for (const record of targetRecords) {
    if (record.type === 'feature') {
      issues.push(...checkFeatureCompleteness(record, index));
    } else if (record.type === 'change') {
      issues.push(...checkChangeCompleteness(record, index));
    } else {
      issues.push(...checkMinimumSections(record));
    }
  }

  // 3. Correctness checks
  // Schema version check is vault-level; run once, not per record
  if (targetRecords.length > 0) {
    issues.push(...checkSchemaVersionMatch(targetRecords[0], schemaVersion, index));
  }
  for (const record of targetRecords) {

    if (record.type === 'change') {
      issues.push(...checkStatusTransition(record, index));
      issues.push(...checkStaleBase(record, index));

      // Operation validation for applied changes
      if (record.status === 'applied') {
        const matrixIssues = runOperationValidationMatrix(record, index);
        issues.push(...matrixIssues);

        // Build coveredByMatrix set for drift detection deduplication
        const coveredByMatrix = new Set<string>();
        for (const entry of record.delta_summary) {
          if (entry.target_type === 'requirement') {
            coveredByMatrix.add(`${entry.target_note_id}::${entry.target_name}`);
          }
        }
        issues.push(...checkDriftForStatus(record, index, coveredByMatrix));

        // Check for unfilled apply markers in target Features
        issues.push(...checkUnfilledApplyMarkers(record, index));
      } else {
        // Pre-apply validation
        issues.push(...runOperationValidationMatrix(record, index));
        issues.push(...checkDriftForStatus(record, index));
      }
    }
  }

  // 4. Coherence checks
  if (!options?.skipCoherence) {
    // Always use allRecords for conflict detection — scoping to targetRecords
    // would hide parallel changes that touch the same feature/system.
    const activeChanges = allRecords.filter(
      (r) => r.type === 'change' && r.status !== 'applied',
    );

    // Run sequencing even with a single active change so we still detect
    // self-referencing cycles (change depends_on includes itself), stale base
    // fingerprints, and requirement conflicts within that single change.
    if (activeChanges.length >= 1) {
      issues.push(...checkConflictsViaSequencing(activeChanges, index));
    }

    issues.push(...checkDependsOnConsistency(activeChanges, index));
    issues.push(...checkFeatureChangeBacklinks(options?.changeId ? targetRecords : allRecords));
    issues.push(...checkDescriptionConsistency(options?.changeId ? targetRecords : allRecords));
    issues.push(
      ...checkDecisionConsistency(
        (options?.changeId ? targetRecords : allRecords).filter((r) => r.type === 'decision'),
        (options?.changeId ? targetRecords : allRecords).filter((r) => r.type === 'feature'),
      ),
    );
  }

  // 5. Aggregate report
  const summary = buildSummary(issues);
  const pass = options?.strict
    ? issues.filter((i) => i.severity === 'error' || i.severity === 'warning').length === 0
    : issues.filter((i) => i.severity === 'error').length === 0;

  return {
    schema_version: VERIFY_REPORT_SCHEMA_VERSION,
    scanned_at: new Date().toISOString(),
    total_notes: allRecords.length,
    issues,
    summary,
    pass,
  };
}

function buildSummary(
  issues: VerifyIssue[],
): Record<VerifyDimension, { errors: number; warnings: number; info: number }> {
  const dimensions: VerifyDimension[] = ['completeness', 'correctness', 'coherence', 'vault_integrity'];
  const summary = {} as Record<VerifyDimension, { errors: number; warnings: number; info: number }>;

  for (const dim of dimensions) {
    const dimIssues = issues.filter((i) => i.dimension === dim);
    summary[dim] = {
      errors: dimIssues.filter((i) => i.severity === 'error').length,
      warnings: dimIssues.filter((i) => i.severity === 'warning').length,
      info: dimIssues.filter((i) => i.severity === 'info').length,
    };
  }

  return summary;
}
