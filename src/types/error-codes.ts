/**
 * Central taxonomy of runtime/usage error codes emitted by ows CLI commands
 * and workflow functions. These are distinct from VerifyIssue codes (see
 * `./verify.ts` → `VERIFY_CODES`), which classify findings inside a
 * `VerifyReport`. ERROR_CODES classify thrown errors and --json error payloads.
 *
 * AI agents and automation scripts should branch on these values when
 * `handleCliError()` emits `{ error: true, code, message }` in JSON mode.
 */
export const ERROR_CODES = {
  // Generic fallbacks
  RUNTIME_ERROR: 'RUNTIME_ERROR',
  COMMANDER_ERROR: 'COMMANDER_ERROR',

  // Filesystem errors (translated from errno)
  READ_ONLY_FILESYSTEM: 'READ_ONLY_FILESYSTEM',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  DISK_FULL: 'DISK_FULL',

  // Domain errors
  AMBIGUOUS_CHANGE_SELECTION: 'AMBIGUOUS_CHANGE_SELECTION',
  CHANGE_NOT_FOUND: 'CHANGE_NOT_FOUND',
  FEATURE_NOT_FOUND: 'FEATURE_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  STALE_BASE: 'STALE_BASE',
  EMPTY_INPUT: 'EMPTY_INPUT',
  VAULT_NOT_FOUND: 'VAULT_NOT_FOUND',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
