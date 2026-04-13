import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows verify`.
 */
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { verify } from '../../core/workflow/verify/verify.js';
import { jsonEnvelope } from '../json-envelope.js';
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

        // Empty-vault notice: generic PASS on an empty vault hides the
        // fact that the user hasn't written anything yet. Surface a
        // one-line hint in human output so fresh `ows init` vaults get
        // a "nothing to verify — start with ows propose" nudge instead
        // of a silently-green report. JSON output is untouched so
        // automation still sees a valid report envelope.
        const isEmptyVault = index.records.size === 0;
        if (opts.json) {
          console.log(jsonEnvelope('verify', report));
        } else {
          console.log(formatVerifyReport(report));
          if (isEmptyVault) {
            console.log(
              '\nNote: vault has no typed notes yet. Run `ows propose "<first change>"` to create one.',
            );
          }
        }

        if (!report.pass) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
