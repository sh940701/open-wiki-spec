import { statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import fg from 'fast-glob';

export interface FileEntry {
  /** Path relative to vault root (always uses '/' as separator, even on Windows) */
  path: string;
  /** Absolute path on disk */
  absolutePath: string;
  /** File stats */
  stat: { mtimeMs: number; size: number };
}

/**
 * Normalize a path to use forward slashes regardless of platform.
 * This ensures downstream checks like `startsWith('wiki/')` work on Windows.
 */
function toPosixPath(p: string): string {
  return sep === '\\' ? p.replace(/\\/g, '/') : p;
}

/**
 * Scan the vault for all markdown files.
 *
 * Broken symlinks: `fast-glob` with `followSymbolicLinks: false` may still
 * return the link path itself (not its target). If the link points
 * nowhere, a naive `statSync` throws ENOENT and aborts the entire scan.
 * We catch per-entry errors, skip the broken file, and continue — one
 * dangling symlink must not take down `ows verify` on the whole vault.
 * Sort output with a pinned `en` + `numeric` collator so scan ordering
 * is reproducible across host locales (matches the dedup tie-break in
 * src/core/index/build.ts for consistency).
 */
export function scanVaultFiles(vaultRoot: string, globPattern?: string): FileEntry[] {
  const pattern = globPattern ?? join(vaultRoot, 'wiki', '**', '*.md');
  // fast-glob can throw if the base directory is a symlink loop, is
  // protected by restrictive ACLs, or disappears between stat calls.
  // Return an empty list with a stderr warning rather than crashing the
  // whole CLI invocation — individual file issues are still caught
  // per-entry below. We intentionally do NOT swallow non-filesystem
  // errors (programming bugs, bad patterns), only known I/O classes.
  let files: string[];
  try {
    files = fg.sync(pattern, { absolute: true, followSymbolicLinks: false });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EACCES' || code === 'ENOENT') {
      process.stderr.write(
        `[ows] Warning: scanVaultFiles could not enumerate ${pattern}: ${(err as Error).message}. ` +
          'Returning empty file list. Check for symlink loops or permission issues under wiki/.\n',
      );
      return [];
    }
    throw err;
  }

  const entries: FileEntry[] = [];
  for (const absolutePath of files) {
    try {
      const stat = statSync(absolutePath);
      entries.push({
        path: toPosixPath(relative(vaultRoot, absolutePath)),
        absolutePath,
        stat: { mtimeMs: stat.mtimeMs, size: stat.size },
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'EACCES') {
        // Dangling symlink, symlink cycle, or unreadable file — skip
        // silently. Verify will emit a warning via the index's own
        // pass if the user has `ows verify` enabled.
        continue;
      }
      throw err;
    }
  }
  const pathCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
  return entries.sort((a, b) => pathCollator.compare(a.path, b.path));
}
