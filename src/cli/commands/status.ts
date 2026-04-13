import { handleCliError } from "./error-handler.js";
/**
 * CLI handler for `ows status`.
 * Delegates nextAction computation to the canonical continue/next-action module.
 */
import type { Command } from 'commander';
import { discoverVaultPath } from '../vault-discovery.js';
import { warnOnUnsupportedSchema } from '../schema-check.js';
import { jsonEnvelope } from '../json-envelope.js';
import type { VaultIndex, IndexRecord } from '../../types/index.js';
import type { SectionAnalysis, SectionStatus } from '../../core/workflow/continue/types.js';
import { nextAction as computeCanonicalNextAction, toPublicNextAction } from '../../core/workflow/continue/next-action.js';
import type { StatusResult } from '../../types/cli-contracts.js';
export type { StatusResult };

export function registerStatusCommand(program: Command): void {
  program
    .command('status [changeId]')
    .description('Show current state of a Change')
    .option('--json', 'Output result as JSON')
    .action(async (changeId: string | undefined, opts: { json?: boolean }) => {
      try {
        const vaultPath = discoverVaultPath();
        const { buildIndex } = await import('../../core/index/index.js');
        const { analyzeSequencing } = await import('../../core/sequencing/index.js');
        const index = await buildIndex(vaultPath);
        warnOnUnsupportedSchema(index);

        const resolvedChangeId = resolveChangeId(changeId, index);
        const result = getChangeStatus(resolvedChangeId, index, {
          analyzeSequencing: (records) => analyzeSequencing(records),
        });

        if (opts.json) {
          console.log(jsonEnvelope('status', result));
        } else {
          console.log(formatStatusHuman(result));
        }
      } catch (err: unknown) {
        handleCliError(err, opts.json);
      }
    });
}

/**
 * Resolve changeId: if omitted and only one active change exists, use it.
 */
function resolveChangeId(changeId: string | undefined, index: VaultIndex): string {
  if (changeId) return changeId;

  const activeStatuses = new Set(['proposed', 'planned', 'in_progress']);
  const activeChanges = Array.from(index.records.values())
    .filter((r) => r.type === 'change' && activeStatuses.has(r.status));

  if (activeChanges.length === 0) {
    throw new Error("No active changes. Use 'propose' to create one.");
  }
  if (activeChanges.length === 1) {
    return activeChanges[0].id;
  }
  const changeList = activeChanges
    .map((c) => `  - ${c.id} (${c.status}) "${c.title}"`)
    .join('\n');
  throw new Error(
    `Multiple active changes found. Specify which to check:\n  ows status <changeId>\n${changeList}`,
  );
}

export interface StatusDeps {
  analyzeSequencing: (records: Map<string, IndexRecord>) => import('../../types/sequencing.js').SequencingResult;
}

/**
 * Build a SectionAnalysis from an IndexRecord's raw_text and tasks.
 * This avoids needing to call parseNote (which requires real files).
 */
function buildSectionAnalysisFromRecord(change: IndexRecord): SectionAnalysis {
  const KNOWN_SECTIONS = [
    'Why', 'Delta Summary', 'Proposed Update',
    'Design Approach', 'Impact', 'Tasks', 'Validation', 'Status Notes',
  ];

  const sections = new Map<string, SectionStatus>();
  for (const name of KNOWN_SECTIONS) {
    const hasContent = sectionHasContent(change.raw_text, name);
    const exists = sectionExists(change.raw_text, name);
    sections.set(name, {
      exists,
      isEmpty: !hasContent,
      content: '',
    });
  }

  return {
    sections,
    totalTasks: change.tasks.length,
    completedTasks: change.tasks.filter((t) => t.done).length,
    deltaSummaryCount: change.delta_summary.length,
    taskItems: change.tasks.map((t) => ({ text: t.text, done: t.done })),
  };
}

/**
 * Get the status of a change, including section completeness and next action.
 * Delegates to the canonical nextAction() from continue/next-action.ts.
 */
export function getChangeStatus(changeId: string, index: VaultIndex, deps?: StatusDeps): StatusResult {
  const change = index.records.get(changeId);
  if (!change) {
    throw new Error(`Change "${changeId}" not found in the vault index.`);
  }
  if (change.type !== 'change') {
    throw new Error(`"${changeId}" is a ${change.type}, not a change.`);
  }

  const features: string[] = [];
  if (change.feature) features.push(change.feature);
  if (change.features) features.push(...change.features);

  // Build section analysis from the index record
  const analysis = buildSectionAnalysisFromRecord(change);

  const sectionCompleteness = {
    why: !(analysis.sections.get('Why')?.isEmpty ?? true),
    deltaSummary: analysis.deltaSummaryCount > 0,
    tasks: analysis.totalTasks > 0,
    validation: !(analysis.sections.get('Validation')?.isEmpty ?? true),
    designApproach: analysis.sections.get('Design Approach')?.exists
      ? !(analysis.sections.get('Design Approach')?.isEmpty ?? true)
      : undefined,
  };

  const taskProgress = {
    total: analysis.totalTasks,
    completed: analysis.completedTasks,
  };

  // Check blocked dependencies (include missing/unresolved deps as blockers too)
  const blockedBy: string[] = [];
  for (const dep of change.depends_on) {
    const depRecord = index.records.get(dep);
    if (!depRecord || depRecord.status !== 'applied') {
      blockedBy.push(dep);
    }
  }

  // Use the canonical nextAction from continue/next-action.ts
  const minimalContext = {
    change: {
      id: change.id,
      title: change.title,
      status: change.status,
      sections: analysis,
      dependsOn: change.depends_on ?? [],
      touches: change.touches ?? [],
      frontmatter: {},
    },
    features: [],
    decisions: [],
    systems: [],
    sources: [],
    queries: [],
    softWarnings: [],
  };

  // Build minimal ContinueDeps — status is read-only so write/read stubs are safe
  const continueDeps = {
    analyzeSequencing: deps?.analyzeSequencing ?? (() => ({
      status: 'parallel_safe' as const,
      ordering: [],
      pairwise_severities: [],
      requirement_conflicts: [],
      out_of_order_errors: [],
      cycles: [],
      stale_bases: [],
      reasons: [],
      related_changes: [],
    })),
    parseNote: () => ({ frontmatter: null, rawFrontmatter: {}, sections: [], headings: [], wikilinks: [], requirements: [], deltaSummary: [], tasks: [], body: '', contentHash: '', errors: [] }),
    writeFile: () => {},
    readFile: () => '',
  };

  const internalAction = computeCanonicalNextAction(change, analysis, index, minimalContext, continueDeps);
  const nextAction = toPublicNextAction(internalAction);

  return {
    changeId,
    status: change.status,
    features,
    sectionCompleteness,
    taskProgress,
    nextAction,
    blockedBy,
  };
}

/**
 * Check if a section heading exists in raw_text.
 */
function sectionExists(rawText: string, sectionName: string): boolean {
  const pattern = new RegExp(`^## ${sectionName}\\s*$`, 'm');
  return pattern.test(rawText);
}

/**
 * Check if a section heading in raw_text has non-empty content beneath it.
 */
function sectionHasContent(rawText: string, sectionName: string): boolean {
  const pattern = new RegExp(`^## ${sectionName}\\s*$`, 'm');
  const match = pattern.exec(rawText);
  if (!match) return false;

  const afterHeading = match.index + match[0].length;
  const rest = rawText.slice(afterHeading);
  const nextHeading = /^## /m.exec(rest);
  const sectionBody = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return sectionBody.trim().length > 0;
}

function formatStatusHuman(result: StatusResult): string {
  const lines: string[] = [];
  lines.push(`Change: ${result.changeId}`);
  lines.push(`Status: ${result.status}`);
  lines.push(`Features: ${result.features.join(', ') || 'none'}`);
  lines.push('');
  lines.push('Section Completeness:');
  lines.push(`  Why: ${result.sectionCompleteness.why ? 'yes' : 'NO'}`);
  lines.push(`  Delta Summary: ${result.sectionCompleteness.deltaSummary ? 'yes' : 'NO'}`);
  lines.push(`  Tasks: ${result.sectionCompleteness.tasks ? 'yes' : 'NO'}`);
  lines.push(`  Validation: ${result.sectionCompleteness.validation ? 'yes' : 'NO'}`);
  if (result.sectionCompleteness.designApproach !== undefined) {
    lines.push(`  Design Approach: ${result.sectionCompleteness.designApproach ? 'yes' : 'NO'}`);
  }
  lines.push('');
  lines.push(`Task Progress: ${result.taskProgress.completed}/${result.taskProgress.total}`);
  lines.push('');
  lines.push(`Next Action: ${result.nextAction.action}`);
  if (result.nextAction.target) lines.push(`  Target: ${result.nextAction.target}`);
  if (result.nextAction.to) lines.push(`  Transition to: ${result.nextAction.to}`);
  if (result.nextAction.reason) lines.push(`  Reason: ${result.nextAction.reason}`);
  // Surface guidance and template hint for fill_section actions so users
  // know exactly what content to write without re-reading the docs.
  if (result.nextAction.guidance) {
    lines.push(`  Guidance: ${result.nextAction.guidance}`);
  }
  if (result.nextAction.templateHint) {
    lines.push(`  Template:`);
    for (const tl of result.nextAction.templateHint.split('\n')) {
      lines.push(`    ${tl}`);
    }
  }
  if (result.blockedBy.length > 0) {
    lines.push(`  Blocked by: ${result.blockedBy.join(', ')}`);
  }
  // Next command hint so users don't have to guess the lifecycle
  lines.push('');
  const hint = getNextCommandHint(result);
  if (hint) lines.push(`Next command: ${hint}`);
  return lines.join('\n');
}

function getNextCommandHint(result: StatusResult): string | null {
  switch (result.nextAction.action) {
    case 'fill_section':
      return `ows continue ${result.changeId}  # fill the "${result.nextAction.target}" section`;
    case 'transition':
      return `ows continue ${result.changeId}  # transition to ${result.nextAction.to}`;
    case 'start_implementation':
    case 'continue_task':
      return `ows continue ${result.changeId}  # work on next task`;
    case 'ready_to_apply':
      return `ows apply ${result.changeId}`;
    case 'verify_then_archive':
      return `ows verify ${result.changeId} && ows archive ${result.changeId}`;
    case 'blocked':
      return `# resolve blockers first: ${result.blockedBy.join(', ')}`;
    default:
      return null;
  }
}
