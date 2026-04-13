import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows revert`.
 *
 * Reverts an applied change's *status* back to `in_progress` so the user can
 * re-edit the Delta Summary / sections and re-run `ows apply`.
 *
 * Important: this does NOT undo the physical Feature note edits the apply
 * already wrote. Those changes live on disk (and, ideally, in git). Users
 * who need a full rollback should use git checkout/restore on the Feature
 * files. The revert command is a lifecycle helper, not a filesystem rewinder.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import type { VaultIndex } from '../../types/index.js';
import { discoverVaultPath } from '../vault-discovery.js';
import { warnOnUnsupportedSchema } from '../schema-check.js';
import { jsonEnvelope } from '../json-envelope.js';
import { appendLogEntry } from '../init/meta-files.js';
import { assertInsideVault } from '../../utils/path-safety.js';

export interface RevertResult {
  changeId: string;
  previousStatus: string;
  newStatus: 'in_progress';
  warnings: string[];
}

/**
 * Revert an applied change back to in_progress status.
 * Physical Feature edits are NOT undone — use git for that.
 */
export function revertChange(
  changeId: string,
  index: VaultIndex,
  vaultPath: string,
  options?: { force?: boolean; noLog?: boolean },
): RevertResult {
  const change = index.records.get(changeId);
  if (!change) {
    throw new Error(`Change "${changeId}" not found in the vault index.`);
  }

  if (change.status !== 'applied') {
    if (!options?.force) {
      throw new Error(
        `Only applied changes can be reverted. "${changeId}" has status "${change.status}". ` +
        `Use --force to revert a non-applied change.`,
      );
    }
  }

  // Reject revert of archived changes — they've been moved out of 04-changes/
  // and re-running apply on them would require manual un-archiving first.
  if (change.path.startsWith('wiki/99-archive/')) {
    throw new Error(
      `Change "${changeId}" is archived. Un-archive it manually (move the file back to wiki/04-changes/) before reverting.`,
    );
  }

  // If the change is already in_progress, revert is a no-op — don't rewrite
  // the file and don't throw a confusing "status field not found" error.
  if (change.status === 'in_progress') {
    return {
      changeId,
      previousStatus: 'in_progress',
      newStatus: 'in_progress',
      warnings: [`Change "${changeId}" is already in_progress. No change made.`],
    };
  }

  const absPath = path.resolve(vaultPath, change.path);
  assertInsideVault(absPath, vaultPath);

  const content = fs.readFileSync(absPath, 'utf-8');
  const updated = content.replace(/^(status:\s*).+$/m, '$1in_progress');
  if (updated === content) {
    throw new Error(
      `Could not find status field in "${change.path}" to revert. ` +
      `Verify the file has a "status:" line in its YAML frontmatter.`,
    );
  }

  // Atomic write
  const tmp = `${absPath}.ows-revert-${Date.now()}`;
  fs.writeFileSync(tmp, updated, 'utf-8');
  fs.renameSync(tmp, absPath);

  const skipLog = options?.noLog || process.env.OWS_NO_LOG === '1';
  if (!skipLog) {
    appendLogEntry(path.join(vaultPath, 'wiki'), 'revert', changeId);
  }

  return {
    changeId,
    previousStatus: change.status,
    newStatus: 'in_progress',
    warnings: [
      'Status reverted to in_progress. Physical Feature edits were NOT undone.',
      'If you need to restore Feature note content, use `git checkout wiki/03-features/` or similar.',
    ],
  };
}

export function registerRevertCommand(program: Command): void {
  program
    .command('revert <changeId>')
    .description('Revert an applied Change back to in_progress status (for re-editing and re-applying)')
    .option('--json', 'Output result as JSON')
    .option('--force', 'Revert even if status is not "applied"')
    .option('--no-log', 'Skip appending to log.md')
    .action(async (changeId: string, opts: { json?: boolean; force?: boolean; log?: boolean }) => {
      try {
        if (!changeId || changeId.trim().length === 0) {
          throw new Error('Change ID cannot be empty. Use `ows list --json` to find applied changes.');
        }
        const { buildIndex } = await import('../../core/index/index.js');
        const vaultPath = discoverVaultPath();
        const index = await buildIndex(vaultPath);
        warnOnUnsupportedSchema(index);

        const noLog = opts.log === false || process.env.OWS_NO_LOG === '1';
        const result = revertChange(changeId, index, vaultPath, { force: opts.force, noLog });

        if (opts.json) {
          console.log(jsonEnvelope('revert', result));
        } else {
          console.log(`Reverted change "${changeId}": ${result.previousStatus} → ${result.newStatus}`);
          for (const w of result.warnings) {
            console.log(`  ⚠ ${w}`);
          }
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
