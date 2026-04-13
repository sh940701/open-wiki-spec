/**
 * CLI entry point - Commander program definition.
 */
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { registerInitCommand } from './commands/init.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerQueryCommand } from './commands/query.js';
import { registerProposeCommand } from './commands/propose.js';
import { registerContinueCommand } from './commands/continue.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerStatusCommand } from './commands/status.js';
import { registerListCommand } from './commands/list.js';
import { registerArchiveCommand } from './commands/archive.js';
import { registerMigrateCommand } from './commands/migrate.js';
import { registerRetrieveCommand } from './commands/retrieve.js';
import { registerBulkArchiveCommand } from './commands/bulk-archive.js';
import { registerRevertCommand } from './commands/revert.js';
import { CURRENT_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from '../core/index/schema-version.js';

export function createProgram(): Command {
  const program = new Command();

  // Version string includes both package version and vault schema version so
  // users can see at a glance whether a release bumped schema compatibility.
  const pkgVersion = getPackageVersion();
  const versionString = `${pkgVersion} (vault schema: ${CURRENT_SCHEMA_VERSION}, supports: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')})`;

  program
    .name('ows')
    .description('open-wiki-spec: Obsidian-first wiki workflow engine')
    .version(versionString)
    .option('--verbose', 'Enable verbose logging (sets OWS_VERBOSE=1)')
    .option('--debug', 'Enable debug logging (sets OWS_DEBUG=1, implies --verbose)')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      if (opts.debug) {
        process.env.OWS_DEBUG = '1';
        process.env.OWS_VERBOSE = '1';
      } else if (opts.verbose) {
        process.env.OWS_VERBOSE = '1';
      }
    });

  // Register all commands
  registerInitCommand(program);
  registerProposeCommand(program);
  registerContinueCommand(program);
  registerApplyCommand(program);
  registerVerifyCommand(program);
  registerQueryCommand(program);
  registerStatusCommand(program);
  registerListCommand(program);
  registerArchiveCommand(program);
  registerRetrieveCommand(program);
  registerBulkArchiveCommand(program);
  registerRevertCommand(program);
  registerMigrateCommand(program);

  return program;
}

function getPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

// Always parse when imported as CLI entry point (bin/open-wiki-spec.js imports this file)
const program = createProgram();

// Catch Commander parse errors (missing args, unknown options, invalid values)
// and format as JSON if --json is present, with exit code 2 (as documented in
// README).
//
// Commander 12's `exitOverride()` does NOT propagate from parent to
// subcommands automatically — each subcommand's `_exitCallback` must be set
// individually. Without this, a missing-argument error on a subcommand
// (e.g. `ows propose --json` without description) would bypass our handler
// and exit with code 1 + plain stderr. Apply exitOverride to every command
// in the tree.
function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) {
    applyExitOverride(sub);
  }
}
applyExitOverride(program);

try {
  program.parse(process.argv);
} catch (err: unknown) {
  const isJson = process.argv.includes('--json');
  if (isJson) {
    console.log(JSON.stringify({
      error: true,
      code: 'COMMANDER_ERROR',
      message: (err as Error).message,
    }));
  }
  // Usage errors (missing args, unknown options, invalid values) → exit 2
  // Other runtime errors bubble up and exit with 1 via handleCliError.
  process.exitCode = 2;
}
