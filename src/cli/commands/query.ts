import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows query`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { queryWorkflow } from '../../core/workflow/query/query.js';
import { createQueryNote } from '../../core/workflow/query/query-note-creator.js';

export function registerQueryCommand(program: Command): void {
  program
    .command('query <question>')
    .description('Search the vault graph and optionally create a Query note')
    .option('--json', 'Output result as JSON')
    .option('--save', 'Save the Query note to the vault if assessment recommends it')
    .action(async (question: string, opts: { json?: boolean; save?: boolean }) => {
      try {
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const index = await buildIndex(vaultPath);

        const result = queryWorkflow({ question }, index);

        // Save query note if --save and assessment recommends it
        let savedPath: string | undefined;
        if (opts.save && result.assessment.shouldCreate) {
          const note = createQueryNote({
            question,
            title: question.slice(0, 80),
            context: result.contextDocument,
            findings: result.searchResult.candidates.map((c) => `- ${c.title} (${c.id})`).join('\n'),
            conclusion: result.assessment.reasons.join('; '),
            consultedNotes: result.searchResult.candidates.map((c) => c.title),
          });
          const notePath = path.join(vaultPath, note.path);
          const noteDir = path.dirname(notePath);
          if (!fs.existsSync(noteDir)) {
            fs.mkdirSync(noteDir, { recursive: true });
          }
          fs.writeFileSync(notePath, note.content, 'utf-8');
          savedPath = note.path;
        }

        if (opts.json) {
          const output = savedPath ? { ...result, savedPath } : result;
          console.log(JSON.stringify(output, null, 2));
        } else {
          console.log(result.contextDocument);
          console.log();
          if (result.assessment.shouldCreate) {
            console.log(`Recommendation: Create a Query note (confidence: ${result.assessment.confidence})`);
          } else {
            console.log(`Recommendation: No Query note needed (confidence: ${result.assessment.confidence})`);
          }
          for (const reason of result.assessment.reasons) {
            console.log(`  - ${reason}`);
          }
          if (savedPath) {
            console.log(`\nQuery note saved: ${savedPath}`);
          }
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
