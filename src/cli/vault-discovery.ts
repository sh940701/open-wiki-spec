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
  const cwd = startDir ?? process.cwd();
  let dir = cwd;

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
      // Reached filesystem root without finding a vault.
      // Give an explicit, actionable error that distinguishes the two common cases:
      //   (a) user is not in a project directory → `cd` into the project
      //   (b) user is in a project but hasn't initialized → `ows init`
      const err = new Error(
        `No open-wiki-spec vault found.\n\n` +
        `Searched from: ${cwd}\n` +
        `(walked up to filesystem root looking for a directory containing wiki/00-meta/schema.md)\n\n` +
        `To fix this:\n` +
        `  • If you're in the wrong directory: cd into your project root and retry.\n` +
        `  • If you haven't initialized a vault yet: run \`ows init\` inside your project.\n` +
        `  • If your vault lives elsewhere: cd into the project root that contains wiki/.\n\n` +
        `ows commands must run from inside a project that has a wiki/ directory.`,
      );
      (err as NodeJS.ErrnoException).code = 'VAULT_NOT_FOUND';
      throw err;
    }
    dir = parent;
  }
}
