/**
 * Shared schema-version compatibility check for CLI commands.
 *
 * Problem: `buildIndex` loads the vault's declared schema version into the
 * index but does not validate it, and only `ows verify` calls
 * `isSchemaVersionSupported`. Every other command (status, propose,
 * continue, apply, query, ...) happily operates on a vault with an
 * unknown or unsupported schema, silently risking miscommunication
 * between the tool version and the vault format.
 *
 * This helper prints a clear stderr warning once per CLI invocation when
 * the loaded index carries an unsupported or missing schema version. It is
 * non-throwing on purpose so read-only commands like `ows status` still
 * work on legacy vaults — they just surface the mismatch loudly so the
 * user can decide whether to upgrade.
 *
 * Set `OWS_QUIET=1` in the environment to suppress the warning (useful in
 * CI pipelines that run `ows` against known-good fixtures).
 */
import type { VaultIndex } from '../types/index-record.js';
import { isSchemaVersionSupported, SUPPORTED_SCHEMA_VERSIONS } from '../core/index/schema-version.js';

let warnedOnce = false;

export function warnOnUnsupportedSchema(index: VaultIndex): void {
  if (warnedOnce) return;
  if (process.env.OWS_QUIET === '1') return;

  const version = index.schema_version;
  if (!version || version === 'unknown') {
    warnedOnce = true;
    process.stderr.write(
      `[ows] Warning: vault has no declared schema_version ` +
        `(wiki/00-meta/schema.md missing or empty). This CLI version expects ` +
        `one of: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}. ` +
        `Run \`ows init\` to initialize metadata, or \`ows migrate\` to import ` +
        `an existing openspec/ directory. Continuing with best-effort parsing.\n`,
    );
    return;
  }

  if (!isSchemaVersionSupported(version)) {
    warnedOnce = true;
    process.stderr.write(
      `[ows] Warning: vault schema_version "${version}" is not supported by ` +
        `this ows version (supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}). ` +
        `Results may be incorrect. Upgrade the vault or pin a compatible ows release. ` +
        `Run \`ows verify\` for details.\n`,
    );
  }
}

/**
 * Reset the once-per-process latch. Test-only — production code never
 * needs to call this.
 */
export function __resetSchemaWarnLatchForTests(): void {
  warnedOnce = false;
}
