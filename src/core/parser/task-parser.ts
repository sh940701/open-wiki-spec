import type { Section, ParsedTaskItem, ParseError } from './types.js';
import { findSection } from './section-parser.js';

const TASK_REGEX = /^-\s+\[([ xX])\]\s+(.+)$/;

/**
 * Parse task checklist items from a Change note's Tasks section.
 */
export function parseTasks(
  sections: Section[],
): { tasks: ParsedTaskItem[]; errors: ParseError[] } {
  const tasks: ParsedTaskItem[] = [];
  const errors: ParseError[] = [];

  const taskSection = findSection(sections, 'Tasks');
  if (!taskSection) {
    return { tasks, errors };
  }

  // taskSection.content already includes all lines up to the next same-or-higher-level heading,
  // including child heading lines. No need to recurse into children.
  const lines = taskSection.content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(TASK_REGEX);
    if (match) {
      tasks.push({
        text: match[2].trim(),
        done: match[1] !== ' ',
        line: taskSection.line + i + 1,
      });
    }
  }

  return { tasks, errors };
}

function gatherAllContent(section: Section): string {
  let content = section.content;
  for (const child of section.children) {
    content += '\n' + gatherAllContent(child);
  }
  return content;
}
