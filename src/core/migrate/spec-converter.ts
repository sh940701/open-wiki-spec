/**
 * Converts OpenSpec spec.md files into open-wiki-spec Feature notes.
 */
import type { ScannedSpec, ConversionResult } from './types.js';
import * as path from 'node:path';
import { sanitizeMigrationId, safeYamlScalar, safeYamlQuoted } from './sanitize.js';

const REQUIREMENT_HEADING_RE = /^###\s+Requirement:\s*(.+)$/;
const SCENARIO_HEADING_RE = /^####\s+Scenario:\s*(.+)$/;
const PURPOSE_SECTION_RE = /^##\s+Purpose$/m;
const REQUIREMENTS_SECTION_RE = /^##\s+Requirements$/m;
const WHY_SECTION_RE = /^##\s+Why$/m;

/**
 * Convert a single OpenSpec spec into a Feature note.
 */
export function convertSpec(spec: ScannedSpec, systemRef: string): ConversionResult {
  const id = sanitizeMigrationId(spec.capability);
  const title = formatTitle(spec.capability);
  const purpose = extractPurpose(spec.content);
  const requirementsBlock = extractRequirementsBlock(spec.content);
  const constraints = extractConstraints(spec.content);
  const knownGaps = extractKnownGaps(spec.content);

  const content = buildFeatureNote({
    id,
    title,
    systemRef,
    purpose,
    requirementsBlock,
    constraints,
    knownGaps,
  });

  return {
    targetPath: path.join('wiki', '03-features', `${id}.md`),
    content,
    sourceDescription: `openspec/specs/${spec.capability}/spec.md`,
  };
}

/**
 * Convert all specs into Feature notes.
 */
export function convertAllSpecs(
  specs: ScannedSpec[],
  systemRefs: Map<string, string>,
): { results: ConversionResult[]; warnings: string[] } {
  const results: ConversionResult[] = [];
  const warnings: string[] = [];

  for (const spec of specs) {
    const systemRef = systemRefs.get(spec.capability) ?? 'default-system';
    try {
      results.push(convertSpec(spec, systemRef));
    } catch (err) {
      warnings.push(`Failed to convert spec ${spec.capability}: ${(err as Error).message}`);
    }
  }

  return { results, warnings };
}

function buildFeatureNote(opts: {
  id: string;
  title: string;
  systemRef: string;
  purpose: string;
  requirementsBlock: string;
  constraints: string;
  knownGaps: string;
}): string {
  return `---
type: feature
id: ${safeYamlScalar(opts.id)}
status: active
systems:
  - ${safeYamlQuoted(opts.systemRef)}
sources: []
decisions: []
changes: []
tags:
  - feature
  - migrated
---

# Feature: ${opts.title}

## Purpose

${opts.purpose || '<!-- Migrated from OpenSpec - purpose not specified -->'}

## Current Behavior

<!-- Migrated from OpenSpec spec. See requirements below for current behavior. -->

## Constraints

${opts.constraints || '<!-- No constraints specified in original spec -->'}

## Known Gaps

${opts.knownGaps || '<!-- No known gaps specified in original spec -->'}

## Requirements

${opts.requirementsBlock || '<!-- No requirements found in original spec -->'}

## Related Notes
`;
}

/**
 * Extract the Purpose section content from an OpenSpec spec.
 */
function extractPurpose(content: string): string {
  const match = content.match(PURPOSE_SECTION_RE);
  if (!match) {
    // Try extracting from first paragraph after H1
    const h1End = content.indexOf('\n## ');
    if (h1End === -1) return '';
    const h1Match = content.match(/^#\s+.+\n+([\s\S]*?)(?=\n##\s)/);
    if (h1Match) return h1Match[1].trim();
    return '';
  }

  const startIdx = match.index! + match[0].length;
  const nextSection = content.indexOf('\n## ', startIdx);
  const sectionContent = nextSection === -1
    ? content.slice(startIdx)
    : content.slice(startIdx, nextSection);

  return sectionContent.trim();
}

/**
 * Extract the Requirements block preserving its markdown structure.
 */
function extractRequirementsBlock(content: string): string {
  const match = content.match(REQUIREMENTS_SECTION_RE);
  if (!match) return '';

  const startIdx = match.index! + match[0].length;
  // Find next H2 that is NOT a requirement sub-section (i.e., at ## level)
  const remaining = content.slice(startIdx);
  const nextH2 = remaining.match(/\n## (?!Requirements)/);
  const block = nextH2 ? remaining.slice(0, nextH2.index!) : remaining;

  return block.trim();
}

/**
 * Extract constraints from spec content (if any section matches).
 */
function extractConstraints(content: string): string {
  const match = content.match(/^##\s+Constraints$/m);
  if (!match) return '';
  const startIdx = match.index! + match[0].length;
  const nextSection = content.indexOf('\n## ', startIdx);
  return (nextSection === -1 ? content.slice(startIdx) : content.slice(startIdx, nextSection)).trim();
}

/**
 * Extract known gaps from spec content.
 */
function extractKnownGaps(content: string): string {
  const match = content.match(/^##\s+Known\s+Gaps$/m);
  if (!match) return '';
  const startIdx = match.index! + match[0].length;
  const nextSection = content.indexOf('\n## ', startIdx);
  return (nextSection === -1 ? content.slice(startIdx) : content.slice(startIdx, nextSection)).trim();
}

/**
 * Convert kebab-case capability name to a readable title.
 */
function formatTitle(capability: string): string {
  return capability
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
