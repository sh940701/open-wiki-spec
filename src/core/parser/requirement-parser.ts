import { createHash } from 'node:crypto';
import type { Section, ParseError } from './types.js';
import type { Requirement, Scenario } from '../../types/requirement.js';
import { findSection } from './section-parser.js';
import { normalizeForHash } from '../../utils/normalize.js';

const REQUIREMENT_HEADING_REGEX = /^Requirement:\s*(.+)$/;
const SCENARIO_HEADING_REGEX = /^Scenario:\s*(.+)$/;

/**
 * Parse requirement blocks from a Feature note's section tree.
 *
 * The `key` field is NOT set here (parser doesn't know feature_id).
 * The index engine sets it as `${feature_id}::${name}`.
 */
export function parseRequirements(
  sections: Section[],
): { requirements: Requirement[]; errors: ParseError[] } {
  const requirements: Requirement[] = [];
  const errors: ParseError[] = [];
  const seenNames = new Set<string>();

  const reqSection = findSection(sections, 'Requirements');
  if (!reqSection) {
    return { requirements, errors };
  }

  for (const child of reqSection.children) {
    const nameMatch = child.title.match(REQUIREMENT_HEADING_REGEX);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();

    if (seenNames.has(name)) {
      errors.push({
        level: 'error',
        source: 'requirement',
        message: `Duplicate requirement name: "${name}"`,
        line: child.line,
      });
      continue;
    }
    seenNames.add(name);

    const normative = extractNormativeStatement(child);

    if (!normative) {
      errors.push({
        level: 'warning',
        source: 'requirement',
        message: `Requirement "${name}" has no normative statement`,
        line: child.line,
      });
    }

    if (normative && !normative.includes('SHALL') && !normative.includes('MUST')) {
      errors.push({
        level: 'warning',
        source: 'requirement',
        message: `Requirement "${name}" normative statement lacks SHALL or MUST`,
        line: child.line,
      });
    }

    const scenarios: Scenario[] = [];
    for (const scenarioChild of child.children) {
      const scenarioMatch = scenarioChild.title.match(SCENARIO_HEADING_REGEX);
      if (!scenarioMatch) continue;

      const scenarioName = scenarioMatch[1].trim();
      const scenarioText = scenarioChild.content.trim();

      if (!scenarioText) {
        errors.push({
          level: 'warning',
          source: 'requirement',
          message: `Scenario "${scenarioName}" in requirement "${name}" is empty`,
          line: scenarioChild.line,
        });
        continue;
      }

      if (!scenarioText.includes('WHEN') || !scenarioText.includes('THEN')) {
        errors.push({
          level: 'warning',
          source: 'requirement',
          message: `Scenario "${scenarioName}" in requirement "${name}" lacks WHEN/THEN structure`,
          line: scenarioChild.line,
        });
      }

      scenarios.push({ name: scenarioName, raw_text: scenarioText });
    }

    if (scenarios.length === 0) {
      errors.push({
        level: 'warning',
        source: 'requirement',
        message: `Requirement "${name}" has no scenarios`,
        line: child.line,
      });
    }

    const hashInput = normalizeForHashing(normative || '', scenarios);
    const content_hash = computeHash(hashInput);

    requirements.push({
      name,
      key: '', // placeholder; set by index-builder
      normative: normative || '',
      scenarios,
      content_hash,
    });
  }

  return { requirements, errors };
}

/**
 * Extract the normative statement from a requirement section.
 * Content before the first child heading.
 */
function extractNormativeStatement(section: Section): string | null {
  const lines = section.content.split('\n');
  const normativeLines: string[] = [];

  for (const line of lines) {
    if (line.match(/^#{1,6}\s+/)) {
      break;
    }
    normativeLines.push(line);
  }

  const text = normativeLines.join('\n').trim();
  return text || null;
}

function normalizeForHashing(normative: string, scenarios: Scenario[]): string {
  const parts: string[] = [
    normalizeForHash(normative),
  ];
  for (const s of scenarios) {
    parts.push(normalizeForHash(s.raw_text));
  }
  return parts.join('\n');
}

function computeHash(input: string): string {
  const hash = createHash('sha256').update(input, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}
