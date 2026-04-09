import { stringify as yamlStringify } from 'yaml';

/**
 * Sanitize an external directory name for use as a note ID in migration.
 * Strips path traversal sequences, control characters, and non-safe characters.
 */
export function sanitizeMigrationId(name: string): string {
  return name
    .replace(/\.\.\//g, '')
    .replace(/\.\./g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Safely format a string value for inline YAML use (unquoted style).
 * Uses yaml.stringify to properly escape values that contain
 * special YAML characters or newlines.
 */
export function safeYamlScalar(value: string): string {
  return yamlStringify(value).trimEnd();
}

/**
 * Safely format a string value for inline YAML use (always quoted).
 * Forces double-quoting to prevent YAML type coercion (e.g., dates, booleans).
 */
export function safeYamlQuoted(value: string): string {
  // Escape backslash and double-quote, then wrap
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}
