import type { DeltaEntry, DeltaPlan } from './types.js';
import type { ParseResult } from '../../parser/types.js';
import type { VaultIndex } from '../../../types/index-record.js';

const REQUIREMENT_OP_RE =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/;

const RENAMED_RE =
  /^-\s+RENAMED\s+requirement\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/;

const SECTION_OP_RE =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+section\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?::\s*(.+))?/;

/**
 * Parse Delta Summary entries from a Change note's parsed result.
 */
export function parseDeltaSummary(
  parsed: ParseResult,
  resolveWikilink: (target: string) => string | undefined,
): DeltaPlan {
  // Find the Delta Summary section
  const deltaSection = findSection(parsed, 'Delta Summary');
  if (!deltaSection) {
    return { entries: [], byTargetNote: new Map(), warnings: ['No Delta Summary section found'] };
  }

  const lines = deltaSection.split('\n');
  const entries: DeltaEntry[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('-')) continue;

    // Try RENAMED first (more specific pattern)
    const renamedMatch = trimmed.match(RENAMED_RE);
    if (renamedMatch) {
      const targetNoteId = resolveWikilink(renamedMatch[3]);
      entries.push({
        op: 'RENAMED',
        targetType: 'requirement',
        targetName: renamedMatch[1],
        newName: renamedMatch[2],
        targetNote: renamedMatch[3],
        targetNoteId,
        baseFingerprint: parseBaseFingerprint(renamedMatch[4]),
        rawLine: trimmed,
      });
      continue;
    }

    // Try requirement operation
    const reqMatch = trimmed.match(REQUIREMENT_OP_RE);
    if (reqMatch) {
      const targetNoteId = resolveWikilink(reqMatch[4]);
      entries.push({
        op: reqMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED',
        targetType: 'requirement',
        targetName: reqMatch[2],
        targetNote: reqMatch[4],
        targetNoteId,
        baseFingerprint: parseBaseFingerprint(reqMatch[5]),
        rawLine: trimmed,
      });
      continue;
    }

    // Try section operation
    const secMatch = trimmed.match(SECTION_OP_RE);
    if (secMatch) {
      const targetNoteId = resolveWikilink(secMatch[4]);
      entries.push({
        op: secMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED',
        targetType: 'section',
        targetName: secMatch[2],
        targetNote: secMatch[4],
        targetNoteId,
        baseFingerprint: null,
        description: secMatch[5]?.trim(),
        rawLine: trimmed,
      });
      continue;
    }

    // Unrecognized line
    if (trimmed.match(/^-\s+(ADDED|MODIFIED|REMOVED|RENAMED)/)) {
      warnings.push(`Unparseable Delta Summary entry: "${trimmed}"`);
    }
  }

  // Group by target note
  const byTargetNote = new Map<string, DeltaEntry[]>();
  for (const entry of entries) {
    const key = entry.targetNoteId ?? entry.targetNote;
    const group = byTargetNote.get(key) ?? [];
    group.push(entry);
    byTargetNote.set(key, group);
  }

  return { entries, byTargetNote, warnings };
}

/**
 * Validate Delta Summary entries for cross-section conflicts.
 */
export function validateDeltaConflicts(plan: DeltaPlan): string[] {
  const errors: string[] = [];

  for (const [noteKey, entries] of plan.byTargetNote) {
    const reqEntries = entries.filter((e) => e.targetType === 'requirement');

    const added = new Set(reqEntries.filter((e) => e.op === 'ADDED').map((e) => e.targetName));
    const modified = new Set(reqEntries.filter((e) => e.op === 'MODIFIED').map((e) => e.targetName));
    const removed = new Set(reqEntries.filter((e) => e.op === 'REMOVED').map((e) => e.targetName));
    const renamedFrom = new Map(
      reqEntries.filter((e) => e.op === 'RENAMED').map((e) => [e.targetName, e.newName!]),
    );
    const renamedTo = new Set(
      reqEntries.filter((e) => e.op === 'RENAMED').map((e) => e.newName!),
    );

    // Duplicate within same operation
    const addedList = reqEntries.filter((e) => e.op === 'ADDED').map((e) => e.targetName);
    for (const d of findDuplicates(addedList)) {
      errors.push(`Duplicate ADDED requirement "${d}" in ${noteKey}`);
    }

    const modifiedList = reqEntries.filter((e) => e.op === 'MODIFIED').map((e) => e.targetName);
    for (const d of findDuplicates(modifiedList)) {
      errors.push(`Duplicate MODIFIED requirement "${d}" in ${noteKey}`);
    }

    const removedList = reqEntries.filter((e) => e.op === 'REMOVED').map((e) => e.targetName);
    for (const d of findDuplicates(removedList)) {
      errors.push(`Duplicate REMOVED requirement "${d}" in ${noteKey}`);
    }

    const renamedFromList = reqEntries.filter((e) => e.op === 'RENAMED').map((e) => e.targetName);
    for (const d of findDuplicates(renamedFromList)) {
      errors.push(`Duplicate RENAMED (from) requirement "${d}" in ${noteKey}`);
    }

    const renamedToList = reqEntries.filter((e) => e.op === 'RENAMED').map((e) => e.newName!);
    for (const d of findDuplicates(renamedToList)) {
      errors.push(`Duplicate RENAMED (to) requirement "${d}" in ${noteKey}`);
    }

    // Cross-section conflicts
    for (const name of modified) {
      if (removed.has(name)) errors.push(`"${name}" in ${noteKey}: MODIFIED + REMOVED conflict`);
      if (added.has(name)) errors.push(`"${name}" in ${noteKey}: MODIFIED + ADDED conflict`);
    }
    for (const name of added) {
      if (removed.has(name)) errors.push(`"${name}" in ${noteKey}: ADDED + REMOVED conflict`);
    }

    // RENAMED interplay
    for (const [from, to] of renamedFrom) {
      if (modified.has(from)) {
        errors.push(`"${from}" in ${noteKey}: RENAMED FROM + MODIFIED old name (use new name "${to}")`);
      }
      if (added.has(to)) {
        errors.push(`"${to}" in ${noteKey}: RENAMED TO + ADDED collision`);
      }
    }
  }

  return errors;
}

function parseBaseFingerprint(raw?: string): string | null {
  if (!raw || raw === 'n/a') return null;
  return raw;
}

function findSection(parsed: ParseResult, title: string): string | null {
  for (const section of parsed.sections) {
    if (section.title === title) return section.content;
    for (const child of section.children) {
      if (child.title === title) return child.content;
    }
  }
  return null;
}

function findDuplicates(arr: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const item of arr) {
    if (seen.has(item)) dupes.add(item);
    seen.add(item);
  }
  return [...dupes];
}
