import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows apply`.
 */
import * as path from 'node:path';
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { appendLogEntry } from '../init/meta-files.js';

export function registerApplyCommand(program: Command): void {
  program
    .command('apply <changeId>')
    .description('Apply a Change to canonical Feature notes')
    .option('--json', 'Output result as JSON')
    .option('--dry-run', 'Validate without writing')
    .option('--force-stale', 'Apply even with stale base fingerprints')
    .option('--no-auto-transition', 'Do not auto-transition to applied when pending agent ops exist')
    .option('--no-log', 'Skip appending to log.md (useful for CI/team workflows)')
    .action(async (changeId: string, opts: { json?: boolean; dryRun?: boolean; forceStale?: boolean; autoTransition?: boolean; log?: boolean }) => {
      try {
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const { parseNote } = await import('../../core/parser/index.js');
        const { applyChange } = await import('../../core/workflow/apply/index.js');
        const { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } = await import('node:fs');
        const { dirname } = await import('node:path');

        const index = await buildIndex(vaultPath);

        const result = applyChange({
          changeId,
          vaultRoot: vaultPath,
          dryRun: opts.dryRun,
          forceStale: opts.forceStale,
          noAutoTransition: opts.autoTransition === false,
        }, index, {
          parseNote,
          writeFile: (p, c) => writeFileSync(p, c, 'utf-8'),
          readFile: (p) => readFileSync(p, 'utf-8'),
          fileExists: (p) => existsSync(p),
          moveFile: (from, to) => renameSync(from, to),
          ensureDir: (d) => mkdirSync(d, { recursive: true }),
          deleteFile: (p) => unlinkSync(p),
        });

        const skipLog = opts.log === false || process.env.OWS_NO_LOG === '1';
        if (result.statusTransitioned && !skipLog) {
          appendLogEntry(path.join(vaultPath, 'wiki'), 'apply', changeId);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, (_key, value) =>
            value instanceof Map ? Object.fromEntries(value) : value,
          2));
        } else {
          if (opts.dryRun) {
            console.log(`[dry-run] Change "${changeId}" validated.`);
            for (const fr of result.featureResults) {
              if (fr.requiresWrite && fr.updatedContent) {
                console.log(`  Would modify: ${fr.featurePath}`);
              }
            }
          } else if (result.success) {
            console.log(`Change "${changeId}" applied successfully.`);
            if (result.modifiedFiles && result.modifiedFiles.length > 0) {
              for (const f of result.modifiedFiles) {
                console.log(`  Modified: ${f}`);
              }
            }
          } else {
            console.log(`Change "${changeId}" could not be applied.`);
            for (const err of result.errors) {
              console.log(`  - ${err}`);
            }
          }
        }

        if (!opts.dryRun && !result.success) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
