import type { Section, ParseError } from './types.js';
import type { DeltaSummaryEntry } from '../../types/delta.js';
import { findSection } from './section-parser.js';

// Requirement ops: ADDED/MODIFIED/REMOVED requirement "name" to/in/from [[Feature]]
const REQUIREMENT_OP_REGEX =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s*:\s*(.+?))?(?:\s+\[base:\s*([^\]]+)\])?$/;

// RENAMED requirement "old" to "new" in [[Feature]]
const RENAMED_OP_REGEX =
  /^-\s+RENAMED\s+requirement\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*([^\]]+)\])?$/;

// Section ops: ADDED/MODIFIED/REMOVED section "name" to/in/from [[Note]]
const SECTION_OP_REGEX =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+section\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s*:\s*(.+?))?(?:\s+\[base:\s*([^\]]+)\])?$/;

/**
 * Parse Delta Summary entries from a Change note's section tree.
 */
export function parseDeltaSummary(
  sections: Section[],
): { entries: DeltaSummaryEntry[]; errors: ParseError[] } {
  const entries: DeltaSummaryEntry[] = [];
  const errors: ParseError[] = [];

  const deltaSection = findSection(sections, 'Delta Summary');
  if (!deltaSection) {
    return { entries, errors };
  }

  const lines = deltaSection.content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('- ')) continue;

    const lineNum = deltaSection.line + i + 1;

    // Try RENAMED first (most specific)
    const renamedMatch = line.match(RENAMED_OP_REGEX);
    if (renamedMatch) {
      entries.push({
        op: 'RENAMED',
        target_type: 'requirement',
        target_name: renamedMatch[1],
        new_name: renamedMatch[2],
        target_note_id: renamedMatch[3],
        base_fingerprint: normalizeFingerprint(renamedMatch[4] ?? null),
        description: '',
      });
      validateFingerprint('RENAMED', renamedMatch[4] ?? null, renamedMatch[1], lineNum, errors);
      continue;
    }

    // Try requirement operations
    const reqMatch = line.match(REQUIREMENT_OP_REGEX);
    if (reqMatch) {
      const op = reqMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED';
      entries.push({
        op,
        target_type: 'requirement',
        target_name: reqMatch[2],
        target_note_id: reqMatch[4],
        base_fingerprint: normalizeFingerprint(reqMatch[6] ?? null),
        description: reqMatch[5] ?? '',
      });
      validateFingerprint(op, reqMatch[6] ?? null, reqMatch[2], lineNum, errors);
      continue;
    }

    // Try section operations
    const secMatch = line.match(SECTION_OP_REGEX);
    if (secMatch) {
      const secOp = secMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED';
      entries.push({
        op: secOp,
        target_type: 'section',
        target_name: secMatch[2],
        target_note_id: secMatch[4],
        base_fingerprint: normalizeFingerprint(secMatch[6] ?? null),
        description: secMatch[5] ?? '',
      });
      validateFingerprint(secOp, secMatch[6] ?? null, secMatch[2], lineNum, errors);
      continue;
    }

    // Unparseable line with delta op keyword
    if (line.match(/^-\s+(ADDED|MODIFIED|REMOVED|RENAMED)/)) {
      errors.push({
        level: 'warning',
        source: 'delta_summary',
        message: `Delta Summary line does not match expected grammar: "${line}"`,
        line: lineNum,
      });
    }
  }

  return { entries, errors };
}

function normalizeFingerprint(raw: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === 'n/a' || trimmed === 'N/A') return null;
  return trimmed;
}

function validateFingerprint(
  op: string,
  baseFP: string | null,
  name: string,
  line: number,
  errors: ParseError[],
): void {
  if (op === 'ADDED') return;
  if (!baseFP || baseFP.trim() === 'n/a' || baseFP.trim() === 'N/A') {
    errors.push({
      level: 'warning',
      source: 'delta_summary',
      message: `${op} entry for "${name}" is missing base_fingerprint (expected [base: sha256:...])`,
      line,
    });
  }
}
