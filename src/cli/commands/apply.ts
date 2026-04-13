import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows apply`.
 */
import * as path from 'node:path';
import * as nodeFs from 'node:fs';
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { warnOnUnsupportedSchema } from '../schema-check.js';
import { jsonEnvelope } from '../json-envelope.js';
import { appendLogEntry } from '../init/meta-files.js';

export function registerApplyCommand(program: Command): void {
  program
    .command('apply <changeId>')
    .description('Apply a Change to canonical Feature notes')
    .option('--json', 'Output result as JSON')
    .option('--dry-run', 'Validate without writing')
    .option('--force-stale', 'Apply even with stale base fingerprints')
    .option('--no-auto-transition', 'Do not auto-transition to applied when pending agent ops exist')
    .option('--no-log', 'Skip appending to log.md (useful for CI/team workflows)')
    .action(async (changeId: string, opts: { json?: boolean; dryRun?: boolean; forceStale?: boolean; autoTransition?: boolean; log?: boolean }) => {
      // Install signal handlers so Ctrl+C leaves a clear message and exits
      // with the expected code. We also make a best-effort attempt to
      // delete the lock file owned by THIS process — without it, the user
      // would see "another apply operation is in progress" until the 5-
      // minute stale TTL expires, which is a terrible interrupted-run
      // experience. The lock stores `pid: process.pid`, and acquireLock's
      // dead-pid recovery handles real races, so deleting only our own
      // lock is safe.
      const interrupt = (sig: string) => {
        try {
          const vaultPath = discoverVaultPath();
          const lockPath = path.join(vaultPath, 'wiki', '.ows-lock');
          if (nodeFs.existsSync(lockPath)) {
            const content = nodeFs.readFileSync(lockPath, 'utf-8');
            const parsed = JSON.parse(content) as { pid?: number };
            if (parsed.pid === process.pid) {
              nodeFs.unlinkSync(lockPath);
              process.stderr.write(`\n[ows apply] ${sig} received. Released own lock at ${lockPath}. Next apply will auto-recover backup/temp files.\n`);
            } else {
              process.stderr.write(`\n[ows apply] ${sig} received. Lock belongs to pid ${parsed.pid}, not ours — left in place.\n`);
            }
          } else {
            process.stderr.write(`\n[ows apply] ${sig} received. No lock held.\n`);
          }
        } catch {
          process.stderr.write(`\n[ows apply] ${sig} received. Best-effort lock cleanup failed; next apply will auto-recover.\n`);
        }
        process.exit(130);
      };
      process.once('SIGINT', () => interrupt('SIGINT'));
      process.once('SIGTERM', () => interrupt('SIGTERM'));

      try {
        if (!changeId || changeId.trim().length === 0) {
          throw new Error('Change ID cannot be empty. Use `ows list --json` to see active changes.');
        }
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const { parseNote } = await import('../../core/parser/index.js');
        const { applyChange } = await import('../../core/workflow/apply/index.js');
        const { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync, copyFileSync, statSync, chmodSync } = await import('node:fs');
        const { dirname } = await import('node:path');

        const index = await buildIndex(vaultPath);
        warnOnUnsupportedSchema(index);

        const result = applyChange({
          changeId,
          vaultRoot: vaultPath,
          dryRun: opts.dryRun,
          forceStale: opts.forceStale,
          noAutoTransition: opts.autoTransition === false,
        }, index, {
          parseNote,
          writeFile: (p, c) => writeFileSync(p, c, 'utf-8'),
          readFile: (p) => readFileSync(p, 'utf-8'),
          fileExists: (p) => existsSync(p),
          // renameSync fails with EXDEV when `from` and `to` are on
          // different mount points — common under Docker bind mounts,
          // network shares, and /tmp on some Linux distributions. Fall
          // back to copy+unlink so apply stays robust in those envs.
          // The copy path is not atomic, but we already recover via
          // backup files on failure, so a partial copy is no worse than
          // a partial rename in practice.
          moveFile: (from, to) => {
            try {
              renameSync(from, to);
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
              // Cross-device fallback
              copyFileSync(from, to);
              try { unlinkSync(from); } catch { /* leave stale from; not fatal */ }
            }
          },
          ensureDir: (d) => mkdirSync(d, { recursive: true }),
          deleteFile: (p) => unlinkSync(p),
          // Copy the original Feature file's POSIX mode to the freshly
          // written temp file so the final (post-rename) file inherits
          // the same permissions. If the source doesn't exist (new
          // Feature being created by this apply), silently skip.
          copyFileMode: (source, target) => {
            if (!existsSync(source)) return;
            const mode = statSync(source).mode & 0o7777;
            chmodSync(target, mode);
          },
        });

        const skipLog = opts.log === false || process.env.OWS_NO_LOG === '1';
        if (result.statusTransitioned && !skipLog) {
          appendLogEntry(path.join(vaultPath, 'wiki'), 'apply', changeId);
        }

        if (opts.json) {
          console.log(jsonEnvelope('apply', result));
        } else {
          if (opts.dryRun) {
            console.log(`[dry-run] Change "${changeId}" validated.`);
            for (const fr of result.featureResults) {
              if (fr.requiresWrite && fr.updatedContent) {
                console.log(`  Would modify: ${fr.featurePath}`);
              }
            }
          } else if (result.success) {
            console.log(`Change "${changeId}" applied successfully.`);
            if (result.modifiedFiles && result.modifiedFiles.length > 0) {
              for (const f of result.modifiedFiles) {
                console.log(`  Modified: ${f}`);
              }
            }
            // Surface warnings in human output (previously only in JSON)
            if (result.warnings && result.warnings.length > 0) {
              for (const w of result.warnings) {
                console.log(`  Warning: ${w}`);
              }
            }
            if (result.pendingAgentOps && result.pendingAgentOps.length > 0) {
              console.log('');
              console.log(`  ${result.pendingAgentOps.length} marker(s) still need content — fill them then re-run apply.`);
            }
            // Lifecycle handoff: guide user to the next step
            if (result.statusTransitioned) {
              console.log(`  Next: ows verify ${changeId} && ows archive ${changeId}`);
            }
          } else {
            console.log(`Change "${changeId}" could not be applied.`);
            for (const err of result.errors) {
              console.log(`  - ${err}`);
            }
            // Surface warnings alongside errors for context
            if (result.warnings && result.warnings.length > 0) {
              for (const w of result.warnings) {
                console.log(`  Warning: ${w}`);
              }
            }
          }
        }

        if (!result.success) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}
