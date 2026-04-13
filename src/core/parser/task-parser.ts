import type { Section, ParsedTaskItem, ParseError } from './types.js';
import { findSection } from './section-parser.js';

// Full task line with content. Required by `parseTasks` to both capture
// the completion state and record meaningful text.
const TASK_REGEX = /^-\s+\[([ xX])\]\s+(.+)$/;

// Empty task line (no description after the checkbox, e.g. `- [ ]` or
// `- [x]    `). These get flagged as parse warnings so users know a
// placeholder checkbox won't count toward progress.
const EMPTY_TASK_REGEX = /^-\s+\[([ xX])\]\s*$/;

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
      continue;
    }
    // Empty checkbox: surface as a parse warning so the change author
    // sees it instead of a silent "0 tasks" count. The warning is
    // non-blocking — continue.ts/apply.ts still treat the Change as
    // having the parsed tasks, but the user knows to fill in the line.
    if (EMPTY_TASK_REGEX.test(lines[i])) {
      errors.push({
        level: 'warning',
        source: 'task',
        message: `Empty checklist item "${lines[i].trim()}" (no task description). Add text after the checkbox or remove the line.`,
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
