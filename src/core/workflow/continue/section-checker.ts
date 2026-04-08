import type { ParseResult, Section } from '../../parser/types.js';
import type { SectionAnalysis, SectionStatus, SectionTarget } from './types.js';

const KNOWN_SECTIONS = [
  'Why', 'Delta Summary', 'Proposed Update',
  'Design Approach', 'Impact', 'Tasks', 'Validation', 'Status Notes',
];

/**
 * Analyze a Change note's sections for completeness.
 */
export function analyzeChangeSections(parsed: ParseResult): SectionAnalysis {
  const sections = new Map<string, SectionStatus>();

  for (const name of KNOWN_SECTIONS) {
    const section = findSectionByTitle(parsed.sections, name);
    if (section) {
      const isEmpty = isEffectivelyEmpty(section.content);
      sections.set(name, {
        exists: true,
        isEmpty,
        content: section.content,
      });
    } else {
      sections.set(name, {
        exists: false,
        isEmpty: true,
        content: '',
      });
    }
  }

  const totalTasks = parsed.tasks.length;
  const completedTasks = parsed.tasks.filter((t) => t.done).length;
  const deltaSummaryCount = parsed.deltaSummary.length;
  const taskItems = parsed.tasks.map((t) => ({ text: t.text, done: t.done }));

  return {
    sections,
    totalTasks,
    completedTasks,
    deltaSummaryCount,
    taskItems,
  };
}

/**
 * Check hard prerequisites for proposed -> planned transition.
 */
export function checkPlannedPrerequisites(
  analysis: SectionAnalysis,
): { missingHard: string[]; softWarnings: string[] } {
  const missingHard: string[] = [];

  const whySection = analysis.sections.get('Why');
  if (!whySection || whySection.isEmpty) missingHard.push('Why');

  if (analysis.deltaSummaryCount === 0) missingHard.push('Delta Summary');

  if (analysis.totalTasks === 0) missingHard.push('Tasks');

  const validationSection = analysis.sections.get('Validation');
  if (!validationSection || validationSection.isEmpty) missingHard.push('Validation');

  const softWarnings: string[] = [];
  const designSection = analysis.sections.get('Design Approach');
  const designIsPresent = designSection && (
    !designSection.isEmpty || designSection.content.trim() === 'N/A'
  );
  if (!designIsPresent) {
    softWarnings.push('Design Approach is empty. Consider adding implementation approach or marking N/A.');
  }

  return { missingHard, softWarnings };
}

/**
 * Build section guidance for the agent.
 */
export function buildSectionTarget(sectionName: string): SectionTarget {
  const guidance: Record<string, SectionTarget> = {
    'Why': {
      sectionName: 'Why',
      guidance: 'Explain why this change is needed. Reference the user request, related Feature gaps, or evidence from Source notes. 1-3 paragraphs.',
      templateHint: '## Why\n\n<Explain the motivation and business/technical need>',
    },
    'Delta Summary': {
      sectionName: 'Delta Summary',
      guidance: 'List each planned modification using the canonical format: ADDED/MODIFIED/REMOVED/RENAMED requirement "<name>" to/in/from [[Feature]]. Include [base: <content_hash>] for MODIFIED/REMOVED/RENAMED.',
      templateHint: '## Delta Summary\n- ADDED requirement "<name>" to [[Feature: ...]]\n- MODIFIED section "Current Behavior" in [[Feature: ...]]: <what changes>',
    },
    'Tasks': {
      sectionName: 'Tasks',
      guidance: 'Break down implementation into concrete checklist items. Each task should be independently completable and verifiable.',
      templateHint: '## Tasks\n- [ ] <first task>\n- [ ] <second task>',
    },
    'Validation': {
      sectionName: 'Validation',
      guidance: 'Describe how to verify this change is correct. Include test approach, manual verification steps, and acceptance criteria.',
      templateHint: '## Validation\n\n<Describe verification approach>',
    },
    'Design Approach': {
      sectionName: 'Design Approach',
      guidance: 'Describe the technical approach for this change. If a major technical choice is involved, create a Decision note and link to it.',
      templateHint: '## Design Approach\n\n<Describe implementation approach>',
    },
  };

  return guidance[sectionName] ?? {
    sectionName,
    guidance: `Fill the "${sectionName}" section with relevant content.`,
    templateHint: `## ${sectionName}\n\n<Content>`,
  };
}

function findSectionByTitle(sections: Section[], title: string): Section | null {
  for (const section of sections) {
    if (section.title === title) return section;
    const child = findSectionByTitle(section.children, title);
    if (child) return child;
  }
  return null;
}

function isEffectivelyEmpty(content: string): boolean {
  const stripped = content.replace(/^\s+|\s+$/g, '');
  return stripped === '';
}
