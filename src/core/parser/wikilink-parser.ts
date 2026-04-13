import type { WikilinkOccurrence, ParseError } from './types.js';

const WIKILINK_REGEX = /\[\[([^\]|]*?)(?:\|([^\]]+?))?\]\]/g;
const CODE_FENCE_REGEX = /^(`{3,}|~{3,})/;

/**
 * Extract all wikilinks from a string, tracking their location.
 * Skips wikilinks inside fenced code blocks.
 */
export function extractWikilinks(
  text: string,
  location: 'frontmatter' | 'body',
  startLine: number = 1,
): { wikilinks: WikilinkOccurrence[]; errors: ParseError[] } {
  const wikilinks: WikilinkOccurrence[] = [];
  const errors: ParseError[] = [];
  const lines = text.split('\n');
  let insideCodeFence = false;
  let codeFenceMarker = '';  // The opening fence string (e.g., "```" or "~~~~~")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = line.match(CODE_FENCE_REGEX);
    if (fenceMatch) {
      if (!insideCodeFence) {
        insideCodeFence = true;
        codeFenceMarker = fenceMatch[1]; // Store the full opening fence (e.g., "````")
      } else {
        // CommonMark: closing fence must have same marker char and length >= opening
        const trimmed = line.trim();
        const openChar = codeFenceMarker[0];
        if (trimmed.length >= codeFenceMarker.length &&
            trimmed === openChar.repeat(trimmed.length)) {
          insideCodeFence = false;
          codeFenceMarker = '';
        }
      }
      continue;
    }
    if (insideCodeFence) continue;

    // Reset regex state for each line
    const regex = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      const target = match[1].trim();
      const alias = match[2]?.trim() ?? null;

      if (target.length === 0) {
        errors.push({
          level: 'warning',
          source: 'wikilink',
          message: 'Empty wikilink target',
          line: startLine + i,
        });
        continue;
      }

      // Warn on nested brackets (escaped delimiter is already split by regex, so only check brackets)
      if (target.includes('[[') || target.includes(']]')) {
        errors.push({
          level: 'warning',
          source: 'wikilink',
          message: `Malformed wikilink target with nested brackets or escaped delimiter: "${target}"`,
          line: startLine + i,
        });
        continue;
      }

      // Strip #heading subpath (Obsidian [[Note#Heading]] syntax)
      const hashIndex = target.indexOf('#');
      const resolvedTarget = hashIndex !== -1 ? target.slice(0, hashIndex).trim() : target;

      if (resolvedTarget.length === 0) {
        // Target was only a heading fragment like [[#Heading]]
        continue;
      }

      wikilinks.push({ target: resolvedTarget, alias, location, line: startLine + i });
    }
  }

  return { wikilinks, errors };
}

/**
 * Strip wikilink syntax from a raw wikilink string.
 * Strips [[...]] brackets and drops the display text after |.
 */
export function stripWikilinkSyntax(wikilink: string): string {
  let result = wikilink.trim();
  if (result.startsWith('[[') && result.endsWith(']]')) {
    result = result.slice(2, -2);
  }
  const pipeIndex = result.indexOf('|');
  if (pipeIndex !== -1) {
    result = result.slice(0, pipeIndex);
  }
  // Strip #heading subpath
  const hashIndex = result.indexOf('#');
  if (hashIndex !== -1) {
    result = result.slice(0, hashIndex);
  }
  return result.trim();
}

/**
 * Get unique wikilink target strings.
 */
export function uniqueWikilinkTargets(wikilinks: WikilinkOccurrence[]): string[] {
  const targets = new Set<string>();
  for (const wl of wikilinks) {
    targets.add(wl.target);
  }
  return Array.from(targets);
}
