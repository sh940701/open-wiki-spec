import { join } from 'node:path';
import { stringify } from 'yaml';
import type { QueryObject, ProposeDeps } from './types.js';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import type { SequencingResult } from '../../../types/sequencing.js';
import { generateId } from '../../../utils/id-generator.js';
import { assertInsideVault } from '../../../utils/path-safety.js';

/**
 * Create a Feature note with stub sections.
 */
export function createFeatureNote(
  vaultRoot: string,
  query: QueryObject,
  index: VaultIndex,
  deps: Pick<ProposeDeps, 'writeFile'>,
): { id: string; path: string; title: string } {
  const featureId = deduplicateId(generateId('feature', query.summary), index);
  const title = titleFromId(featureId, 'feature');
  const noteTitle = `Feature: ${title}`;

  // Resolve systems from query's system_terms
  const systems: string[] = [];
  for (const term of query.system_terms) {
    const systemRecord = findSystemByName(term, index);
    if (systemRecord) {
      systems.push(`[[${systemRecord.title}]]`);
    }
  }

  const frontmatter = {
    type: 'feature',
    id: featureId,
    status: 'active',
    aliases: [noteTitle, title],
    systems,
    sources: [] as string[],
    decisions: [] as string[],
    changes: [] as string[],
    tags: ['feature'],
  };

  const body = [
    `# ${noteTitle}`,
    '',
    '## Purpose',
    '',
    '## Current Behavior',
    '',
    '## Constraints',
    '',
    '## Known Gaps',
    '',
    '## Requirements',
    '',
    '## Related Notes',
    '',
  ].join('\n');

  const content = formatNoteContent(frontmatter, body);
  const featurePath = join(vaultRoot, 'wiki', '03-features', `${slugFromId(featureId)}.md`);
  assertInsideVault(featurePath, vaultRoot);
  deps.writeFile(featurePath, content);

  return { id: featureId, path: featurePath, title: noteTitle };
}

/**
 * Create a Change note linked to a Feature with stub sections.
 */
export function createChangeNote(
  vaultRoot: string,
  feature: { id: string; title?: string },
  query: QueryObject,
  sequencingFull: SequencingResult,
  index: VaultIndex,
  deps: Pick<ProposeDeps, 'writeFile'>,
): { id: string; path: string; title: string } {
  const changeId = deduplicateId(generateId('change', query.summary), index);
  const title = titleFromId(changeId, 'change');

  const depends_on = computeDependsOn(feature, sequencingFull);
  const touches = computeTouches(feature, query, index);

  const featureTitle = feature.title ?? titleFromId(feature.id, 'feature');

  const changeNoteTitle = `Change: ${title}`;
  const frontmatter = {
    type: 'change',
    id: changeId,
    status: 'proposed',
    created_at: new Date().toLocaleDateString('en-CA'),
    aliases: [changeNoteTitle, title],
    feature: `[[${featureTitle}]]`,
    depends_on: depends_on.map((id) => {
      const rec = index.records.get(id);
      return `[[${rec?.title ?? id}]]`;
    }),
    touches: touches.map((touchId) => {
      if (touchId === feature.id) {
        return `[[${featureTitle}]]`;
      }
      const rec = index.records.get(touchId);
      return `[[${rec?.title ?? touchId}]]`;
    }),
    systems: [] as string[],
    sources: [] as string[],
    decisions: [] as string[],
    tags: ['change'],
  };

  const body = [
    `# Change: ${title}`,
    '',
    '## Why',
    '',
    '## Delta Summary',
    '',
    '## Proposed Update',
    '',
    '## Design Approach',
    '',
    '## Impact',
    '',
    '## Tasks',
    '',
    '## Validation',
    '',
    '## Status Notes',
    '',
  ].join('\n');

  const content = formatNoteContent(frontmatter, body);
  const changePath = join(vaultRoot, 'wiki', '04-changes', `${slugFromId(changeId)}.md`);
  assertInsideVault(changePath, vaultRoot);
  deps.writeFile(changePath, content);

  return { id: changeId, path: changePath, title: `Change: ${title}` };
}

/**
 * Compute depends_on from sequencing analysis.
 * Depends on the earlier change in any pairwise severity or requirement conflict
 * that touches the same Feature.
 */
export function computeDependsOn(
  feature: { id: string },
  sequencingFull: SequencingResult,
): string[] {
  const depends_on: string[] = [];

  for (const overlap of sequencingFull.pairwise_severities) {
    if (overlap.overlapping_features.includes(feature.id)) {
      const posA = sequencingFull.ordering.find((o) => o.id === overlap.change_a)?.position ?? Infinity;
      const posB = sequencingFull.ordering.find((o) => o.id === overlap.change_b)?.position ?? Infinity;
      const earlierId = posA < posB ? overlap.change_a : overlap.change_b;
      if (!depends_on.includes(earlierId)) {
        depends_on.push(earlierId);
      }
    }
  }

  for (const conflict of sequencingFull.requirement_conflicts) {
    if (conflict.feature_id === feature.id) {
      const posA = sequencingFull.ordering.find((o) => o.id === conflict.change_a)?.position ?? Infinity;
      const posB = sequencingFull.ordering.find((o) => o.id === conflict.change_b)?.position ?? Infinity;
      const earlierId = posA < posB ? conflict.change_a : conflict.change_b;
      if (!depends_on.includes(earlierId)) {
        depends_on.push(earlierId);
      }
    }
  }

  return [...new Set(depends_on)];
}

/**
 * Compute touches from target Feature + query system_terms + Feature's systems.
 */
export function computeTouches(
  feature: { id: string },
  query: QueryObject,
  index: VaultIndex,
): string[] {
  const touches: string[] = [feature.id];

  for (const term of query.system_terms) {
    const systemRecord = findSystemByName(term, index);
    if (systemRecord) {
      touches.push(systemRecord.id);
    }
  }

  const featureRecord = index.records.get(feature.id);
  if (featureRecord) {
    for (const sysId of featureRecord.systems) {
      if (!touches.includes(sysId)) {
        touches.push(sysId);
      }
    }
  }

  return [...new Set(touches)];
}

function findSystemByName(term: string, index: VaultIndex): IndexRecord | null {
  const lowerTerm = term.toLowerCase();
  for (const record of index.records.values()) {
    if (record.type !== 'system') continue;
    if (record.title.toLowerCase() === lowerTerm) return record;
    if (record.aliases.some((a) => a.toLowerCase() === lowerTerm)) return record;
  }
  return null;
}

/**
 * If `id` already exists in the index (including archived records),
 * append `-2`, `-3`, etc. until a unique ID is found.
 */
function deduplicateId(id: string, index: VaultIndex): string {
  if (!index.records.has(id)) return id;
  let suffix = 2;
  while (index.records.has(`${id}-${suffix}`)) {
    suffix++;
  }
  return `${id}-${suffix}`;
}

function titleFromId(id: string, prefix: string): string {
  const slug = id.startsWith(`${prefix}-`) ? id.slice(prefix.length + 1) : id;
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function slugFromId(id: string): string {
  return id;
}

function formatNoteContent(frontmatter: Record<string, unknown>, body: string): string {
  const yamlStr = stringify(frontmatter, { lineWidth: 0 });
  return `---\n${yamlStr}---\n\n${body}`;
}
