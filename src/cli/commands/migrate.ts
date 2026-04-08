import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows migrate`.
 */
import type { Command } from 'commander';
import { migrate, planMigration } from '../../core/migrate/migrate.js';
import type { MigrateOptions, MigrationPlan, MigrationResult } from '../../core/migrate/types.js';

export function registerMigrateCommand(program: Command): void {
  program
    .command('migrate [openspec-dir]')
    .description('Migrate an existing OpenSpec project to open-wiki-spec format')
    .option('--dry-run', 'Show what would be migrated without writing files')
    .option('--json', 'Output result as JSON')
    .option('--skip-archive', 'Skip migrating archived changes')
    .action(async (openspecDir: string | undefined, opts: {
      dryRun?: boolean;
      json?: boolean;
      skipArchive?: boolean;
    }) => {
      try {
        const options: MigrateOptions = {
          openspecDir,
          dryRun: opts.dryRun,
          skipArchive: opts.skipArchive,
          json: opts.json,
        };

        if (opts.dryRun) {
          const plan = planMigration(options);
          if (opts.json) {
            console.log(JSON.stringify(plan, null, 2));
          } else {
            printPlan(plan);
          }
        } else {
          const result = await migrate(options);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printResult(result);
          }
          if (result.errors.length > 0) {
            process.exitCode = 1;
          }
        }
      } catch (err: unknown) {
        if (opts.json) {
          console.log(JSON.stringify({ error: (err as Error).message }));
        } else {
          handleCliError(err, opts.json);
        }
        process.exitCode = 1;
      }
    });
}

function printPlan(plan: MigrationPlan): void {
  console.log('Migration Plan (dry run)');
  console.log('========================');
  console.log(`  Source: ${plan.openspecPath}`);
  console.log(`  Target: ${plan.wikiPath}`);
  console.log();

  for (const step of plan.steps) {
    console.log(`Step: ${step.name}`);
    console.log(`  ${step.description}`);
    if (step.outputs.length > 0) {
      console.log(`  Files to create:`);
      for (const output of step.outputs) {
        console.log(`    - ${output.targetPath} (from ${output.sourceDescription})`);
      }
    }
    if (step.warnings.length > 0) {
      for (const w of step.warnings) {
        console.log(`  Warning: ${w}`);
      }
    }
    console.log();
  }

  console.log(`Total: ${plan.totalFiles} files, ${plan.totalWarnings} warnings`);
}

function printResult(result: MigrationResult): void {
  console.log('Migration Complete');
  console.log('==================');

  if (result.filesWritten.length > 0) {
    console.log(`  Files written: ${result.filesWritten.length}`);
    for (const f of result.filesWritten) {
      console.log(`    + ${f}`);
    }
  }

  if (result.filesSkipped.length > 0) {
    console.log(`  Files skipped (already exist): ${result.filesSkipped.length}`);
    for (const f of result.filesSkipped) {
      console.log(`    ~ ${f}`);
    }
  }

  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    for (const e of result.errors) {
      console.log(`    ! ${e}`);
    }
  }

  // Print warnings from plan
  const totalWarnings = result.plan.steps.reduce((sum, s) => sum + s.warnings.length, 0);
  if (totalWarnings > 0) {
    console.log(`  Warnings: ${totalWarnings}`);
    for (const step of result.plan.steps) {
      for (const w of step.warnings) {
        console.log(`    ? ${w}`);
      }
    }
  }
}
