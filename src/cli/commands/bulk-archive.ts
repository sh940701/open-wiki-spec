import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows bulk-archive`.
 * Archives all applied Changes at once.
 */
import type { Command } from 'commander';
import { archiveChange } from './archive.js';
import type { ArchiveResult } from './archive.js';
import { jsonEnvelope } from '../json-envelope.js';

export interface BulkArchiveResult {
  archived: ArchiveResult[];
  skipped: { changeId: string; reason: string }[];
}

export function registerBulkArchiveCommand(program: Command): void {
  program
    .command('bulk-archive')
    .description('Archive all applied Changes at once')
    .option('--json', 'Output result as JSON')
    .option('--force', 'Archive even if verify finds errors')
    .option('--no-log', 'Skip appending to log.md')
    .action(async (opts: { json?: boolean; force?: boolean; log?: boolean }) => {
      try {
        const { discoverVaultPath } = await import('../vault-discovery.js');
        const { buildIndex } = await import('../../core/index/index.js');
        const { warnOnUnsupportedSchema } = await import('../schema-check.js');
        const fs = await import('node:fs');
        const pathMod = await import('node:path');
        const vaultPath = discoverVaultPath();

        // Lock awareness: refuse to bulk-archive while an `ows apply` is
        // in progress. bulk-archive walks every applied Change and
        // physically renames files; if apply is mid-write those files
        // can be in temp/backup names and we'd move half-written state
        // into 99-archive/. The apply lock's stale-TTL check still
        // handles crashed writers — we only block live ones.
        const lockPath = pathMod.join(vaultPath, 'wiki', '.ows-lock');
        if (fs.existsSync(lockPath)) {
          throw new Error(
            `Cannot bulk-archive while another process holds ${lockPath}. ` +
              'Another `ows apply` may be in progress. Wait for it to finish or ' +
              'delete the lock file if you have confirmed the apply crashed.',
          );
        }

        let index = await buildIndex(vaultPath);
        warnOnUnsupportedSchema(index);

        const noLog = opts.log === false || process.env.OWS_NO_LOG === '1';

        // Find all applied changes
        const appliedChanges: string[] = [];
        for (const [id, record] of index.records) {
          if (record.type === 'change' && record.status === 'applied') {
            appliedChanges.push(id);
          }
        }

        if (appliedChanges.length === 0) {
          if (opts.json) {
            console.log(jsonEnvelope('bulk-archive', { archived: [], skipped: [] }));
          } else {
            console.log('No applied changes to archive.');
          }
          return;
        }

        const result: BulkArchiveResult = { archived: [], skipped: [] };

        for (const changeId of appliedChanges) {
          try {
            const archiveResult = archiveChange(changeId, index, vaultPath, {
              force: opts.force,
              noLog,
            });
            result.archived.push(archiveResult);
            // Rebuild index so subsequent iterations see the archived state.
            // Prevents stale-index issues (e.g., re-archiving the same change,
            // or verify picking up a now-moved file).
            index = await buildIndex(vaultPath);
          } catch (err: unknown) {
            result.skipped.push({
              changeId,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (opts.json) {
          console.log(jsonEnvelope('bulk-archive', result));
        } else {
          if (result.archived.length > 0) {
            console.log(`Archived ${result.archived.length} change(s):`);
            for (const a of result.archived) {
              console.log(`  ${a.changeId}: ${a.oldPath} → ${a.newPath}`);
            }
          }
          if (result.skipped.length > 0) {
            console.log(`\nSkipped ${result.skipped.length} change(s):`);
            for (const s of result.skipped) {
              console.log(`  ${s.changeId}: ${s.reason}`);
            }
          }
        }

        // Exit with non-zero if any changes were skipped
        if (result.skipped.length > 0) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
