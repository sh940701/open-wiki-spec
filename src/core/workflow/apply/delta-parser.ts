import type { DeltaEntry, DeltaPlan } from './types.js';
import type { ParseResult } from '../../parser/types.js';
import type { VaultIndex } from '../../../types/index-record.js';

// Requirement name body: any char except unescaped quote. Supports \" escape.
// Matches: "simple", "say \"hi\"", "contains \\ backslash"
const QUOTED_NAME = '(?:[^"\\\\]|\\\\.)*';

const REQUIREMENT_OP_RE =
  new RegExp(
    `^-\\s+(ADDED|MODIFIED|REMOVED)\\s+requirement\\s+"(${QUOTED_NAME})"\\s+(to|in|from)\\s+\\[\\[([^\\]]+)\\]\\](?:\\s+\\[base:\\s*((?:sha256:[a-f0-9]+)|n\\/a|migrated)\\])?`,
  );

const RENAMED_RE =
  new RegExp(
    `^-\\s+RENAMED\\s+requirement\\s+"(${QUOTED_NAME})"\\s+to\\s+"(${QUOTED_NAME})"\\s+in\\s+\\[\\[([^\\]]+)\\]\\](?:\\s+\\[base:\\s*((?:sha256:[a-f0-9]+)|n\\/a|migrated)\\])?`,
  );

const SECTION_OP_RE =
  new RegExp(
    `^-\\s+(ADDED|MODIFIED|REMOVED)\\s+section\\s+"(${QUOTED_NAME})"\\s+(to|in|from)\\s+\\[\\[([^\\]]+)\\]\\](?::\\s*(.+))?`,
  );

/**
 * Unescape a quoted-string value captured by the delta regex.
 * Reverses `\"` → `"` and `\\` → `\`.
 */
function unescapeQuoted(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

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

  // Track line number within the Delta Summary section (1-based) so error
  // messages can point at the exact malformed line. Using a section-local
  // counter keeps the number meaningful across narrative bullets and
  // code-fence content that split() produces.
  let lineNumber = 0;
  for (const line of lines) {
    lineNumber++;
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('-')) continue;

    // Try RENAMED first (more specific pattern)
    const renamedMatch = trimmed.match(RENAMED_RE);
    if (renamedMatch) {
      const targetNoteId = resolveWikilink(renamedMatch[3]);
      entries.push({
        op: 'RENAMED',
        targetType: 'requirement',
        targetName: unescapeQuoted(renamedMatch[1]),
        newName: unescapeQuoted(renamedMatch[2]),
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
        targetName: unescapeQuoted(reqMatch[2]),
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
        targetName: unescapeQuoted(secMatch[2]),
        targetNote: secMatch[4],
        targetNoteId,
        baseFingerprint: null,
        description: secMatch[5]?.trim(),
        rawLine: trimmed,
      });
      continue;
    }

    // Unrecognized line. Include the relative line number so users can
    // jump to it quickly — the apply command promotes these warnings to
    // errors, and without a line number they have to eyeball the whole
    // Delta Summary to find the broken entry.
    if (trimmed.match(/^-\s+(ADDED|MODIFIED|REMOVED|RENAMED)/)) {
      warnings.push(
        `Unparseable Delta Summary entry (section-relative line ${lineNumber}): "${trimmed}"`,
      );
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
      // RENAMED A→B + REMOVED B: the atomic order RENAMED→REMOVED
      // would rename A to B, then immediately remove B, leaving both
      // A and B gone. That almost never matches author intent (they
      // probably meant REMOVE A directly) and is unreachable to audit
      // after the fact. Block it.
      if (removed.has(to)) {
        errors.push(
          `"${to}" in ${noteKey}: RENAMED "${from}" TO "${to}" + REMOVED "${to}" — both requirements disappear. ` +
            `If you meant to delete "${from}", use REMOVED "${from}" directly.`,
        );
      }
      // RENAMED A→B + REMOVED A: A is gone twice. REMOVED runs before
      // RENAMED in the atomic order, so REMOVED A would succeed, then
      // RENAMED A→B would fail ("not found"). Surface up front.
      if (removed.has(from)) {
        errors.push(
          `"${from}" in ${noteKey}: RENAMED "${from}" TO "${to}" + REMOVED "${from}" — the old name is removed before rename runs.`,
        );
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
