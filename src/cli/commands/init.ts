import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows init`.
 */
import type { Command } from 'commander';
import { initVault } from '../init/init-engine.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init [path]')
    .description('Initialize a new open-wiki-spec vault')
    .option('--force', 'Force re-initialization, recreating meta files')
    .option('--skip-seed', 'Skip creating seed notes')
    .option('--json', 'Output result as JSON')
    .action(async (targetPath: string | undefined, opts: { force?: boolean; skipSeed?: boolean; json?: boolean }) => {
      try {
        const result = await initVault({ path: targetPath, force: opts.force, skipSeed: opts.skipSeed });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.mode === 'fresh') {
            console.log(`Vault initialized at ${result.wikiPath}`);
          } else {
            console.log(`Vault extended at ${result.wikiPath}`);
          }
          console.log(`  Directories: ${result.directoriesCreated.length} created`);
          console.log(`  Meta files: ${result.metaFilesCreated.length} created`);
          console.log(`  Seed notes: ${result.seedFilesCreated.length} created`);
          console.log(`  Skill files: ${result.skillFilesGenerated.length} generated`);
          if (result.warnings.length > 0) {
            for (const w of result.warnings) console.log(`  Warning: ${w}`);
          }
          if (result.mode === 'fresh') {
            console.log('');
            console.log('Next steps:');
            console.log('  1. Edit wiki/01-sources/seed-context.md with your project description');
            console.log('  2. Edit wiki/02-systems/default-system.md with your system boundaries');
            console.log('  3. Run `ows propose` to create your first feature note');
          }
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
