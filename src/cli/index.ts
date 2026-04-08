/**
 * CLI entry point - Commander program definition.
 */
import { Command } from 'commander';
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

export function createProgram(): Command {
  const program = new Command();

  program
    .name('ows')
    .description('open-wiki-spec: Obsidian-first wiki workflow engine')
    .version('0.1.0');

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
  registerMigrateCommand(program);

  return program;
}

// Always parse when imported as CLI entry point (bin/open-wiki-spec.js imports this file)
const program = createProgram();
program.parse(process.argv);
