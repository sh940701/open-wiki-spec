import { handleCliError } from "./error-handler.js";
/**
 * Archive command: moves applied Changes to 99-archive/.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VaultIndex } from '../../types/index.js';
import { verify } from '../../core/workflow/verify/verify.js';
import { appendLogEntry } from '../init/meta-files.js';
import { assertInsideVault } from '../../utils/path-safety.js';

export interface ArchiveResult {
  changeId: string;
  oldPath: string;
  newPath: string;
  verifyPassed: boolean;
  warnings: string[];
}

/**
 * Archive an applied change.
 * Moves the file from 04-changes/ to 99-archive/ and appends to log.md.
 */
export function archiveChange(
  changeId: string,
  index: VaultIndex,
  vaultPath: string,
  options?: { force?: boolean; noLog?: boolean },
): ArchiveResult {
  const change = index.records.get(changeId);
  if (!change) {
    throw new Error(`Change "${changeId}" not found in the vault index.`);
  }

  // Prevent re-archiving: refuse if the change is already in 99-archive/
  if (change.path.startsWith('wiki/99-archive/')) {
    throw new Error(
      `Change "${changeId}" is already archived at "${change.path}". ` +
      `Archiving again would be a no-op.`,
    );
  }

  const warnings: string[] = [];

  if (change.status !== 'applied') {
    if (!options?.force) {
      throw new Error(
        `Only applied changes can be archived. "${changeId}" has status "${change.status}". ` +
        `Use --force to archive a non-applied change.`,
      );
    }
    warnings.push(`Archived with status "${change.status}" (not applied). Use with caution.`);
  }

  // Run verify to confirm cleanly applied
  const verifyResult = verify(index, { changeId });

  if (!verifyResult.pass) {
    if (!options?.force) {
      const errorIssues = verifyResult.issues.filter((i) => i.severity === 'error');
      const top3 = errorIssues.slice(0, 3).map((i) => `  - [${i.code}] ${i.message}`).join('\n');
      const more = errorIssues.length > 3 ? `\n  ... and ${errorIssues.length - 3} more` : '';
      throw new Error(
        `Verify found ${errorIssues.length} error(s) for change "${changeId}":\n${top3}${more}\n\nFix the issues above or use --force to archive anyway.`,
      );
    }
    warnings.push(`Archived despite ${verifyResult.issues.length} verify issue(s).`);
  }

  // Move the file
  const oldRelPath = change.path;
  const fileName = path.basename(oldRelPath);
  const newRelPath = `wiki/99-archive/${fileName}`;

  // Resolve to absolute paths using vaultPath (project root)
  const oldAbsPath = path.join(vaultPath, oldRelPath);
  const newAbsPath = path.join(vaultPath, newRelPath);
  assertInsideVault(oldAbsPath, vaultPath);
  assertInsideVault(newAbsPath, vaultPath);

  // Ensure 99-archive/ exists
  fs.mkdirSync(path.join(vaultPath, 'wiki', '99-archive'), { recursive: true });
  fs.renameSync(oldAbsPath, newAbsPath);

  // Append to log.md (appendLogEntry expects the wiki directory)
  const skipLog = options?.noLog || process.env.OWS_NO_LOG === '1';
  if (!skipLog) {
    appendLogEntry(path.join(vaultPath, 'wiki'), 'archive', changeId);
  }

  return {
    changeId,
    oldPath: oldRelPath,
    newPath: newRelPath,
    verifyPassed: verifyResult.pass,
    warnings,
  };
}


/**
 * Register the archive command with Commander.
 */
export function registerArchiveCommand(program: import('commander').Command): void {
  program
    .command('archive <changeId>')
    .description('Archive an applied Change to 99-archive/')
    .option('--json', 'Output result as JSON')
    .option('--force', 'Archive even if verify finds errors')
    .option('--no-log', 'Skip appending to log.md (useful for CI/team workflows)')
    .action(async (changeId: string, opts: { json?: boolean; force?: boolean; log?: boolean }) => {
      try {
        const { discoverVaultPath } = await import('../vault-discovery.js');
        const { buildIndex } = await import('../../core/index/index.js');
        const { warnOnUnsupportedSchema } = await import('../schema-check.js');
        const { jsonEnvelope } = await import('../json-envelope.js');
        const vaultPath = discoverVaultPath();
        const index = await buildIndex(vaultPath);
        warnOnUnsupportedSchema(index);

        const noLog = opts.log === false || process.env.OWS_NO_LOG === '1';
        const result = archiveChange(changeId, index, vaultPath, { force: opts.force, noLog });

        if (opts.json) {
          console.log(jsonEnvelope('archive', result));
        } else {
          console.log(`Archived change "${changeId}"`);
          console.log(`  From: ${result.oldPath}`);
          console.log(`  To:   ${result.newPath}`);
          if (!result.verifyPassed) {
            console.log(`  Warning: verify did not pass.`);
          }
          for (const w of result.warnings) {
            console.log(`  Warning: ${w}`);
          }
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
