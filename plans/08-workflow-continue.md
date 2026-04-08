# Continue Workflow Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec's continue workflow is built around an **artifact DAG** (Directed Acyclic Graph). Each change follows a schema (e.g., "spec-driven") that declares ordered artifacts (proposal, specs, design, tasks). The `continue` command:

1. Selects a change (user picks or most-recently-modified).
2. Reads the schema's artifact graph and detects which artifacts are complete (by checking file existence on disk).
3. Uses `getNextArtifacts(completed)` to find artifacts whose dependencies are all satisfied.
4. Picks the first ready artifact and loads its instructions (template, context, rules, dependencies).
5. Creates ONE artifact per invocation, then shows progress.

The core decision logic is purely structural: "which files exist?" determines "what to do next."

### Key Source Files

- `src/core/templates/workflows/continue-change.ts` -- Skill template that defines the agent-facing continue instructions. Runs `openspec status --change <name> --json` then `openspec instructions <artifact-id> --change <name> --json`.
- `src/core/artifact-graph/graph.ts` -- `ArtifactGraph` class: `getNextArtifacts(completed)` returns artifact IDs where all `requires` are in the completed set; `isComplete(completed)` checks if all artifacts are done; `getBlocked(completed)` returns blocked artifacts with their unmet deps.
- `src/core/artifact-graph/instruction-loader.ts` -- `loadChangeContext()` builds `ChangeContext` (graph + completed set + metadata); `generateInstructions()` loads template, resolves dependencies, reads project config for context/rules.
- `src/core/artifact-graph/state.ts` -- `detectCompleted(graph, changeDir)` iterates all artifacts and checks whether their `generates` file exists on disk (supports glob patterns).
- `src/core/artifact-graph/types.ts` -- Defines `Artifact` (id, generates, description, template, instruction, requires), `SchemaYaml`, `CompletedSet`, `BlockedArtifacts`.

### Core Algorithm / Flow

OpenSpec continue algorithm:

```
1. Resolve schema for the change (explicit > .openspec.yaml > default "spec-driven")
2. Build ArtifactGraph from schema YAML
3. detectCompleted(graph, changeDir):
     for each artifact in graph:
       if artifact.generates file exists on disk:
         add artifact.id to completedSet
4. If graph.isComplete(completedSet):
     → congratulate, suggest apply/archive, STOP
5. nextArtifacts = graph.getNextArtifacts(completedSet):
     for each artifact not in completedSet:
       if all artifact.requires are in completedSet:
         add to ready list
6. Pick first ready artifact (sorted alphabetically for determinism)
7. generateInstructions(context, artifactId):
     - load template from schema templates directory
     - resolve dependency info (which deps are done, their output paths)
     - compute unlocked artifacts (what becomes available after this one)
     - read project config for context/rules injection
8. Agent creates the artifact file following the template
9. Show updated status, STOP (one artifact per invocation)
```

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

- **Section 15: Recommended Workflow** -- Defines the next-action algorithm pseudocode, the status lifecycle `proposed -> planned -> in_progress -> applied`, and the section-completeness contract for the `proposed -> planned` transition.
- **Section 15: continue** -- "Read current Change state, linked Feature, related Decision, existing Tasks. Run nextAction(). Promote major design reasoning into Decision. Maintain depends_on and touches. Move to in_progress when implementation starts."
- **Section 14.2: Change structure** -- Defines the sections: Why, Delta Summary, Proposed Update, Design Approach, Impact, Tasks, Validation, Status Notes.
- **Section 15: Section-Completeness Contract** -- Hard prerequisites for `proposed -> planned`: Why non-empty, Delta Summary has >= 1 entry, Tasks has >= 1 item, Validation non-empty. Soft prerequisites: Design Approach exists, Decision link if complex.
- **Section 14.2: Design Approach vs Decision** -- Design Approach is ephemeral (dies with the change). Decision is durable. Content MUST NOT be duplicated between them. Promotion criteria: affects multiple Features/Systems, hard to reverse, needs team consensus, outlives the change.

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec |
|--------|----------|----------------|
| Progress model | Artifact DAG: file-existence detection | Section-completeness: frontmatter status + section content checks |
| What is "next" | The first artifact whose dependency files all exist | The first empty/missing section in a known order, OR the first unchecked task |
| Schema | External YAML schema file defining artifact graph | No external schema; the Change note template IS the schema |
| Granularity | One artifact file per step (proposal.md, design.md, etc.) | One section per step within a single Change note |
| Decision handling | design.md artifact in the change directory | Design Approach section (ephemeral) + Decision note (durable, separate) |
| Context loading | Read completed dependency files from change dir | Read linked Feature, Decision, System notes via wikilinks |
| Status transitions | Implicit (all artifacts done = complete) | Explicit status field: proposed -> planned -> in_progress -> applied |

### Contracts to Satisfy

1. The next-action algorithm from section 15 MUST be implemented exactly as specified.
2. Section-completeness check MUST enforce the 4 hard prerequisites and 2 soft prerequisites.
3. Design Approach content MUST NOT be duplicated into Decision notes; only link when promoting.
4. The continue workflow MUST read linked Feature, Decision, and System notes for context.
5. Status transitions MUST follow the allowed lifecycle: `proposed -> planned -> in_progress -> applied`.
6. When multiple active changes exist, the user MUST be asked to select one.
7. `depends_on` and `touches` metadata MUST be maintained during continue.

---

## 3. Implementation Plan

### Architecture Overview

The continue workflow is a single-module function that:

1. Selects the target Change note.
2. Parses the Change to extract status, sections, frontmatter links.
3. Runs the next-action algorithm to determine what to do.
4. Gathers context from linked notes (Feature, Decision, System).
5. Returns a structured `ContinueResult` that tells the agent exactly what to do next.

It depends on the vault parser (plan 03), the index engine (plan 04), and the note templates (plan 02).

```
┌─────────────────────────────────────────────────┐
│                 continue workflow                │
│                                                  │
│  selectChange() ─► parseChange() ─► nextAction() │
│                        │                │        │
│                 gatherContext()    ContinueResult │
│                        │                         │
│              ┌─────────┴──────────┐              │
│              │  Feature, Decision, │              │
│              │  System notes       │              │
│              └─────────────────────┘              │
└─────────────────────────────────────────────────┘
```

### Data Structures

```typescript
/**
 * Represents the result of analyzing a Change note's sections.
 */
interface SectionAnalysis {
  /** Section name -> whether it has non-empty content */
  sections: Map<string, SectionStatus>;
  /** Number of tasks total */
  totalTasks: number;
  /** Number of checked tasks */
  completedTasks: number;
  /** Number of Delta Summary entries */
  deltaSummaryCount: number;
}

interface SectionStatus {
  exists: boolean;
  isEmpty: boolean;
  /** Raw content of the section (for context gathering) */
  content: string;
}

/**
 * Hard prerequisites for proposed -> planned transition.
 * Maps to overview.md section 15 Section-Completeness Contract.
 */
interface PlannedPrerequisites {
  /** Why section is non-empty */
  whyPresent: boolean;
  /** Delta Summary has >= 1 entry */
  deltaSummaryPresent: boolean;
  /** Tasks has >= 1 item */
  tasksPresent: boolean;
  /** Validation section is non-empty */
  validationPresent: boolean;
}

/**
 * Soft prerequisites (warning-only).
 */
interface SoftPrerequisites {
  /** Design Approach exists and is not empty (or explicitly "N/A") */
  designApproachPresent: boolean;
  /** At least one Decision link exists (relevant for complex changes) */
  decisionLinkPresent: boolean;
}

/**
 * The action the agent should take next.
 */
type NextAction =
  | { action: "fill_section"; target: SectionTarget; context: GatheredContext }
  | { action: "transition"; to: "planned"; context: GatheredContext }
  | { action: "blocked"; reason: string; unresolvedTargets: string[] }
  | { action: "start_implementation"; target: TaskTarget; context: GatheredContext }
  | { action: "continue_task"; target: TaskTarget; context: GatheredContext }
  | { action: "ready_to_apply"; context: GatheredContext }
  | { action: "verify_then_archive"; context: GatheredContext }
  // NOTE: Decision promotion is NOT a nextAction() return type.
  // It is handled as a post-processing step in the continue orchestrator.
  // See "Decision Promotion Check" section below.
  //
  // NOTE: The `in_progress -> applied` transition is NOT owned by continue.
  // Per unified ownership rules, only apply(09) may set status to `applied`.
  // When all tasks are done, continue returns `ready_to_apply` to signal
  // the user should run the apply workflow.

/**
 * Identifies which section needs to be filled.
 */
interface SectionTarget {
  sectionName: string;
  /** Human-readable description of what this section should contain */
  guidance: string;
  /** Suggested template content or structure hints */
  templateHint: string;
}

/**
 * Identifies which task to work on.
 */
interface TaskTarget {
  /** Zero-based index in the Tasks checklist */
  index: number;
  /** Raw text of the task item */
  description: string;
}

/**
 * Context gathered from linked notes for the agent to use when filling sections.
 */
interface GatheredContext {
  /** The Change note's own content */
  change: ChangeContext;
  /** Linked Feature note(s) content */
  features: LinkedNoteContext[];
  /** Linked Decision note(s) content */
  decisions: LinkedNoteContext[];
  /** Linked System note(s) content */
  systems: LinkedNoteContext[];
  /** Linked Source note(s) content */
  sources: LinkedNoteContext[];
  /** Soft prerequisite warnings to display */
  softWarnings: string[];
}

interface ChangeContext {
  id: string;
  title: string;
  status: string;
  sections: SectionAnalysis;
  dependsOn: string[];
  touches: string[];
  frontmatter: Record<string, unknown>;
}

interface LinkedNoteContext {
  id: string;
  title: string;
  type: string;
  /** Key sections extracted (Purpose, Requirements, etc.) */
  relevantSections: Map<string, string>;
}

/**
 * Converts the plan 08 internal rich NextAction to the flat NextAction
 * defined in 00-unified-types.md (lines 371-377). This is the public
 * contract consumed by plans 10, 12, and other cross-plan consumers.
 *
 * The internal rich discriminated union carries GatheredContext and typed
 * targets (SectionTarget, TaskTarget). The public NextAction strips these
 * to simple strings. Context is delivered separately via ContinueResult.
 */
function toPublicNextAction(internal: NextAction): PublicNextAction {
  switch (internal.action) {
    case "fill_section":
      return {
        action: "fill_section",
        target: internal.target.sectionName,
      };
    case "transition":
      return {
        action: "transition",
        to: internal.to,
      };
    case "blocked":
      return {
        action: "blocked",
        reason: internal.reason,
        blockers: internal.unresolvedTargets,
      };
    case "start_implementation":
      return {
        action: "start_implementation",
        target: internal.target.description,
      };
    case "continue_task":
      return {
        action: "continue_task",
        target: internal.target.description,
      };
    case "ready_to_apply":
      return { action: "ready_to_apply" };
    case "verify_then_archive":
      return { action: "verify_then_archive" };
  }
}

// PublicNextAction is the exact shape from 00-unified-types.md:
// interface NextAction {
//   action: NextActionType;
//   target?: string;
//   to?: ChangeStatus;
//   reason?: string;
//   blockers?: string[];
// }
// Imported as `PublicNextAction` here to avoid naming collision with the
// internal discriminated union. In implementation, import from unified types.

/**
 * Full result of the continue workflow.
 * The `nextAction` field uses the PUBLIC NextAction shape from unified types,
 * produced via toPublicNextAction(). The rich context is in `context`.
 */
interface ContinueResult {
  changeName: string;
  changeId: string;
  currentStatus: string;
  nextAction: PublicNextAction;  // unified types NextAction (flat interface)
  /** Rich context gathered from linked notes (for agent consumption) */
  context: GatheredContext;
  /** Summary string for agent to present to user */
  summary: string;
}

/**
 * Input for change selection when multiple active changes exist.
 */
interface ChangeSelectionCandidate {
  id: string;
  title: string;
  status: string;
  feature: string | null;
  /** ISO date string */
  lastModified: string;
  /** Completion summary, e.g., "2/4 hard prereqs met" or "3/7 tasks done" */
  progressSummary: string;
}
```

### Core Algorithm

#### Step 1: Change Selection

```
function selectChange(vaultIndex, explicitChangeName?):
  activeChanges = vaultIndex.getNotesByType("change")
    .filter(c => c.status in ["proposed", "planned", "in_progress"])
    .sort(byLastModified DESC)

  if explicitChangeName:
    match = activeChanges.find(c => c.id == explicitChangeName OR c.title matches)
    if not match: throw ChangeNotFoundError
    return match

  if activeChanges.length == 0:
    throw NoActiveChangesError("No active changes. Use 'propose' to create one.")

  if activeChanges.length == 1:
    // Auto-select but still announce to user
    return activeChanges[0]

  // Multiple active changes: MUST ask user
  candidates = activeChanges.map(c => buildSelectionCandidate(c))
  return { action: "prompt_user", candidates }
```

#### Step 2: Section Analysis

```
function analyzeChangeSections(changeNote):
  knownSections = [
    "Why", "Delta Summary", "Proposed Update",
    "Design Approach", "Impact", "Tasks", "Validation", "Status Notes"
  ]

  analysis = new SectionAnalysis()

  for sectionName in knownSections:
    heading = findHeading(changeNote.content, "## " + sectionName)
    if heading:
      content = extractSectionContent(changeNote.content, heading)
      analysis.sections.set(sectionName, {
        exists: true,
        isEmpty: isEffectivelyEmpty(content),
        content: content,
      })
    else:
      analysis.sections.set(sectionName, {
        exists: false,
        isEmpty: true,
        content: "",
      })

  // Count tasks
  tasksSection = analysis.sections.get("Tasks")
  if tasksSection and not tasksSection.isEmpty:
    analysis.totalTasks = countPattern(tasksSection.content, /^- \[[ x]\]/gm)
    analysis.completedTasks = countPattern(tasksSection.content, /^- \[x\]/gm)

  // Count Delta Summary entries
  deltaSection = analysis.sections.get("Delta Summary")
  if deltaSection and not deltaSection.isEmpty:
    analysis.deltaSummaryCount = countPattern(
      deltaSection.content,
      /^- (ADDED|MODIFIED|REMOVED|RENAMED) /gm
    )

  return analysis
```

#### Step 3: Check Planned Prerequisites

```
function checkPlannedPrerequisites(analysis, changeNote):
  hard = {
    whyPresent:          not analysis.sections.get("Why").isEmpty,
    deltaSummaryPresent: analysis.deltaSummaryCount > 0,
    tasksPresent:        analysis.totalTasks > 0,
    validationPresent:   not analysis.sections.get("Validation").isEmpty,
  }

  soft = {
    designApproachPresent:
      not analysis.sections.get("Design Approach").isEmpty
      OR analysis.sections.get("Design Approach").content.trim() == "N/A",
    decisionLinkPresent:
      changeNote.frontmatter.decisions?.length > 0,
  }

  missingHard = []
  if not hard.whyPresent:          missingHard.push("Why")
  if not hard.deltaSummaryPresent: missingHard.push("Delta Summary")
  if not hard.tasksPresent:        missingHard.push("Tasks")
  if not hard.validationPresent:   missingHard.push("Validation")

  softWarnings = []
  if not soft.designApproachPresent:
    softWarnings.push("Design Approach is empty. Consider adding implementation approach or marking N/A.")
  // Soft prerequisite 6 is CONDITIONAL: only warn when significant
  // technical decisions are present (overview.md section 15).
  // Detect this by checking if Design Approach mentions decision-like content.
  if not soft.decisionLinkPresent:
    designApproach = analysis.sections.get("Design Approach")
    hasSignificantDecisions = designApproach
      AND not designApproach.isEmpty
      AND /\b(chose|decided|trade-?off|alternative|migration|architecture)\b/i.test(designApproach.content)
    if hasSignificantDecisions:
      softWarnings.push("Design Approach contains significant technical choices but no Decision links. Consider creating a Decision note.")

  return { missingHard, softWarnings }
```

#### Step 4: The Next-Action Algorithm (overview.md section 15, exact pseudocode)

```
function nextAction(changeNote, analysis, vaultIndex):
  status = changeNote.frontmatter.status
  context = gatherContext(changeNote, vaultIndex)

  if status == "proposed":
    { missingHard, softWarnings } = checkPlannedPrerequisites(analysis)
    context.softWarnings = softWarnings

    if missingHard.length > 0:
      target = buildSectionTarget(missingHard[0])
      return { action: "fill_section", target, context }

    // All hard prereqs met -> transition to planned
    // (Decision promotion is checked AFTER nextAction, in the orchestrator)
    return { action: "transition", to: "planned", context }

  if status == "planned":
    unresolvedDeps = checkDependsOn(changeNote, vaultIndex)
    if unresolvedDeps.length > 0:
      return {
        action: "blocked",
        reason: "Depends on unresolved changes",
        unresolvedTargets: unresolvedDeps
      }
    firstTask = getFirstUncheckedTask(analysis)
    if not firstTask:
      // EXTENSION: overview.md section 15 does not define this case.
      // The spec assumes tasks exist at `planned` stage since Tasks >= 1
      // is a hard prerequisite for `proposed -> planned`. This handles
      // the edge case where all tasks were manually checked before
      // transitioning to `in_progress`.
      // We warn the user rather than silently double-transitioning.
      context.softWarnings.push(
        "All tasks are already checked at 'planned' status. "
        + "This is unusual — tasks are normally completed during 'in_progress'. "
        + "Transitioning to 'in_progress'; run continue again to proceed to apply."
      )
      return { action: "transition", to: "in_progress", context }
    return { action: "start_implementation", target: firstTask, context }

  if status == "in_progress":
    unchecked = getUncheckedTasks(analysis)
    if unchecked.length > 0:
      return { action: "continue_task", target: unchecked[0], context }
    // All tasks complete. Per unified ownership rules, only apply(09)
    // may execute the `in_progress -> applied` transition.
    // Continue signals readiness; the user must run `apply` next.
    return { action: "ready_to_apply", context }

  if status == "applied":
    return { action: "verify_then_archive", context }

  throw InvalidStatusError(status)
```

#### Step 5: Gather Context from Linked Notes

```
function gatherContext(changeNote, vaultIndex):
  context = new GatheredContext()
  fm = changeNote.frontmatter

  // Read linked Feature(s)
  featureLinks = fm.feature ? [fm.feature] : (fm.features ?? [])
  for link in featureLinks:
    featureId = resolveWikilink(link, vaultIndex)
    featureNote = vaultIndex.getById(featureId)
    if featureNote:
      context.features.push({
        id: featureNote.id,
        title: featureNote.title,
        type: "feature",
        relevantSections: extractRelevantSections(featureNote, [
          "Purpose", "Current Behavior", "Constraints",
          "Known Gaps", "Requirements"
        ])
      })

  // Read linked Decisions
  for link in (fm.decisions ?? []):
    decisionId = resolveWikilink(link, vaultIndex)
    decisionNote = vaultIndex.getById(decisionId)
    if decisionNote:
      context.decisions.push({
        id: decisionNote.id,
        title: decisionNote.title,
        type: "decision",
        relevantSections: extractRelevantSections(decisionNote, [
          "Summary", "Context", "Options Considered",
          "Decision", "Consequences"
        ])
      })

  // Read linked Systems
  for link in (fm.systems ?? []):
    systemId = resolveWikilink(link, vaultIndex)
    systemNote = vaultIndex.getById(systemId)
    if systemNote:
      context.systems.push({
        id: systemNote.id,
        title: systemNote.title,
        type: "system",
        relevantSections: extractRelevantSections(systemNote, [
          "Purpose", "Boundaries", "Key Interfaces"
        ])
      })

  // Read linked Sources
  for link in (fm.sources ?? []):
    sourceId = resolveWikilink(link, vaultIndex)
    sourceNote = vaultIndex.getById(sourceId)
    if sourceNote:
      context.sources.push({
        id: sourceNote.id,
        title: sourceNote.title,
        type: "source",
        relevantSections: extractRelevantSections(sourceNote, [
          "Summary", "Key Points"
        ])
      })

  return context
```

#### Step 6: Section Fill Guidance

When `nextAction` returns `fill_section`, the agent needs to know what goes in each section. The `buildSectionTarget` function maps section names to guidance:

```
function buildSectionTarget(sectionName):
  guidance = {
    "Why": {
      sectionName: "Why",
      guidance: "Explain why this change is needed. Reference the user request, "
        + "related Feature gaps, or evidence from Source notes. 1-3 paragraphs.",
      templateHint: "## Why\n\n<Explain the motivation and business/technical need>"
    },
    "Delta Summary": {
      sectionName: "Delta Summary",
      guidance: "List each planned modification using the canonical format: "
        + "ADDED/MODIFIED/REMOVED/RENAMED requirement '<name>' to/in/from [[Feature]]. "
        + "Include [base: <content_hash>] for MODIFIED/REMOVED/RENAMED. "
        + "Also list section operations if narrative sections change.",
      templateHint: "## Delta Summary\n- ADDED requirement \"<name>\" to [[Feature: ...]]\n"
        + "- MODIFIED section \"Current Behavior\" in [[Feature: ...]]: <what changes>"
    },
    "Tasks": {
      sectionName: "Tasks",
      guidance: "Break down implementation into concrete checklist items. "
        + "Each task should be independently completable and verifiable.",
      templateHint: "## Tasks\n- [ ] <first task>\n- [ ] <second task>"
    },
    "Validation": {
      sectionName: "Validation",
      guidance: "Describe how to verify this change is correct. "
        + "Include test approach, manual verification steps, and acceptance criteria.",
      templateHint: "## Validation\n\n<Describe verification approach>"
    },
    "Design Approach": {
      sectionName: "Design Approach",
      guidance: "Describe the technical approach for this change. "
        + "File changes, data flow, architecture decisions. "
        + "If a major technical choice is involved, create a Decision note "
        + "and link to it instead of duplicating the rationale here.",
      templateHint: "## Design Approach\n\n<Describe implementation approach>\n\n"
        + "For technical rationale, see [[Decision: ...]]."
    },
  }

  return guidance[sectionName]
```

#### Step 7: Decision Promotion Check

This implements the duplication prevention rule from overview.md section 14.2.

```
function checkDecisionPromotion(changeNote, analysis):
  designApproach = analysis.sections.get("Design Approach")
  if not designApproach or designApproach.isEmpty:
    return null

  // Check if Design Approach content meets Decision promotion criteria
  content = designApproach.content

  // Decision promotion criteria from overview.md section 14.2.
  // ANY ONE of the following 4 criteria is sufficient to suggest promotion:
  promotionCriteria = {
    // 1. Affects multiple Features or Systems
    affectsMultiple: countWikilinks(content, "Feature:") > 1
      OR countWikilinks(content, "System:") > 1
      OR (changeNote.frontmatter.touches?.length > 1),

    // 2. Hard to reverse or high migration cost
    hardToReverse: /\b(migration|irreversible|cannot revert|breaking change|data loss|schema change|backward compatibility)\b/i.test(content),

    // 3. Requires team consensus or ADR-level review
    needsConsensus: /\b(adr|team decision|consensus|architectural decision|tech lead|design review)\b/i.test(content),

    // 4. Contains rationale that should outlive the Change
    durableRationale: /\b(chose|decided|rationale|trade-?off|alternative considered|versus|vs\.?|long-term|future-proof)\b/i.test(content),

    // Already references a Decision note (promotion already done)
    alreadyLinked: countWikilinks(content, "Decision:") > 0,
  }

  // If already linked to a Decision, no promotion needed
  if promotionCriteria.alreadyLinked:
    return null

  // ANY ONE criterion is sufficient (overview.md: "하나라도 만족하면")
  if promotionCriteria.affectsMultiple
    OR promotionCriteria.hardToReverse
    OR promotionCriteria.needsConsensus
    OR promotionCriteria.durableRationale:
    return {
      content: content,
      reasons: promotionCriteria,
    }

  return null
```

**Promotion execution (post-processing step in the continue orchestrator, after nextAction returns)**:

1. Create a new Decision note in `wiki/05-decisions/` with the durable rationale extracted from Design Approach.
2. Replace the rationale content in Design Approach with a wikilink: `For the rationale on <topic>, see [[Decision: <title>]].`
3. Add the Decision wikilink to the Change's `decisions:` frontmatter.
4. Add the Decision wikilink to the linked Feature's `decisions:` frontmatter.
5. The agent MUST NOT copy the same text into both Design Approach and Decision.

#### Step 8: Status Transition During Continue

```
function executeTransition(changeNote, targetStatus, vaultIndex):
  currentStatus = changeNote.frontmatter.status
  // Per unified ownership rules (00-unified-types.md):
  // continue(08) owns: proposed->planned, planned->in_progress
  // apply(09) owns: in_progress->applied (NOT allowed here)
  allowedTransitions = {
    "proposed": ["planned"],
    "planned": ["in_progress"],
    "in_progress": [],   // in_progress->applied is owned by apply(09)
    "applied": [],       // archive is a separate workflow
  }

  if targetStatus not in allowedTransitions[currentStatus]:
    throw InvalidTransitionError(currentStatus, targetStatus)

  // Additional gate checks per transition
  if targetStatus == "planned":
    prereqs = checkPlannedPrerequisites(analyzeChangeSections(changeNote))
    if prereqs.missingHard.length > 0:
      throw PrerequisitesNotMetError(prereqs.missingHard)

  if targetStatus == "in_progress":
    // Check depends_on are resolved
    unresolvedDeps = checkDependsOn(changeNote, vaultIndex)
    if unresolvedDeps.length > 0:
      throw BlockedByDependenciesError(unresolvedDeps)

  // Update frontmatter status
  updateFrontmatterField(changeNote.path, "status", targetStatus)

  // Log transition
  appendToLog(vaultIndex, {
    action: "status_transition",
    changeId: changeNote.id,
    from: currentStatus,
    to: targetStatus,
    timestamp: now(),
  })
```

**Transition trigger rules:**

| From | To | Triggered When | Gate |
|------|----|---------------|------|
| `proposed` | `planned` | All 4 hard prerequisites met | `checkPlannedPrerequisites()` passes |
| `planned` | `in_progress` | Agent or user starts implementation work | `depends_on` all resolved |

**Transition ownership rules (per unified types 00-unified-types.md):**

- `proposed -> planned`: Executed by `propose` (07) or `continue` (08) workflow when all hard prerequisites are met.
- `planned -> in_progress`: Executed by `continue` (08) workflow when `nextAction` returns `start_implementation` and the agent begins working on the first task.
- `in_progress -> applied`: Executed by `apply` (09) workflow ONLY. The continue workflow does NOT own this transition. When all tasks are complete, `nextAction()` returns `{ action: "ready_to_apply" }`, signaling the user to run `apply`. The apply workflow performs both the canonical Feature update and the status transition to `applied`.

#### Step 8b: depends_on Resolution Contract

Per the ownership rules in `00-unified-types.md` (line 394), `checkDependsOn` in continue **must call sequencing-engine (plan 06), not reimplement** dependency resolution. Plan 06 owns dependency analysis, cycle detection, topological ordering, and stale base integration. Plan 08 is a thin wrapper that delegates and interprets the result.

```
function checkDependsOn(changeNote, vaultIndex):
  dependsOn = changeNote.frontmatter.depends_on ?? []
  if dependsOn.length == 0:
    return []  // no dependencies, not blocked

  // Delegate to sequencing-engine (plan 06) for the canonical dependency analysis.
  // Per the unified types API boundary (00-unified-types.md line 440):
  //   "Calls sequencingEngine.analyzeSequencing(index, [thisChange]) for depends_on checks"
  // We pass only [thisChange] (not all active changes) because the continue workflow
  // only needs dependency info for the single change being continued.
  sequencingResult = sequencingEngine.analyzeSequencing(vaultIndex, [changeNote])

  // Extract this change's per-change result
  perChange = sequencingResult.ordering.find(o => o.id == changeNote.frontmatter.id)

  unresolved = []

  // 1. Check blocked_by from sequencing result (unresolved depends_on targets)
  if perChange and perChange.blocked_by.length > 0:
    for depId in perChange.blocked_by:
      depRecord = vaultIndex.getById(depId)
      unresolved.push({
        target: depId,
        reason: depRecord
          ? "status is '" + depRecord.status + "', needs 'applied'"
          : "depends_on target not found in vault",
        severity: depRecord ? "blocked" : "error"
      })

  // 2. Check for out-of-order errors (overview.md section 10.5.1):
  // If this change has advanced past a dependency that isn't yet resolved,
  // that's a sequencing error.
  for ooe in sequencingResult.out_of_order_errors:
    if ooe.change_id == changeNote.frontmatter.id:
      unresolved.push({
        target: ooe.dependency_id,
        reason: ooe.message,
        severity: "sequencing_error"
      })

  // 3. Check for cycles involving this change
  for cycle in sequencingResult.cycles:
    if changeNote.frontmatter.id in cycle.cycle:
      unresolved.push({
        target: cycle.cycle.join(" -> "),
        reason: cycle.message,
        severity: "error"
      })

  return unresolved
```

**Resolution semantics (enforced by sequencing-engine):**
- A `depends_on` target is "resolved" when its status is `applied`.
- Archived changes are also considered resolved (applied + moved).
- A `depends_on` target that doesn't exist in the vault is an error, not just a block.
- If the current Change has advanced past a dependency that isn't yet resolved, it's a `sequencing_error` (overview.md section 10.5.1: "sequencing error로 보고해야 한다").
- Cycle detection is handled by plan 06's topological sort, not reimplemented here.

#### Step 9: Presenting the Next Action to the User

```
function formatContinueResult(result: ContinueResult): string:
  lines = []
  lines.push("## Continue: " + result.changeName)
  lines.push("**Status:** " + result.currentStatus)

  match result.nextAction:
    case { action: "fill_section", target, context }:
      lines.push("")
      lines.push("### Next Step: Fill '" + target.sectionName + "'")
      lines.push(target.guidance)
      lines.push("")
      if context.features.length > 0:
        lines.push("### Context from linked Feature:")
        for f in context.features:
          lines.push("- **" + f.title + "**: " + summarize(f.relevantSections))
      if context.decisions.length > 0:
        lines.push("### Related Decisions:")
        for d in context.decisions:
          lines.push("- **" + d.title + "**")
      if context.softWarnings.length > 0:
        lines.push("")
        lines.push("### Warnings")
        for w in context.softWarnings:
          lines.push("- " + w)

    case { action: "transition", to }:
      lines.push("")
      lines.push("All prerequisites for '" + to + "' are met.")
      lines.push("Ready to transition status from '" +
        result.currentStatus + "' to '" + to + "'.")

    case { action: "blocked", reason, unresolvedTargets }:
      lines.push("")
      lines.push("### Blocked")
      lines.push(reason)
      for t in unresolvedTargets:
        lines.push("- Waiting on: " + t)

    case { action: "start_implementation", target, context }:
      lines.push("")
      lines.push("### Ready to Implement")
      lines.push("First task: " + target.description)
      lines.push("")
      lines.push("Starting implementation will transition status to 'in_progress'.")

    case { action: "continue_task", target, context }:
      completed = context.change.sections.completedTasks
      total = context.change.sections.totalTasks
      lines.push("**Progress:** " + completed + "/" + total + " tasks")
      lines.push("")
      lines.push("### Next Task")
      lines.push(target.description)

    case { action: "ready_to_apply" }:
      lines.push("")
      lines.push("All tasks complete. Run 'apply' to update canonical Features, "
        + "then 'verify' to check alignment.")

    case { action: "verify_then_archive" }:
      lines.push("")
      lines.push("Change is applied. Run 'verify' to check alignment, "
        + "then 'archive' when ready.")

  return lines.join("\n")
```

### File Structure

```
src/core/workflow/
  continue.ts            -- Main continue workflow entry point
  continue.types.ts      -- All TypeScript interfaces for this workflow
  section-analysis.ts    -- Section parsing, completeness checking
  prerequisites.ts       -- Hard/soft prerequisite evaluation
  decision-promotion.ts  -- Decision promotion heuristics
  status-transition.ts   -- Status transition logic with gate checks
```

This aligns with plan 01's canonical project structure (`src/core/workflow/`) and plan 09's apply workflow paths.

### Orchestrator Pseudocode

The `continueChange()` entry point is the orchestrator that wires all steps together. This pseudocode makes the critical decision points explicit, including when `executeTransition()` is called.

```
function continueChange(vaultIndex, options?):
  // Step 1: Select target change
  change = selectChange(vaultIndex, options?.changeName)

  // Step 2: Analyze sections
  analysis = analyzeChangeSections(change)

  // Step 3: Determine next action (the core algorithm from overview section 15)
  internalAction = nextAction(change, analysis, vaultIndex)

  // Step 4: CRITICAL -- Execute transitions when appropriate.
  // This is where status mutations happen. The nextAction() function is
  // pure/read-only; executeTransition() performs the actual write.
  switch (internalAction.action):
    case "transition":
      // proposed -> planned: all hard prerequisites met
      executeTransition(change, internalAction.to, vaultIndex)

    case "start_implementation":
      // planned -> in_progress: this is the IMPLICIT transition that
      // overview.md section 15 triggers when the agent starts working
      // on the first task. The formatter says "Starting implementation
      // will transition status to 'in_progress'" -- this is where that
      // actually executes.
      // NOTE: This is an intentional adaptation from overview.md section 15,
      // which shows `return { action: "transition", to: "applied" }` for the
      // in_progress branch. Per the ownership split in unified types,
      // plan 08 owns planned->in_progress but NOT in_progress->applied.
      executeTransition(change, "in_progress", vaultIndex)

    case "ready_to_apply":
      // Do NOT transition here. The apply workflow (plan 09) owns
      // in_progress -> applied. Signal readiness to the user.
      break

    case "fill_section":
    case "continue_task":
    case "blocked":
    case "verify_then_archive":
      // No transition needed for these actions.
      break

  // Step 5: Check Decision promotion (post-processing, after transition)
  promotion = checkDecisionPromotion(change, analysis)
  softWarnings = internalAction.context?.softWarnings ?? []
  if promotion:
    softWarnings.push(
      "Design Approach contains content that may warrant a Decision note. " +
      "Promotion reasons: " + summarizePromotionReasons(promotion.reasons)
    )

  // Step 6: Convert to public NextAction and build result
  publicAction = toPublicNextAction(internalAction)
  context = internalAction.context ?? gatherContext(change, vaultIndex)
  context.softWarnings = softWarnings

  result = {
    changeName: change.title,
    changeId: change.frontmatter.id,
    currentStatus: change.frontmatter.status,
    nextAction: publicAction,
    context: context,
    summary: formatContinueResult(result),
  }

  return result
```

### Public API / Interface

```typescript
/**
 * Main entry point for the continue workflow.
 *
 * @param vaultIndex - The in-memory vault index
 * @param options - Optional change name or ID to target
 * @returns ContinueResult with the next action and context
 */
function continueChange(
  vaultIndex: VaultIndex,
  options?: { changeName?: string }
): Promise<ContinueResult>;

/**
 * Analyze a Change note's sections for completeness.
 */
function analyzeChangeSections(
  changeNote: ParsedNote
): SectionAnalysis;

/**
 * Check hard and soft prerequisites for proposed -> planned transition.
 */
function checkPlannedPrerequisites(
  analysis: SectionAnalysis,
  changeNote: ParsedNote
): { missingHard: string[]; softWarnings: string[] };

/**
 * Compute the deterministic next action for a Change.
 */
function nextAction(
  changeNote: ParsedNote,
  analysis: SectionAnalysis,
  vaultIndex: VaultIndex
): Promise<NextAction>;

/**
 * Execute a status transition with gate checks.
 */
function executeTransition(
  changeNote: ParsedNote,
  targetStatus: string,
  vaultIndex: VaultIndex
): Promise<void>;

/**
 * Check if Design Approach content should be promoted to Decision.
 */
function checkDecisionPromotion(
  changeNote: ParsedNote,
  analysis: SectionAnalysis
): DecisionPromotionCandidate | null;
```

### Dependencies on Other Modules

| Module | What is needed | Plan |
|--------|---------------|------|
| Vault Parser | `parseNote()`, `extractSectionContent()`, `extractFrontmatter()`, wikilink resolution | 03-vault-parser |
| Index Engine | `VaultIndex`, `getById()`, `getNotesByType()`, `resolveWikilink()` | 04-index-engine |
| Note Templates | Change minimum section contract, section names and order | 02-note-templates |
| Sequencing Engine | `analyzeSequencing()` for depends_on resolution (plan 08 delegates, not reimplements) | 06-sequencing-engine |
| Workflow Propose | May be invoked if no active changes exist | 07-workflow-propose |

---

## 4. Test Strategy

### Unit Tests

1. **Section Analysis**
   - Parse a Change note with all sections filled -> all sections marked non-empty
   - Parse a Change note with empty sections -> correctly identifies empties
   - Parse a Change note with missing sections -> correctly identifies missing
   - Count tasks: `- [ ]` and `- [x]` patterns, including edge cases (nested lists, code blocks)
   - Count Delta Summary entries: various ADDED/MODIFIED/REMOVED/RENAMED patterns

2. **Prerequisite Checking**
   - All hard prerequisites met -> missingHard is empty
   - Only "Why" missing -> missingHard is `["Why"]`
   - All hard prerequisites missing -> missingHard has all 4 in order
   - Design Approach is "N/A" -> soft warning NOT raised
   - Design Approach is empty -> soft warning raised
   - No Decision links -> soft warning raised

3. **Next-Action Algorithm**
   - `proposed` + Why empty -> `fill_section` for "Why"
   - `proposed` + all hard prereqs met -> `transition` to "planned"
   - `planned` + unresolved depends_on -> `blocked`
   - `planned` + all deps resolved -> `start_implementation`
   - `in_progress` + unchecked tasks -> `continue_task` with first unchecked
   - `in_progress` + all tasks done -> `ready_to_apply`
   - `applied` -> `verify_then_archive`
   - `planned` + all tasks already checked -> `transition` to "in_progress" with warning
   - Unknown status -> throws InvalidStatusError

4. **Decision Promotion**
   - Short Design Approach (< 100 words) -> no promotion
   - Long Design Approach with multiple Feature refs -> promotion suggested
   - Design Approach already links to Decision -> no promotion
   - Design Approach with durable language keywords -> promotion suggested

5. **Status Transitions**
   - `proposed -> planned` when prerequisites met -> succeeds
   - `proposed -> planned` when prerequisites NOT met -> throws
   - `proposed -> in_progress` -> throws (invalid transition)
   - `in_progress -> applied` -> throws (not owned by continue, owned by apply)
   - `planned -> in_progress` with unresolved deps -> throws
   - `planned -> in_progress` with resolved deps -> succeeds

### Integration Tests

6. **End-to-End Continue Flow**
   - Create a Change note with only "Why" filled, call `continueChange()` -> returns `fill_section` for "Delta Summary"
   - Fill all hard prereqs, call `continueChange()` -> returns `transition` to "planned"
   - After planned, with tasks, call `continueChange()` -> returns `start_implementation`
   - With 2 active changes and no explicit name -> returns prompt_user with candidates

7. **Context Gathering**
   - Change linked to Feature with Requirements -> context includes requirement text
   - Change linked to Decision -> context includes decision summary
   - Broken wikilink in frontmatter -> graceful handling (warning, not crash)

### Edge Cases

8. **No active changes** -> clear error message suggesting `propose`
9. **Change with status "applied"** -> returns `verify_then_archive`
10. **Delta Summary with malformed entries** -> counts only valid entries
11. **Tasks section with only checked items at `in_progress`** -> returns `ready_to_apply`
12. **Circular depends_on** -> detected and reported as error
13. **Design Approach contains only a Decision link** -> no promotion, recognized as already done

---

## 5. Implementation Order

### Prerequisites

- **03-vault-parser** must be complete (section extraction, frontmatter parsing, wikilink resolution)
- **04-index-engine** must be complete (note lookup by ID, type queries)
- **02-note-templates** must be complete (Change section contract is the source of truth for section names)
- **06-sequencing-engine** must be partially available (`checkDependsOn` function)

### Build Order

```
Step 1: Data structures
  - Define all TypeScript interfaces in continue.types.ts
  - Depends on: note-templates for section name constants

Step 2: Section analysis
  - Implement analyzeChangeSections()
  - Implement prerequisite checking
  - Depends on: vault-parser for section extraction
  - Test: unit tests 1-2

Step 3: Next-action algorithm
  - Implement nextAction() following the exact pseudocode
  - Depends on: section analysis, sequencing engine for depends_on
  - Test: unit tests 3

Step 4: Context gathering
  - Implement gatherContext() to read linked notes
  - Depends on: index engine for note lookup
  - Test: integration test 7

Step 5: Decision promotion
  - Implement checkDecisionPromotion() heuristics
  - Test: unit tests 4

Step 6: Status transitions
  - Implement executeTransition() with gate checks
  - Depends on: prerequisites, sequencing
  - Test: unit tests 5

Step 7: Change selection
  - Implement selectChange() with multi-change prompting
  - Depends on: index engine
  - Test: integration test 6

Step 8: Main entry point + presentation
  - Wire everything into continueChange()
  - Implement formatContinueResult()
  - Test: integration tests 6-8
```
