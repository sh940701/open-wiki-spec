import { stripWikilinkSyntax } from '../parser/wikilink-parser.js';

export interface LookupMaps {
  title_to_ids: Map<string, string[]>;
  id_set: Set<string>;
  alias_to_ids: Map<string, string[]>;
  path_to_id: Map<string, string>;
}

export interface WikilinkResolution {
  target_id: string;
  resolved_via: 'title' | 'id' | 'alias';
}

export interface WikilinkError {
  source_id: string;
  source_path: string;
  raw_link: string;
  error: 'no_match' | 'ambiguous_alias' | 'missing_id';
  candidates?: string[];
}

interface RawRecord {
  id: string;
  title: string;
  aliases: string[];
  path: string;
}

/**
 * Build lookup maps for wikilink resolution from raw records.
 */
export function buildLookupMaps(rawRecords: RawRecord[]): LookupMaps {
  const title_to_ids = new Map<string, string[]>();
  const id_set = new Set<string>();
  const alias_to_ids = new Map<string, string[]>();
  const path_to_id = new Map<string, string>();

  for (const record of rawRecords) {
    // Id set for direct id resolution
    id_set.add(record.id);

    // Title map (lowercase for case-insensitive matching)
    const titleKey = record.title.toLowerCase();
    const titleEntries = title_to_ids.get(titleKey) ?? [];
    titleEntries.push(record.id);
    title_to_ids.set(titleKey, titleEntries);

    // Alias map
    for (const alias of record.aliases) {
      const aliasKey = alias.toLowerCase();
      const aliasEntries = alias_to_ids.get(aliasKey) ?? [];
      aliasEntries.push(record.id);
      alias_to_ids.set(aliasKey, aliasEntries);
    }

    // Path map
    path_to_id.set(record.path, record.id);
  }

  return { title_to_ids, id_set, alias_to_ids, path_to_id };
}

/**
 * Resolve a raw wikilink string to a note id.
 * Follows overview.md 10.7: title match -> alias match -> error.
 */
export function resolveWikilink(
  raw: string,
  lookups: LookupMaps,
): WikilinkResolution | { error: 'no_match' | 'ambiguous_alias'; raw_link: string; candidates?: string[] } {
  const rawTarget = stripWikilinkSyntax(raw);
  // Strip #heading subpath before lookup
  const hashIndex = rawTarget.indexOf('#');
  const target = hashIndex !== -1 ? rawTarget.slice(0, hashIndex).trim() : rawTarget;
  if (target.length === 0) {
    return { error: 'no_match', raw_link: raw };
  }
  const normalized = target.toLowerCase();

  // Step 1: exact match against title
  const titleMatches = lookups.title_to_ids.get(normalized) ?? [];
  if (titleMatches.length === 1) {
    return { target_id: titleMatches[0], resolved_via: 'title' };
  }
  if (titleMatches.length > 1) {
    const uniqueIds = new Set(titleMatches);
    if (uniqueIds.size === 1) {
      return { target_id: titleMatches[0], resolved_via: 'title' };
    }
    return { error: 'ambiguous_alias', raw_link: raw, candidates: titleMatches };
  }

  // Step 2: exact match against note id
  if (lookups.id_set.has(target)) {
    return { target_id: target, resolved_via: 'id' };
  }

  // Step 3: exact match against alias
  const aliasMatches = lookups.alias_to_ids.get(normalized) ?? [];
  if (aliasMatches.length === 1) {
    return { target_id: aliasMatches[0], resolved_via: 'alias' };
  }
  if (aliasMatches.length > 1) {
    return { error: 'ambiguous_alias', raw_link: raw, candidates: aliasMatches };
  }

  // Step 4: no match
  return { error: 'no_match', raw_link: raw };
}

/**
 * Check if a resolution result is successful.
 */
export function isResolved(result: ReturnType<typeof resolveWikilink>): result is WikilinkResolution {
  return 'target_id' in result;
}
