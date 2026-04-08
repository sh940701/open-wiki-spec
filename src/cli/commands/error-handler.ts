/**
 * Common CLI error handler.
 * Outputs JSON error when --json is set, plaintext otherwise.
 */
export function handleCliError(err: unknown, json?: boolean): void {
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    console.log(JSON.stringify({ error: true, message }, null, 2));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exitCode = 1;
}
