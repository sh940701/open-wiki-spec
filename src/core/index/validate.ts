import type { IndexWarning } from '../../types/index-record.js';
import type { WikilinkError } from './resolve.js';

/**
 * Detect duplicate ids among raw records.
 */
export function detectDuplicateIds(
  records: { id: string; path: string }[],
): Map<string, string[]> {
  const idToPaths = new Map<string, string[]>();
  for (const record of records) {
    const paths = idToPaths.get(record.id) ?? [];
    paths.push(record.path);
    idToPaths.set(record.id, paths);
  }

  const duplicates = new Map<string, string[]>();
  for (const [id, paths] of idToPaths) {
    if (paths.length > 1) {
      duplicates.set(id, paths);
    }
  }
  return duplicates;
}

/**
 * Build canonical IndexWarning[] from all detected issues.
 */
export function buildWarnings(
  duplicateIds: Map<string, string[]>,
  linkErrors: WikilinkError[],
  missingIds: string[],
  invalidFrontmatterPaths: string[],
  schemaVersion: string,
  emptyTypedNotePaths: string[] = [],
): IndexWarning[] {
  const warnings: IndexWarning[] = [];

  // Invalid frontmatter
  for (const path of invalidFrontmatterPaths) {
    const severity = isTypedFolder(path) ? 'error' as const : 'warning' as const;
    warnings.push({
      type: 'invalid_frontmatter',
      severity,
      note_path: path,
      message: severity === 'error'
        ? `Typed note at "${path}" has corrupted frontmatter and was dropped from the index`
        : 'File has frontmatter delimiters but YAML could not be parsed',
    });
  }

  // Duplicate IDs
  for (const [id, paths] of duplicateIds) {
    for (const path of paths) {
      warnings.push({
        type: 'duplicate_id',
        note_path: path,
        message: `Duplicate id "${id}" also found in: ${paths.filter(p => p !== path).join(', ')}`,
      });
    }
  }

  // Unresolved wikilinks
  for (const error of linkErrors) {
    if (error.error === 'no_match') {
      warnings.push({
        type: 'unresolved_wikilink',
        note_path: error.source_path,
        message: `Unresolved wikilink "${error.raw_link}"`,
      });
    } else if (error.error === 'ambiguous_alias') {
      warnings.push({
        type: 'ambiguous_alias',
        note_path: error.source_path,
        message: `Ambiguous alias "${error.raw_link}", candidates: ${error.candidates?.join(', ')}`,
      });
    }
  }

  // Missing IDs
  for (const path of missingIds) {
    warnings.push({
      type: 'missing_id',
      note_path: path,
      message: 'Typed note has no id field',
    });
  }

  // Schema mismatch
  if (schemaVersion === 'unknown') {
    warnings.push({
      type: 'schema_mismatch',
      note_path: 'wiki/00-meta/schema.md',
      message: 'No schema.md found or schema_version is missing',
    });
  }

  // Empty typed notes
  for (const notePath of emptyTypedNotePaths) {
    warnings.push({
      type: 'empty_typed_note',
      severity: 'error',
      note_path: notePath,
      message: `Empty or body-less note in typed folder: "${notePath}" was dropped from the index`,
    });
  }

  return warnings;
}

/** Typed folders whose notes MUST have valid frontmatter. */
const TYPED_FOLDER_PREFIXES = [
  'wiki/01-sources/', 'wiki/02-systems/', 'wiki/03-features/',
  'wiki/04-changes/', 'wiki/05-decisions/', 'wiki/06-queries/',
];

export function isTypedFolder(notePath: string): boolean {
  return TYPED_FOLDER_PREFIXES.some((prefix) => notePath.startsWith(prefix));
}
