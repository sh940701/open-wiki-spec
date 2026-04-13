import type { DeltaEntry, FeatureApplyResult, ApplyOperationResult } from './types.js';
import type { Requirement } from '../../../types/requirement.js';

/**
 * Map operation to atomic priority.
 * RENAMED(1) -> REMOVED(2) -> MODIFIED(3) -> ADDED(4)
 */
function getAtomicPriority(op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'): number {
  switch (op) {
    case 'RENAMED': return 1;
    case 'REMOVED': return 2;
    case 'MODIFIED': return 3;
    case 'ADDED': return 4;
  }
}

/**
 * Find the start and end byte offsets of a requirement block in the content.
 * A requirement block starts at `### Requirement: <name>` and ends just before
 * the next heading of level <= 3 (`###`, `##`, `#`) or end of the Requirements section.
 */
function findRequirementBlock(
  content: string,
  reqName: string,
  requirementsSectionEnd: number,
): { start: number; end: number } | null {
  const headingPattern = new RegExp(
    `^### Requirement: ${escapeRegex(reqName)}\\s*$`,
    'm',
  );
  const match = headingPattern.exec(content);
  if (!match) return null;

  const start = match.index;
  if (start >= requirementsSectionEnd) return null;

  // Find the end: next heading of level <= 3, or the Requirements section end
  const afterHeading = start + match[0].length;
  const nextHeadingPattern = /^#{1,3} /m;
  const rest = content.slice(afterHeading, requirementsSectionEnd);
  const nextMatch = nextHeadingPattern.exec(rest);

  const end = nextMatch
    ? afterHeading + nextMatch.index
    : requirementsSectionEnd;

  return { start, end };
}

/**
 * Find the start and end offsets of the `## Requirements` section in the content.
 * The section starts at `## Requirements` and ends just before the next `## ` heading
 * or at end of file.
 */
function findRequirementsSection(content: string): { start: number; end: number } | null {
  const sectionPattern = /^## Requirements\s*$/m;
  const match = sectionPattern.exec(content);
  if (!match) return null;

  const start = match.index;
  const afterHeading = start + match[0].length;

  // Find next ## heading (level 2 or higher) after this section
  const rest = content.slice(afterHeading);
  const nextSectionPattern = /^## /m;
  const nextMatch = nextSectionPattern.exec(rest);

  const end = nextMatch
    ? afterHeading + nextMatch.index
    : content.length;

  return { start, end };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply delta operations to a Feature note's file content.
 * Operations are executed in atomic order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
 *
 * - RENAMED: replaces the heading text programmatically
 * - REMOVED: deletes the entire requirement block
 * - MODIFIED: inserts a marker comment after the heading (agent fills content)
 * - ADDED: appends a requirement skeleton at end of Requirements section
 *
 * Content outside `## Requirements` is preserved byte-for-byte.
 * Returns the rebuilt content in `updatedContent`.
 */
export function applyDeltaToFeature(
  featureId: string,
  featurePath: string,
  requirementsMap: Map<string, Requirement>,
  entries: DeltaEntry[],
  fileContent?: string,
  changeId?: string,
): FeatureApplyResult {
  const operations: ApplyOperationResult[] = [];

  // Sort by atomic priority
  const sorted = [...entries]
    .filter((e) => e.targetType === 'requirement')
    .sort((a, b) => getAtomicPriority(a.op) - getAtomicPriority(b.op));

  // Track in-memory map changes for validation. We snapshot the set of
  // pre-existing requirement names so the ADDED write phase can skip the
  // skeleton insertion when a requirement already exists (no-op retry
  // semantics — see preValidateEntry in apply.ts).
  const preExistingReqNames = new Set(requirementsMap.keys());
  for (const entry of sorted) {
    const result = validateOperation(requirementsMap, entry);
    operations.push(result);
  }

  // If no file content provided, return empty updatedContent (legacy behavior)
  if (fileContent === undefined) {
    return {
      featureId,
      featurePath,
      operations,
      updatedContent: '',
      requiresWrite: operations.some((o) => o.success),
    };
  }

  // Apply operations to file content
  let content = fileContent;

  // Process operations in atomic order on the actual content
  for (const opResult of operations) {
    if (!opResult.success) continue;

    const entry = opResult.entry;
    const section = findRequirementsSection(content);
    if (!section) {
      // Missing Requirements section: record clear failure instead of silently skipping.
      // This prevents ADDED operations from appearing successful while doing nothing.
      opResult.success = false;
      opResult.error = `Feature "${featureId}" has no "## Requirements" section. Cannot apply ${entry.op} on "${entry.targetName}". Add the section to the Feature note first.`;
      continue;
    }

    switch (entry.op) {
      case 'RENAMED': {
        const oldHeadingPattern = new RegExp(
          `^(### Requirement: )${escapeRegex(entry.targetName)}(\\s*)$`,
          'm',
        );
        content = content.replace(oldHeadingPattern, `$1${entry.newName!}$2`);
        break;
      }

      case 'REMOVED': {
        const block = findRequirementBlock(content, entry.targetName, section.end);
        if (block) {
          // Remove the block, trimming trailing blank lines to keep formatting clean
          const before = content.slice(0, block.start);
          const after = content.slice(block.end);
          content = before + after;
        }
        break;
      }

      case 'MODIFIED': {
        // Insert a marker comment after the requirement heading line
        const headingPattern = new RegExp(
          `^(### Requirement: ${escapeRegex(entry.targetName)}\\s*)$`,
          'm',
        );
        const markerChangeId = changeId || '';
        const marker = `\n<!-- MODIFIED by change: ${markerChangeId} -->`;
        content = content.replace(headingPattern, `$1${marker}`);
        break;
      }

      case 'ADDED': {
        // Skip skeleton insertion when the requirement already exists in
        // the parsed Feature — this happens on --no-auto-transition retry
        // or crash recovery. validateOperation already promoted this to a
        // success, and re-inserting would duplicate the skeleton.
        if (preExistingReqNames.has(entry.targetName)) {
          break;
        }
        const markerChangeId = changeId || '';
        const skeleton = `\n### Requirement: ${entry.targetName}\n\n<!-- ADDED by change: ${markerChangeId}. Fill in normative statement (SHALL/MUST) and scenarios (WHEN/THEN). -->\n`;
        // Insert before the end of the Requirements section
        const before = content.slice(0, section.end);
        const after = content.slice(section.end);
        content = before + skeleton + after;
        break;
      }
    }
  }

  return {
    featureId,
    featurePath,
    operations,
    updatedContent: content,
    requiresWrite: operations.some((o) => o.success),
  };
}

/**
 * Extract a change identifier from the entry for use in markers.
 * Uses the targetNote or a sanitized version of rawLine.
 */
function extractChangeContext(entry: DeltaEntry): string {
  // Use the targetNote field which contains the change context
  return entry.targetNote || '';
}

/**
 * Validate a single operation against the requirements map.
 * Also updates the map to reflect successful operations (for subsequent validations).
 */
function validateOperation(
  requirements: Map<string, Requirement>,
  entry: DeltaEntry,
): ApplyOperationResult {
  switch (entry.op) {
    case 'RENAMED': {
      const oldReq = requirements.get(entry.targetName);
      if (!oldReq) {
        return { entry, success: false, error: `Requirement "${entry.targetName}" not found for RENAME` };
      }
      if (requirements.has(entry.newName!)) {
        return { entry, success: false, error: `Target name "${entry.newName}" already exists` };
      }
      requirements.delete(entry.targetName);
      const renamed = { ...oldReq, name: entry.newName!, key: '' };
      requirements.set(entry.newName!, renamed);
      return { entry, success: true };
    }

    case 'REMOVED': {
      if (!requirements.has(entry.targetName)) {
        return { entry, success: false, error: `Requirement "${entry.targetName}" not found for REMOVE` };
      }
      requirements.delete(entry.targetName);
      return { entry, success: true };
    }

    case 'MODIFIED': {
      if (!requirements.has(entry.targetName)) {
        return { entry, success: false, error: `Requirement "${entry.targetName}" not found for MODIFY` };
      }
      return { entry, success: true, contentChanged: true };
    }

    case 'ADDED': {
      // No-op on retry: if the requirement already exists (e.g., a prior
      // --no-auto-transition run inserted the skeleton, or apply was retried
      // after a crash), treat as success so the status transition can
      // proceed. The write phase uses the pre-existing name set to skip
      // re-inserting the skeleton — see applyDeltaToFeature below. This
      // matches the preValidateEntry contract in apply.ts.
      return { entry, success: true };
    }
  }
}
