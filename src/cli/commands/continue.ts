import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows continue`.
 */
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { warnOnUnsupportedSchema } from '../schema-check.js';
import { jsonEnvelope } from '../json-envelope.js';

export function registerContinueCommand(program: Command): void {
  program
    .command('continue [changeId]')
    .description('Continue work on an existing Change')
    .option('--json', 'Output result as JSON')
    .option('--dry-run', 'Compute next action without executing transitions')
    .action(async (changeId: string | undefined, opts: { json?: boolean; dryRun?: boolean }) => {
      try {
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const { analyzeSequencing } = await import('../../core/sequencing/index.js');
        const { parseNote } = await import('../../core/parser/index.js');
        const { continueChange } = await import('../../core/workflow/continue/index.js');
        const { writeFileSync, readFileSync, renameSync, unlinkSync } = await import('node:fs');

        const index = await buildIndex(vaultPath);
        warnOnUnsupportedSchema(index);

        const result = continueChange(index, {
          analyzeSequencing,
          parseNote,
          writeFile: (p, c) => writeFileSync(p, c, 'utf-8'),
          readFile: (p) => readFileSync(p, 'utf-8'),
          renameFile: (from, to) => renameSync(from, to),
          deleteFile: (p) => unlinkSync(p),
        }, {
          ...(changeId ? { changeName: changeId } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
        });

        if (opts.json) {
          console.log(jsonEnvelope('continue', result));
        } else {
          console.log(result.summary);
        }

        // Exit code policy: mirror propose's `asked_user → 1` pattern.
        // A `blocked` action means the change can't proceed without
        // external resolution (unresolved depends_on). CI pipelines
        // that run `ows continue` as a gate need exitCode=1 to detect
        // this — otherwise a blocked change silently looks like success.
        if (result.nextAction.action === 'blocked') {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
