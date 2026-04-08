/**
 * Vault path discovery utility.
 * Walks up the directory tree to find a wiki/ directory
 * with 00-meta/schema.md, similar to how git finds .git/.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Discover the vault root by walking up from startDir.
 * Returns the project root (the directory that contains wiki/),
 * not the wiki/ directory itself. This matches what buildIndex()
 * expects: it appends wiki/ internally.
 * @throws Error if no valid wiki/ directory is found.
 */
export function discoverVaultPath(startDir?: string): string {
  let dir = startDir ?? process.cwd();

  while (true) {
    const candidate = path.join(dir, 'wiki');
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isDirectory() &&
      fs.existsSync(path.join(candidate, '00-meta', 'schema.md'))
    ) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        'No wiki/ vault found. Run `ows init` to create one, or run from within a project that has a wiki/ directory.',
      );
    }
    dir = parent;
  }
}
