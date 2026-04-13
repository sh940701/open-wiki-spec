/**
 * Completeness dimension checks.
 * Verifies that required sections, links, and requirements are present.
 */
import type { VaultIndex, IndexRecord } from '../../../types/index.js';
import type { VerifyIssue } from '../../../types/verify.js';
import { FEATURE_REQUIRED_SECTIONS } from '../../schema/feature.schema.js';
const CHANGE_REQUIRED_SECTIONS = ['Why'];

/** Sections whose body must contain meaningful content (not just a heading). */
const CHANGE_CONTENT_REQUIRED_SECTIONS = ['Why', 'Delta Summary', 'Tasks', 'Validation'];
/** Minimum non-whitespace characters to consider a section non-empty. */
const MIN_SECTION_CONTENT_LENGTH = 10;

/** Threshold for considering a change "complex" (triggers Design Approach warning) */
const COMPLEX_CHANGE_DELTA_THRESHOLD = 3;

/**
 * Check completeness of a Feature note.
 * Required: Purpose, Current Behavior, Constraints, Known Gaps, Requirements sections.
 * Requirements must have SHALL/MUST and at least one scenario.
 */
export function checkFeatureCompleteness(feature: IndexRecord, _index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  // Required sections
  for (const section of FEATURE_REQUIRED_SECTIONS) {
    if (!feature.headings.includes(section)) {
      issues.push({
        dimension: 'completeness',
        severity: 'error',
        code: 'MISSING_SECTION',
        message: `Feature "${feature.id}" is missing required section "${section}"`,
        note_id: feature.id,
        note_path: feature.path,
        suggestion: `Add a "## ${section}" section to the Feature note.`,
      });
    }
  }

  // Machine-verifiable requirements
  if (feature.requirements.length === 0) {
    issues.push({
      dimension: 'completeness',
      severity: 'error',
      code: 'MISSING_REQUIREMENTS',
      message: `Feature "${feature.id}" has no requirements defined`,
      note_id: feature.id,
      note_path: feature.path,
      suggestion: 'Add at least one "### Requirement: <name>" under the Requirements section.',
    });
  }

  // Duplicate requirement name check: the parser skips the second
  // occurrence and records a parse error, but that error doesn't make
  // it into the verify report on its own. Surface duplicates here so
  // users see a clear completeness error instead of silently losing a
  // requirement entry. Note: seen is built from parser output, which
  // already deduped — so duplicates show up as "parser skipped N".
  // We detect via raw headings instead: count `### Requirement: X`
  // occurrences across the Feature's headings list.
  const requirementHeadingCounts = new Map<string, number>();
  for (const heading of feature.headings) {
    const match = heading.match(/^Requirement:\s*(.+)$/i);
    if (match) {
      const name = match[1].trim();
      requirementHeadingCounts.set(name, (requirementHeadingCounts.get(name) ?? 0) + 1);
    }
  }
  for (const [name, count] of requirementHeadingCounts) {
    if (count > 1) {
      issues.push({
        dimension: 'completeness',
        severity: 'error',
        code: 'MISSING_REQUIREMENTS',
        message: `Requirement "${name}" in Feature "${feature.id}" appears ${count} times — each name must be unique within the Feature.`,
        note_id: feature.id,
        note_path: feature.path,
        suggestion: `Rename the duplicate headings (e.g., "${name} (auth flow)", "${name} (legacy)") or merge them into one requirement.`,
      });
    }
  }

  // Each requirement must have SHALL/MUST and at least one scenario.
  // Migrated notes (from OpenSpec) may not follow this convention — downgrade to warning.
  const isMigrated = feature.tags?.includes('migrated') ?? false;
  const reqSeverity = isMigrated ? 'warning' as const : 'error' as const;
  for (const req of feature.requirements) {
    if (!/\b(SHALL|MUST)\b/.test(req.normative)) {
      issues.push({
        dimension: 'completeness',
        severity: reqSeverity,
        code: 'MISSING_REQUIREMENTS',
        message: `Requirement "${req.name}" in Feature "${feature.id}" lacks SHALL or MUST keyword`,
        note_id: feature.id,
        note_path: feature.path,
        suggestion: isMigrated
          ? 'Migrated requirement — consider adding SHALL/MUST when updating this Feature.'
          : 'Normative statements must contain SHALL or MUST.',
      });
    }
    if (req.scenarios.length === 0) {
      issues.push({
        dimension: 'completeness',
        severity: reqSeverity,
        code: 'MISSING_REQUIREMENTS',
        message: `Requirement "${req.name}" in Feature "${feature.id}" has no scenario defined`,
        note_id: feature.id,
        note_path: feature.path,
        suggestion: isMigrated
          ? 'Migrated requirement — consider adding WHEN/THEN scenarios when updating.'
          : 'Add at least one "#### Scenario:" with WHEN/THEN format.',
      });
    }
  }

  return issues;
}

/**
 * Check completeness of a Change note.
 * Hard prerequisites: Why section, Delta Summary, Tasks, Validation.
 * Soft prerequisites: Design Approach (warning for complex changes).
 */
export function checkChangeCompleteness(change: IndexRecord, _index: VaultIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  // Hard prerequisites - section headings
  for (const section of CHANGE_REQUIRED_SECTIONS) {
    if (!change.headings.includes(section)) {
      issues.push({
        dimension: 'completeness',
        severity: 'error',
        code: 'MISSING_SECTION',
        message: `Change "${change.id}" is missing required section "${section}"`,
        note_id: change.id,
        note_path: change.path,
        suggestion: `Add a "## ${section}" section to the Change note.`,
      });
    }
  }

  // Delta Summary check. Migrated changes (OpenSpec's free-form
  // "What Changes" doesn't map cleanly to canonical delta_summary) get
  // a warning instead of an error so a fresh migration doesn't fail
  // verify out of the gate. Authors still need to fill in canonical
  // delta_summary before `ows apply` can run.
  const isMigratedChange = change.tags?.includes('migrated') ?? false;
  if (change.delta_summary.length === 0) {
    issues.push({
      dimension: 'completeness',
      severity: isMigratedChange ? 'warning' : 'error',
      code: 'MISSING_DELTA_SUMMARY',
      message: `Change "${change.id}" has no Delta Summary entries`,
      note_id: change.id,
      note_path: change.path,
      suggestion: isMigratedChange
        ? 'Migrated from OpenSpec — fill in canonical Delta Summary (ADDED/MODIFIED/REMOVED/RENAMED) before applying.'
        : 'Add a Delta Summary with ADDED/MODIFIED/REMOVED/RENAMED operations.',
    });
  }

  // Tasks check
  if (change.tasks.length === 0) {
    issues.push({
      dimension: 'completeness',
      severity: 'error',
      code: 'MISSING_TASKS',
      message: `Change "${change.id}" has no tasks defined`,
      note_id: change.id,
      note_path: change.path,
      suggestion: 'Add a Tasks section with checkbox items.',
    });
  }

  // Validation section check
  if (!change.headings.includes('Validation')) {
    issues.push({
      dimension: 'completeness',
      severity: 'error',
      code: 'MISSING_VALIDATION',
      message: `Change "${change.id}" is missing required section "Validation"`,
      note_id: change.id,
      note_path: change.path,
      suggestion: 'Add a "## Validation" section describing how to verify this change.',
    });
  }

  // Required links - feature
  if (change.feature == null && (change.features == null || change.features.length === 0)) {
    issues.push({
      dimension: 'completeness',
      severity: 'error',
      code: 'MISSING_LINK',
      message: `Change "${change.id}" has no linked Feature`,
      note_id: change.id,
      note_path: change.path,
      suggestion: 'Add a "feature" or "features" field to the Change frontmatter.',
    });
  }

  // Soft prerequisite - Design Approach for complex changes
  if (!change.headings.includes('Design Approach') && isComplexChange(change)) {
    issues.push({
      dimension: 'completeness',
      severity: 'warning',
      code: 'MISSING_DESIGN_APPROACH',
      message: `Change "${change.id}" has ${change.delta_summary.length} delta entries but no Design Approach section`,
      note_id: change.id,
      note_path: change.path,
      suggestion: 'Consider adding a "## Design Approach" section for complex changes.',
    });
  }

  // Empty required sections check — heading present but body too short
  for (const section of CHANGE_CONTENT_REQUIRED_SECTIONS) {
    if (change.headings.includes(section)) {
      const body = extractSectionBody(change.raw_text, section);
      const nonWs = body.replace(/\s/g, '');
      if (nonWs.length < MIN_SECTION_CONTENT_LENGTH) {
        issues.push({
          dimension: 'completeness',
          severity: 'warning',
          code: 'EMPTY_REQUIRED_SECTION',
          message: `Change "${change.id}" has section "${section}" but its body is empty or too short`,
          note_id: change.id,
          note_path: change.path,
          suggestion: `Add meaningful content to the "${section}" section (at least ${MIN_SECTION_CONTENT_LENGTH} characters).`,
        });
      }
    }
  }

  // System link warning
  if (change.systems.length === 0) {
    issues.push({
      dimension: 'completeness',
      severity: 'warning',
      code: 'MISSING_LINK',
      message: `Change "${change.id}" has no linked System`,
      note_id: change.id,
      note_path: change.path,
      suggestion: 'Add systems to the Change frontmatter.',
    });
  }

  return issues;
}

/**
 * Extract the body text between a heading and the next heading of equal or higher level.
 */
function extractSectionBody(rawText: string, sectionName: string): string {
  const lines = rawText.split('\n');
  let capturing = false;
  let sectionLevel = 0;
  const bodyLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (capturing) {
        // Stop at same or higher-level heading
        if (level <= sectionLevel) break;
      }
      if (!capturing && title === sectionName) {
        capturing = true;
        sectionLevel = level;
        continue; // skip the heading line itself
      }
    }
    if (capturing) {
      bodyLines.push(line);
    }
  }

  return bodyLines.join('\n');
}

/** Note types that require at least a Purpose or Summary section with content. */
const BODY_REQUIRED_TYPES: Set<string> = new Set(['system', 'decision', 'source', 'query']);
const BODY_REQUIRED_SECTIONS = ['Purpose', 'Summary'];

/**
 * Check minimum sections for System, Decision, Source, Query notes.
 * These notes should have at least a Purpose or Summary section with meaningful content.
 */
export function checkMinimumSections(note: IndexRecord): VerifyIssue[] {
  if (!BODY_REQUIRED_TYPES.has(note.type)) return [];

  const issues: VerifyIssue[] = [];

  const hasRequiredSection = BODY_REQUIRED_SECTIONS.some((section) =>
    note.headings.includes(section),
  );

  if (!hasRequiredSection) {
    issues.push({
      dimension: 'completeness',
      severity: 'warning',
      code: 'MISSING_SECTION',
      message: `${capitalize(note.type)} "${note.id}" has no Purpose or Summary section`,
      note_id: note.id,
      note_path: note.path,
      suggestion: 'Add a "## Purpose" or "## Summary" section with meaningful content.',
    });
  } else {
    // Check that at least one of the present required sections has content
    let hasContent = false;
    for (const section of BODY_REQUIRED_SECTIONS) {
      if (note.headings.includes(section)) {
        const body = extractSectionBody(note.raw_text, section);
        const nonWs = body.replace(/\s/g, '');
        if (nonWs.length >= MIN_SECTION_CONTENT_LENGTH) {
          hasContent = true;
          break;
        }
      }
    }
    if (!hasContent) {
      issues.push({
        dimension: 'completeness',
        severity: 'warning',
        code: 'EMPTY_REQUIRED_SECTION',
        message: `${capitalize(note.type)} "${note.id}" has Purpose/Summary section but its body is empty or too short`,
        note_id: note.id,
        note_path: note.path,
        suggestion: `Add meaningful content to the Purpose or Summary section (at least ${MIN_SECTION_CONTENT_LENGTH} characters).`,
      });
    }
  }

  return issues;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isComplexChange(change: IndexRecord): boolean {
  return change.delta_summary.length >= COMPLEX_CHANGE_DELTA_THRESHOLD;
}
