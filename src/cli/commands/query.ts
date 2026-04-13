import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows query`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { warnOnUnsupportedSchema } from '../schema-check.js';
import { jsonEnvelope } from '../json-envelope.js';
import { queryWorkflow } from '../../core/workflow/query/query.js';
import { createQueryNote } from '../../core/workflow/query/query-note-creator.js';
import { safeWriteFile } from '../../utils/path-safety.js';

export function registerQueryCommand(program: Command): void {
  program
    .command('query <question>')
    .description('Search the vault graph and optionally create a Query note')
    .option('--json', 'Output result as JSON')
    .option('--save', 'Save the Query note to the vault if assessment recommends it')
    .action(async (question: string, opts: { json?: boolean; save?: boolean }) => {
      try {
        if (!question || question.trim().length === 0) {
          throw new Error('Question cannot be empty. Example: ows query "how does auth work?"');
        }
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const index = await buildIndex(vaultPath);
        warnOnUnsupportedSchema(index);

        const result = queryWorkflow({ question }, index);

        // Save query note if --save and assessment recommends it.
        // Duplicate guard: if a Query note in the vault already records
        // the exact same `question` in its frontmatter, skip creation and
        // surface the existing note's path instead of churning `-2, -3`
        // suffix files every time the user replays the same investigation.
        let savedPath: string | undefined;
        let duplicateOfExistingPath: string | undefined;
        if (opts.save && result.assessment.shouldCreate) {
          const normalizedQuestion = question.trim();
          // We don't index the raw `question` frontmatter field into
          // IndexRecord, so scan Query notes' raw_text for a verbatim
          // match. `createQueryNote` emits the question twice — once in
          // YAML frontmatter and once in the "Investigation: <q>" body
          // line — so this substring check is tight in practice.
          for (const record of index.records.values()) {
            if (record.type !== 'query') continue;
            if (record.raw_text.includes(`question: ${normalizedQuestion}`) ||
                record.raw_text.includes(`Investigation: ${normalizedQuestion}`)) {
              duplicateOfExistingPath = record.path;
              break;
            }
          }
        }
        if (duplicateOfExistingPath) {
          if (opts.json) {
            console.log(
              jsonEnvelope('query', { ...result, savedPath: duplicateOfExistingPath, duplicateSkipped: true }),
            );
          } else {
            console.log(result.contextDocument);
            console.log();
            console.log(
              `Skipped save: a Query note with the same question already exists at ${duplicateOfExistingPath}`,
            );
          }
          return;
        }
        if (opts.save && result.assessment.shouldCreate) {
          // Bucket the retrieval candidates by note type so the saved Query
          // note can reference them via structured frontmatter fields, making
          // it discoverable in subsequent graph queries.
          const relatedFeatures: string[] = [];
          const relatedSystems: string[] = [];
          const relatedChanges: string[] = [];
          const relatedDecisions: string[] = [];
          const relatedSources: string[] = [];
          for (const c of result.searchResult.candidates) {
            const record = index.records.get(c.id);
            if (!record) continue;
            const wikilink = `[[${record.title}]]`;
            switch (record.type) {
              case 'feature': relatedFeatures.push(wikilink); break;
              case 'system': relatedSystems.push(wikilink); break;
              case 'change': relatedChanges.push(wikilink); break;
              case 'decision': relatedDecisions.push(wikilink); break;
              case 'source': relatedSources.push(wikilink); break;
              case 'query': /* skip — don't recurse queries referencing queries */ break;
              default:
                // Log unexpected types so schema changes are visible at query time
                if (process.env.OWS_VERBOSE === '1' || process.env.OWS_DEBUG === '1') {
                  process.stderr.write(
                    `[ows query] Warning: unexpected note type "${record.type}" for candidate "${c.id}", skipped in Query note bucketing.\n`,
                  );
                }
                break;
            }
          }

          const note = createQueryNote({
            question,
            title: question.slice(0, 80),
            context: result.contextDocument,
            findings: result.searchResult.candidates.map((c) => `- ${c.title} (${c.id})`).join('\n'),
            conclusion: result.assessment.reasons.join('; '),
            consultedNotes: result.searchResult.candidates.map((c) => c.title),
            relatedFeatures: relatedFeatures.length > 0 ? relatedFeatures : undefined,
            relatedSystems: relatedSystems.length > 0 ? relatedSystems : undefined,
            relatedChanges: relatedChanges.length > 0 ? relatedChanges : undefined,
            relatedDecisions: relatedDecisions.length > 0 ? relatedDecisions : undefined,
            relatedSources: relatedSources.length > 0 ? relatedSources : undefined,
          });
          let notePath = path.join(vaultPath, note.path);
          const noteDir = path.dirname(notePath);
          if (!fs.existsSync(noteDir)) {
            fs.mkdirSync(noteDir, { recursive: true });
          }
          // Deduplicate filename if already exists
          if (fs.existsSync(notePath)) {
            const ext = path.extname(notePath);
            const base = notePath.slice(0, -ext.length);
            let suffix = 2;
            while (fs.existsSync(`${base}-${suffix}${ext}`)) {
              suffix++;
            }
            notePath = `${base}-${suffix}${ext}`;
            savedPath = note.path.replace(ext, `-${suffix}${ext}`);
          }
          safeWriteFile(notePath, note.content, vaultPath);
          if (!savedPath) {
            savedPath = note.path;
          }
        }

        if (opts.json) {
          const output = savedPath ? { ...result, savedPath } : result;
          console.log(jsonEnvelope('query', output));
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
