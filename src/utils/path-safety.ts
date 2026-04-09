import { resolve } from 'node:path';
import * as fs from 'node:fs';

/**
 * Assert that a file path resolves to a location inside the vault root.
 * Uses fs.realpathSync.native() to follow symlinks and detect traversal.
 * Also rejects paths that are themselves symlinks pointing outside the vault.
 *
 * @throws Error if the resolved path is outside vaultRoot
 */
export function assertInsideVault(filePath: string, vaultRoot: string): void {
  // Resolve vault root — follow symlinks if it exists on disk
  let resolvedRoot: string;
  try {
    resolvedRoot = fs.realpathSync.native(vaultRoot);
  } catch {
    resolvedRoot = resolve(vaultRoot);
  }

  // Resolve file path — follow symlinks if it exists on disk
  let resolvedPath: string;
  if (fs.existsSync(filePath)) {
    // Reject if the path itself is a symlink pointing outside vault
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      const linkTarget = fs.realpathSync.native(filePath);
      if (!linkTarget.startsWith(resolvedRoot + '/') && linkTarget !== resolvedRoot) {
        throw new Error(
          `Path traversal blocked: symlink "${filePath}" points to "${linkTarget}" outside vault root "${resolvedRoot}"`,
        );
      }
    }
    resolvedPath = fs.realpathSync.native(filePath);
  } else {
    // For non-existent files, resolve the parent directory through symlinks
    // and combine with the filename
    const parent = resolve(filePath, '..');
    try {
      const resolvedParent = fs.realpathSync.native(parent);
      const basename = resolve(filePath).slice(resolve(parent).length);
      resolvedPath = resolvedParent + basename;
    } catch {
      // Parent doesn't exist either — use logical resolve as fallback
      resolvedPath = resolve(filePath);
    }
  }

  if (!resolvedPath.startsWith(resolvedRoot + '/') && resolvedPath !== resolvedRoot) {
    throw new Error(
      `Path traversal blocked: "${resolvedPath}" is outside vault root "${resolvedRoot}"`,
    );
  }
}

/**
 * Safely write a file after asserting it is inside the vault root.
 * Resolves symlinks before writing to prevent symlink-based path traversal.
 */
export function safeWriteFile(filePath: string, content: string, vaultRoot: string): void {
  assertInsideVault(filePath, vaultRoot);
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Safely read a file after asserting it is inside the vault root.
 * Resolves symlinks before reading to prevent symlink-based path traversal.
 */
export function safeReadFile(filePath: string, vaultRoot: string): string {
  assertInsideVault(filePath, vaultRoot);
  return fs.readFileSync(filePath, 'utf-8');
}
