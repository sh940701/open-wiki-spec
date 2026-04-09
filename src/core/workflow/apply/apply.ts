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

  // Check all tasks complete
  const uncheckedTasks = parsed.tasks.filter((t) => !t.done);
  if (uncheckedTasks.length > 0) {
    throw new Error(
      `Cannot apply: ${uncheckedTasks.length} unchecked task(s) remaining. ` +
      'Complete all tasks via \'continue\' before applying.',
    );
  }

  // 2. Parse Delta Summary
  const resolveWikilink = (target: string): string | undefined => {
    // Simple lookup by title
    for (const record of index.records.values()) {
      if (record.title === target || record.id === target) {
        return record.id;
      }
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
      errors.push(`Target note "${noteKey}" not found in index`);
      continue;
    }
    const noteParsed = deps.parseNote(resolve(options.vaultRoot, noteRecord.path));
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

    // Read Feature file content for programmatic editing
    const featureContent = deps.readFile(resolvedNotePath);
    const result = applyDeltaToFeature(noteKey, resolvedNotePath, reqMap, allReqEntries, featureContent, options.changeId);
    featureResults.push(result);

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

  // When noAutoTransition is set and there are pending agent ops, skip auto-transition.
  // The agent must fill markers first, then run apply again (or verifyApply).
  const skipTransition = options.noAutoTransition && pendingAgentOps.length > 0;

  if (!options.dryRun) {
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
          pendingWrites.push({ path: featureResult.featurePath, content: featureResult.updatedContent });
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

      // Phase 2a: Write all to temp files
      const tmpPaths: string[] = [];
      let writeFailed = false;

      for (const { path, content } of pendingWrites) {
        assertInsideVault(path, options.vaultRoot);
        const tmpPath = `${path}${tmpSuffix}`;
        try {
          deps.writeFile(tmpPath, content);
          tmpPaths.push(tmpPath);
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
          // Restore any backups already made
          for (const { original, backup } of backedUpPaths) {
            try {
              deps.moveFile(backup, original);
            } catch {
              // Best-effort restore — swallow errors
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
            // Restore all backups
            for (const { original, backup } of backedUpPaths) {
              try {
                deps.moveFile(backup, original);
              } catch {
                // Best-effort restore — swallow errors
              }
            }
            // Cleanup remaining temp files (the ones not yet renamed)
            const remainingTmps = pendingWrites
              .filter((w) => !renamedPaths.includes(w.path))
              .map((w) => `${w.path}${tmpSuffix}`);
            cleanupTempFiles(remainingTmps, deps);
          } else {
            // All writes succeeded — delete backups
            for (const { backup } of backedUpPaths) {
              try {
                if (deps.deleteFile) {
                  deps.deleteFile(backup);
                }
              } catch {
                // Best-effort cleanup — swallow errors
              }
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
      return requirements.has(entry.targetName)
        ? `Requirement "${entry.targetName}" already exists (ADDED requires non-existence)`
        : null;
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
