import { statSync } from 'node:fs';
import { join, relative } from 'node:path';
import fg from 'fast-glob';

export interface FileEntry {
  /** Path relative to vault root */
  path: string;
  /** Absolute path on disk */
  absolutePath: string;
  /** File stats */
  stat: { mtimeMs: number; size: number };
}

/**
 * Scan the vault for all markdown files.
 */
export function scanVaultFiles(vaultRoot: string, globPattern?: string): FileEntry[] {
  const pattern = globPattern ?? join(vaultRoot, 'wiki', '**', '*.md');
  const files = fg.sync(pattern, { absolute: true, followSymbolicLinks: false });

  return files.map((absolutePath) => {
    const stat = statSync(absolutePath);
    return {
      path: relative(vaultRoot, absolutePath),
      absolutePath,
      stat: { mtimeMs: stat.mtimeMs, size: stat.size },
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
