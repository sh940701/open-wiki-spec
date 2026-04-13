/**
 * Templates for 00-meta files.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCHEMA_VERSION = '2026-04-06-v1';

/**
 * Block the current thread for `ms` milliseconds without spinning the event loop.
 * Primary path uses `Atomics.wait` on a SharedArrayBuffer. If Atomics.wait is
 * unavailable (very old Node or restricted sandbox), falls back to a blocking
 * child_process.execSync sleep which is also O(ms) wall time. Only used as a
 * last resort because it forks a subprocess.
 */
function blockingSleep(ms: number): void {
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
    return;
  } catch {
    // Fall through to child_process fallback
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    // Use `sleep` on POSIX; on Windows use `timeout` which waits in seconds.
    // We intentionally cap at one second of resolution loss to avoid fork
    // overhead dominating the delay.
    if (process.platform === 'win32') {
      execSync(`timeout /T 1 /NOBREAK > NUL`, { stdio: 'ignore' });
    } else {
      execSync(`sleep ${(ms / 1000).toFixed(3)}`, { stdio: 'ignore' });
    }
  } catch {
    // Last-resort: busy-wait as an absolute worst case. This should never
    // execute in normal Node environments.
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

/**
 * Atomic write: write to a temp file in the same directory, then rename.
 * If the process crashes mid-write, only the temp file is left behind
 * (and gets cleaned up by the next apply's recoverFromCrash()).
 */
function atomicWriteFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.ows-tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup of temp file on write/rename failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export function createSchemaFile(wikiPath: string): void {
  const content = `---
type: meta
schema_version: "${SCHEMA_VERSION}"
effective_date: "${formatDate(new Date())}"
---

# Vault Schema

## Current Version

\`${SCHEMA_VERSION}\`

## Note Types

| Type | Folder | Required Frontmatter |
|------|--------|---------------------|
| Feature | 03-features/ | type, id, status, systems |
| Change | 04-changes/ | type, id, status, feature/features, touches |
| System | 02-systems/ | type, id, status |
| Decision | 05-decisions/ | type, id, status |
| Source | 01-sources/ | type, id |
| Query | 06-queries/ | type, id, status |

## Migration Notes

- Initial schema. No migrations required.

## Deprecated Fields

- None.
`;
  atomicWriteFile(path.join(wikiPath, '00-meta', 'schema.md'), content);
}

export function createIndexFile(wikiPath: string): void {
  const content = `---
type: meta
---

# Vault Index

This file is the entry point for navigating the vault.

## Quick Links

- [[schema]] -- Vault schema version and note type contracts
- [[log]] -- Vault operation log
- [[conventions]] -- Naming and structural conventions

## Note Types

This file is a manual entry point. Use \`ows list\` for the current vault contents.

### Features

### Systems

### Active Changes

### Decisions

### Sources

### Queries
`;
  atomicWriteFile(path.join(wikiPath, '00-meta', 'index.md'), content);
}

export function createLogFile(wikiPath: string): void {
  const date = formatDate(new Date());
  const content = `---
type: meta
---

# Vault Operation Log

Chronological log of vault operations performed by \`ows\`.

| Date | Operation | Target | Agent |
|------|-----------|--------|-------|
| ${date} | init | vault | ows |
`;
  atomicWriteFile(path.join(wikiPath, '00-meta', 'log.md'), content);
}

export function createConventionsFile(wikiPath: string): void {
  const content = `---
type: meta
---

# Vault Conventions

## File Naming

- Use kebab-case for all filenames: \`auth-login.md\`, not \`Auth Login.md\`.
- Prefix is not required in filenames (the folder provides context).
- Note title (H1) should include the type prefix: \`# Feature: Auth Login\`.

## Frontmatter Rules

- \`id\` is immutable after creation. Never change it.
- \`status\` should follow the allowed lifecycle transitions.
- Wikilinks in frontmatter use the format: \`"[[Note Title]]"\`.

## Wikilink Conventions

- Use note titles for wikilinks: \`[[Feature: Auth Login]]\`.
- Do not use file paths in wikilinks.
- If a note has aliases, any alias can be used as a wikilink target.

## Section Conventions

- Each note type has recommended sections (see [[schema]]).
- Additional sections can be added freely.
- Section names should match the expected names exactly (case-sensitive).

## Requirement Conventions

- Requirements live inside Feature notes under \`## Requirements\`.
- Each requirement: \`### Requirement: <name>\` with \`<name>\` unique within the Feature.
- Normative statement should contain \`SHALL\` or \`MUST\`.
- Each requirement should have at least one \`#### Scenario:\` with \`WHEN\`/\`THEN\` format.

## Delta Summary Conventions

- Delta Summary lives inside Change notes under \`## Delta Summary\`.
- Operations: \`ADDED\`, \`MODIFIED\`, \`REMOVED\`, \`RENAMED\`.
- Apply order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
- MODIFIED/REMOVED/RENAMED entries should include \`[base: <content_hash>]\`.
`;
  atomicWriteFile(path.join(wikiPath, '00-meta', 'conventions.md'), content);
}

/**
 * Append an entry to the vault operation log.
 * Validates that the log path is inside the vault (rejects symlinks escaping the vault).
 */
export function appendLogEntry(
  wikiPath: string,
  operation: string,
  target: string,
  agent: string = 'ows',
  vaultRoot?: string,
): void {
  const logPath = path.join(wikiPath, '00-meta', 'log.md');

  // Security: reject if log.md is a symlink pointing outside the vault
  try {
    const stat = fs.lstatSync(logPath);
    if (stat.isSymbolicLink()) {
      const realPath = fs.realpathSync.native(logPath);
      const boundary = vaultRoot ?? path.dirname(wikiPath);
      const realBoundary = fs.realpathSync.native(boundary);
      if (!realPath.startsWith(realBoundary + path.sep) && realPath !== realBoundary) {
        throw new Error(`log.md symlink escapes vault boundary: ${logPath}`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Re-throw security errors; only swallow "file doesn't exist yet"
      if (err instanceof Error && err.message.includes('symlink escapes vault')) {
        throw err;
      }
    }
  }

  // Sanitize markdown-table-breaking characters: pipe, newline, carriage return.
  // This prevents log poisoning via crafted change IDs or targets.
  const sanitize = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const date = formatDate(new Date());
  const entry = `| ${sanitize(date)} | ${sanitize(operation)} | ${sanitize(target)} | ${sanitize(agent)} |`;

  // Serialize parallel appenders via an exclusive-create lock file.
  // Two simultaneous `ows archive`/`ows apply` runs would otherwise race on
  // `appendFileSync`. The lock is a per-vault mutex held only for the duration
  // of this single append (ms). Stale locks are reclaimed by either:
  //   - time-based TTL (older than 30s → abandoned)
  //   - PID-based liveness (writer PID no longer exists → abandoned)
  // The PID check is important because a crashed process leaves a fresh
  // lock timestamp that the TTL alone would wait on for the full 30s.
  const lockPath = path.join(wikiPath, '00-meta', 'log.md.lock');
  const LOCK_STALE_MS = 30_000;
  const MAX_RETRIES = 50;
  let acquired = false;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}|${Date.now()}`);
      fs.closeSync(fd);
      acquired = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Unexpected error (permissions, missing dir, etc.) — fall
        // through to best-effort append without locking to avoid
        // blocking the workflow. This preserves behavior on read-only
        // or otherwise constrained filesystems.
        break;
      }
      // Try to detect a stale lock (time OR dead-PID based)
      try {
        const lockContent = fs.readFileSync(lockPath, 'utf-8');
        const [pidStr, ts] = lockContent.split('|');
        const lockAge = Date.now() - Number(ts);
        const staleByAge = Number.isFinite(lockAge) && lockAge > LOCK_STALE_MS;
        let staleByPid = false;
        const pid = Number(pidStr);
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
          try {
            // Signal 0 checks liveness without delivering a signal
            process.kill(pid, 0);
          } catch {
            staleByPid = true;
          }
        }
        if (staleByAge || staleByPid) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // ignore
      }
      // Block the thread for ~10ms without spinning the event loop.
      // Atomics.wait on a SharedArrayBuffer is a true blocking sleep in Node,
      // unlike `while (Date.now() < x) {}` which burns CPU and starves timers.
      blockingSleep(10);
    }
  }

  // If acquisition failed after all retries, abort rather than append
  // without the mutex. Previously we'd silently proceed and risk
  // corrupting log.md with interleaved writes from parallel processes.
  // The caller catches this and surfaces a clear error so the user
  // can inspect the lock file.
  if (!acquired && fs.existsSync(lockPath)) {
    throw new Error(
      `Could not acquire log.md lock at ${lockPath} after ${MAX_RETRIES} retries. ` +
        'Another process may be holding it. Inspect the lock file (contains pid|timestamp) ' +
        'and delete it manually if you have confirmed the holder is dead.',
    );
  }

  try {
    fs.appendFileSync(logPath, '\n' + entry);
  } finally {
    if (acquired) {
      try { fs.unlinkSync(lockPath); } catch { /* best-effort */ }
    }
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
