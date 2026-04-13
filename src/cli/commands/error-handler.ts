/**
 * Common CLI error handler.
 * Outputs JSON error when --json is set, plaintext otherwise.
 *
 * JSON format: { error: true, code: string, message: string, details?: unknown }
 * Parser errors use code "COMMANDER_ERROR", runtime errors use "RUNTIME_ERROR".
 */
import { ERROR_CODES } from '../../types/error-codes.js';

export function handleCliError(err: unknown, json?: boolean, code: string = ERROR_CODES.RUNTIME_ERROR): void {
  let message = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : undefined;
  const errnoCode = (err as NodeJS.ErrnoException | null)?.code;
  // Commander errors have a distinct name/code
  let errCode: string = errName === 'CommanderError' ? ERROR_CODES.COMMANDER_ERROR : code;

  // Recognize common filesystem errors and rewrite to actionable diagnostics.
  // Users on read-only vaults (Docker bind mounts, NFS ro, macOS sealed paths)
  // would otherwise see a cryptic `EROFS` or `EACCES` without context.
  if (errnoCode === 'EROFS') {
    errCode = ERROR_CODES.READ_ONLY_FILESYSTEM;
    message = `Vault filesystem is read-only: ${message}. Mount the vault directory read-write (e.g., remove \`:ro\` from Docker bind mounts, remount NFS with rw), or run ows against a writable copy.`;
  } else if (errnoCode === 'EACCES') {
    errCode = ERROR_CODES.PERMISSION_DENIED;
    message = `Permission denied: ${message}. Check file/directory ownership and permissions on the vault. On Linux/macOS, try \`chmod -R u+w wiki/\`.`;
  } else if (errnoCode === 'ENOSPC') {
    errCode = ERROR_CODES.DISK_FULL;
    message = `No space left on device: ${message}. Free up disk space and retry.`;
  } else if (errnoCode === 'VAULT_NOT_FOUND') {
    errCode = ERROR_CODES.VAULT_NOT_FOUND;
    // message already contains the actionable guidance from vault-discovery.ts
  }

  // Extract structured fields from typed errors (e.g., AmbiguousChangeError)
  // so AI agents and scripts can act on them programmatically.
  const errObj = err as Record<string, unknown> | null;
  const structuredCode = typeof errObj?.code === 'string' ? errObj.code as string : errCode;
  const details: Record<string, unknown> = {};
  if (errObj && typeof errObj === 'object') {
    if (Array.isArray(errObj.candidates)) {
      details.candidates = errObj.candidates;
    }
  }

  if (json) {
    const payload: Record<string, unknown> = {
      error: true,
      code: structuredCode,
      message,
    };
    if (Object.keys(details).length > 0) {
      payload.details = details;
    }
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exitCode = 1;
}
