import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractFrontmatter } from '../parser/frontmatter-parser.js';

/**
 * Read the schema version from wiki/00-meta/schema.md frontmatter.
 */
export function readSchemaVersion(vaultRoot: string): string {
  const schemaPath = join(vaultRoot, 'wiki', '00-meta', 'schema.md');
  if (!existsSync(schemaPath)) {
    return 'unknown';
  }

  const content = readFileSync(schemaPath, 'utf-8');
  const { raw } = extractFrontmatter(content);
  if (!raw || !raw.data.schema_version) {
    return 'unknown';
  }

  return String(raw.data.schema_version);
}
