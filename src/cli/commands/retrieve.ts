import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows retrieve`.
 * Standalone retrieval scan — thin wrapper around propose --dry-run.
 */
import type { Command } from 'commander';
import { jsonEnvelope } from '../json-envelope.js';

export function registerRetrieveCommand(program: Command): void {
  program
    .command('retrieve <description>')
    .description('Run a standalone retrieval scan against the vault graph (read-only)')
    .option('--json', 'Output result as JSON')
    .option('--keywords <list>', 'Comma-separated keywords to override automatic term extraction')
    .action(async (description: string, opts: { json?: boolean; keywords?: string }) => {
      try {
        if (!description || description.trim().length === 0) {
          throw new Error('Description cannot be empty. Example: ows retrieve "auth login"');
        }
        const { discoverVaultPath } = await import('../vault-discovery.js');
        const { buildIndex } = await import('../../core/index/index.js');
        const { retrieve } = await import('../../core/retrieval/index.js');
        const { analyzeSequencing } = await import('../../core/sequencing/index.js');
        const { parseNote } = await import('../../core/parser/index.js');
        const { propose } = await import('../../core/workflow/propose/index.js');
        const { readFileSync } = await import('node:fs');

        const vaultPath = discoverVaultPath();
        const keywordsArr = opts.keywords
          ? opts.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
          : undefined;

        const result = await propose(description, {
          vaultRoot: vaultPath,
          dryRun: true,
          keywords: keywordsArr,
        }, {
          buildIndex,
          retrieve,
          analyzeSequencing,
          parseNote: (filePath: string) => parseNote(filePath),
          readFile: (filePath: string) => readFileSync(filePath, 'utf-8'),
          writeFile: () => { /* dry-run: no writes */ },
        });

        if (opts.json) {
          console.log(jsonEnvelope('retrieve', result));
        } else {
          const cls = result.classification;
          console.log(`Classification: ${cls.classification} (confidence: ${cls.confidence})`);
          console.log();

          if (result.retrieval.candidates.length === 0) {
            console.log('No candidates found.');
          } else {
            console.log('Candidates:');
            for (const c of result.retrieval.candidates.slice(0, 10)) {
              console.log(`  ${c.score.toString().padStart(3)} | ${c.type.padEnd(8)} | ${c.title}`);
              for (const r of c.reasons) {
                console.log(`        ${r}`);
              }
            }
          }

          console.log();
          if (result.sequencing_warnings.length > 0) {
            console.log('Sequencing warnings:');
            for (const w of result.sequencing_warnings) {
              console.log(`  - ${w}`);
            }
          }
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
