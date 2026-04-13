import * as path from 'node:path';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import type { ContinueResult, ContinueDeps, GatheredContext, ChangeContext, LinkedNoteContext, SectionAnalysis } from './types.js';
import { analyzeChangeSections, checkPlannedPrerequisites } from './section-checker.js';
import { nextAction, toPublicNextAction } from './next-action.js';
import { checkDecisionPromotion } from './decision-promoter.js';
import { computeRequirementHash } from '../apply/stale-checker.js';
import { assertInsideVault } from '../../../utils/path-safety.js';
import { readConventionsContent } from '../../../utils/conventions.js';
import { ERROR_CODES } from '../../../types/error-codes.js';

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

  // Step 6b: Stale-base early warning.
  // When another Change has already been applied to the same Feature,
  // this Change's delta_summary base_fingerprints will be stale. Users
  // discover this only at `ows apply` time, which is too late — all
  // sections have been filled, tasks checked, and apply fails with
  // STALE_BASE. Surface the problem during `continue` so users can
  // update the [base: ...] entries before investing more work.
  if (changeRecord.delta_summary.length > 0) {
    for (const entry of changeRecord.delta_summary) {
      if (entry.target_type !== 'requirement') continue;
      if (!entry.base_fingerprint || entry.base_fingerprint === 'migrated') continue;
      const featureRecord = index.records.get(entry.target_note_id);
      if (!featureRecord) continue;
      const req = featureRecord.requirements.find((r) => r.name === entry.target_name);
      if (!req) continue;
      // Compute current hash — import is at module level so this is cheap
      const currentHash = computeRequirementHash(req);
      if (currentHash !== entry.base_fingerprint) {
        context.softWarnings.push(
          `Stale base detected early: "${entry.target_name}" in Feature "${featureRecord.title}" — ` +
            `base_fingerprint in Delta Summary is ${entry.base_fingerprint} but current is ${currentHash}. ` +
            `Update the [base: ...] entry in the Change's ## Delta Summary before running \`ows apply\`.`,
        );
      }
    }
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
    // Prefer exact ID match, then exact title match (no partial substring)
    const match = allChanges.find((c) => c.id === explicitName)
      ?? allChanges.find((c) => c.title.toLowerCase() === explicitName.toLowerCase());
    if (!match) {
      // The search covers all changes (active + applied + archived)
      // because explicit lookup is also used for verify_then_archive
      // paths. Error message must reflect that so users don't wonder
      // why a known archived id "doesn't exist".
      throw new Error(
        `Change "${explicitName}" not found in the vault (searched all changes including applied/archived by id and by title). ` +
          'Use `ows list --json` to see available change ids.',
      );
    }
    return match;
  }

  if (activeChanges.length === 0) {
    throw new Error("No active changes. Use 'propose' to create one, or specify a change ID explicitly.");
  }

  if (activeChanges.length === 1) {
    return activeChanges[0];
  }

  // Multiple active changes: require explicit selection
  const changeList = activeChanges
    .map((c) => `  - ${c.id} (${c.status}) "${c.title}"`)
    .join('\n');
  const err = new Error(
    `Multiple active changes found. Specify which to continue:\n${changeList}`,
  ) as AmbiguousChangeError;
  err.code = ERROR_CODES.AMBIGUOUS_CHANGE_SELECTION;
  err.candidates = activeChanges.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    path: c.path,
  }));
  throw err;
}

/**
 * Error thrown when multiple active changes exist and no explicit selection is given.
 * Carries the candidate list so CLI can expose it in JSON error payloads.
 */
export interface AmbiguousChangeError extends Error {
  code: typeof ERROR_CODES.AMBIGUOUS_CHANGE_SELECTION;
  candidates: { id: string; title: string; status: string; path: string }[];
}

export function isAmbiguousChangeError(err: unknown): err is AmbiguousChangeError {
  return err instanceof Error && (err as AmbiguousChangeError).code === ERROR_CODES.AMBIGUOUS_CHANGE_SELECTION;
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
    queries: [],
    softWarnings: [],
    conventions: readConventionsContent(index.vaultRoot, deps),
  };

  // Linked features
  const featureIds = changeRecord.feature
    ? [changeRecord.feature]
    : (changeRecord.features ?? []);

  for (const fId of featureIds) {
    const featureRecord = index.records.get(fId);
    if (featureRecord) {
      // Soft-warn on continuing a Change whose linked Feature is
      // archived or deprecated. The Change author might be working
      // against a Feature that was retired — surface the mismatch
      // before they invest more time filling sections. `continue` is
      // not blocked (the author may legitimately be resurrecting an
      // archived Feature), just informed.
      const featurePath = featureRecord.path ?? '';
      const featureStatus = (featureRecord.status ?? '').toLowerCase();
      if (featurePath.startsWith('wiki/99-archive/') || featureStatus === 'archived') {
        context.softWarnings.push(
          `Linked Feature "${featureRecord.title}" is archived. ` +
            'Continuing work will extend a retired Feature — confirm this is intentional.',
        );
      } else if (featureStatus === 'deprecated') {
        context.softWarnings.push(
          `Linked Feature "${featureRecord.title}" is deprecated. ` +
            'Consider migrating this change to the replacement Feature.',
        );
      }
      context.features.push(buildLinkedContext(featureRecord, ['Purpose', 'Current Behavior', 'Constraints', 'Known Gaps', 'Requirements', 'Change Log'], index, deps));
    }
  }

  // Linked decisions
  for (const dId of changeRecord.decisions ?? []) {
    const decisionRecord = index.records.get(dId);
    if (decisionRecord) {
      context.decisions.push(buildLinkedContext(decisionRecord, ['Context', 'Decision', 'Consequences'], index, deps));
    }
  }

  // Linked systems
  for (const sId of changeRecord.systems ?? []) {
    const systemRecord = index.records.get(sId);
    if (systemRecord) {
      context.systems.push(buildLinkedContext(systemRecord, ['Purpose', 'Overview', 'Boundaries'], index, deps));
    }
  }

  // Linked sources
  for (const srcId of changeRecord.sources ?? []) {
    const sourceRecord = index.records.get(srcId);
    if (sourceRecord) {
      context.sources.push(buildLinkedContext(sourceRecord, ['Summary', 'Content', 'Key Points'], index, deps));
    }
  }

  // Linked Query notes via feature backlinks.
  // Query notes that reference any of this change's features are brought in
  // so the agent can consider prior investigations while continuing.
  const seenQueryIds = new Set<string>();
  for (const fId of featureIds) {
    const featureRecord = index.records.get(fId);
    if (!featureRecord) continue;
    for (const backId of featureRecord.links_in ?? []) {
      if (seenQueryIds.has(backId)) continue;
      const backRecord = index.records.get(backId);
      if (backRecord && backRecord.type === 'query') {
        context.queries.push(
          buildLinkedContext(backRecord, ['Question', 'Findings', 'Conclusion'], index, deps),
        );
        seenQueryIds.add(backId);
      }
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

  // Compare-and-swap: verify the status the in-memory index observed is
  // still what the file contains right now. Without this, two concurrent
  // `ows continue` processes can each load a stale index showing
  // `proposed`, each compute the transition to `planned`, each rewrite
  // the file, and both succeed — the second write silently clobbers the
  // first's temp/rename. The status lifecycle then says `planned` but
  // logs/audit trails disagree. Reject on mismatch so the user can retry
  // against a fresh index.
  const observedStatusMatch = content.match(/^status:\s*([^\n]+)$/m);
  const observedStatus = observedStatusMatch?.[1]?.trim();
  if (observedStatus && observedStatus !== current) {
    throw new Error(
      `Concurrent modification detected: change "${changeRecord.id}" was loaded with status "${current}" ` +
        `but the file on disk now reads "${observedStatus}". Another process may have transitioned this change. ` +
        'Re-run `ows continue` to pick up the new status and decide what to do next.',
    );
  }

  const updated = content.replace(
    /^(status:\s*).+$/m,
    `$1${targetStatus}`,
  );

  // Atomic write via temp-file + rename when fs primitives are available.
  // Falls back to direct writeFile for test mocks that don't wire renameFile/deleteFile.
  const tmpSuffix = `.ows-status-${Date.now()}-${process.pid}`;
  if (deps.renameFile) {
    const tmpPath = `${filePath}${tmpSuffix}`;
    deps.writeFile(tmpPath, updated);
    try {
      deps.renameFile(tmpPath, filePath);
    } catch (renameErr) {
      // Cleanup temp file on rename failure so we don't leave orphans
      if (deps.deleteFile) {
        try { deps.deleteFile(tmpPath); } catch { /* swallow */ }
      }
      throw renameErr;
    }
  } else {
    deps.writeFile(filePath, updated);
  }
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

/**
 * Read project conventions from wiki/00-meta/conventions.md (best-effort).
 */
