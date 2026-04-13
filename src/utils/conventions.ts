/**
 * Shared utility for reading project conventions from wiki/00-meta/conventions.md.
 * Used by propose and continue workflows to inject project rules into agent context.
 */
import * as path from 'node:path';

export interface ReadConventionsDeps {
  readFile: (filePath: string) => string;
}

/**
 * Read project conventions from wiki/00-meta/conventions.md (best-effort).
 * Returns undefined if the file doesn't exist or is empty.
 */
export function readConventionsContent(
  vaultRoot: string,
  deps: ReadConventionsDeps,
): string | undefined {
  try {
    const conventionsPath = path.join(vaultRoot, 'wiki', '00-meta', 'conventions.md');
    const content = deps.readFile(conventionsPath);
    const stripped = content.replace(/^---[\s\S]*?---\s*/, '');
    const trimmed = stripped.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
