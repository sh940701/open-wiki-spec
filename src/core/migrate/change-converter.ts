/**
 * Converts OpenSpec changes into open-wiki-spec Change notes and Decision notes.
 */
import * as path from 'node:path';
import type { ScannedChange, ConversionResult } from './types.js';
import { sanitizeMigrationId, safeYamlScalar, safeYamlQuoted } from './sanitize.js';

const WHY_SECTION_RE = /^##\s+Why$/m;
const WHAT_CHANGES_RE = /^##\s+What\s+Changes$/m;
const IMPACT_RE = /^##\s+Impact$/m;
const CAPABILITIES_RE = /^##\s+Capabilities$/m;
const TASK_LINE_RE = /^-\s+\[([xX ])\]\s+(.+)$/;

/**
 * Convert a single OpenSpec change into a Change note.
 * Optionally produces a Decision note if design.md has significant content.
 */
export function convertChange(
  change: ScannedChange,
  featureRefs: Map<string, string>,
  systemRefMap: Map<string, string>,
): { changeNote: ConversionResult; decisionNote: ConversionResult | null; warnings: string[] } {
  const warnings: string[] = [];
  const id = sanitizeMigrationId(change.name);
  const title = formatChangeTitle(change.name);

  // Extract proposal sections
  const why = extractSection(change.proposal ?? '', WHY_SECTION_RE) || '<!-- Why not specified in original proposal -->';
  const whatChanges = extractSection(change.proposal ?? '', WHAT_CHANGES_RE);
  const impactText = extractSection(change.proposal ?? '', IMPACT_RE);
  const nonGoals = extractSection(change.proposal ?? '', /^##\s+Non-?goals$/im);

  // Determine status
  const status = change.archived ? 'applied' : 'proposed';

  // Determine created_at
  const createdAt = resolveCreatedAt(change);

  // Parse capabilities from proposal for feature linking
  const capabilities = parseCapabilities(change.proposal ?? '');

  // Build feature reference
  const featureRef = resolveFeatureRef(change, featureRefs, capabilities, warnings);

  // Build delta summary from delta specs
  const deltaSummary = buildDeltaSummary(change, featureRefs);

  // Extract tasks from tasks.md
  const tasksBlock = buildTasksBlock(change.tasks);

  // Build design approach from design.md
  const designApproach = change.design
    ? extractDesignSummary(change.design)
    : '<!-- No design document in original change -->';

  // Build touches refs (from delta specs, metadata, and capabilities)
  const touchesRefs = buildTouchesRefs(change, featureRefs, capabilities);

  // Build depends_on
  const dependsOn = change.metadata?.dependsOn?.map(d => `"[[${d}]]"`) ?? [];

  // Build system refs
  const systemRefs = inferSystemRefsFromChange(change, featureRefs, systemRefMap);

  const changeContent = buildChangeNote({
    id,
    title,
    status,
    createdAt,
    featureRef,
    dependsOn,
    touchesRefs,
    systemRefs,
    why,
    deltaSummary,
    proposedUpdate: buildProposedUpdate(whatChanges, nonGoals),
    designApproach,
    impactText: impactText || '<!-- Impact not specified -->',
    tasksBlock,
  });

  const targetDir = change.archived ? path.join('wiki', '99-archive') : path.join('wiki', '04-changes');
  const changeNote: ConversionResult = {
    targetPath: path.join(targetDir, `${id}.md`),
    content: changeContent,
    sourceDescription: `openspec/changes/${change.archived ? 'archive/' : ''}${change.name}/`,
  };

  // Build decision note if design.md is substantial
  let decisionNote: ConversionResult | null = null;
  if (change.design && isSubstantialDesign(change.design)) {
    decisionNote = buildDecisionNote(change);
  }

  return { changeNote, decisionNote, warnings };
}

/**
 * Convert all changes into Change notes (and optional Decision notes).
 */
export function convertAllChanges(
  changes: ScannedChange[],
  featureRefs: Map<string, string>,
  systemRefMap: Map<string, string>,
): { results: ConversionResult[]; warnings: string[] } {
  const results: ConversionResult[] = [];
  const warnings: string[] = [];

  for (const change of changes) {
    try {
      const { changeNote, decisionNote, warnings: cw } = convertChange(change, featureRefs, systemRefMap);
      results.push(changeNote);
      if (decisionNote) results.push(decisionNote);
      warnings.push(...cw);
    } catch (err) {
      warnings.push(`Failed to convert change ${change.name}: ${(err as Error).message}`);
    }
  }

  return { results, warnings };
}

function buildChangeNote(opts: {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  featureRef: string;
  dependsOn: string[];
  touchesRefs: string[];
  systemRefs: string[];
  why: string;
  deltaSummary: string;
  proposedUpdate: string;
  designApproach: string;
  impactText: string;
  tasksBlock: string;
}): string {
  const dependsOnYaml = opts.dependsOn.length > 0
    ? opts.dependsOn.map(d => `  - ${d}`).join('\n')
    : '';
  const touchesYaml = opts.touchesRefs.length > 0
    ? opts.touchesRefs.map(t => `  - ${t}`).join('\n')
    : '';
  const systemsYaml = opts.systemRefs.length > 0
    ? opts.systemRefs.map(s => `  - ${s}`).join('\n')
    : '';

  return `---
type: change
id: ${safeYamlScalar(opts.id)}
status: ${safeYamlScalar(opts.status)}
created_at: ${safeYamlQuoted(opts.createdAt)}
feature: ${safeYamlQuoted(opts.featureRef)}
depends_on:
${dependsOnYaml || '  []'}
touches:
${touchesYaml || '  []'}
systems:
${systemsYaml || '  []'}
sources: []
decisions: []
tags:
  - change
  - migrated
---

# Change: ${opts.title}

## Why

${opts.why}

## Delta Summary
${opts.deltaSummary || '<!-- No delta specs found in original change -->'}

## Proposed Update

${opts.proposedUpdate}

## Design Approach

${opts.designApproach}

## Impact

${opts.impactText}

## Tasks
${opts.tasksBlock || '- [ ] Review migrated change'}

## Validation

<!-- Validation criteria not specified in original change -->

## Status Notes

<!-- Migrated from OpenSpec -->
`;
}

function buildDecisionNote(change: ScannedChange): ConversionResult {
  const id = `decision-${sanitizeMigrationId(change.name)}`;
  const title = formatChangeTitle(change.name);
  const context = extractSection(change.design ?? '', /^##\s+Context$/m) || '<!-- Context from design.md -->';
  const decisions = extractSection(change.design ?? '', /^##\s+Decisions?$/m) || change.design || '';
  const goals = extractSection(change.design ?? '', /^##\s+Goals/m);

  const changeTitle = `Change: ${title}`;

  const content = `---
type: decision
id: ${safeYamlScalar(id)}
status: active
features: []
changes:
  - "[[${changeTitle}]]"
tags:
  - decision
  - migrated
---

# Decision: ${title}

## Context

${context}

## Options Considered

${goals ? goals : '<!-- Options not explicitly documented -->'}

## Decision

${decisions}

## Consequences

<!-- Consequences not explicitly documented in original design -->

## Related Notes
`;

  return {
    targetPath: path.join('wiki', '05-decisions', `${id}.md`),
    content,
    sourceDescription: `openspec/changes/${change.archived ? 'archive/' : ''}${change.name}/design.md`,
  };
}

function buildProposedUpdate(whatChanges: string, nonGoals: string): string {
  const parts: string[] = [];
  if (whatChanges) parts.push(whatChanges);
  if (nonGoals) parts.push(`### Non-goals\n\n${nonGoals}`);
  return parts.join('\n\n') || '<!-- See delta summary for details -->';
}

function extractSection(content: string, sectionRe: RegExp): string {
  const match = content.match(sectionRe);
  if (!match) return '';

  const startIdx = match.index! + match[0].length;
  const remaining = content.slice(startIdx);
  const nextH2 = remaining.match(/\n## /);
  const sectionContent = nextH2 ? remaining.slice(0, nextH2.index!) : remaining;
  return sectionContent.trim();
}

function resolveCreatedAt(change: ScannedChange): string {
  // Try metadata first
  if (change.metadata?.created) {
    return change.metadata.created;
  }

  // Try archived date prefix (e.g., "2025-01-11-add-update-command")
  if (change.archived) {
    const dateMatch = change.name.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (dateMatch) return dateMatch[1];
  }

  // Default to today
  return new Date().toLocaleDateString('en-CA');
}

/** Parsed capability references from a proposal's ## Capabilities section */
interface ParsedCapabilities {
  newCapabilities: string[];
  modifiedCapabilities: string[];
}

function resolveFeatureRef(
  change: ScannedChange,
  featureRefs: Map<string, string>,
  capabilities: ParsedCapabilities,
  warnings: string[],
): string {
  // Try to match from delta specs first (most precise)
  if (change.deltaSpecs.length > 0) {
    const firstCapability = change.deltaSpecs[0].capability;
    const ref = featureRefs.get(firstCapability);
    if (ref) return ref;
  }

  // Try modified capabilities from proposal (indicates the primary feature being changed)
  for (const cap of capabilities.modifiedCapabilities) {
    const ref = featureRefs.get(cap);
    if (ref) return ref;
  }

  // Try new capabilities from proposal
  for (const cap of capabilities.newCapabilities) {
    const ref = featureRefs.get(cap);
    if (ref) return ref;
  }

  // Try to match from touches metadata
  if (change.metadata?.touches && change.metadata.touches.length > 0) {
    const firstTouch = change.metadata.touches[0];
    const ref = featureRefs.get(firstTouch);
    if (ref) return ref;
  }

  // Try to infer from change name
  for (const [capability, ref] of featureRefs) {
    if (change.name.includes(capability)) {
      return ref;
    }
  }

  warnings.push(`Could not resolve feature reference for change ${change.name}, leaving empty`);
  return '';
}

function buildDeltaSummary(
  change: ScannedChange,
  featureRefs: Map<string, string>,
): string {
  if (change.deltaSpecs.length === 0) return '';

  const lines: string[] = [];
  for (const delta of change.deltaSpecs) {
    const ref = featureRefs.get(delta.capability) ?? `[[${delta.capability}]]`;
    const deltaEntries = parseDeltaSpecContent(delta.content, ref);
    if (deltaEntries.length > 0) {
      lines.push(...deltaEntries);
    } else {
      // Fallback: generic entry if no structured content found
      lines.push(`- MODIFIED section "Migrated Content" in ${ref} [base: n/a]`);
    }
  }
  return lines.join('\n');
}

const DELTA_SECTION_HEADING_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements$/gm;
const DELTA_REQ_HEADING_RE = /^###\s+Requirement:\s*(.+)$/;

/**
 * Parse a delta spec file's content to extract structured delta summary entries.
 * Real delta specs use headings like:
 *   ## ADDED Requirements
 *   ### Requirement: Some Name
 *   ## MODIFIED Requirements
 *   ### Requirement: Other Name
 */
function parseDeltaSpecContent(content: string, featureRef: string): string[] {
  const entries: string[] = [];
  const lines = content.split('\n');
  let currentOp: string | null = null;

  for (const line of lines) {
    // Check for delta operation heading
    const opMatch = line.match(/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements$/);
    if (opMatch) {
      currentOp = opMatch[1];
      continue;
    }

    // Check for requirement heading under a delta op
    if (currentOp) {
      const reqMatch = line.match(DELTA_REQ_HEADING_RE);
      if (reqMatch) {
        const reqName = reqMatch[1].trim();
        const preposition = currentOp === 'ADDED' ? 'to' : currentOp === 'REMOVED' ? 'from' : 'in';
        const baseFP = currentOp === 'ADDED' ? ' [base: n/a]' : ' [base: migrated]';
        entries.push(`- ${currentOp} requirement "${reqName}" ${preposition} ${featureRef}${baseFP}`);
      }
    }

    // Reset op if we hit a non-delta H2
    if (line.match(/^##\s+/) && !line.match(/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements$/)) {
      currentOp = null;
    }
  }

  return entries;
}

function buildTasksBlock(tasksContent: string | null): string {
  if (!tasksContent) return '';

  const lines = tasksContent.split('\n');
  const tasks: string[] = [];

  for (const line of lines) {
    const match = line.match(TASK_LINE_RE);
    if (match) {
      const done = match[1] !== ' ';
      const text = match[2].trim();
      tasks.push(`- [${done ? 'x' : ' '}] ${text}`);
    }
  }

  return tasks.join('\n') || '- [ ] Review migrated change';
}

/**
 * Parse the ## Capabilities section from a proposal to extract capability names.
 * Real format:
 *   ## Capabilities
 *   ### New Capabilities
 *   - `capability-name`: description
 *   ### Modified Capabilities
 *   - `capability-name`: description
 */
function parseCapabilities(proposal: string): ParsedCapabilities {
  const result: ParsedCapabilities = { newCapabilities: [], modifiedCapabilities: [] };

  const capSection = extractSection(proposal, CAPABILITIES_RE);
  if (!capSection) return result;

  const lines = capSection.split('\n');
  let currentSubsection: 'new' | 'modified' | null = null;

  for (const line of lines) {
    if (line.match(/^###\s+New\s+Capabilities/i)) {
      currentSubsection = 'new';
      continue;
    }
    if (line.match(/^###\s+Modified\s+Capabilities/i)) {
      currentSubsection = 'modified';
      continue;
    }

    if (currentSubsection && line.startsWith('- ')) {
      // Extract capability name from "- `name`: description" or "- name: description"
      const backtickMatch = line.match(/^-\s+`([^`]+)`/);
      const plainMatch = line.match(/^-\s+(\S+?):/);
      const capName = backtickMatch?.[1] ?? plainMatch?.[1];
      if (capName && capName !== '_(none)_') {
        if (currentSubsection === 'new') {
          result.newCapabilities.push(capName);
        } else {
          result.modifiedCapabilities.push(capName);
        }
      }
    }
  }

  return result;
}

function buildTouchesRefs(
  change: ScannedChange,
  featureRefs: Map<string, string>,
  capabilities: ParsedCapabilities,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  // From delta specs
  for (const delta of change.deltaSpecs) {
    const ref = featureRefs.get(delta.capability);
    if (ref && !seen.has(ref)) {
      refs.push(`"${ref}"`);
      seen.add(ref);
    }
  }

  // From capabilities section (new + modified)
  for (const cap of [...capabilities.newCapabilities, ...capabilities.modifiedCapabilities]) {
    const ref = featureRefs.get(cap);
    if (ref && !seen.has(ref)) {
      refs.push(`"${ref}"`);
      seen.add(ref);
    }
  }

  // From metadata touches
  if (change.metadata?.touches) {
    for (const touch of change.metadata.touches) {
      const ref = featureRefs.get(touch) ?? `"[[${touch}]]"`;
      if (!seen.has(ref)) {
        refs.push(ref.startsWith('"') ? ref : `"${ref}"`);
        seen.add(ref);
      }
    }
  }

  return refs;
}

function inferSystemRefsFromChange(
  change: ScannedChange,
  featureRefs: Map<string, string>,
  systemRefMap: Map<string, string>,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  // From delta specs — most precise
  for (const delta of change.deltaSpecs) {
    const ref = systemRefMap.get(delta.capability);
    if (ref && !seen.has(ref)) {
      refs.push(`"${ref}"`);
      seen.add(ref);
    }
  }

  // From metadata touches
  if (change.metadata?.touches) {
    for (const touch of change.metadata.touches) {
      const ref = systemRefMap.get(touch);
      if (ref && !seen.has(ref)) {
        refs.push(`"${ref}"`);
        seen.add(ref);
      }
    }
  }

  // From metadata provides (new capabilities)
  if (change.metadata?.provides) {
    for (const cap of change.metadata.provides) {
      const ref = systemRefMap.get(cap);
      if (ref && !seen.has(ref)) {
        refs.push(`"${ref}"`);
        seen.add(ref);
      }
    }
  }

  return refs;
}

function extractDesignSummary(design: string): string {
  // Extract the main content, trying Context or Decisions sections first
  const context = extractSection(design, /^##\s+Context$/m);
  const decisions = extractSection(design, /^##\s+Decisions?$/m);
  const goals = extractSection(design, /^##\s+Goals/m);

  const parts: string[] = [];
  if (context) parts.push(context);
  if (goals) parts.push(goals);
  if (decisions) parts.push(decisions);

  if (parts.length > 0) return parts.join('\n\n');

  // Fallback: return the whole design content without H1
  return design.replace(/^#\s+.+\n*/m, '').trim() || '<!-- Design content could not be extracted -->';
}

function isSubstantialDesign(design: string): boolean {
  // Consider a design substantial if it has more than 200 chars of actual content
  const stripped = design.replace(/^#.*$/gm, '').replace(/<!--.*?-->/gs, '').trim();
  return stripped.length > 200;
}

function formatChangeTitle(name: string): string {
  // Remove date prefix for archived changes
  const withoutDate = name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return withoutDate
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
