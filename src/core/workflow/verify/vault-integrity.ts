/**
 * Vault-wide structural integrity checks.
 * These checks detect fundamental problems with vault structure
 * that may affect other verification dimensions.
 */
import type { VaultIndex, IndexRecord } from '../../../types/index.js';
import type { VerifyIssue } from '../../../types/verify.js';

/**
 * Convert index warnings of type 'duplicate_id' to VerifyIssues.
 * Duplicate ids are already detected during index build.
 */
export function duplicateIdCheck(index: VaultIndex): VerifyIssue[] {
  return index.warnings
    .filter((w) => w.type === 'duplicate_id')
    .map((w) => ({
      dimension: 'vault_integrity' as const,
      severity: 'error' as const,
      code: 'DUPLICATE_ID',
      message: w.message,
      note_path: w.note_path,
      suggestion: 'Each note must have a unique id. Rename one of the duplicates.',
    }));
}

/**
 * Convert index warnings of type 'missing_id' to VerifyIssues.
 */
export function missingIdCheck(index: VaultIndex): VerifyIssue[] {
  return index.warnings
    .filter((w) => w.type === 'missing_id')
    .map((w) => ({
      dimension: 'vault_integrity' as const,
      severity: 'error' as const,
      code: 'MISSING_ID',
      message: w.message,
      note_path: w.note_path,
      suggestion: 'Every note must have a unique id field in its frontmatter.',
    }));
}

/**
 * Check for unresolved wikilinks in all notes.
 * Wikilinks are resolved during index build; unresolved ones are recorded
 * as index warnings of type 'unresolved_wikilink'. We surface those here.
 */
export function unresolvedWikilinkCheck(index: VaultIndex): VerifyIssue[] {
  return index.warnings
    .filter((w) => w.type === 'unresolved_wikilink')
    .map((w) => ({
      dimension: 'vault_integrity' as const,
      severity: 'error' as const,
      code: 'UNRESOLVED_WIKILINK',
      message: w.message,
      note_path: w.note_path,
      suggestion: 'Create the missing note or fix the wikilink target.',
    }));
}

/**
 * Convert index warnings of type 'ambiguous_alias' to VerifyIssues.
 */
export function ambiguousAliasCheck(index: VaultIndex): VerifyIssue[] {
  return index.warnings
    .filter((w) => w.type === 'ambiguous_alias')
    .map((w) => ({
      dimension: 'vault_integrity' as const,
      severity: 'error' as const,
      code: 'AMBIGUOUS_ALIAS',
      message: w.message,
      note_path: w.note_path,
      suggestion: 'Each alias must resolve to exactly one note. Remove or rename the duplicate alias.',
    }));
}

/**
 * Check for orphan notes (notes with no incoming or outgoing links).
 * Meta files are excluded from this check.
 *
 * Bootstrap exemption: if the vault contains only a single typed note, it
 * cannot possibly link anywhere (there is nothing to link to), so flagging
 * it as an orphan is noise that would break the first-note experience
 * under `--strict`. Skip the check in that case.
 */
export function orphanNoteCheck(index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const typedNotes = Array.from(index.records.values()).filter(
    (r) => !r.path.startsWith('wiki/00-meta/'),
  );
  if (typedNotes.length <= 1) return issues;

  for (const record of typedNotes) {
    if (record.links_in.length === 0 && record.links_out.length === 0) {
      issues.push({
        dimension: 'vault_integrity',
        severity: 'warning',
        code: 'ORPHAN_NOTE',
        message: `Note "${record.title}" (${record.path}) has no incoming or outgoing links`,
        note_id: record.id,
        note_path: record.path,
        suggestion: 'Add wikilinks to connect this note to the vault graph.',
      });
    }
  }
  return issues;
}

/**
 * Check for notes in 99-archive/ that don't have 'applied' status.
 * Also check that note type matches its typed folder location (e.g., feature → 03-features/).
 */
export function archivePlacementCheck(index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  // Expected folder per note type (archived notes exempt — they live in 99-archive/)
  const TYPE_TO_FOLDER: Record<string, string> = {
    source: 'wiki/01-sources/',
    system: 'wiki/02-systems/',
    feature: 'wiki/03-features/',
    change: 'wiki/04-changes/',
    decision: 'wiki/05-decisions/',
    query: 'wiki/06-queries/',
  };

  for (const record of index.records.values()) {
    const isInArchive = record.path.startsWith('wiki/99-archive/');
    if (isInArchive && record.status !== 'applied') {
      issues.push({
        dimension: 'vault_integrity',
        severity: 'error',
        code: 'ARCHIVE_PLACEMENT_ERROR',
        message: `Note "${record.id}" in 99-archive/ has status "${record.status}" (expected "applied")`,
        note_id: record.id,
        note_path: record.path,
        suggestion: 'Only applied changes should be in the archive. Move the note back or update its status.',
      });
    }

    // Type/folder mismatch check (skip archived notes — they're allowed anywhere under 99-archive/)
    if (!isInArchive) {
      const expectedFolder = TYPE_TO_FOLDER[record.type];
      if (expectedFolder && !record.path.startsWith(expectedFolder)) {
        issues.push({
          dimension: 'vault_integrity',
          severity: 'error',
          code: 'TYPE_FOLDER_MISMATCH',
          message: `Note "${record.id}" has type "${record.type}" but is located in "${record.path}" instead of "${expectedFolder}"`,
          note_id: record.id,
          note_path: record.path,
          suggestion: `Move the note to ${expectedFolder} or correct the "type" field in frontmatter.`,
        });
      }
    }
  }
  return issues;
}

/**
 * Convert index warnings of type 'invalid_frontmatter' to VerifyIssues.
 * Typed-folder frontmatter errors (severity: 'error') are surfaced as verify errors.
 * Other frontmatter warnings are surfaced as verify warnings.
 */
export function invalidFrontmatterTypeCheck(index: VaultIndex): VerifyIssue[] {
  return index.warnings
    .filter((w) => w.type === 'invalid_frontmatter')
    .map((w) => ({
      dimension: 'vault_integrity' as const,
      severity: (w.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning',
      code: w.severity === 'error' ? 'TYPED_FOLDER_FRONTMATTER_ERROR' : 'INVALID_FRONTMATTER_TYPE',
      message: w.message,
      note_path: w.note_path,
      suggestion: w.severity === 'error'
        ? 'This note is in a typed folder and MUST have valid frontmatter. Fix the YAML syntax immediately.'
        : 'Fix the frontmatter YAML syntax or add missing required fields.',
    }));
}

/**
 * Convert index warnings of type 'empty_typed_note' to VerifyIssues.
 */
export function emptyTypedNoteCheck(index: VaultIndex): VerifyIssue[] {
  return index.warnings
    .filter((w) => w.type === 'empty_typed_note')
    .map((w) => ({
      dimension: 'vault_integrity' as const,
      severity: 'error' as const,
      code: 'EMPTY_TYPED_NOTE',
      message: w.message,
      note_path: w.note_path,
      suggestion: 'Add valid frontmatter and content to this note, or remove it from the typed folder.',
    }));
}

/**
 * Detect title/id collisions: when any note's title matches another note's id.
 * This can cause ambiguous wikilink resolution.
 */
export function titleIdCollisionCheck(index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  for (const record of index.records.values()) {
    const titleLower = record.title.toLowerCase();
    for (const other of index.records.values()) {
      if (record.id === other.id) continue;
      if (titleLower === other.id.toLowerCase()) {
        issues.push({
          dimension: 'vault_integrity',
          severity: 'error',
          code: 'TITLE_ID_COLLISION',
          message: `Note "${record.id}" has title "${record.title}" which matches note "${other.id}"'s id. This may cause ambiguous wikilink resolution.`,
          note_id: record.id,
          note_path: record.path,
          suggestion: 'Rename the title or id to avoid collision.',
        });
      }
    }
  }
  return issues;
}

/**
 * Common secret patterns that should never appear in vault frontmatter.
 * Scans values (not keys) for these patterns and warns the user.
 */
const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'OpenAI API key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { name: 'GitHub token', regex: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  // AWS long-lived (AKIA) and temporary session (ASIA) access key IDs
  { name: 'AWS access key', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // GCP service account key (JSON)
  { name: 'GCP service account key', regex: /"type"\s*:\s*"service_account"/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'JWT token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'Private key header', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  // Generic "password = ..." or "secret = ..." in config-like blocks
  { name: 'Hardcoded credential', regex: /(?:password|secret|token|api_key)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i },
];

/**
 * Scan note body for accidental secret leakage.
 * Returns warnings (not errors) to encourage removal without blocking work.
 */
export function secretLeakCheck(notes: IndexRecord[]): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  for (const note of notes) {
    // Scan the raw_text (body) for secret patterns
    const scanText = note.raw_text ?? '';
    for (const { name, regex } of SECRET_PATTERNS) {
      if (regex.test(scanText)) {
        issues.push({
          dimension: 'vault_integrity' as const,
          severity: 'warning' as const,
          code: 'POTENTIAL_SECRET_LEAK',
          message: `Note "${note.id}" may contain a ${name}`,
          note_id: note.id,
          note_path: note.path,
          suggestion: 'Remove the secret and rotate the credential. Use environment variables instead.',
        });
        break; // one warning per note is enough
      }
    }
  }

  return issues;
}

/**
 * Resolve a wikilink target against the vault index.
 * Checks id, title, and aliases.
 */
export function resolveLink(index: VaultIndex, link: string): IndexRecord | undefined {
  // Direct id match
  const byId = index.records.get(link);
  if (byId) return byId;

  // Title or alias match
  for (const record of index.records.values()) {
    if (record.title === link) return record;
    if (record.aliases.includes(link)) return record;
  }

  return undefined;
}
