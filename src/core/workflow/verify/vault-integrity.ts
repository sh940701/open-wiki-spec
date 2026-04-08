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
 */
export function orphanNoteCheck(index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  for (const record of index.records.values()) {
    if (record.path.startsWith('wiki/00-meta/')) continue;
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
 */
export function archivePlacementCheck(index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
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
