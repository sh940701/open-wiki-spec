import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows propose`.
 * Thin wrapper around the propose workflow.
 */
import * as path from 'node:path';
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { warnOnUnsupportedSchema } from '../schema-check.js';
import { jsonEnvelope } from '../json-envelope.js';
import { appendLogEntry } from '../init/meta-files.js';

export function registerProposeCommand(program: Command): void {
  program
    .command('propose <description>')
    .description('Propose a new change to the codebase wiki')
    .option('--json', 'Output result as JSON')
    .option('--dry-run', 'Show what would happen without writing files')
    .option('--force-classification <type>', 'Override classification (existing_change, existing_feature, new_feature)')
    .option('--force-target <id>', 'Use a specific candidate id (requires --force-classification)')
    .option('--keywords <list>', 'Comma-separated keywords to override automatic term extraction')
    .option('--confirm', 'Confirm note creation when classification is needs_confirmation')
    .option('--no-log', 'Skip appending to log.md (useful for CI/team workflows)')
    .action(async (description: string, opts: { json?: boolean; dryRun?: boolean; forceClassification?: string; forceTarget?: string; keywords?: string; confirm?: boolean; log?: boolean }) => {
      try {
        if (!description || description.trim().length === 0) {
          throw new Error('Description cannot be empty. Example: ows propose "Add passkey login support"');
        }
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const { retrieve } = await import('../../core/retrieval/index.js');
        const { analyzeSequencing } = await import('../../core/sequencing/index.js');
        const { parseNote } = await import('../../core/parser/index.js');
        const { propose } = await import('../../core/workflow/propose/index.js');
        const { writeFileSync, readFileSync, openSync, writeSync, closeSync } = await import('node:fs');

        const validClassifications = ['existing_change', 'existing_feature', 'new_feature'] as const;
        type ValidClassification = typeof validClassifications[number];
        let forceClassification: ValidClassification | undefined;
        if (opts.forceClassification) {
          if (!validClassifications.includes(opts.forceClassification as ValidClassification)) {
            throw new Error(
              `Invalid --force-classification value: "${opts.forceClassification}". ` +
              `Must be one of: ${validClassifications.join(', ')}`,
            );
          }
          forceClassification = opts.forceClassification as ValidClassification;
        }

        if (opts.forceTarget && !opts.forceClassification) {
          throw new Error('--force-target requires --force-classification');
        }

        const keywords = opts.keywords
          ? opts.keywords.split(',').map((k) => k.trim()).filter(Boolean)
          : undefined;

        const result = await propose(description, {
          vaultRoot: vaultPath,
          dryRun: opts.dryRun,
          forceClassification,
          forceTargetId: opts.forceTarget,
          keywords,
          confirm: opts.confirm,
        }, {
          // Wrap buildIndex so the schema-version compatibility warning fires
          // once per invocation even though propose() builds the index inside
          // its own workflow. The latch inside warnOnUnsupportedSchema keeps
          // repeated calls silent.
          buildIndex: (root) => {
            const idx = buildIndex(root);
            warnOnUnsupportedSchema(idx);
            return idx;
          },
          retrieve,
          analyzeSequencing,
          parseNote,
          writeFile: (p, c) => writeFileSync(p, c, 'utf-8'),
          readFile: (p) => readFileSync(p, 'utf-8'),
          // Atomic exclusive create via O_CREAT|O_EXCL ('wx' flag) to prevent
          // concurrent propose races when both pick new_feature for the same slug.
          exclusiveCreateFile: (p, c) => {
            const fd = openSync(p, 'wx');
            try {
              writeSync(fd, c);
            } finally {
              closeSync(fd);
            }
          },
        });

        const skipLog = opts.log === false || process.env.OWS_NO_LOG === '1';
        if (result.target_change && !skipLog) {
          appendLogEntry(path.join(vaultPath, 'wiki'), 'propose', result.target_change.id);
        }

        if (opts.json) {
          console.log(jsonEnvelope('propose', result));
        } else {
          // Branch human output on action so CI logs aren't misleading.
          // Previously every run started with "Propose workflow
          // completed." — even an `asked_user` result that created
          // nothing and exited with code 1. That made `ows propose`
          // failures look like successes in CI dashboards.
          if (result.action === 'asked_user') {
            console.log('Propose workflow needs user confirmation.');
            const reasons = result.classification?.reasons ?? [];
            for (const r of reasons) console.log(`  Reason: ${r}`);
            console.log(
              '  Re-run with `--force-classification <existing_change|existing_feature|new_feature>` ' +
                '(optionally with `--force-target <id>` and `--confirm`) to proceed.',
            );
          } else {
            console.log('Propose workflow completed.');
            if (result.target_change) {
              console.log(`  Created change: ${result.target_change.id}`);
              console.log(`  Next: ows continue ${result.target_change.id}`);
            }
          }
        }

        if (result.action === 'asked_user') {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
