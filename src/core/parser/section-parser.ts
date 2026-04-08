import type { Section, ParseError } from './types.js';

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const CODE_FENCE_REGEX = /^(`{3,}|~{3,})/;

/**
 * Parse a markdown body into a hierarchical section tree.
 * Skips lines inside fenced code blocks.
 */
export function parseSections(
  body: string,
  bodyStartLine: number = 1,
): { sections: Section[]; headings: string[]; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const sections: Section[] = [];
  const headings: string[] = [];
  const normalizedBody = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedBody.split('\n');
  const stack: Section[] = [];

  // Collect heading positions, skipping code fences
  const headingPositions: { index: number; level: number; title: string }[] = [];
  let insideCodeFence = false;
  let codeFenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(CODE_FENCE_REGEX);
    if (fenceMatch) {
      if (!insideCodeFence) {
        insideCodeFence = true;
        codeFenceMarker = fenceMatch[1][0];
      } else if (lines[i].trim().startsWith(codeFenceMarker.repeat(3))) {
        insideCodeFence = false;
        codeFenceMarker = '';
      }
      continue;
    }
    if (insideCodeFence) continue;

    const match = lines[i].match(HEADING_REGEX);
    if (match) {
      headingPositions.push({
        index: i,
        level: match[1].length,
        title: match[2].trim(),
      });
    }
  }

  for (let h = 0; h < headingPositions.length; h++) {
    const { index, level, title } = headingPositions[h];
    headings.push(title);

    // Content: lines after this heading until the next heading of same or higher level
    const contentLines: string[] = [];
    const nextSameOrHigher = headingPositions.findIndex(
      (hp, idx) => idx > h && hp.level <= level,
    );
    const endIndex = nextSameOrHigher !== -1
      ? headingPositions[nextSameOrHigher].index
      : lines.length;

    for (let i = index + 1; i < endIndex; i++) {
      contentLines.push(lines[i]);
    }

    const section: Section = {
      level,
      title,
      content: contentLines.join('\n').trim(),
      line: bodyStartLine + index,
      children: [],
    };

    // Build hierarchy using stack
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      sections.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  return { sections, headings, errors };
}

/**
 * Find a section by title (case-insensitive, recursive).
 */
export function findSection(sections: Section[], title: string): Section | undefined {
  const target = title.toLowerCase();
  for (const section of sections) {
    if (section.title.toLowerCase() === target) {
      return section;
    }
    const child = findSection(section.children, title);
    if (child) return child;
  }
  return undefined;
}
