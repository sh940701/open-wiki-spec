import { parse as parseYaml } from 'yaml';
import { FrontmatterSchema, type Frontmatter } from '../schema/frontmatter.js';
import type { RawFrontmatter, ParseError } from './types.js';

/**
 * Extract YAML frontmatter from a markdown string.
 *
 * Frontmatter is delimited by --- on its own line at the start of the file
 * and a closing --- on its own line.
 */
/**
 * Maximum size (in bytes) of the YAML frontmatter block.
 * Guards against pathological inputs (e.g., multi-MB YAML) that could
 * cause excessive memory use or parser slowdown.
 */
const MAX_FRONTMATTER_SIZE = 1024 * 1024; // 1 MiB

export function extractFrontmatter(content: string): { raw: RawFrontmatter | null; errors: ParseError[] } {
  const errors: ParseError[] = [];
  // Strip UTF-8 BOM if present (some editors like Windows Notepad add it)
  const stripped = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
  const normalized = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

  // Find closing delimiter: must be `---` at column 0 (not indented).
  // Indented `---` inside block scalars (e.g., `summary: |`) must not be treated as a delimiter.
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '--- ') {
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

  // Guard against pathological YAML sizes
  if (yamlContent.length > MAX_FRONTMATTER_SIZE) {
    errors.push({
      level: 'error',
      source: 'frontmatter',
      message: `Frontmatter exceeds ${MAX_FRONTMATTER_SIZE} bytes (got ${yamlContent.length}). Refusing to parse.`,
      line: 1,
    });
    return { raw: null, errors };
  }

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

  // Detect `key: null` for fields that must be arrays. YAML authors often
  // write `aliases:` (empty value → null) or `tags: null` expecting an
  // empty list, but the schema's passthrough() silently accepts null and
  // downstream `getArray()` coerces it to []. Surface the ambiguity as a
  // warning so the user can fix it explicitly.
  const ARRAY_FIELDS = ['aliases', 'tags', 'systems', 'sources', 'decisions', 'changes', 'depends_on', 'touches', 'features'];
  for (const field of ARRAY_FIELDS) {
    if (field in data && data[field] === null) {
      errors.push({
        level: 'warning',
        source: 'frontmatter',
        message: `Frontmatter field "${field}" is null. Use an empty list "[]" or omit the field instead. Treating as empty list.`,
      });
      // Normalize to empty array so downstream consumers get a predictable shape.
      data[field] = [];
    }
  }

  // Detect case-variant reserved keys (e.g., "Type" instead of "type") and
  // give a clear, actionable error. YAML is case-sensitive, so these would
  // otherwise fail Zod validation with a confusing "missing required" error.
  const reservedKeys = ['type', 'id', 'status', 'tags'];
  const dataKeys = Object.keys(data);
  for (const reserved of reservedKeys) {
    if (!(reserved in data)) {
      const variant = dataKeys.find((k) => k !== reserved && k.toLowerCase() === reserved);
      if (variant) {
        errors.push({
          level: 'error',
          source: 'frontmatter',
          message: `Frontmatter key "${variant}" must be lowercase "${reserved}". YAML keys are case-sensitive.`,
        });
      }
    }
  }
  if (errors.length > 0) {
    return { frontmatter: null, errors };
  }

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
