import { resolve } from 'node:path';

/**
 * Assert that a file path resolves to a location inside the vault root.
 * Prevents symlink-based path traversal attacks.
 *
 * @throws Error if the resolved path is outside vaultRoot
 */
export function assertInsideVault(filePath: string, vaultRoot: string): void {
  const resolvedPath = resolve(filePath);
  const resolvedRoot = resolve(vaultRoot);

  if (!resolvedPath.startsWith(resolvedRoot + '/') && resolvedPath !== resolvedRoot) {
    throw new Error(
      `Path traversal blocked: "${resolvedPath}" is outside vault root "${resolvedRoot}"`,
    );
  }
}
