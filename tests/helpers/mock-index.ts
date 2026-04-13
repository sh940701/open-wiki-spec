/**
 * Test helpers for creating mock VaultIndex and IndexRecord objects.
 */
import type { IndexRecord, VaultIndex, IndexWarning, NoteType } from '../../src/types/index.js';

/** Partial override for IndexRecord fields */
export type IndexRecordOverride = Partial<IndexRecord>;

/** Create a minimal IndexRecord with sensible defaults */
export function createRecord(overrides: IndexRecordOverride & { id: string; type: NoteType }): IndexRecord {
  return {
    schema_version: overrides.schema_version ?? '2026-04-06-v1',
    id: overrides.id,
    type: overrides.type,
    title: overrides.title ?? `${capitalize(overrides.type)}: ${overrides.id}`,
    aliases: overrides.aliases ?? [],
    path: overrides.path ?? `wiki/${folderForType(overrides.type)}/${overrides.id}.md`,
    status: overrides.status ?? defaultStatusForType(overrides.type),
    created_at: overrides.created_at,
    tags: overrides.tags ?? [overrides.type],
    systems: overrides.systems ?? [],
    sources: overrides.sources ?? [],
    decisions: overrides.decisions ?? [],
    changes: overrides.changes ?? [],
    feature: overrides.feature,
    features: overrides.features,
    depends_on: overrides.depends_on ?? [],
    touches: overrides.touches ?? [],
    links_out: overrides.links_out ?? [],
    links_in: overrides.links_in ?? [],
    headings: overrides.headings ?? defaultHeadingsForType(overrides.type),
    requirements: overrides.requirements ?? [],
    delta_summary: overrides.delta_summary ?? [],
    tasks: overrides.tasks ?? [],
    raw_text: overrides.raw_text ?? '',
    content_hash: overrides.content_hash ?? 'hash-' + overrides.id,
  };
}

/** Create a VaultIndex from an array of IndexRecords */
export function createIndex(
  records: IndexRecord[],
  overrides?: { schema_version?: string; warnings?: IndexWarning[]; vaultRoot?: string },
): VaultIndex {
  const map = new Map<string, IndexRecord>();
  for (const r of records) {
    map.set(r.id, r);
  }
  return {
    schema_version: overrides?.schema_version ?? '2026-04-06-v1',
    scanned_at: new Date().toISOString(),
    vaultRoot: overrides?.vaultRoot ?? '/tmp/test-vault',
    records: map,
    warnings: overrides?.warnings ?? [],
  };
}

/** Create a Feature IndexRecord with standard sections */
export function createFeature(id: string, overrides?: Partial<IndexRecord>): IndexRecord {
  return createRecord({
    id,
    type: 'feature',
    status: 'active',
    headings: ['Purpose', 'Current Behavior', 'Constraints', 'Known Gaps', 'Requirements', 'Change Log'],
    ...overrides,
  });
}

/** Create a Change IndexRecord with standard sections */
export function createChange(id: string, overrides?: Partial<IndexRecord>): IndexRecord {
  return createRecord({
    id,
    type: 'change',
    status: 'proposed',
    created_at: '2026-04-06',
    headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
    ...overrides,
  });
}

/** Create a System IndexRecord */
export function createSystem(id: string, overrides?: Partial<IndexRecord>): IndexRecord {
  return createRecord({
    id,
    type: 'system',
    status: 'active',
    ...overrides,
  });
}

/** Create a Decision IndexRecord */
export function createDecision(id: string, overrides?: Partial<IndexRecord>): IndexRecord {
  return createRecord({
    id,
    type: 'decision',
    status: 'active',
    ...overrides,
  });
}

/** Create a Source IndexRecord */
export function createSource(id: string, overrides?: Partial<IndexRecord>): IndexRecord {
  return createRecord({
    id,
    type: 'source',
    status: 'active',
    ...overrides,
  });
}

/** Create a Query IndexRecord */
export function createQuery(id: string, overrides?: Partial<IndexRecord>): IndexRecord {
  return createRecord({
    id,
    type: 'query',
    status: 'active',
    ...overrides,
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function folderForType(type: NoteType): string {
  const map: Record<NoteType, string> = {
    feature: '03-features',
    change: '04-changes',
    system: '02-systems',
    decision: '05-decisions',
    source: '01-sources',
    query: '06-queries',
  };
  return map[type];
}

function defaultStatusForType(type: NoteType): string {
  if (type === 'feature') return 'active';
  if (type === 'change') return 'proposed';
  return 'active';
}

function defaultHeadingsForType(type: NoteType): string[] {
  switch (type) {
    case 'feature':
      return ['Purpose', 'Current Behavior', 'Constraints', 'Known Gaps', 'Requirements', 'Change Log'];
    case 'change':
      return ['Why', 'Delta Summary', 'Tasks', 'Validation'];
    default:
      return [];
  }
}
