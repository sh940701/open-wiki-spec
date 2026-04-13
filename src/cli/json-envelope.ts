/**
 * Common JSON envelope for all CLI --json output.
 *
 * Every CLI command wraps its success payload in:
 *   { ok: true, command: "<name>", version: "<pkg version>", data: <payload> }
 *
 * Error output is handled separately by handleCliError and keeps its
 * existing { error: true, code, message } shape.
 *
 * Uses a JSON.stringify replacer (single-pass) to normalize Map instances
 * to plain objects. This preserves native Date → toISOString() behavior
 * and avoids the 2-pass cost of deep-cloning + stringify.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Envelope schema version. Bump on breaking changes to the envelope
 * shape (adding fields is non-breaking; renaming/removing/semantic
 * changes are breaking). Consumers pin against this to detect drift.
 */
export const ENVELOPE_VERSION = '1';

let _version: string | undefined;

function getVersion(): string {
  if (_version) return _version;
  try {
    // ESM-safe: derive directory from import.meta.url
    const thisDir = dirname(fileURLToPath(import.meta.url));
    // Walk up from dist/cli/ (or src/cli/) to find package.json
    let dir = thisDir;
    for (let i = 0; i < 5; i++) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
        _version = pkg.version ?? 'unknown';
        return _version;
      }
      dir = dirname(dir);
    }
  } catch {
    // fall through
  }
  _version = 'unknown';
  return _version;
}

/**
 * JSON.stringify replacer that converts Map → plain object and
 * Set → array. Handles nested structures via the natural recursion
 * of JSON.stringify — no manual deep-walk needed.
 *
 * Date, RegExp, and other built-ins are left to their default
 * JSON.stringify behavior (Date → toISOString string, others → {}).
 */
function envelopeReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) {
      obj[String(k)] = v;
    }
    return obj;
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  return value;
}

/**
 * Wrap a command's success payload in the standard CLI JSON envelope
 * and return the serialized JSON string (pretty-printed).
 *
 * Usage:
 *   console.log(jsonEnvelope('propose', result));
 */
export function jsonEnvelope(command: string, data: unknown): string {
  const envelope = {
    ok: true as const,
    command,
    envelope_version: ENVELOPE_VERSION,
    version: getVersion(),
    data,
  };
  return JSON.stringify(envelope, envelopeReplacer, 2);
}
