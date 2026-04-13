import * as path from 'node:path';
import type { IndexRecord, VaultIndex, IndexWarning } from '../../types/index-record.js';
import type { NoteType } from '../../types/notes.js';
import { parseNote } from '../parser/note-parser.js';
import { uniqueWikilinkTargets } from '../parser/wikilink-parser.js';
import { scanVaultFiles, type FileEntry } from './scan.js';
import { readSchemaVersion } from './schema-version.js';
import { buildLookupMaps, resolveWikilink, isResolved, type LookupMaps, type WikilinkError } from './resolve.js';
import { computeReverseIndex } from './reverse.js';
import { detectDuplicateIds, buildWarnings, isTypedFolder } from './validate.js';

const VALID_NOTE_TYPES: Set<string> = new Set([
  'feature', 'change', 'system', 'decision', 'source', 'query',
]);

export interface BuildOptions {
  useCache?: boolean;
  globPattern?: string;
}

interface RawRecord {
  id: string;
  type: NoteType;
  title: string;
  aliases: string[];
  path: string;
  status: string;
  created_at?: string;
  tags: string[];
  systems_raw: string[];
  sources_raw: string[];
  decisions_raw: string[];
  changes_raw: string[];
  depends_on_raw: string[];
  touches_raw: string[];
  feature_raw: string | null;
  features_raw: string[] | null;
  headings: string[];
  requirements: IndexRecord['requirements'];
  delta_summary: IndexRecord['delta_summary'];
  tasks: IndexRecord['tasks'];
  links_out_raw: string[];
  raw_text: string;
  content_hash: string;
  mtime: number;
  file_size: number;
}

/**
 * Build a fresh in-memory index of all typed notes in the vault.
 */
export function buildIndex(vaultRoot: string, options?: BuildOptions): VaultIndex {
  // Step 1: Scan files
  const files = scanVaultFiles(vaultRoot, options?.globPattern);

  // Step 2: Schema version
  const schemaVersion = readSchemaVersion(vaultRoot);

  // Step 3: Parse into raw records
  const rawRecords: RawRecord[] = [];
  const missingIds: string[] = [];
  const invalidFrontmatterPaths: string[] = [];
  const emptyTypedNotePaths: string[] = [];

  for (const file of files) {
    // Detect empty files in typed folders
    if (file.stat.size === 0 && isTypedFolder(file.path)) {
      emptyTypedNotePaths.push(file.path);
      continue;
    }

    // Catch ENOENT gracefully: files may be deleted between scan and parse.
    // Without this, a single deleted file would abort the entire index build.
    let result;
    try {
      result = parseNoteToRawRecord(file, schemaVersion);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EACCES') {
        // File vanished or became unreadable — skip silently
        continue;
      }
      throw err;
    }
    if (result.invalidFrontmatter) {
      invalidFrontmatterPaths.push(file.path);
      continue;
    }
    if (result.missingId) {
      missingIds.push(file.path);
      continue;
    }
    if (result.raw === null) {
      // Non-empty file in typed folder with no valid frontmatter
      if (isTypedFolder(file.path)) {
        emptyTypedNotePaths.push(file.path);
      }
      continue;
    }
    rawRecords.push(result.raw);
  }

  // Step 4: Build lookup maps
  const lookups = buildLookupMaps(rawRecords);

  // Step 5-6: Resolve links + detect duplicates
  const linkErrors: WikilinkError[] = [];
  const records = new Map<string, IndexRecord>();
  const duplicateIds = detectDuplicateIds(rawRecords);

  // Sort duplicate path groups up front with a locale-independent collator
  // so the "keep first occurrence" decision is deterministic regardless
  // of host locale (Korean, Japanese, Turkish users would otherwise see
  // different winners from the same vault). Using `numeric: true` also
  // orders `part-2` before `part-10`, matching human expectations.
  const pathCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
  const dedupedWinner = new Map<string, string>();
  for (const [dupId, paths] of duplicateIds) {
    const sorted = [...paths].sort((a, b) => pathCollator.compare(a, b));
    dedupedWinner.set(dupId, sorted[0]);
  }

  for (const raw of rawRecords) {
    // Skip duplicate ids (keep first occurrence by path sort order)
    if (duplicateIds.has(raw.id)) {
      if (raw.path !== dedupedWinner.get(raw.id)) {
        continue;
      }
    }

    const resolved = resolveRecordLinks(raw, lookups, linkErrors, schemaVersion);
    records.set(resolved.id, resolved);
  }

  // Step 7: Compute reverse index
  computeReverseIndex(records);

  // Step 8: Build canonical warnings
  const warnings = buildWarnings(duplicateIds, linkErrors, missingIds, invalidFrontmatterPaths, schemaVersion, emptyTypedNotePaths);

  return {
    schema_version: schemaVersion,
    scanned_at: new Date().toISOString(),
    vaultRoot: path.resolve(vaultRoot),
    records,
    warnings,
  };
}

function parseNoteToRawRecord(
  fileEntry: FileEntry,
  schemaVersion: string,
): { raw: RawRecord | null; missingId: boolean; invalidFrontmatter: boolean } {
  const parseResult = parseNote(fileEntry.absolutePath);

  if (parseResult.frontmatter === null) {
    if (parseResult.rawFrontmatter !== null) {
      // Meta notes (type: meta) are infrastructure files, not semantic notes.
      // Skip them silently without generating invalid_frontmatter warnings.
      if (parseResult.rawFrontmatter.type === 'meta') {
        return { raw: null, missingId: false, invalidFrontmatter: false };
      }
      const hasParseErrors = parseResult.errors.some(
        e => e.source === 'frontmatter' && e.level === 'error',
      );
      if (hasParseErrors) {
        return { raw: null, missingId: false, invalidFrontmatter: true };
      }
    }
    return { raw: null, missingId: false, invalidFrontmatter: false };
  }

  const fm = parseResult.frontmatter;

  if (!VALID_NOTE_TYPES.has(fm.type)) {
    return { raw: null, missingId: false, invalidFrontmatter: false };
  }

  if (!fm.id) {
    return { raw: null, missingId: true, invalidFrontmatter: false };
  }

  // Extract title from first H1 heading or frontmatter id.
  // Cap at 200 chars to stay within filesystem path limits (Windows 260-char limit,
  // plus vault prefix overhead). Unicode grapheme clusters are preserved.
  const MAX_TITLE_LENGTH = 200;
  const h1 = parseResult.sections.find(s => s.level === 1);
  const rawTitle = h1?.title ?? fm.id;
  const title = rawTitle.length > MAX_TITLE_LENGTH
    ? rawTitle.slice(0, MAX_TITLE_LENGTH)
    : rawTitle;

  const getArray = (key: string): string[] => {
    const val = (fm as Record<string, unknown>)[key];
    return Array.isArray(val) ? val : [];
  };

  // Auto-generate derived aliases
  const explicitAliases = getArray('aliases');
  const derivedAliases: string[] = [];
  // Title without type prefix: "Feature: Auth Login" → "Auth Login"
  const prefixStripped = title.replace(/^(Feature|Change|System|Decision|Source|Query):\s*/i, '');
  if (prefixStripped !== title && prefixStripped.length > 0) {
    derivedAliases.push(prefixStripped);
  }
  // ID with dashes as spaces: "feature-auth-login" → "auth login" (drop type prefix)
  const idParts = fm.id.split('-');
  if (idParts.length > 1 && VALID_NOTE_TYPES.has(idParts[0])) {
    const idAlias = idParts.slice(1).join(' ');
    if (idAlias.length > 0) {
      derivedAliases.push(idAlias);
    }
  }
  // Merge: explicit first, then derived (deduplicate case-insensitive)
  const seenLower = new Set(explicitAliases.map((a) => a.toLowerCase()));
  const mergedAliases = [...explicitAliases];
  for (const d of derivedAliases) {
    if (!seenLower.has(d.toLowerCase())) {
      mergedAliases.push(d);
      seenLower.add(d.toLowerCase());
    }
  }

  const raw: RawRecord = {
    id: fm.id,
    type: fm.type as NoteType,
    title,
    aliases: mergedAliases,
    path: fileEntry.path,
    status: (fm as Record<string, unknown>).status as string ?? 'active',
    created_at: fm.type === 'change' ? (fm as Record<string, unknown>).created_at as string : undefined,
    tags: getArray('tags'),
    systems_raw: getArray('systems'),
    sources_raw: getArray('sources'),
    decisions_raw: getArray('decisions'),
    changes_raw: getArray('changes'),
    depends_on_raw: getArray('depends_on'),
    touches_raw: getArray('touches'),
    feature_raw: fm.type === 'change' ? ((fm as Record<string, unknown>).feature as string ?? null) : null,
    features_raw: fm.type === 'change' ? (getArray('features').length > 0 ? getArray('features') : null) : null,
    headings: parseResult.headings,
    requirements: parseResult.requirements,
    delta_summary: parseResult.deltaSummary,
    tasks: parseResult.tasks.map(t => ({ text: t.text, done: t.done })),
    links_out_raw: uniqueWikilinkTargets(parseResult.wikilinks),
    raw_text: parseResult.body,
    content_hash: parseResult.contentHash,
    mtime: fileEntry.stat.mtimeMs,
    file_size: fileEntry.stat.size,
  };

  return { raw, missingId: false, invalidFrontmatter: false };
}

function resolveRecordLinks(
  rawRecord: RawRecord,
  lookups: LookupMaps,
  errors: WikilinkError[],
  schemaVersion: string,
): IndexRecord {
  function resolveArray(rawLinks: string[]): string[] {
    const ids: string[] = [];
    for (const raw of rawLinks) {
      const result = resolveWikilink(raw, lookups);
      if (isResolved(result)) {
        ids.push(result.target_id);
      } else {
        errors.push({ source_id: rawRecord.id, source_path: rawRecord.path, ...result });
      }
    }
    return ids;
  }

  // Like resolveArray but keeps unresolved wikilinks as raw tokens
  // so downstream blocking logic can detect them
  function resolveArrayKeepUnresolved(rawLinks: string[]): string[] {
    const ids: string[] = [];
    for (const raw of rawLinks) {
      const result = resolveWikilink(raw, lookups);
      if (isResolved(result)) {
        ids.push(result.target_id);
      } else {
        errors.push({ source_id: rawRecord.id, source_path: rawRecord.path, ...result });
        // Preserve raw token so blocking logic knows a dependency exists
        const stripped = raw.replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/"/g, '');
        if (stripped) ids.push(stripped);
      }
    }
    return ids;
  }

  function resolveSingle(raw: string | null): string | undefined {
    if (raw === null) return undefined;
    const result = resolveWikilink(raw, lookups);
    if (isResolved(result)) return result.target_id;
    errors.push({ source_id: rawRecord.id, source_path: rawRecord.path, ...result });
    return undefined;
  }

  return {
    schema_version: schemaVersion,
    id: rawRecord.id,
    type: rawRecord.type,
    title: rawRecord.title,
    aliases: rawRecord.aliases,
    path: rawRecord.path,
    status: rawRecord.status,
    created_at: rawRecord.created_at,
    tags: rawRecord.tags,
    systems: resolveArray(rawRecord.systems_raw),
    sources: resolveArray(rawRecord.sources_raw),
    decisions: resolveArray(rawRecord.decisions_raw),
    changes: resolveArray(rawRecord.changes_raw),
    feature: resolveSingle(rawRecord.feature_raw),
    features: rawRecord.features_raw ? resolveArray(rawRecord.features_raw) : undefined,
    depends_on: resolveArrayKeepUnresolved(rawRecord.depends_on_raw),
    touches: resolveArray(rawRecord.touches_raw),
    links_out: resolveArray(rawRecord.links_out_raw),
    links_in: [], // populated by computeReverseIndex
    headings: rawRecord.headings,
    requirements: rawRecord.requirements.map(req => ({
      ...req,
      key: rawRecord.id + '::' + req.name,
    })),
    delta_summary: rawRecord.delta_summary.map(entry => ({
      ...entry,
      target_note_id: (() => {
        const resolved = resolveWikilink(entry.target_note_id, lookups);
        if (isResolved(resolved)) return resolved.target_id;
        errors.push({ source_id: rawRecord.id, source_path: rawRecord.path, ...resolved });
        return ''; // empty string preserves id-only contract; raw text would violate it
      })(),
    })),
    tasks: rawRecord.tasks,
    raw_text: rawRecord.raw_text,
    content_hash: rawRecord.content_hash,
  };
}
