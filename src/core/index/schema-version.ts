import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { extractFrontmatter } from '../parser/frontmatter-parser.js';
import { FEATURE_REQUIRED_SECTIONS, FEATURE_OPTIONAL_SECTIONS } from '../schema/feature.schema.js';
import { CHANGE_REQUIRED_SECTIONS } from '../schema/change.schema.js';
import { QUERY_REQUIRED_SECTIONS } from '../schema/query.schema.js';

/**
 * Current schema version written by `ows init`.
 * Update this when schema structure changes in a backwards-incompatible way.
 */
export const CURRENT_SCHEMA_VERSION = '2026-04-06-v1';

/**
 * Supported schema versions — a vault with one of these can be read by current ows.
 * Older versions trigger a warning; unlisted versions trigger an error.
 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = [
  '2026-04-06-v1',
];

/**
 * Breaking-change tripwire: fingerprint of the compile-time schema shape.
 * Computed from the set of required/optional sections for each note type.
 * When this fingerprint changes but CURRENT_SCHEMA_VERSION has not been bumped,
 * `ows verify` emits a BREAKING_CHANGE_WITHOUT_VERSION_BUMP warning.
 */
export function computeSchemaFingerprint(): string {
  const shape = {
    version: CURRENT_SCHEMA_VERSION,
    feature: {
      required: [...FEATURE_REQUIRED_SECTIONS],
      optional: [...FEATURE_OPTIONAL_SECTIONS],
    },
    change: { required: [...CHANGE_REQUIRED_SECTIONS] },
    query: { required: [...QUERY_REQUIRED_SECTIONS] },
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

/**
 * Baseline fingerprint captured at the CURRENT_SCHEMA_VERSION declaration above.
 * If the runtime computeSchemaFingerprint() differs from this, it means schema
 * shape changed without bumping CURRENT_SCHEMA_VERSION — a potential silent
 * breaking change that verify will flag.
 */
export const BASELINE_SCHEMA_FINGERPRINT = 'a1c975130bcc7290';

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

/**
 * Check if a schema version is supported by the current ows version.
 */
export function isSchemaVersionSupported(version: string): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.includes(version);
}
