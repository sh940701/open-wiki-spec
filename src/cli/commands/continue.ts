import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows continue`.
 */
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';

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
        const { writeFileSync, readFileSync } = await import('node:fs');

        const index = await buildIndex(vaultPath);

        const result = continueChange(index, {
          analyzeSequencing,
          parseNote,
          writeFile: (p, c) => writeFileSync(p, c, 'utf-8'),
          readFile: (p) => readFileSync(p, 'utf-8'),
        }, {
          ...(changeId ? { changeName: changeId } : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, (_key, value) =>
            value instanceof Map ? Object.fromEntries(value) : value,
          2));
        } else {
          console.log(result.summary);
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
