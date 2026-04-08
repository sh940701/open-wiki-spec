import type { ParseResult } from '../../parser/types.js';
import type { PlannedPrerequisites } from './types.js';
import type { ChangeFrontmatter } from '../../../types/frontmatter.js';

/**
 * Check hard and soft prerequisites for the proposed -> planned transition.
 *
 * Hard prerequisites (ALL required):
 *   1. Why section exists and is non-empty
 *   2. Delta Summary has >= 1 entry
 *   3. Tasks has >= 1 item
 *   4. Validation section exists and is non-empty
 *
 * Soft prerequisites (warning only):
 *   5. Design Approach exists
 *   6. Decision link exists in frontmatter
 */
export function checkPlannedPrerequisites(parsed: ParseResult): PlannedPrerequisites {
  const why_present = sectionHasContent(parsed, 'Why');
  const delta_summary_present = parsed.deltaSummary.length > 0;
  const tasks_present = parsed.tasks.length > 0;
  const validation_present = sectionHasContent(parsed, 'Validation');

  const all_hard_met = why_present && delta_summary_present && tasks_present && validation_present;

  // Soft prerequisites: Design Approach must have content or contain 'N/A'
  const design_approach_present = sectionHasContent(parsed, 'Design Approach') ||
    sectionContainsText(parsed, 'Design Approach', 'N/A');

  const fm = parsed.frontmatter as ChangeFrontmatter | null;
  const decision_link_present = (fm?.decisions?.length ?? 0) > 0;

  const warnings: string[] = [];
  if (!design_approach_present) {
    warnings.push('Design Approach section is empty (soft prerequisite)');
  }
  if (!decision_link_present) {
    warnings.push('No Decision links found (soft prerequisite for complex changes)');
  }

  return {
    hard: {
      why_present,
      delta_summary_present,
      tasks_present,
      validation_present,
    },
    soft: {
      design_approach_present,
      decision_link_present,
    },
    all_hard_met,
    warnings,
  };
}

/**
 * Check if a section exists and has non-empty content.
 */
function sectionHasContent(parsed: ParseResult, sectionTitle: string): boolean {
  const section = findSection(parsed.sections, sectionTitle);
  if (!section) return false;
  return section.content.trim().length > 0;
}

/**
 * Check if a section contains specific text.
 */
function sectionContainsText(parsed: ParseResult, sectionTitle: string, text: string): boolean {
  const section = findSection(parsed.sections, sectionTitle);
  if (!section) return false;
  return section.content.includes(text);
}

/**
 * Find a section by title in the section tree (depth-first search).
 */
function findSection(sections: ParseResult['sections'], title: string): ParseResult['sections'][0] | null {
  for (const section of sections) {
    if (section.title.trim() === title) return section;
    const found = findSection(section.children, title);
    if (found) return found;
  }
  return null;
}
