import type { IndexRecord, VaultIndex } from '../../../types/index-record.js';
import type { SequencingResult } from '../../../types/sequencing.js';
import type { NextAction as PublicNextAction } from '../../../types/next-action.js';
import type { InternalNextAction, SectionAnalysis, GatheredContext, ContinueDeps } from './types.js';
import { checkPlannedPrerequisites, buildSectionTarget } from './section-checker.js';

/**
 * Compute the deterministic next action for a Change.
 * Implements the exact pseudocode from overview.md section 15.
 */
export function nextAction(
  changeRecord: IndexRecord,
  analysis: SectionAnalysis,
  index: VaultIndex,
  context: GatheredContext,
  deps: ContinueDeps,
): InternalNextAction {
  const status = changeRecord.status;

  if (status === 'proposed') {
    const { missingHard, softWarnings } = checkPlannedPrerequisites(analysis);
    context.softWarnings.push(...softWarnings);

    if (missingHard.length > 0) {
      const target = buildSectionTarget(missingHard[0]);
      return { action: 'fill_section', target, context };
    }

    return { action: 'transition', to: 'planned', context };
  }

  if (status === 'planned') {
    const unresolvedDeps = checkDependsOn(changeRecord, index, deps);
    if (unresolvedDeps.length > 0) {
      return {
        action: 'blocked',
        reason: 'Depends on unresolved changes',
        unresolvedTargets: unresolvedDeps.map((d) => d.target),
      };
    }

    const firstUnchecked = getFirstUncheckedTaskIndex(analysis);
    if (firstUnchecked === null) {
      // Edge case: all tasks already checked at planned stage
      context.softWarnings.push(
        "All tasks are already checked at 'planned' status. " +
        "This is unusual — tasks are normally completed during 'in_progress'. " +
        "Transitioning to 'in_progress'; run continue again to proceed to apply.",
      );
      return { action: 'transition', to: 'in_progress', context };
    }

    return {
      action: 'start_implementation',
      target: { index: firstUnchecked, description: getTaskDescription(analysis, firstUnchecked) },
      context,
    };
  }

  if (status === 'in_progress') {
    const firstUnchecked = getFirstUncheckedTaskIndex(analysis);
    if (firstUnchecked !== null) {
      return {
        action: 'continue_task',
        target: { index: firstUnchecked, description: getTaskDescription(analysis, firstUnchecked) },
        context,
      };
    }
    // All tasks complete. Per unified ownership rules, only apply(09)
    // may execute the in_progress -> applied transition.
    return { action: 'ready_to_apply', context };
  }

  if (status === 'applied') {
    return { action: 'verify_then_archive', context };
  }

  throw new Error(`Invalid Change status: "${status}"`);
}

/**
 * Convert internal rich NextAction to the public flat NextAction.
 */
export function toPublicNextAction(internal: InternalNextAction): PublicNextAction {
  switch (internal.action) {
    case 'fill_section':
      return {
        action: 'fill_section',
        target: internal.target.sectionName,
        guidance: internal.target.guidance,
        templateHint: internal.target.templateHint,
      };
    case 'transition':
      return { action: 'transition', to: internal.to };
    case 'blocked':
      return { action: 'blocked', reason: internal.reason, blockers: internal.unresolvedTargets };
    case 'start_implementation':
      return {
        action: 'start_implementation',
        target: internal.target.description,
        taskIndex: internal.target.index,
      };
    case 'continue_task':
      return {
        action: 'continue_task',
        target: internal.target.description,
        taskIndex: internal.target.index,
      };
    case 'ready_to_apply':
      return { action: 'ready_to_apply' };
    case 'verify_then_archive':
      return { action: 'verify_then_archive' };
  }
}

// ── depends_on checking (delegates to sequencing engine) ──

interface UnresolvedDep {
  target: string;
  reason: string;
}

/**
 * Check depends_on resolution by delegating to the sequencing engine.
 * Per ownership rules: continue(08) must call sequencing-engine, not reimplement.
 */
function checkDependsOn(
  changeRecord: IndexRecord,
  index: VaultIndex,
  deps: ContinueDeps,
): UnresolvedDep[] {
  const dependsOn = changeRecord.depends_on ?? [];
  if (dependsOn.length === 0) return [];

  const sequencingResult = deps.analyzeSequencing(index.records);

  const perChange = sequencingResult.ordering.find((o) => o.id === changeRecord.id);
  const unresolved: UnresolvedDep[] = [];

  if (perChange && perChange.blocked_by.length > 0) {
    for (const depId of perChange.blocked_by) {
      const depRecord = index.records.get(depId);
      unresolved.push({
        target: depId,
        reason: depRecord
          ? `status is '${depRecord.status}', needs 'applied'`
          : 'depends_on target not found in vault',
      });
    }
  }

  for (const ooe of sequencingResult.out_of_order_errors) {
    if (ooe.change_id === changeRecord.id) {
      unresolved.push({
        target: ooe.dependency_id,
        reason: ooe.message,
      });
    }
  }

  for (const cycle of sequencingResult.cycles) {
    if (cycle.cycle.includes(changeRecord.id)) {
      unresolved.push({
        target: cycle.cycle.join(' -> '),
        reason: cycle.message,
      });
    }
  }

  return unresolved;
}

function getFirstUncheckedTaskIndex(analysis: SectionAnalysis): number | null {
  if (analysis.totalTasks === 0) return null;
  const idx = analysis.taskItems.findIndex((t) => !t.done);
  return idx === -1 ? null : idx;
}

function getTaskDescription(analysis: SectionAnalysis, index: number): string {
  const item = analysis.taskItems[index];
  return item ? item.text : `Task ${index + 1} of ${analysis.totalTasks}`;
}
