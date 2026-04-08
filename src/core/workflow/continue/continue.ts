import * as path from 'node:path';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import type { ContinueResult, ContinueDeps, GatheredContext, ChangeContext, LinkedNoteContext, SectionAnalysis } from './types.js';
import { analyzeChangeSections, checkPlannedPrerequisites } from './section-checker.js';
import { nextAction, toPublicNextAction } from './next-action.js';
import { checkDecisionPromotion } from './decision-promoter.js';
import { assertInsideVault } from '../../../utils/path-safety.js';

const ACTIVE_STATUSES = new Set(['proposed', 'planned', 'in_progress']);

/**
 * Main continue workflow entry point.
 *
 * 1. Select target Change
 * 2. Analyze sections
 * 3. Gather context from linked notes
 * 4. Compute next action
 * 5. Check Decision promotion
 * 6. Execute transitions
 * 7. Return structured result
 */
export function continueChange(
  index: VaultIndex,
  deps: ContinueDeps,
  options?: { changeName?: string; dryRun?: boolean },
): ContinueResult {
  // Step 1: Select target change
  const changeRecord = selectChange(index, options?.changeName);

  // Step 2: Parse and analyze
  const resolvedPath = path.resolve(index.vaultRoot, changeRecord.path);
  const parsed = deps.parseNote(resolvedPath);
  const analysis = analyzeChangeSections(parsed);

  // Step 3: Gather context (pass analysis and frontmatter to avoid re-parsing)
  const context = gatherContext(changeRecord, index, deps, analysis, parsed.rawFrontmatter ?? {});

  // Step 4: Compute next action
  const internalAction = nextAction(changeRecord, analysis, index, context, deps);

  // Step 5: Execute transitions if needed (skip when dryRun)
  let effectiveStatus = changeRecord.status;
  if (!options?.dryRun) {
    if (internalAction.action === 'transition') {
      // Write status update to frontmatter
      executeTransition(changeRecord, internalAction.to, deps, index.vaultRoot);
      effectiveStatus = internalAction.to;
    } else if (internalAction.action === 'start_implementation') {
      // planned -> in_progress implicit transition
      executeTransition(changeRecord, 'in_progress', deps, index.vaultRoot);
      effectiveStatus = 'in_progress';
    }
  }

  // Step 6: Check Decision promotion
  const promotion = checkDecisionPromotion(changeRecord, analysis);
  if (promotion) {
    context.softWarnings.push(
      'Design Approach contains content that may warrant a Decision note. ' +
      'Consider promoting durable rationale to a separate Decision.',
    );
  }

  // Step 7: Build result
  // After auto-transition, re-compute nextAction to reflect the NEW status
  let effectiveAction = internalAction;
  if (effectiveStatus !== changeRecord.status) {
    // Update context.change.status to match the transitioned status
    context.change.status = effectiveStatus;
    // Update frontmatter.status to match the transitioned status
    context.change.frontmatter.status = effectiveStatus;
    // Status changed — re-derive what the next action should be in the new state
    const updatedRecord = { ...changeRecord, status: effectiveStatus };
    effectiveAction = nextAction(updatedRecord, analysis, index, context, deps);
  }

  const publicAction = toPublicNextAction(effectiveAction);

  return {
    changeName: changeRecord.title,
    changeId: changeRecord.id,
    currentStatus: effectiveStatus,
    nextAction: publicAction,
    context,
    summary: formatSummary({ ...changeRecord, status: effectiveStatus }, publicAction),
  };
}

/**
 * Select the target Change from the index.
 */
function selectChange(index: VaultIndex, explicitName?: string): IndexRecord {
  const activeChanges = Array.from(index.records.values())
    .filter((r) => r.type === 'change' && ACTIVE_STATUSES.has(r.status));

  if (explicitName) {
    // When explicit name is given, also search applied changes
    // (for verify_then_archive path)
    const allChanges = Array.from(index.records.values())
      .filter((r) => r.type === 'change');
    const match = allChanges.find(
      (c) => c.id === explicitName || c.title.toLowerCase().includes(explicitName.toLowerCase()),
    );
    if (!match) {
      throw new Error(`Change "${explicitName}" not found among active changes`);
    }
    return match;
  }

  if (activeChanges.length === 0) {
    // Fall back to applied changes for verify_then_archive path
    const appliedChanges = Array.from(index.records.values())
      .filter((r) => r.type === 'change' && r.status === 'applied');
    if (appliedChanges.length > 0) {
      return appliedChanges[0];
    }
    throw new Error("No active changes. Use 'propose' to create one.");
  }

  if (activeChanges.length === 1) {
    return activeChanges[0];
  }

  // Multiple active changes: require explicit selection
  const changeList = activeChanges
    .map((c) => `  - ${c.id} (${c.status}) "${c.title}"`)
    .join('\n');
  throw new Error(
    `Multiple active changes found. Specify which to continue:\n${changeList}`,
  );
}

/**
 * Gather context from linked notes.
 * When no changeId is specified and multiple active changes exist,
 * returns a result with the list of active changes and stops.
 */
function gatherContext(
  changeRecord: IndexRecord,
  index: VaultIndex,
  deps: ContinueDeps,
  analysis?: SectionAnalysis,
  frontmatter?: Record<string, unknown>,
): GatheredContext {
  // Parse the Change note to populate sections and frontmatter
  const resolvedChangePath = path.resolve(index.vaultRoot, changeRecord.path);
  let changeSections = analysis ?? { sections: new Map(), totalTasks: 0, completedTasks: 0, deltaSummaryCount: 0, taskItems: [] };
  let changeFrontmatter: Record<string, unknown> = frontmatter ?? {};
  if (!analysis) {
    try {
      const changeParsed = deps.parseNote(resolvedChangePath);
      changeSections = analyzeChangeSections(changeParsed);
      changeFrontmatter = changeParsed.rawFrontmatter ?? {};
    } catch {
      // Keep defaults
    }
  }

  const context: GatheredContext = {
    change: {
      id: changeRecord.id,
      title: changeRecord.title,
      status: changeRecord.status,
      sections: changeSections,
      dependsOn: changeRecord.depends_on ?? [],
      touches: changeRecord.touches ?? [],
      frontmatter: changeFrontmatter,
    },
    features: [],
    decisions: [],
    systems: [],
    sources: [],
    softWarnings: [],
  };

  // Linked features
  const featureIds = changeRecord.feature
    ? [changeRecord.feature]
    : (changeRecord.features ?? []);

  for (const fId of featureIds) {
    const featureRecord = index.records.get(fId);
    if (featureRecord) {
      context.features.push(buildLinkedContext(featureRecord, ['Purpose', 'Current Behavior', 'Requirements'], index, deps));
    }
  }

  // Linked decisions
  for (const dId of changeRecord.decisions ?? []) {
    const decisionRecord = index.records.get(dId);
    if (decisionRecord) {
      context.decisions.push(buildLinkedContext(decisionRecord, ['Summary', 'Context', 'Decision'], index, deps));
    }
  }

  // Linked systems
  for (const sId of changeRecord.systems ?? []) {
    const systemRecord = index.records.get(sId);
    if (systemRecord) {
      context.systems.push(buildLinkedContext(systemRecord, ['Purpose', 'Boundaries'], index, deps));
    }
  }

  // Linked sources
  for (const srcId of changeRecord.sources ?? []) {
    const sourceRecord = index.records.get(srcId);
    if (sourceRecord) {
      context.sources.push(buildLinkedContext(sourceRecord, ['Summary', 'Content'], index, deps));
    }
  }

  return context;
}

const MAX_SECTION_LENGTH = 500;

function buildLinkedContext(
  record: IndexRecord,
  sectionNames: string[],
  index: VaultIndex,
  deps: ContinueDeps,
): LinkedNoteContext {
  const relevantSections: Record<string, string> = {};

  // Parse the actual note file to get real section content
  const resolvedPath = path.resolve(index.vaultRoot, record.path);
  try {
    const parsed = deps.parseNote(resolvedPath);
    // Search all sections including children (H2 sections are often children of H1)
    const collectSections = (sections: typeof parsed.sections): void => {
      for (const section of sections) {
        if (sectionNames.includes(section.title) && section.content.trim()) {
          const truncated = section.content.length > MAX_SECTION_LENGTH
            ? section.content.slice(0, MAX_SECTION_LENGTH) + '...'
            : section.content;
          relevantSections[section.title] = truncated;
        }
        if (section.children.length > 0) {
          collectSections(section.children);
        }
      }
    };
    collectSections(parsed.sections);
  } catch {
    // If parsing fails, fall back to headings-only
    for (const heading of record.headings) {
      if (sectionNames.includes(heading)) {
        relevantSections[heading] = '(unable to read section content)';
      }
    }
  }

  return {
    id: record.id,
    title: record.title,
    type: record.type,
    relevantSections,
  };
}

/**
 * Execute a status transition.
 * Per unified ownership rules:
 *   continue(08) owns: proposed->planned, planned->in_progress
 *   apply(09) owns: in_progress->applied (NOT allowed here)
 */
function executeTransition(
  changeRecord: IndexRecord,
  targetStatus: string,
  deps: ContinueDeps,
  vaultRoot?: string,
): void {
  const current = changeRecord.status;
  const allowed: Record<string, string[]> = {
    proposed: ['planned'],
    planned: ['in_progress'],
    in_progress: [],   // in_progress->applied is owned by apply(09)
    applied: [],
  };

  if (!(allowed[current] ?? []).includes(targetStatus)) {
    throw new Error(
      `Invalid transition: "${current}" -> "${targetStatus}". ` +
      (targetStatus === 'applied'
        ? 'The in_progress->applied transition is owned by the apply workflow.'
        : 'Only the allowed lifecycle transitions are permitted.'),
    );
  }

  // Read current file, update frontmatter status
  const filePath = vaultRoot ? path.resolve(vaultRoot, changeRecord.path) : changeRecord.path;
  if (vaultRoot) {
    assertInsideVault(filePath, vaultRoot);
  }
  const content = deps.readFile(filePath);
  const updated = content.replace(
    /^(status:\s*).+$/m,
    `$1${targetStatus}`,
  );
  deps.writeFile(filePath, updated);
}

function formatSummary(changeRecord: IndexRecord, action: { action: string; target?: string; to?: string }): string {
  const lines: string[] = [];
  lines.push(`## Continue: ${changeRecord.title}`);
  lines.push(`**Status:** ${changeRecord.status}`);
  lines.push('');

  switch (action.action) {
    case 'fill_section':
      lines.push(`### Next Step: Fill '${action.target}'`);
      break;
    case 'transition':
      lines.push(`All prerequisites for '${action.to}' are met. Ready to transition.`);
      break;
    case 'blocked':
      lines.push('### Blocked');
      break;
    case 'start_implementation':
      lines.push('### Ready to Implement');
      lines.push(`First task: ${action.target}`);
      break;
    case 'continue_task':
      lines.push(`### Next Task: ${action.target}`);
      break;
    case 'ready_to_apply':
      lines.push("All tasks complete. Run 'apply' to update canonical Features.");
      break;
    case 'verify_then_archive':
      lines.push("Change is applied. Run 'verify' then 'archive' when ready.");
      break;
  }

  return lines.join('\n');
}
