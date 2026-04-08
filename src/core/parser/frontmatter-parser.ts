import { parse as parseYaml } from 'yaml';
import { FrontmatterSchema, type Frontmatter } from '../schema/frontmatter.js';
import type { RawFrontmatter, ParseError } from './types.js';

/**
 * Extract YAML frontmatter from a markdown string.
 *
 * Frontmatter is delimited by --- on its own line at the start of the file
 * and a closing --- on its own line.
 */
export function extractFrontmatter(content: string): { raw: RawFrontmatter | null; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0 || lines[0].trim() !== '---') {
    errors.push({
      level: 'error',
      source: 'frontmatter',
      message: 'File does not start with YAML frontmatter delimiter (---)',
      line: 1,
    });
    return { raw: null, errors };
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIndex = i;
      break;
    }
  }

  if (closeIndex === -1) {
    errors.push({
      level: 'error',
      source: 'frontmatter',
      message: 'No closing frontmatter delimiter (---) found',
      line: 1,
    });
    return { raw: null, errors };
  }

  const yamlContent = lines.slice(1, closeIndex).join('\n');
  const body = lines.slice(closeIndex + 1).join('\n');
  const bodyStartLine = closeIndex + 2; // 1-indexed, line after closing ---

  let data: Record<string, unknown>;
  try {
    data = parseYaml(yamlContent);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      errors.push({
        level: 'error',
        source: 'frontmatter',
        message: 'Frontmatter YAML must be an object (key-value pairs)',
        line: 1,
      });
      return { raw: null, errors };
    }
  } catch (e) {
    errors.push({
      level: 'error',
      source: 'frontmatter',
      message: `Invalid YAML in frontmatter: ${(e as Error).message}`,
      line: 1,
    });
    return { raw: null, errors };
  }

  return {
    raw: { data: data as Record<string, unknown>, body, bodyStartLine },
    errors,
  };
}

/**
 * Validate raw frontmatter data against the discriminated union schema.
 * Returns the validated frontmatter or null with errors.
 */
export function validateFrontmatter(
  data: Record<string, unknown>,
): { frontmatter: Frontmatter | null; errors: ParseError[] } {
  const errors: ParseError[] = [];

  const result = FrontmatterSchema.safeParse(data);

  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        level: 'error',
        source: 'frontmatter',
        message: `${issue.path.join('.')}: ${issue.message}`,
      });
    }
    return { frontmatter: null, errors };
  }

  return { frontmatter: result.data as Frontmatter, errors };
}
