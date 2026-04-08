import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows verify`.
 */
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { verify } from '../../core/workflow/verify/verify.js';
import { formatVerifyReport } from './formatters.js';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify [changeId]')
    .description('Verify vault consistency')
    .option('--json', 'Output result as JSON')
    .option('--strict', 'Treat warnings as errors')
    .action(async (changeId: string | undefined, opts: { json?: boolean; strict?: boolean }) => {
      try {
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const index = await buildIndex(vaultPath);

        // Validate changeId if provided
        if (changeId && !index.records.has(changeId)) {
          throw new Error(`Change "${changeId}" not found in vault index.`);
        }

        const report = verify(index, { changeId, strict: opts.strict });

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatVerifyReport(report));
        }

        if (!report.pass) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
