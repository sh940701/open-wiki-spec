import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractFrontmatter, validateFrontmatter } from './frontmatter-parser.js';
import { parseSections } from './section-parser.js';
import { extractWikilinks, uniqueWikilinkTargets } from './wikilink-parser.js';
import { parseRequirements } from './requirement-parser.js';
import { parseDeltaSummary } from './delta-summary-parser.js';
import { parseTasks } from './task-parser.js';
import type { ParseResult, ParseError, WikilinkOccurrence } from './types.js';

/**
 * Parse a single markdown note into a complete ParseResult.
 * Reads the file at the given path and orchestrates all sub-parsers.
 *
 * Returns ParseResult with raw wikilinks (not resolved to ids).
 */
export function parseNote(filePath: string): ParseResult {
  const content = readFileSync(filePath, 'utf-8');
  const errors: ParseError[] = [];

  // 1. Frontmatter
  const { raw, errors: fmExtractErrors } = extractFrontmatter(content);
  errors.push(...fmExtractErrors);

  let frontmatter = null;
  let rawFrontmatter = null;
  let body = content;
  let bodyStartLine = 1;

  if (raw) {
    rawFrontmatter = raw.data;
    body = raw.body;
    bodyStartLine = raw.bodyStartLine;

    const { frontmatter: validated, errors: fmValidateErrors } = validateFrontmatter(raw.data);
    errors.push(...fmValidateErrors);
    frontmatter = validated;
  }

  // 2. Sections
  const { sections, headings, errors: sectionErrors } = parseSections(body, bodyStartLine);
  errors.push(...sectionErrors);

  // 3. Wikilinks (from frontmatter YAML values and body)
  const fmWikilinks = raw
    ? extractWikilinksFromObject(raw.data, 'frontmatter')
    : { wikilinks: [] as WikilinkOccurrence[], errors: [] as ParseError[] };
  const bodyWikilinks = extractWikilinks(body, 'body', bodyStartLine);
  errors.push(...fmWikilinks.errors, ...bodyWikilinks.errors);
  const allWikilinks = [...fmWikilinks.wikilinks, ...bodyWikilinks.wikilinks];

  // 4. Requirements (Feature only)
  const noteType = frontmatter?.type;
  let requirements: ParseResult['requirements'] = [];
  if (noteType === 'feature') {
    const reqResult = parseRequirements(sections);
    requirements = reqResult.requirements;
    errors.push(...reqResult.errors);
  }

  // 5. Delta Summary + Tasks (Change only)
  let deltaSummary: ParseResult['deltaSummary'] = [];
  let tasks: ParseResult['tasks'] = [];
  if (noteType === 'change') {
    const deltaResult = parseDeltaSummary(sections);
    deltaSummary = deltaResult.entries;
    errors.push(...deltaResult.errors);

    const taskResult = parseTasks(sections);
    tasks = taskResult.tasks;
    errors.push(...taskResult.errors);
  }

  // 6. Content hash
  const contentHash = computeBodyHash(body);

  return {
    frontmatter,
    rawFrontmatter,
    sections,
    headings,
    wikilinks: allWikilinks,
    requirements,
    deltaSummary,
    tasks,
    body,
    contentHash,
    errors,
  };
}

function computeBodyHash(body: string): string {
  const hash = createHash('sha256').update(body, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Recursively walk a frontmatter object and extract wikilinks from string values.
 * Protects against YAML alias cycles with a visited set and depth limit.
 */
function extractWikilinksFromObject(
  obj: Record<string, unknown>,
  location: 'frontmatter' | 'body',
): { wikilinks: WikilinkOccurrence[]; errors: ParseError[] } {
  const MAX_DEPTH = 10;
  const allWikilinks: WikilinkOccurrence[] = [];
  const allErrors: ParseError[] = [];
  const visited = new WeakSet<object>();

  function walk(value: unknown, depth: number): void {
    if (depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      const { wikilinks, errors } = extractWikilinks(value, location, 1);
      allWikilinks.push(...wikilinks);
      allErrors.push(...errors);
    } else if (Array.isArray(value)) {
      if (visited.has(value)) return;
      visited.add(value);
      for (const item of value) walk(item, depth + 1);
    } else if (typeof value === 'object' && value !== null) {
      if (visited.has(value)) return;
      visited.add(value);
      for (const v of Object.values(value)) walk(v, depth + 1);
    }
  }

  walk(obj, 0);
  return { wikilinks: allWikilinks, errors: allErrors };
}
