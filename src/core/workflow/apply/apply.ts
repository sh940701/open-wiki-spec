import * as fs from 'node:fs';
import { join, basename, resolve } from 'node:path';
import type {
  ApplyOptions,
  ApplyResult,
  ApplyDeps,
  DeltaEntry,
  StaleReport,
  FeatureApplyResult,
  SectionApplyResult,
  PostValidation,
  PendingAgentOp,
  ArchiveOptions,
  ArchiveResult,
} from './types.js';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import type { Requirement } from '../../../types/requirement.js';
import { parseDeltaSummary, validateDeltaConflicts } from './delta-parser.js';
import { detectStale, computeRequirementHash } from './stale-checker.js';
import { applyDeltaToFeature } from './feature-updater.js';
import { assertInsideVault } from '../../../utils/path-safety.js';

const PROGRAMMATIC_OPS = new Set(['RENAMED', 'REMOVED']);
const AGENT_DRIVEN_OPS = new Set(['MODIFIED', 'ADDED']);
const LOCK_FILENAME = '.ows-lock';
const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Default atomic exclusive file create using fs.openSync with O_CREAT|O_EXCL ('wx' flag).
 * Throws with code EEXIST if the file already exists — preventing race conditions.
 */
function defaultExclusiveCreateFile(filePath: string, content: string): void {
  const fd = fs.openSync(filePath, 'wx');
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Recover from a prior crash: restore .ows-backup-* files and remove .ows-tmp-* files.
 * Called before acquiring lock to ensure clean state.
 *
 * Returns a list of per-file recovery failures so the caller can decide
 * whether to abort. Previously these were swallowed silently, which could
 * leave the vault in a partially-recovered state where some Feature files
 * were successfully restored from backup but others were not — the next
 * apply would then operate on mixed pre-/post-crash content without the
 * user ever seeing a warning.
 */
function recoverFromCrash(vaultRoot: string, deps: ApplyDeps): string[] {
  const failures: string[] = [];
  const wikiDir = join(vaultRoot, 'wiki');
  try {
    const allFiles = fs.readdirSync(wikiDir, { recursive: true }) as string[];

    // Step 0: Check for a commit marker. If present, ALL renames
    // succeeded in a prior run but the process crashed before cleanup.
    // Forward-recover: delete backups + commit marker, keep new files.
    // If absent AND backups exist, the renames were partial — rollback
    // by restoring all backups.
    const commitMarker = allFiles.find((f) => String(f).includes('.ows-commit-'));
    if (commitMarker) {
      // Forward recovery: all renames completed → delete backups + marker
      for (const relFile of allFiles) {
        const file = String(relFile);
        const absPath = join(wikiDir, file);
        if (file.includes('.ows-backup-') || file.includes('.ows-tmp-') || file.includes('.ows-commit-')) {
          try {
            if (deps.deleteFile) deps.deleteFile(absPath);
          } catch (err) {
            failures.push(`forward-recovery cleanup failed for ${file}: ${(err as Error).message}`);
          }
        }
      }
      return failures;
    }

    // No commit marker → rollback any partial renames
    for (const relFile of allFiles) {
      const file = String(relFile);
      const absPath = join(wikiDir, file);
      if (file.includes('.ows-tmp-')) {
        try {
          if (deps.deleteFile) deps.deleteFile(absPath);
        } catch (err) {
          failures.push(`failed to remove stale tmp file ${file}: ${(err as Error).message}`);
        }
      } else if (file.includes('.ows-backup-')) {
        // Rollback: ALWAYS restore backup regardless of whether the
        // original path exists. If the original was overwritten by a
        // partial rename, the backup is the authoritative pre-apply
        // version. This prevents the mixed-state bug where some files
        // have post-apply content and others have pre-apply content.
        const originalPath = absPath.replace(/\.ows-backup-\d+/, '');
        try {
          fs.renameSync(absPath, originalPath);
        } catch (err) {
          failures.push(`failed to restore backup ${file}: ${(err as Error).message}`);
        }
      }
    }
  } catch {
    // wiki dir might not exist yet — ignore
  }
  return failures;
}

function acquireLock(vaultRoot: string, deps: ApplyDeps): boolean {
  const lockPath = join(vaultRoot, 'wiki', LOCK_FILENAME);
  const lockContent = JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() });
  const exclusiveCreate = deps.exclusiveCreateFile ?? defaultExclusiveCreateFile;

  try {
    // Atomic exclusive create — fails with EEXIST if lock already exists
    exclusiveCreate(lockPath, lockContent);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      // Unexpected error (permissions, missing directory, etc.)
      return false;
    }
  }

  // Lock file exists — check if stale
  try {
    const content = deps.readFile(lockPath);
    const parsed = JSON.parse(content) as { pid?: number; timestamp?: string };
    const lockTime = parsed.timestamp ? new Date(parsed.timestamp).getTime() : 0;
    const isStaleByTime = Date.now() - lockTime > LOCK_STALE_MS;
    let isStaleByPid = false;

    if (parsed.pid) {
      try {
        // process.kill(pid, 0) throws if process doesn't exist
        process.kill(parsed.pid, 0);
      } catch {
        isStaleByPid = true;
      }
    }

    if (isStaleByTime || isStaleByPid) {
      // Remove stale lock and retry atomically
      if (deps.deleteFile) {
        deps.deleteFile(lockPath);
      }
      try {
        exclusiveCreate(lockPath, lockContent);
        return true;
      } catch {
        // Another process grabbed the lock between delete and create
        return false;
      }
    }

    return false;
  } catch {
    // If we can't parse the lock, treat as stale and recover
    if (deps.deleteFile) {
      try { deps.deleteFile(lockPath); } catch { /* swallow */ }
    }
    try {
      exclusiveCreate(lockPath, lockContent);
      return true;
    } catch {
      return false;
    }
  }
}

function releaseLock(vaultRoot: string, deps: ApplyDeps): void {
  const lockPath = join(vaultRoot, 'wiki', LOCK_FILENAME);
  try {
    if (deps.deleteFile) {
      deps.deleteFile(lockPath);
    }
  } catch {
    // Best-effort release — swallow errors
  }
}

function getAtomicPriority(op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'): number {
  switch (op) {
    case 'RENAMED': return 1;
    case 'REMOVED': return 2;
    case 'MODIFIED': return 3;
    case 'ADDED': return 4;
  }
}

/**
 * Main apply workflow using a TWO-PHASE COMMIT pattern.
 *
 * Phase 1 (Validate & Compute -- no disk writes):
 *   1-9. Parse, validate, stale-check, pre-validate, compute
 *
 * Phase 2 (Write -- only if Phase 1 passes):
 *   10-11. Write files, transition status
 */
export function applyChange(
  options: ApplyOptions,
  index: VaultIndex,
  deps: ApplyDeps,
): ApplyResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Load Change note
  const changeRecord = index.records.get(options.changeId);
  if (!changeRecord) {
    throw new Error(`Change "${options.changeId}" not found in index`);
  }

  const resolvedChangePath = resolve(options.vaultRoot, changeRecord.path);
  const parsed = deps.parseNote(resolvedChangePath);

  // Verify status
  if (changeRecord.status !== 'in_progress') {
    throw new Error(
      `Cannot apply change with status "${changeRecord.status}". ` +
      'Expected "in_progress". Use \'continue\' to advance through the status lifecycle first.',
    );
  }

  // Check all tasks complete. Reject changes with zero tasks — a change with
  // no tasks is an incomplete spec (Tasks is a hard prerequisite per the
  // planned transition), and allowing it would let users apply a Change that
  // was never actually implemented.
  if (parsed.tasks.length === 0) {
    throw new Error(
      'Cannot apply: change has no tasks defined. Add implementation tasks to the ## Tasks section before applying.',
    );
  }
  const uncheckedTasks = parsed.tasks.filter((t) => !t.done);
  if (uncheckedTasks.length > 0) {
    throw new Error(
      `Cannot apply: ${uncheckedTasks.length} unchecked task(s) remaining. ` +
      'Complete all tasks via \'continue\' before applying.',
    );
  }

  // 2. Parse Delta Summary
  const resolveWikilink = (target: string): string | undefined => {
    // Lookup by id first (highest priority), then title, then alias
    for (const record of index.records.values()) {
      if (record.id === target) return record.id;
    }
    for (const record of index.records.values()) {
      if (record.title === target) return record.id;
    }
    for (const record of index.records.values()) {
      if (record.aliases.some((a) => a === target)) return record.id;
    }
    return undefined;
  };

  const deltaPlan = parseDeltaSummary(parsed, resolveWikilink);
  warnings.push(...deltaPlan.warnings);

  if (deltaPlan.entries.length === 0) {
    return makeResult(options, changeRecord, {
      success: false,
      errors: ['No Delta Summary entries found. Nothing to apply.'],
      warnings,
    });
  }

  // Hard-fail on any Unparseable line. These warnings are only emitted when
  // a delta line STARTS with ADDED/MODIFIED/REMOVED/RENAMED but fails the
  // full regex (e.g., missing quotes around the requirement name, or the
  // target was written as plain text instead of a `[[wikilink]]`). Such
  // lines are unambiguously intended as delta entries — silently applying
  // only the parseable siblings produces a partial change that is
  // impossible to audit after the fact. Block the whole apply so the user
  // fixes the syntax explicitly.
  const unparseable = deltaPlan.warnings.filter((w) =>
    w.startsWith('Unparseable Delta Summary entry'),
  );
  if (unparseable.length > 0) {
    return makeResult(options, changeRecord, {
      success: false,
      errors: [
        `Delta Summary has ${unparseable.length} unparseable line(s). ` +
          `Fix the syntax — requirement names must be quoted ` +
          `(e.g., \`ADDED requirement "FooBar" to [[Feature: Auth]]\`) ` +
          `and target Features must be wikilinks, not plain text:`,
        ...unparseable.map((u) => `  ${u}`),
      ],
      warnings,
    });
  }

  // Validate that every Delta Summary entry targets a Feature declared in the
  // change's frontmatter (`feature` or `features`). This prevents a Change that
  // claims `features: [A, B]` from accidentally modifying Feature C.
  const declaredFeatureIds = new Set<string>();
  if (changeRecord.feature) declaredFeatureIds.add(changeRecord.feature);
  if (changeRecord.features) {
    for (const f of changeRecord.features) declaredFeatureIds.add(f);
  }
  if (declaredFeatureIds.size > 0) {
    const undeclaredTargets: string[] = [];
    for (const [noteKey] of deltaPlan.byTargetNote) {
      if (!declaredFeatureIds.has(noteKey)) {
        undeclaredTargets.push(noteKey);
      }
    }
    if (undeclaredTargets.length > 0) {
      return makeResult(options, changeRecord, {
        success: false,
        errors: [
          `Delta Summary targets Feature(s) not declared in the change's frontmatter: ${undeclaredTargets.join(', ')}. ` +
          `Declared features: ${Array.from(declaredFeatureIds).join(', ')}. ` +
          `Either add the undeclared targets to the change's "features" field, or fix the Delta Summary to point at the declared Features.`,
        ],
        warnings,
      });
    }
  }

  // Validate delta conflicts
  const conflictErrors = validateDeltaConflicts(deltaPlan);
  if (conflictErrors.length > 0) {
    return makeResult(options, changeRecord, { success: false, errors: conflictErrors, warnings });
  }

  // 3. Build feature requirements maps
  const featureRequirements = new Map<string, Map<string, Requirement>>();
  for (const [noteKey] of deltaPlan.byTargetNote) {
    const noteRecord = index.records.get(noteKey);
    if (!noteRecord) {
      errors.push(
        `Target note "${noteKey}" referenced in Delta Summary does not exist in the vault. ` +
        `Either the Feature was deleted, renamed, or the Change's Delta Summary points to the wrong target. ` +
        `Fix the Delta Summary wikilink or restore the missing note.`,
      );
      continue;
    }
    // Resolve path: absolute paths stay as-is, relative paths resolve against vault root
    const resolvedNotePath = resolve(options.vaultRoot, noteRecord.path);
    let noteParsed;
    try {
      noteParsed = deps.parseNote(resolvedNotePath);
    } catch (parseErr) {
      errors.push(
        `Failed to read target note "${noteKey}" at ${noteRecord.path}: ${(parseErr as Error).message}. ` +
        `The file may have been deleted or become unreadable since the index was built.`,
      );
      continue;
    }
    const reqMap = new Map<string, Requirement>();
    for (const req of noteParsed.requirements) {
      reqMap.set(req.name, req);
    }
    featureRequirements.set(noteKey, reqMap);
  }

  if (errors.length > 0) {
    return makeResult(options, changeRecord, { success: false, errors, warnings });
  }

  // 4. Stale detection
  const staleReport = detectStale(deltaPlan, featureRequirements);

  // 5. Block if stale
  if (staleReport.blocked && !options.forceStale) {
    return makeResult(options, changeRecord, {
      success: false,
      staleReport,
      warnings: [
        ...warnings,
        'Stale base detected. Another change has modified the base requirements.',
      ],
      errors: staleReport.staleEntries.map((s) =>
        `STALE: ${s.entry.op} "${s.entry.targetName}" - ${s.reason}`,
      ),
    });
  }

  // 5b. If --force-stale was used and there actually was a stale report,
  // record a prominent warning per entry so the audit trail isn't silent.
  // Without this, a forced apply looks identical to a clean apply in the
  // resulting ApplyResult — making it impossible for reviewers to tell
  // after the fact that the stale guard was bypassed on purpose.
  if (staleReport.blocked && options.forceStale && staleReport.staleEntries.length > 0) {
    warnings.push(
      `--force-stale: bypassed ${staleReport.staleEntries.length} stale base check(s). ` +
        'Applied requirement deltas against a base that has already been modified ' +
        'by another change. Review the result carefully and re-verify the Feature.',
    );
    for (const s of staleReport.staleEntries) {
      warnings.push(`  force-stale: ${s.entry.op} "${s.entry.targetName}" - ${s.reason}`);
    }
  }

  // === PHASE 1: Validate and compute ===

  const featureResults: FeatureApplyResult[] = [];
  const allPostValidations: PostValidation[] = [];
  const pendingAgentOps: PendingAgentOp[] = [];

  // 6. Pre-validate and apply programmatic ops
  for (const [noteKey, entries] of deltaPlan.byTargetNote) {
    const reqEntries = entries.filter((e) => e.targetType === 'requirement');
    if (reqEntries.length === 0) continue;

    const reqMap = featureRequirements.get(noteKey)!;
    const noteRecord = index.records.get(noteKey)!;

    // Pre-validate in atomic order using a shadow map.
    // This ensures RENAMED creates the new name before MODIFIED checks it.
    const shadowMap = new Map(reqMap);
    const sortedForValidation = [...reqEntries].sort(
      (a, b) => getAtomicPriority(a.op) - getAtomicPriority(b.op),
    );
    for (const entry of sortedForValidation) {
      const preError = preValidateEntry(entry, shadowMap);
      if (preError) {
        errors.push(`Pre-validation: ${preError}`);
      } else {
        // Update shadow map to reflect the operation for subsequent validations
        if (entry.op === 'RENAMED') {
          const req = shadowMap.get(entry.targetName);
          if (req) {
            shadowMap.delete(entry.targetName);
            shadowMap.set(entry.newName!, { ...req, name: entry.newName!, key: '' });
          }
        } else if (entry.op === 'REMOVED') {
          shadowMap.delete(entry.targetName);
        }
      }
    }

    if (errors.length > 0) continue;

    // Apply all requirement operations (programmatic + agent-driven markers)
    const mechEntries = reqEntries.filter((e) => PROGRAMMATIC_OPS.has(e.op));
    const agentEntries = reqEntries.filter((e) => AGENT_DRIVEN_OPS.has(e.op));
    const allReqEntries = [...mechEntries, ...agentEntries];

    const resolvedNotePath = resolve(options.vaultRoot, noteRecord.path);

    // Read Feature file content for programmatic editing. The file may
    // have been deleted or replaced between parseNote (earlier in this
    // function) and this read — for example, an Obsidian user moving
    // files while `ows apply` runs. Turn a raw exception into a
    // structured `errors` entry so the caller gets a clean failure
    // report instead of the process aborting mid-apply.
    let featureContent: string;
    try {
      featureContent = deps.readFile(resolvedNotePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const reason =
        code === 'ENOENT'
          ? 'file no longer exists (was it moved or deleted mid-apply?)'
          : code === 'EACCES'
            ? 'permission denied while reading'
            : (err as Error).message;
      errors.push(
        `Failed to re-read Feature "${noteKey}" at ${noteRecord.path}: ${reason}. ` +
          'Aborting apply before any writes.',
      );
      continue;
    }
    const result = applyDeltaToFeature(noteKey, resolvedNotePath, reqMap, allReqEntries, featureContent, options.changeId);
    featureResults.push(result);

    // Hard-fail on any semantic operation failure within a Feature.
    // Without this, a multi-Feature change (features: [A, B]) could
    // see Feature A succeed and Feature B fail at the operation level
    // (e.g., "## Requirements section not found"), yet Phase 2 would
    // still write A and skip B — producing a partial apply. Promoting
    // operation-level failures to the global errors array ensures the
    // entire apply aborts before any writes.
    const failedOps = result.operations.filter((op) => !op.success);
    for (const op of failedOps) {
      errors.push(
        `Feature "${noteKey}": ${op.entry.op} "${op.entry.targetName}" failed: ${op.error ?? 'unknown error'}`,
      );
    }

    // Collect agent-driven ops (MODIFIED/ADDED need agent to fill content)
    for (const entry of agentEntries) {
      pendingAgentOps.push({
        entry,
        featureId: noteKey,
        featurePath: resolvedNotePath,
      });
    }
  }

  // Abort if any pre-validation failed
  if (errors.length > 0) {
    return makeResult(options, changeRecord, {
      success: false,
      staleReport,
      featureResults,
      errors,
      warnings,
    });
  }

  // Snapshot content_hashes before agent edits
  const preEditSnapshots = new Map<string, Map<string, string>>();
  for (const op of pendingAgentOps) {
    if (!preEditSnapshots.has(op.featureId)) {
      const reqMap = featureRequirements.get(op.featureId)!;
      const hashMap = new Map<string, string>();
      for (const [name, req] of reqMap) {
        hashMap.set(name, computeRequirementHash(req));
      }
      preEditSnapshots.set(op.featureId, hashMap);
    }
  }

  // Handle section operations — currently unsupported; hard-fail
  const sectionResults: SectionApplyResult[] = [];
  for (const [noteKey, entries] of deltaPlan.byTargetNote) {
    const secEntries = entries.filter((e) => e.targetType === 'section');
    if (secEntries.length === 0) continue;

    const secNoteRecord = index.records.get(noteKey)!;
    for (const entry of secEntries) {
      sectionResults.push({
        noteId: noteKey,
        notePath: resolve(options.vaultRoot, secNoteRecord.path),
        sectionName: entry.targetName,
        op: entry.op as 'ADDED' | 'MODIFIED' | 'REMOVED',
        success: false,
        error: 'Section-level operations are not yet supported. Use requirement-level operations.',
      });
    }
  }

  // Block apply if ANY section-level operations exist
  if (sectionResults.length > 0) {
    errors.push('Cannot apply: contains section-level operations which are not yet supported');
    return {
      changeId: options.changeId,
      changeName: changeRecord.title,
      success: false,
      staleReport,
      featureResults,
      sectionResults,
      postValidation: allPostValidations,
      pendingAgentOps,
      preEditSnapshots,
      statusTransitioned: false,
      modifiedFiles: [],
      warnings,
      errors,
    };
  }

  // === PHASE 2: Write (only if Phase 1 passed) ===
  // Uses atomic temp-file pattern: write to .ows-tmp first, then rename all at once.

  let statusTransitioned = false;
  const modifiedFiles: string[] = [];

  // Always skip auto-transition when agent-driven ops remain — even if
  // `noAutoTransition` is false. Previously the default behavior was
  // to still flip the Change to `applied` while leaving `MODIFIED/ADDED`
  // markers unfilled in the Feature, which verify later caught via
  // `UNFILLED_APPLY_MARKER`. That verdict was correct but came AFTER
  // the status transition, leaving the Change in a lying state. Skip
  // the transition up front so the Change stays `in_progress` until
  // the agent actually fills the markers and runs apply again.
  const skipTransition = pendingAgentOps.length > 0;
  if (skipTransition && !options.noAutoTransition) {
    warnings.push(
      `Auto-transition to "applied" blocked: ${pendingAgentOps.length} agent-driven op(s) still need marker fill. ` +
        'Fill the MODIFIED/ADDED markers in the Feature note, then re-run `ows apply`.',
    );
  }

  if (!options.dryRun) {
    // Recover from prior crash (restore backups, clean temp files).
    // Failures here are not fatal for tmp-file leftovers, but unrestored
    // backups mean the vault is in a half-restored state — surface them
    // as errors so the user can intervene before we clobber more files.
    const recoveryFailures = recoverFromCrash(options.vaultRoot, deps);
    for (const fail of recoveryFailures) {
      if (fail.startsWith('failed to restore backup')) {
        errors.push(
          `Pre-apply crash recovery could not restore a backup: ${fail}. ` +
            'Manually inspect wiki/ for .ows-backup-* files, restore them, then retry.',
        );
      } else {
        warnings.push(`Pre-apply crash recovery warning: ${fail}`);
      }
    }
    if (errors.length > 0) {
      return makeResult(options, changeRecord, {
        success: false,
        staleReport,
        featureResults,
        errors,
        warnings,
      });
    }
    // Acquire vault-level lock
    if (!acquireLock(options.vaultRoot, deps)) {
      errors.push('Cannot apply: another apply operation is in progress (wiki/.ows-lock exists)');
      return {
        changeId: options.changeId,
        changeName: changeRecord.title,
        success: false,
        staleReport,
        featureResults,
        sectionResults,
        postValidation: allPostValidations,
        pendingAgentOps,
        preEditSnapshots,
        statusTransitioned: false,
        modifiedFiles: [],
        warnings,
        errors,
      };
    }

    try {
      // Collect all pending writes as {path, content} pairs
      const pendingWrites: { path: string; content: string }[] = [];

      for (const featureResult of featureResults) {
        if (featureResult.requiresWrite && featureResult.updatedContent) {
          // Only append Change Log when actually transitioning to applied
          // (skip when --no-auto-transition with pending agent ops)
          const content = skipTransition
            ? featureResult.updatedContent
            : appendChangeLogEntry(
                featureResult.updatedContent,
                changeRecord,
                deltaPlan.byTargetNote.get(featureResult.featureId) ?? [],
              );
          pendingWrites.push({ path: featureResult.featurePath, content });
        }
      }

      // Status transition content — skip if noAutoTransition with pending ops
      const changeContent = deps.readFile(resolvedChangePath);
      const updatedChangeContent = skipTransition
        ? changeContent  // keep current status (in_progress)
        : changeContent.replace(/^(status:\s*).+$/m, '$1applied');
      pendingWrites.push({ path: resolvedChangePath, content: updatedChangeContent });

      // Use unique temp suffix to avoid collisions
      const tmpSuffix = `.ows-tmp-${Date.now()}`;

      // Phase 2a: Write all to temp files, preserving the original file
      // mode so permissions survive the write (a 0444 read-only vault
      // stays 0444, preserving the user's intent). When copyFileMode is
      // not injected, we fall through to whatever umask produces.
      const tmpPaths: string[] = [];
      let writeFailed = false;

      for (const { path, content } of pendingWrites) {
        assertInsideVault(path, options.vaultRoot);
        const tmpPath = `${path}${tmpSuffix}`;
        try {
          deps.writeFile(tmpPath, content);
          tmpPaths.push(tmpPath);
          if (deps.copyFileMode) {
            try {
              deps.copyFileMode(path, tmpPath);
            } catch {
              // Mode preservation is best-effort — on platforms where
              // chmod is a no-op (Windows without admin) or the source
              // file was already replaced, just use default permissions.
            }
          }
        } catch (err) {
          errors.push(`Failed to write temp file ${tmpPath}: ${(err as Error).message}`);
          writeFailed = true;
          break;
        }
      }

      if (writeFailed) {
        // Cleanup: remove any temp files already written
        cleanupTempFiles(tmpPaths, deps);
      } else {
        // Phase 2b: Backup originals, then rename temp files to final paths (atomic swap)
        const backupSuffix = `.ows-backup-${Date.now()}`;
        const backedUpPaths: { original: string; backup: string }[] = [];
        let backupFailed = false;

        // Backup existing originals before overwriting
        for (const { path } of pendingWrites) {
          if (deps.fileExists(path)) {
            const backupPath = `${path}${backupSuffix}`;
            try {
              deps.moveFile(path, backupPath);
              backedUpPaths.push({ original: path, backup: backupPath });
            } catch (err) {
              errors.push(`Failed to backup ${path}: ${(err as Error).message}`);
              backupFailed = true;
              break;
            }
          }
        }

        if (backupFailed) {
          // Restore any backups already made. Surface any restore failure
          // so the user knows a backup file is orphaned and the original missing.
          for (const { original, backup } of backedUpPaths) {
            try {
              deps.moveFile(backup, original);
            } catch (restoreErr) {
              errors.push(
                `CRITICAL: Failed to restore backup "${backup}" -> "${original}": ${(restoreErr as Error).message}. ` +
                `Manual recovery required: move the backup file back to the original path.`,
              );
            }
          }
          // Cleanup temp files
          const allTmps = pendingWrites.map((w) => `${w.path}${tmpSuffix}`);
          cleanupTempFiles(allTmps, deps);
        } else {
          // Now rename temp files to final paths
          let renameFailed = false;
          const renamedPaths: string[] = [];

          for (let i = 0; i < pendingWrites.length; i++) {
            const { path } = pendingWrites[i];
            const tmpPath = `${path}${tmpSuffix}`;
            try {
              deps.moveFile(tmpPath, path);
              renamedPaths.push(path);
            } catch (err) {
              errors.push(`Failed to rename ${tmpPath} -> ${path}: ${(err as Error).message}`);
              renameFailed = true;
              break;
            }
          }

          if (renameFailed) {
            // Remove successfully renamed temp->final files and restore from backup
            for (const renamedPath of renamedPaths) {
              try {
                if (deps.deleteFile) {
                  deps.deleteFile(renamedPath);
                }
              } catch {
                // Best-effort — swallow errors
              }
            }
            // Restore all backups. Surface restore failures so users can recover manually.
            for (const { original, backup } of backedUpPaths) {
              try {
                deps.moveFile(backup, original);
              } catch (restoreErr) {
                errors.push(
                  `CRITICAL: Failed to restore backup "${backup}" -> "${original}": ${(restoreErr as Error).message}. ` +
                  `Manual recovery required.`,
                );
              }
            }
            // Cleanup remaining temp files (the ones not yet renamed)
            const remainingTmps = pendingWrites
              .filter((w) => !renamedPaths.includes(w.path))
              .map((w) => `${w.path}${tmpSuffix}`);
            cleanupTempFiles(remainingTmps, deps);
          } else {
            // All renames succeeded. Write a commit marker so that
            // crash recovery knows this is a complete apply — forward
            // recovery (delete backups) instead of rollback (restore
            // backups). The marker is deleted after backup cleanup.
            const commitMarkerPath = join(options.vaultRoot, 'wiki', `.ows-commit-${Date.now()}`);
            try {
              deps.writeFile(commitMarkerPath, `${options.changeId}|${Date.now()}`);
            } catch {
              // Commit marker write failure is non-fatal — without it,
              // a crash here would trigger rollback recovery on next run,
              // which is safe (just means the apply would be re-run).
            }

            // All writes succeeded — delete backups. Surface any
            // cleanup failure as a warning.
            for (const { backup } of backedUpPaths) {
              try {
                if (deps.deleteFile) {
                  deps.deleteFile(backup);
                }
              } catch (err) {
                warnings.push(
                  `Orphan backup: apply succeeded but could not delete ${backup} (${(err as Error).message}). ` +
                    'Remove the file manually or check wiki/ permissions.',
                );
              }
            }

            // Remove commit marker now that backups are cleaned up
            try {
              if (deps.deleteFile) deps.deleteFile(commitMarkerPath);
            } catch {
              // Non-fatal — marker will be cleaned up on next apply.
            }
            for (const { path } of pendingWrites) {
              if (path !== resolvedChangePath) {
                modifiedFiles.push(path);
              }
            }
            statusTransitioned = !skipTransition;
          }
        }
      }
    } finally {
      releaseLock(options.vaultRoot, deps);
    }
  }

  // Dry-run warning: when dry-run reports success but pendingAgentOps
  // remain, the caller must still fill markers and run a real apply
  // later. Without this note, a CI that runs `--dry-run` then trusts
  // `success: true` would skip the real apply and leave the change
  // stuck in in_progress. Surface it explicitly in warnings so both
  // JSON and human consumers see it.
  if (options.dryRun && pendingAgentOps.length > 0 && errors.length === 0) {
    warnings.push(
      `Dry-run success is PROVISIONAL: ${pendingAgentOps.length} agent-driven operation(s) ` +
        `still need human/LLM authoring (MODIFIED/ADDED requirement markers). ` +
        'Real apply cannot skip this step — fill the markers then run `ows apply` without --dry-run.',
    );
  }

  return {
    changeId: options.changeId,
    changeName: changeRecord.title,
    success: errors.length === 0,
    staleReport,
    featureResults,
    sectionResults,
    postValidation: allPostValidations,
    pendingAgentOps,
    preEditSnapshots,
    statusTransitioned,
    modifiedFiles,
    warnings,
    errors,
  };
}

/**
 * Archive an applied Change.
 */
export function archiveChange(
  options: ArchiveOptions,
  index: VaultIndex,
  deps: ApplyDeps,
): ArchiveResult {
  const changeRecord = index.records.get(options.changeId);
  if (!changeRecord) {
    throw new Error(`Change "${options.changeId}" not found`);
  }

  if (changeRecord.status !== 'applied') {
    return {
      success: false,
      fromPath: changeRecord.path,
      toPath: '',
      indexInvalidated: false,
      error: `Cannot archive change with status "${changeRecord.status}". Must be "applied".`,
    };
  }

  const resolvedFromPath = resolve(options.vaultRoot, changeRecord.path);
  assertInsideVault(resolvedFromPath, options.vaultRoot);
  const filename = basename(changeRecord.path);
  const archiveDir = join(options.vaultRoot, 'wiki', '99-archive');
  const toPath = join(archiveDir, filename);
  assertInsideVault(toPath, options.vaultRoot);

  if (deps.fileExists(toPath)) {
    return {
      success: false,
      fromPath: resolvedFromPath,
      toPath,
      indexInvalidated: false,
      error: `Archive target already exists: ${toPath}`,
    };
  }

  deps.ensureDir(archiveDir);
  deps.moveFile(resolvedFromPath, toPath);

  return {
    success: true,
    fromPath: resolvedFromPath,
    toPath,
    indexInvalidated: true,
  };
}

// ── Helpers ──

function preValidateEntry(entry: DeltaEntry, requirements: Map<string, Requirement>): string | null {
  switch (entry.op) {
    case 'ADDED':
      // If requirement already exists (e.g., from a prior --no-auto-transition run),
      // treat as no-op rather than error — the skeleton was already placed.
      return null;
    case 'MODIFIED':
      return !requirements.has(entry.targetName)
        ? `Requirement "${entry.targetName}" not found (MODIFIED requires existence)`
        : null;
    case 'REMOVED':
      return !requirements.has(entry.targetName)
        ? `Requirement "${entry.targetName}" not found (REMOVED requires existence)`
        : null;
    case 'RENAMED': {
      if (!requirements.has(entry.targetName)) {
        return `Old name "${entry.targetName}" not found`;
      }
      if (requirements.has(entry.newName!)) {
        return `New name "${entry.newName}" already exists`;
      }
      return null;
    }
  }
}

/** Best-effort cleanup of temp files. Errors are swallowed. */
function cleanupTempFiles(tmpPaths: string[], deps: ApplyDeps): void {
  for (const tmpPath of tmpPaths) {
    try {
      if (deps.deleteFile) {
        deps.deleteFile(tmpPath);
      }
    } catch {
      // Best-effort cleanup — swallow errors
    }
  }
}

/**
 * Maximum number of rows kept in a Feature note's Change Log table.
 * Older entries are dropped (still preserved in archived Change notes).
 */
const CHANGE_LOG_MAX_ROWS = 50;

/**
 * Trim a Change Log section so only the most recent CHANGE_LOG_MAX_ROWS remain.
 * If rows were dropped, adds a comment marker indicating the trim.
 */
function trimChangeLogSection(featureContent: string): string {
  const changeLogMatch = featureContent.match(/^## Change Log\s*$/m);
  if (!changeLogMatch) return featureContent;

  const sectionStart = changeLogMatch.index! + changeLogMatch[0].length;
  const nextHeadingMatch = featureContent.slice(sectionStart).match(/^## /m);
  const sectionEnd = nextHeadingMatch
    ? sectionStart + nextHeadingMatch.index!
    : featureContent.length;
  const sectionContent = featureContent.slice(sectionStart, sectionEnd);

  // Find table rows (lines starting with `| ` that are not header/separator)
  const lines = sectionContent.split('\n');
  const rowLines: { line: string; index: number }[] = [];
  let headerDone = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^\|[-\s|]+\|\s*$/)) {
      headerDone = true;
      continue;
    }
    if (headerDone && line.startsWith('| ') && line.trim().endsWith('|')) {
      rowLines.push({ line, index: i });
    }
  }

  if (rowLines.length <= CHANGE_LOG_MAX_ROWS) return featureContent;

  // Keep the first CHANGE_LOG_MAX_ROWS rows (newest, since we prepend)
  const keepRows = rowLines.slice(0, CHANGE_LOG_MAX_ROWS);
  const dropCount = rowLines.length - CHANGE_LOG_MAX_ROWS;
  const lastKeptIdx = keepRows[keepRows.length - 1].index;

  // Build the trimmed section: up to last kept row + marker + empty line
  const keptSectionLines = lines.slice(0, lastKeptIdx + 1);
  keptSectionLines.push('');
  keptSectionLines.push(`<!-- ${dropCount} older entries trimmed; see wiki/99-archive/ for full history -->`);
  keptSectionLines.push('');

  const newSectionContent = keptSectionLines.join('\n');
  return featureContent.slice(0, sectionStart) + newSectionContent + featureContent.slice(sectionEnd);
}

/**
 * Append a Change Log entry row to a Feature note's ## Change Log section.
 * If the section or table header doesn't exist, creates them.
 * Trims older entries when the table grows beyond CHANGE_LOG_MAX_ROWS.
 */
function appendChangeLogEntry(
  featureContent: string,
  changeRecord: IndexRecord,
  deltaEntries: DeltaEntry[],
): string {
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const changeLink = `[[${changeRecord.title}]]`;
  const summary = deltaEntries
    .map((e) => {
      if (e.op === 'RENAMED' && e.newName) {
        return `${e.op} [${e.targetType}] ${e.targetName} → ${e.newName}`;
      }
      return `${e.op} [${e.targetType}] ${e.targetName}`;
    })
    .join(', ');
  const newRow = `| ${date} | ${changeLink} | ${summary} |`;

  // Idempotency: if ANY row containing this change's wikilink already
  // exists in the Change Log section, skip the append. Previously the
  // check required both date AND change link to match — which meant a
  // revert on day 1 followed by re-apply on day 2 would insert a
  // duplicate entry. Matching on the change link alone is safe because
  // each Change has a unique title/id, and a single apply should
  // produce at most one log row per Feature.
  const existingChangeLogMatch = featureContent.match(/^## Change Log\s*$/m);
  if (existingChangeLogMatch) {
    const exStart = existingChangeLogMatch.index! + existingChangeLogMatch[0].length;
    const exNextHeading = featureContent.slice(exStart).match(/^## /m);
    const exEnd = exNextHeading ? exStart + exNextHeading.index! : featureContent.length;
    const exSection = featureContent.slice(exStart, exEnd);
    // Escape the change link for use in a literal regex test
    const escapedLink = changeLink.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    const dupRegex = new RegExp(`${escapedLink}`, 'm');
    if (dupRegex.test(exSection)) {
      return featureContent; // Change already logged — skip append.
    }
  }

  let updated: string;

  // Check if ## Change Log section exists
  const changeLogMatch = featureContent.match(/^## Change Log\s*$/m);
  if (changeLogMatch) {
    // Extract the Change Log section content (bounded by next ## heading or EOF)
    const sectionStart = changeLogMatch.index! + changeLogMatch[0].length;
    const nextHeadingMatch = featureContent.slice(sectionStart).match(/^## /m);
    const sectionEnd = nextHeadingMatch
      ? sectionStart + nextHeadingMatch.index!
      : featureContent.length;
    const sectionContent = featureContent.slice(sectionStart, sectionEnd);

    // Look for table separator ONLY within this section (handle EOF without trailing newline)
    const sepMatch = sectionContent.match(/(\|[-\s|]+\|)\s*(?:\n|$)/);
    if (sepMatch) {
      // Insert after the separator row within the section
      const sepAbsPos = sectionStart + sepMatch.index! + sepMatch[0].length;
      updated = featureContent.slice(0, sepAbsPos) + newRow + '\n' + featureContent.slice(sepAbsPos);
    } else {
      // Section exists but no table — insert table + row after heading
      const tableBlock = `\n\n| Date | Change | Summary |\n|------|--------|---------|\n${newRow}\n`;
      updated = featureContent.slice(0, sectionStart) + tableBlock + featureContent.slice(sectionStart);
    }
  } else {
    // No Change Log section — insert before ## Related Notes (or at end)
    const relatedMatch = featureContent.match(/^## Related Notes\s*$/m);
    const section = `## Change Log\n\n| Date | Change | Summary |\n|------|--------|---------|\n${newRow}\n\n`;
    if (relatedMatch) {
      updated = featureContent.slice(0, relatedMatch.index!) + section + featureContent.slice(relatedMatch.index!);
    } else {
      // Ensure trailing newline before appending
      const base = featureContent.endsWith('\n') ? featureContent : featureContent + '\n';
      updated = base + '\n' + section;
    }
  }

  // Trim older entries to keep the table bounded
  return trimChangeLogSection(updated);
}

function makeResult(
  options: ApplyOptions,
  changeRecord: IndexRecord,
  overrides: Partial<ApplyResult>,
): ApplyResult {
  return {
    changeId: options.changeId,
    changeName: changeRecord.title,
    success: false,
    staleReport: { hasStaleEntries: false, staleEntries: [], cleanEntries: [], blocked: false },
    featureResults: [],
    sectionResults: [],
    postValidation: [],
    pendingAgentOps: [],
    preEditSnapshots: new Map(),
    statusTransitioned: false,
    modifiedFiles: [],
    warnings: [],
    errors: [],
    ...overrides,
  };
}
