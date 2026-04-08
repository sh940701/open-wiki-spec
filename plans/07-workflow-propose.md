# Workflow: Propose Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec provides three workflow entry points for creating changes:

1. **`/opsx:new` (new-change)** -- Creates a scaffolded change directory and shows the first artifact template. Stops and waits for user direction. Does NOT create any artifacts automatically.

2. **`/opsx:ff` (ff-change / fast-forward)** -- Creates a change AND generates all artifacts in dependency order until the change is apply-ready. Loops through `openspec status --change` to check artifact completion.

3. **`/opsx:propose` (propose)** -- Identical to ff-change in execution: creates a change and generates all artifacts in one step. The only difference is naming/description emphasis ("propose" vs "fast-forward").

All three follow the same basic flow:
```
1. If no input, ask what the user wants to build
2. Derive a kebab-case change name
3. Run `openspec new change "<name>"` to scaffold the directory
4. Get artifact build order via `openspec status --change "<name>" --json`
5. Loop: for each ready artifact, get instructions, create it
6. Show final status
```

**What OpenSpec does NOT do:**

- No similarity check before creating a new change.
- No search for existing features, changes, or related work.
- No scoring or classification of candidates.
- No sequencing analysis against active changes.
- No preflight enforcement -- it goes straight from user input to change creation.
- No explicit transition from `proposed` to a "planned" or "apply-ready" state that checks section completeness.

The only "discovery" OpenSpec does is prompt-driven: the instructions tell the AI to check if a change with that name already exists and suggest continuing it. This is pure LLM judgment, not a product-enforced retrieval step.

### Key Source Files

| File | Role |
|------|------|
| `src/core/templates/workflows/propose.ts` | Propose skill template: create change + generate all artifacts |
| `src/core/templates/workflows/new-change.ts` | New-change skill template: scaffold + show first artifact |
| `src/core/templates/workflows/ff-change.ts` | Fast-forward skill template: scaffold + generate all artifacts |
| `src/commands/workflow/new-change.ts` | `newChangeCommand()`: validates name, calls `createChange()`, optional README |
| `src/commands/workflow/shared.ts` | Shared types (`TaskItem`, `ApplyInstructions`), validation helpers, schema listing |

### Core Algorithm / Flow

**OpenSpec propose (from propose.ts):**

```
1. Parse user input -> derive change name
2. openspec new change "<name>" (creates openspec/changes/<name>/)
3. openspec status --change "<name>" --json -> get applyRequires, artifacts
4. For each artifact in dependency order:
   a. openspec instructions <artifact-id> --change "<name>" --json
   b. Read dependency artifacts
   c. Create artifact file using template
   d. Re-check status
5. Loop until all applyRequires artifacts are done
6. Show final status
```

**OpenSpec validation (from shared.ts):**

```
1. validateChangeName(name) -> kebab-case validation
2. validateSchemaExists(schema) -> check schema directory exists
3. validateChangeExists(changeName, projectRoot) -> directory existence check
```

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

- **Section 7** -- OpenSpec's limitation: similarity detection depends too much on prompt instructions and free-form model reasoning instead of mechanically enforced retrieval.
- **Section 8.2** -- `propose` must NOT immediately create a new Change. It must first run a preflight similarity scan.
- **Section 8.3** -- The goal of preflight is "Where should this attach?" not just "Is there something related?"
- **Section 9.1** -- v1 deterministic similarity scan: normalize query -> lexical retrieval -> graph expansion -> scoring -> classification.
- **Section 9.3** -- Main agent + retrieval subagent execution model.
- **Section 10.4** -- Query Object Contract: `{ intent, summary, feature_terms, system_terms, entity_terms, status_bias }`.
- **Section 10.5** -- Classification thresholds: `existing_change` (score >= 75, gap >= 15), `existing_feature` (>= 70), `new_feature` (< 45), `needs_confirmation` (top two >= 60, gap < 10).
- **Section 10.5.1** -- Parallel change sequencing: evaluate `depends_on`, `touches`, and requirement-level conflict model during propose.
- **Section 10.5.2** -- Post-classification action contract: each classification maps to a specific next workflow action.
- **Section 10.6** -- Retrieval subagent output contract with `sequencing` field.
- **Section 14.2** -- Change note structure with Delta Summary, `[base: <content_hash>]`, atomic apply order.
- **Section 15** -- Propose workflow: run similarity scan -> classify -> act. `proposed -> planned` transition requires section-completeness check (hard/soft prerequisites).

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec | Reason |
|--------|----------|----------------|--------|
| Pre-creation check | None (prompt-driven only) | Mandatory preflight similarity scan | Core product differentiation (overview.md section 7-8) |
| Discovery method | LLM reads filesystem | Structured retrieval subagent with scoring | Deterministic, explainable, session-stable results |
| Classification | None | 4-way: `existing_change`, `existing_feature`, `new_feature`, `needs_confirmation` | Each classification drives a different workflow action |
| Query format | Natural language to LLM | Normalized query object with typed fields | Consistent search for same request across sessions |
| Sequencing check | None at propose time | Evaluates severity model against active changes | Prevents creating changes that conflict with in-progress work |
| Artifact pipeline | Schema-driven DAG (`proposal` -> `design` -> `tasks`) | Section-completeness on a single Change note | Simpler model: one note, check sections, not a DAG |
| Planned transition | Implicit (all artifacts done) | Explicit `proposed -> planned` gate with hard/soft prerequisites | overview.md section 15 |
| Feature creation | Not a concept (changes are top-level) | `new_feature` path creates Feature note first, then Change | Feature is the canonical spec in open-wiki-spec |

### Contracts to Satisfy

1. `propose` MUST run similarity scan preflight before creating any new note.
2. The main agent MUST normalize the user request into a query object (section 10.4).
3. The retrieval subagent MUST return a structured candidate list with scores, reasons, and classification hints.
4. Classification MUST follow the threshold rules (section 10.5).
5. Sequencing analysis MUST be evaluated and included in retrieval output (section 10.5.1).
6. Each classification MUST map to a post-classification action (section 10.5.2).
7. After creating/attaching a Change, `checkPlannedPrerequisites()` MUST run. If all hard prerequisites pass, the Change transitions from `proposed` to `planned`.
8. Hard prerequisites for `proposed -> planned`: (1) Why non-empty, (2) Delta Summary has >= 1 entry, (3) Tasks has >= 1 item, (4) Validation non-empty.
9. Soft prerequisites (warning only): (5) Design Approach exists or `N/A`, (6) Decision link if complex.

---

## 3. Implementation Plan

### Architecture Overview

The propose workflow is an orchestration function that coordinates:

1. **Query normalization** -- transforms user input into a typed query object.
2. **Sequencing analysis** -- delegates to the sequencing engine (plan 06) for conflict analysis.
3. **Retrieval + Classification** -- delegates to the retrieval engine (plan 05) via `retrieve()`. Classification ownership is in plan 05 — plan 07 does NOT re-classify.
4. **Sequencing severity escalation** -- escalates classification to `needs_confirmation` if sequencing detects conflicts (done inside `retrieve()` via Rule 0b).
5. **Post-classification action** -- creates/updates notes based on the classification.
6. **Section-completeness check** -- evaluates hard prerequisites for `proposed -> planned` transition.

```
┌──────────────────────────────────────────────────┐
│              User Request (natural language)       │
└─────────────────────┬────────────────────────────┘
                      │
                      v
┌──────────────────────────────────────────────────┐
│  Step 1: normalizeQuery(request)                  │
│  -> QueryObject { intent, summary, terms... }     │
└─────────────────────┬────────────────────────────┘
                      │
                      v
┌──────────────────────────────────────────────────┐
│  Step 2a: sequencing.analyzeSequencing(index)     │
│  -> SequencingResult (full, retained for step 3)  │
│                                                    │
│  Step 2b: retrievalEngine.retrieve(               │
│    index, query, { sequencing: sequencingResult }) │
│  -> RetrievalResult (with classification,         │
│     SequencingSummary, candidates, warnings)       │
│  Classification is done INSIDE retrieve() by      │
│  plan 05's classify(). Plan 07 does NOT re-classify│
└─────────────────────┬────────────────────────────┘
                      │
           ┌──────────┴──────────┐
           │   Post-Classification│
           │   Action Router      │
           │   (reads result.     │
           │    classification)   │
           └──────────┬──────────┘
      ┌───────┬───────┼───────┐
      v       v       v       v
  existing existing  new    needs
  _change  _feature feature confirm
      │       │       │       │
      v       v       v       v
  Continue  Create   Create  Show
  Change    Change   Feature candidates
            + link   + Change + ask user
            Feature  + link
                      │
                      v
┌──────────────────────────────────────────────────┐
│  Step 3: executePostClassification()              │
│  Receives BOTH RetrievalResult AND full           │
│  SequencingResult as separate params.             │
│  SequencingSummary (in RetrievalResult) = display │
│  SequencingResult (full) = depends_on/touches logic│
│                                                    │
│  Step 4: checkPlannedPrerequisites(change)        │
│  -> If all hard prerequisites met: proposed->planned │
└──────────────────────────────────────────────────┘
```

Module file: `src/workflow/propose.ts`

### Data Structures

```typescript
// ── Query Object (overview.md section 10.4) ──

// QueryObject maps to RetrievalQuery in 00-unified-types.md.
// The unified type uses intent: 'add' | 'modify' | 'remove' | 'query'.
// This plan extends with 'fix' and 'investigate' as aliases:
//   'fix' -> mapped to 'modify' when passed to the retrieval engine
//   'investigate' -> mapped to 'query' when passed to the retrieval engine
// The local intent type is kept broader for better normalizeQuery() heuristics.
interface QueryObject {
  /** User's intent verb */
  intent: 'add' | 'modify' | 'fix' | 'remove' | 'investigate';
  /** Original user request, lightly cleaned */
  summary: string;
  /** Terms likely to match Feature titles/aliases */
  feature_terms: string[];
  /** Terms likely to match System names */
  system_terms: string[];
  /** Terms matching specific technical entities */
  entity_terms: string[];
  /** Status filter: which statuses to prefer in results */
  status_bias: ('active' | 'proposed' | 'planned' | 'in_progress')[];
}

// ── Classification types (overview.md section 10.5, 00-unified-types.md) ──
// ProposalClassification is an alias for Classification from 00-unified-types.md.
// The canonical definition is: type Classification = 'existing_change' | 'existing_feature' | 'new_feature' | 'needs_confirmation';

type ProposalClassification = Classification;

interface ClassificationResult {
  classification: ProposalClassification;
  confidence: 'high' | 'medium' | 'low';
  /** Top candidate that drove the classification */
  primary_candidate: ScoredCandidate | null;
  /** Second candidate (for gap analysis) */
  secondary_candidate: ScoredCandidate | null;
  /** Human-readable reasons for classification */
  reasons: string[];
}

// ScoredCandidate matches 00-unified-types.md definition.
// Note: candidates of type 'system', 'decision', 'source', or 'query' can appear
// in the scored list but the classification rules (Rules 2-6) only check for
// 'feature' and 'change' types. If a non-Feature/non-Change type scores highest,
// it falls through to the fallback (new_feature). This is intentional: System/Decision
// notes don't drive classification decisions but may appear as contextual results.
interface ScoredCandidate {
  id: string;
  type: NoteType;  // 'feature' | 'change' | 'system' | 'decision' | 'source' | 'query'
  title: string;
  score: number;
  reasons: string[];
}

// ── Retrieval subagent output (overview.md section 10.6) ──
// Type ownership: RetrievalResult is canonically defined in 00-unified-types.md.
// Plan 05 (retrieval-engine) produces this type; plan 07 consumes it.
// This plan imports RetrievalResult from the shared types module, NOT from
// plan 05 directly — both plans reference the same canonical definition.
// If plan 05 needs to extend the shape, it must update 00-unified-types.md.

// Imported from shared types (00-unified-types.md):
// interface RetrievalResult {
//   query: string;
//   classification: Classification;
//   confidence: Confidence;
//   sequencing: SequencingSummary;
//   candidates: ScoredCandidate[];
//   warnings: string[];
// }

// ── Section-completeness types (overview.md section 15) ──

interface PlannedPrerequisites {
  hard: {
    why_present: boolean;
    delta_summary_present: boolean;
    tasks_present: boolean;
    validation_present: boolean;
  };
  soft: {
    design_approach_present: boolean;
    decision_link_present: boolean;
  };
  all_hard_met: boolean;
  warnings: string[];
}

// ── Propose workflow result ──

interface ProposeResult {
  /** What action was taken */
  action: 'continued_change' | 'created_change' | 'created_feature_and_change' | 'asked_user';
  /** The retrieval analysis (type owned by 00-unified-types.md, produced by plan 05) */
  retrieval: RetrievalResult;
  /** The classification decision */
  classification: ClassificationResult;
  /** The Change note that is now the work target (null if needs_confirmation) */
  target_change: { id: string; path: string; status: string } | null;
  /** The Feature note that is the canonical target (null if needs_confirmation) */
  target_feature: { id: string; path: string } | null;
  /** Section-completeness check result (null if needs_confirmation) */
  prerequisites: PlannedPrerequisites | null;
  /** Whether the Change was transitioned to 'planned' */
  transitioned_to_planned: boolean;
  /** Sequencing warnings surfaced prominently when conflicts are detected */
  sequencing_warnings: string[];
}
```

### Core Algorithm

#### Step 1: normalizeQuery(request)

```
function normalizeQuery(userRequest: string): QueryObject:
  // This is the one step where the LLM is involved:
  // The main agent extracts structured fields from natural language.
  //
  // For v1, this is a deterministic prompt-based extraction.
  // The main agent parses the user request and produces:

  // Intent detection heuristics:
  intent = 'add'  // default
  lowerRequest = userRequest.toLowerCase()
  if lowerRequest matches /\b(fix|bug|broken|error|crash)\b/:
    intent = 'fix'
  else if lowerRequest matches /\b(change|update|modify|refactor|improve)\b/:
    intent = 'modify'
  else if lowerRequest matches /\b(remove|delete|deprecate|drop)\b/:
    intent = 'remove'
  else if lowerRequest matches /\b(investigate|research|explore|analyze|query)\b/:
    intent = 'investigate'

  // Term extraction:
  // Split request into words, filter stop words, group by likely type.
  // This is a heuristic; the main agent can refine this with LLM judgment.
  words = extractSignificantWords(userRequest)

  // feature_terms: nouns/noun phrases that could be Feature titles
  // system_terms: words matching known system names (from index)
  // entity_terms: technical identifiers (camelCase, snake_case, specific tech)

  return {
    intent,
    summary: userRequest.trim(),
    feature_terms: extractFeatureTerms(words),
    system_terms: extractSystemTerms(words, knownSystems),
    entity_terms: extractEntityTerms(words),
    status_bias: ['active', 'proposed', 'planned', 'in_progress']
  }
```

**Note on v1 implementation**: Query normalization is intentionally simple. The main agent (Claude Code) has the context to do reasonable term extraction. The key contract is the output format, not the extraction algorithm. Better extraction (e.g., NER models) can be added in v2 without changing the retrieval contract.

#### Step 2: Preflight (Sequencing + Retrieval)

```typescript
// PreflightResult carries both the RetrievalResult (with SequencingSummary for display)
// and the full SequencingResult (for post-classification logic like computeDependsOn).
interface PreflightResult {
  retrieval: RetrievalResult;
  sequencingFull: SequencingResult;
}
```

```
function runPreflight(query: QueryObject, index: VaultIndex): PreflightResult:
  // 2a. Run sequencing analysis on all active changes (plan 06)
  sequencingFull = sequencingEngine.analyzeSequencing(index)

  // 2b. Delegate retrieval + classification to retrieval engine (plan 05).
  //     Pass the full SequencingResult — retrieve() derives SequencingSummary
  //     internally and uses it for classification escalation (Rule 0b).
  //     Classification ownership is in plan 05. Plan 07 does NOT re-classify.
  retrieval = retrievalEngine.retrieve(index, query, { sequencing: sequencingFull })
  // Returns: RetrievalResult with classification, confidence,
  //   sequencing (SequencingSummary), candidates, warnings.
  //   Sequencing severity escalation (conflict_candidate/conflict_critical
  //   → needs_confirmation) is handled inside retrieve()'s classify() via Rule 0b.

  return {
    retrieval,
    sequencingFull
  }
```

#### Classification (handled by plan 05)

**IMPORTANT**: Classification is owned by plan 05 (retrieval-engine). Plan 07 does NOT have its own `classify()` function. The `retrieve()` call in `runPreflight()` returns a fully classified `RetrievalResult` with `classification`, `confidence`, `candidates`, and `sequencing` (SequencingSummary).

Plan 07 reads `retrieval.classification` and routes to the appropriate post-classification action. It does not re-evaluate thresholds, re-score candidates, or override classification — the only exception is the `forceClassification` testing override in `propose()`. Index-quality escalation (Rule 0) is handled inside plan 05's `classify()`, not here.

For the full classification rules (Rule 0 index-quality escalation, Rule 0b sequencing escalation, Rules 1-4 threshold rules, fallback), see plan 05's `classify()` function.

Plan 07 wraps the classification into a `ClassificationResult` envelope for richer context:

```
function buildClassificationResult(retrieval: RetrievalResult): ClassificationResult:
  return {
    classification: retrieval.classification,
    confidence: retrieval.confidence,
    primary_candidate: retrieval.candidates[0] ?? null,
    secondary_candidate: retrieval.candidates[1] ?? null,
    reasons: retrieval.candidates[0]?.reasons ?? []
  }
```

#### Step 4: Post-Classification Actions

```
function executePostClassification(
  classification: ClassificationResult,
  query: QueryObject,
  sequencingFull: SequencingResult,
  retrieval: RetrievalResult,
  index: VaultIndex,
  vaultRoot: string
): ProposeResult:
  // NOTE: `sequencingFull` is the full SequencingResult from plan 06, used for
  // computeDependsOn() which accesses pairwise_severities, ordering, and
  // requirement_conflicts. `retrieval.sequencing` is the SequencingSummary subset
  // for display output. These are intentionally separate parameters to resolve
  // the SequencingSummary/SequencingResult type mismatch (v2 NEW-1).

  // Derive sequencing_warnings from SequencingResult.reasons for ProposeResult output.
  sequencing_warnings = sequencingFull.reasons.filter(r =>
    r.includes('needs_review') || r.includes('conflict') || r.includes('stale') || r.includes('out-of-order')
  )

  switch classification.classification:

    case 'existing_change':
      // Use the existing active Change as the work target.
      // Read the linked Feature and set up for continue/apply.
      // NOTE: This path hands off to plan 08 (workflow-continue).
      // The Change note already exists; plan 07 does not modify it.
      change = index.records.get(classification.primary_candidate.id)
      feature = resolveFeatureFromChange(change, index)
      return {
        action: 'continued_change',
        retrieval,
        classification,
        target_change: { id: change.id, path: change.path, status: change.status },
        target_feature: feature ? { id: feature.id, path: feature.path } : null,
        prerequisites: null,  // not checking prerequisites for continue
        transitioned_to_planned: false,
        sequencing_warnings
      }

    case 'existing_feature':
      // Use the existing Feature as canonical target.
      // Create a new Change note and connect it to that Feature.
      feature = index.records.get(classification.primary_candidate.id)

      changeId = generateChangeId(query)  // e.g., "change-add-passkey-login"
      changePath = createChangeNote(vaultRoot, changeId, feature, query, sequencingFull, index)
      prerequisites = checkPlannedPrerequisites(changePath)

      return {
        action: 'created_change',
        retrieval,
        classification,
        target_change: { id: changeId, path: changePath, status: prerequisites.all_hard_met ? 'planned' : 'proposed' },
        target_feature: { id: feature.id, path: feature.path },
        prerequisites,
        transitioned_to_planned: prerequisites.all_hard_met,
        sequencing_warnings
      }

    case 'new_feature':
      // Create a new Feature note first.
      // Then create a new Change note connected to it.
      featureId = generateFeatureId(query)  // e.g., "feature-passkey-login"
      featurePath = createFeatureNote(vaultRoot, featureId, query)

      changeId = generateChangeId(query)
      changePath = createChangeNote(vaultRoot, changeId, { id: featureId, path: featurePath }, query, sequencingFull, index)
      prerequisites = checkPlannedPrerequisites(changePath)

      return {
        action: 'created_feature_and_change',
        retrieval,
        classification,
        target_change: { id: changeId, path: changePath, status: prerequisites.all_hard_met ? 'planned' : 'proposed' },
        target_feature: { id: featureId, path: featurePath },
        prerequisites,
        transitioned_to_planned: prerequisites.all_hard_met,
        sequencing_warnings
      }

    case 'needs_confirmation':
      // Stop automatic creation. Show candidates and ask the user.
      return {
        action: 'asked_user',
        retrieval,
        classification,
        target_change: null,
        target_feature: null,
        prerequisites: null,
        transitioned_to_planned: false,
        sequencing_warnings
      }
```

#### Step 5: checkPlannedPrerequisites(changePath)

```
function checkPlannedPrerequisites(changePath: string): PlannedPrerequisites:
  // Parse the Change note at changePath
  note = parseNote(changePath)

  // Hard prerequisites (ALL required for proposed -> planned)
  why_present = sectionHasContent(note, 'Why')
  delta_summary_present = parseDeltaSummary(note).entries.length > 0
  tasks_present = parseTaskList(note).length > 0
  validation_present = sectionHasContent(note, 'Validation')

  all_hard_met = why_present && delta_summary_present && tasks_present && validation_present

  // Soft prerequisites (warning only)
  design_approach_present = sectionHasContent(note, 'Design Approach') || sectionContains(note, 'Design Approach', 'N/A')
  decision_link_present = note.frontmatter.decisions?.length > 0

  warnings = []
  if !design_approach_present:
    warnings.push('Design Approach section is empty (soft prerequisite)')
  if !decision_link_present:
    warnings.push('No Decision links found (soft prerequisite for complex changes)')

  return {
    hard: { why_present, delta_summary_present, tasks_present, validation_present },
    soft: { design_approach_present, decision_link_present },
    all_hard_met,
    warnings
  }
```

**Note on the `proposed -> planned` transition**: In a typical `propose` flow, the Change note is created with stub sections. The initial creation will NOT satisfy all hard prerequisites -- `Why`, `Delta Summary`, `Tasks`, and `Validation` will be empty placeholders. This is expected. The prerequisites check runs, reports what's missing, and the `continue` workflow (plan 08) fills in sections until all prerequisites are met.

However, if the main agent generates a complete Change note in one step (similar to OpenSpec's propose/ff flow), and all sections are populated, the transition to `planned` happens immediately.

#### Note Creation Functions

```
function createChangeNote(
  vaultRoot: string,
  changeId: string,
  feature: { id: string; path: string },
  query: QueryObject,
  sequencingFull: SequencingResult,
  index: VaultIndex
): string:
  // Compute depends_on from sequencing analysis.
  // See computeDependsOn() definition below.
  depends_on = computeDependsOn(changeId, feature, sequencingFull, index)
  // Compute touches from query terms + feature.
  // See computeTouches() definition below.
  touches = computeTouches(feature, query, index)

  // Build frontmatter.
  // v1 limitation: propose always creates a single-feature Change using `feature:` (singular).
  // Overview.md 13.2 allows cross-cutting changes with `features:` (plural), but this path
  // is not supported in v1 propose. Cross-cutting changes can be created manually or by
  // editing the frontmatter after creation. A v2 enhancement could add a multi-feature
  // selection flow when the user explicitly requests cross-cutting work.
  frontmatter = {
    type: 'change',
    id: changeId,
    status: 'proposed',
    feature: `"[[${feature.title || feature.id}]]"`,
    depends_on: depends_on.map(id => `"[[${resolveTitle(id)}]]"`),
    touches: touches.map(id => `"[[${resolveTitle(id)}]]"`),
    systems: inferSystems(query, feature),
    sources: [],
    decisions: [],
    tags: ['change'],
    // CRITICAL: created_at MUST be ISO 8601 date (YYYY-MM-DD) for deterministic
    // tiebreaking in sequencing engine (plan 06). The sequencing engine's priority
    // queue compares (created_at, change_id) lexicographically, so non-ISO formats
    // would produce incorrect ordering.
    created_at: new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
  }

  // Build body sections (initially stubs)
  body = `
# Change: ${titleFromId(changeId)}

## Why

## Delta Summary

## Proposed Update

## Design Approach

## Impact

## Tasks

## Validation

## Status Notes
`

  changePath = path.join(vaultRoot, 'wiki', '04-changes', `${slugFromId(changeId)}.md`)
  writeNoteWithFrontmatter(changePath, frontmatter, body)
  return changePath


function createFeatureNote(
  vaultRoot: string,
  featureId: string,
  query: QueryObject
): string:
  frontmatter = {
    type: 'feature',
    id: featureId,
    status: 'active',
    systems: inferSystems(query),
    sources: [],
    decisions: [],
    changes: [],
    tags: ['feature']
  }

  body = `
# Feature: ${titleFromId(featureId)}

## Purpose

## Current Behavior

## Constraints

## Known Gaps

## Requirements

## Related Notes
`

  featurePath = path.join(vaultRoot, 'wiki', '03-features', `${slugFromId(featureId)}.md`)
  writeNoteWithFrontmatter(featurePath, frontmatter, body)
  return featurePath
```

#### Helper: computeDependsOn()

Derives the `depends_on` list for a newly created Change based on sequencing analysis. A new Change should depend on existing active Changes that:
1. Touch the same Feature (conflict_candidate or conflict_critical relationship), OR
2. Are explicitly identified as blockers by the sequencing engine.

**Execution context**: Due to escalation logic in `runPreflight()` (via plan 05's `classify()` Rule 0b), when the overall sequencing status is `conflict_candidate` or `conflict_critical`, classification is escalated to `needs_confirmation` and no Change note is created. Therefore, `computeDependsOn()` primarily handles the `parallel_safe` and `needs_review` cases, where pairwise overlaps on the target Feature are unlikely. The conflict-handling branches below are defensive code for edge cases where individual pair severities differ from the overall status. The only scenario where this function produces non-empty results in practice is `new_feature` classification for a newly created Feature that happens to touch systems shared with existing changes — where overall status may remain `needs_review` while a specific pair has Feature-level overlap.

```
function computeDependsOn(
  newChangeId: string,
  feature: { id: string },
  sequencingFull: SequencingResult,
  index: VaultIndex
): string[]:
  depends_on: string[] = []

  // Find active changes that touch the same Feature as this new change.
  // If any are in conflict_candidate or conflict_critical state with each other,
  // the new change should depend on the EARLIER one only (by ordering position).
  // We do NOT add both sides — that would create a guaranteed-stuck state for the
  // new change, since the two conflicting changes cannot both be resolved.
  for overlap in sequencingFull.pairwise_severities:
    if overlap.overlapping_features.includes(feature.id):
      // Both changes in this pair touch our target Feature.
      // Add the earlier one (by ordering position) as a dependency.
      posA = sequencingFull.ordering.find(o => o.id == overlap.change_a)?.position ?? Infinity
      posB = sequencingFull.ordering.find(o => o.id == overlap.change_b)?.position ?? Infinity
      // Depend on whichever comes first in deterministic order.
      // The user must resolve the A-vs-B conflict before C can proceed;
      // depending on BOTH would create an unsatisfiable depends_on.
      earlierId = posA < posB ? overlap.change_a : overlap.change_b
      if !depends_on.includes(earlierId):
        depends_on.push(earlierId)

  // Also add the earlier change from requirement-level conflict pairs
  // on the same Feature. Same rule: depend on only the earlier one,
  // not both sides, to avoid deadlock.
  for conflict in sequencingFull.requirement_conflicts:
    if conflict.feature_id == feature.id:
      posA = sequencingFull.ordering.find(o => o.id == conflict.change_a)?.position ?? Infinity
      posB = sequencingFull.ordering.find(o => o.id == conflict.change_b)?.position ?? Infinity
      earlierId = posA < posB ? conflict.change_a : conflict.change_b
      if !depends_on.includes(earlierId):
        depends_on.push(earlierId)

  return [...new Set(depends_on)]
```

#### Helper: computeTouches()

Derives the `touches` list for a newly created Change. `touches` is the impact surface: which Feature and System notes this Change will affect.

```
function computeTouches(
  feature: { id: string },
  query: QueryObject,
  index: VaultIndex
): string[]:
  touches: string[] = []

  // 1. Always include the target Feature
  touches.push(feature.id)

  // 2. Resolve system_terms from the query to System note IDs
  for term in query.system_terms:
    // Look up the term in the index to find a matching System note
    systemRecord = findSystemByName(term, index)
    if systemRecord != null:
      touches.push(systemRecord.id)

  // 3. If the target Feature has systems[], include those too
  //    (the new Change likely affects the Feature's associated systems)
  featureRecord = index.records.get(feature.id)
  if featureRecord != null:
    for sysId in featureRecord.systems:
      if !touches.includes(sysId):
        touches.push(sysId)

  return [...new Set(touches)]

function findSystemByName(term: string, index: VaultIndex): IndexRecord | null:
  // Case-insensitive match on title or aliases
  lowerTerm = term.toLowerCase()
  for record in index.records.values():
    if record.type !== 'system': continue
    if record.title.toLowerCase() == lowerTerm:
      return record
    if record.aliases.some(a => a.toLowerCase() == lowerTerm):
      return record
  return null
```

#### Main Entry Point: propose()

```
async function propose(
  userRequest: string,
  options: {
    vaultRoot: string;
    forceClassification?: ProposalClassification;  // for testing or override
    dryRun?: boolean;  // return result without writing files
  }
): Promise<ProposeResult>:

  // 0. Build index
  index = await buildIndex(options.vaultRoot)

  // 1. Normalize query
  query = normalizeQuery(userRequest)

  // 2. Run preflight (sequencing + retrieval with classification)
  //    runPreflight returns { retrieval: RetrievalResult, sequencingFull: SequencingResult }
  //    Classification is done inside retrieve() by plan 05. Plan 07 does NOT re-classify.
  { retrieval, sequencingFull } = await runPreflight(query, index)

  // 3. Allow force override (for testing only)
  if options.forceClassification:
    retrieval = { ...retrieval, classification: options.forceClassification }

  // 4. Build classification result envelope
  classification = buildClassificationResult(retrieval)

  if options.dryRun:
    return {
      action: classificationToAction(classification.classification),
      retrieval,
      classification,
      target_change: null,
      target_feature: null,
      prerequisites: null,
      transitioned_to_planned: false,
      sequencing_warnings: sequencingFull.reasons.filter(r =>
        r.includes('needs_review') || r.includes('conflict') || r.includes('stale') || r.includes('out-of-order')
      )
    }

  // 5. Execute post-classification action
  //    Pass BOTH retrieval (with SequencingSummary for display) and
  //    sequencingFull (with full SequencingResult for depends_on/touches logic).
  result = executePostClassification(
    classification, query, sequencingFull, retrieval, index, options.vaultRoot
  )

  // 6. If a Change was created/attached and prerequisites are met, transition
  if result.target_change && result.prerequisites?.all_hard_met:
    updateChangeStatus(result.target_change.path, 'planned')
    result.target_change.status = 'planned'
    result.transitioned_to_planned = true

  return result
```

### File Structure

```
src/
  workflow/
    propose.ts            # Main propose() function, orchestrates the flow
    query-normalizer.ts   # normalizeQuery(), term extraction helpers
    preflight.ts          # runPreflight(), PreflightResult type
    post-action.ts        # executePostClassification(), note creation, computeDependsOn/Touches
    prerequisites.ts      # checkPlannedPrerequisites(), section checks
    types.ts              # All TypeScript interfaces defined above
    index.ts              # Re-exports public API

    # NOTE: No classifier.ts — classification is owned by plan 05 (retrieval-engine).
    # Plan 07 calls retrievalEngine.retrieve() which returns fully classified results.
```

### Public API / Interface

```typescript
// src/workflow/index.ts (propose-related exports)

export { propose } from './propose.js';
export { normalizeQuery } from './query-normalizer.js';
export { runPreflight } from './preflight.js';
export { checkPlannedPrerequisites } from './prerequisites.js';

// NOTE: classify() is NOT exported from plan 07. Classification is owned
// by plan 05 (retrieval-engine). Plan 07 consumes retrieval.classification.

export type {
  QueryObject,
  ProposalClassification,
  ClassificationResult,
  PreflightResult,
  PlannedPrerequisites,
  ProposeResult,
} from './types.js';

// RetrievalResult and ScoredCandidate are re-exported from shared types
// (00-unified-types.md), NOT defined locally.
export type { RetrievalResult, ScoredCandidate } from '../shared/types.js';
```

### Dependencies on Other Modules

| Module | What is needed | How it is used |
|--------|---------------|----------------|
| **04-index-engine** | `VaultIndex`, `buildIndex()` | Build index at propose start; look up records by ID via `index.records.get()` |
| **05-retrieval-engine** | `retrievalEngine.retrieve(index, query, { sequencing })` | Full retrieval pipeline including classification. Plan 07 does NOT call `search()` or re-classify — it consumes `RetrievalResult.classification` directly. |
| **06-sequencing-engine** | `analyzeSequencing(index)` | Sequencing analysis; returns full `SequencingResult` which is passed to `retrieve()` and retained for `executePostClassification()` |
| **03-vault-parser** | `parseNote()`, `parseDeltaSummary()` | Parse created notes for prerequisite checks |
| **02-note-templates** | Frontmatter schemas, section contracts | Validate created notes against type contracts |
| `util/id` | `generateChangeId()`, `generateFeatureId()` | ID generation for new notes |
| `util/hash` | SHA-256 hashing | Content hash for base_fingerprint on Delta Summary entries |

### Comparison: OpenSpec Propose vs open-wiki-spec Propose

```
OpenSpec propose:
  1. Ask what to build             ─┐
  2. Derive change name             │  No discovery
  3. Create change directory        │
  4. Generate artifacts             │
  5. Show status                   ─┘

open-wiki-spec propose:
  1. Receive user request          ─┐
  2. Normalize query                │  MANDATORY PREFLIGHT
  3. Retrieve candidates            │  (this is the key difference)
  4. Score and classify             │
  5. Check sequencing              ─┘
  6. Execute action based on class ─┐
  7. Create/update notes            │  Post-classification
  8. Check prerequisites            │
  9. Transition if ready           ─┘
```

The fundamental difference: OpenSpec's propose is a `create-first` workflow. open-wiki-spec's propose is a `search-first` workflow. The preflight is not optional -- it is the core product behavior that prevents duplicate features, missed related work, and parallel conflicts.

---

## 4. Test Strategy

### Unit Tests

**query-normalizer.test.ts:**

- "add passkey login" -> intent: 'add', feature_terms: ['passkey', 'login']
- "fix authentication bug" -> intent: 'fix', feature_terms: ['authentication']
- "remove deprecated OAuth flow" -> intent: 'remove', feature_terms: ['oauth', 'flow']
- "investigate session management" -> intent: 'investigate', feature_terms: ['session', 'management']
- "refactor auth middleware" -> intent: 'modify', feature_terms: ['auth', 'middleware']
- Empty string -> throws error
- Very long input (1000+ chars) -> truncated to summary, terms extracted from first 200 chars

**NOTE: Classification tests are in plan 05 (retrieval-engine), not here.**
Plan 07 does not own classify(). The tests below verify that plan 07 correctly
reads and routes on `RetrievalResult.classification` from plan 05.

**preflight.test.ts:**

- `runPreflight` calls `analyzeSequencing()` then `retrieve()` with sequencing result
- `runPreflight` returns `PreflightResult` with both `retrieval` and `sequencingFull`
- `retrieval.classification` reflects plan 05's classify() output (not re-classified)
- `sequencingFull` retains all fields (pairwise_severities, ordering, requirement_conflicts)
- `retrieval.sequencing` is SequencingSummary (subset with status, related_changes, reasons only)

**prerequisites.test.ts:**

- Change with all 4 hard sections filled -> all_hard_met = true
- Change with empty Why -> all_hard_met = false, missing = ['Why']
- Change with empty Delta Summary (no entries) -> all_hard_met = false
- Change with empty Tasks (no items) -> all_hard_met = false
- Change with all hard met but no Design Approach -> all_hard_met = true, warning about soft prerequisite
- Change with all hard met and Design Approach = "N/A" -> no warning
- Change with all sections empty -> all_hard_met = false, 4 missing

**post-action.test.ts:**

- `existing_change` classification -> returns continued_change, no new files
- `existing_feature` classification -> creates new Change note, links to existing Feature
- `new_feature` classification -> creates both Feature and Change notes
- `needs_confirmation` classification -> returns asked_user, no files created
- Created Change note has correct frontmatter (type, id, status, feature link)
- Created Feature note has correct frontmatter (type, id, status)
- Created Change note has all required stub sections
- `depends_on` and `touches` populated from sequencing analysis

**post-action.test.ts (computeDependsOn / computeTouches):**

- `computeDependsOn`: no overlapping changes -> empty depends_on
- `computeDependsOn`: two active changes touch same Feature -> depends on earlier one (by ordering position)
- `computeDependsOn`: requirement conflict on target Feature -> depends on EARLIER conflicting change only (not both — adding both would create unsatisfiable depends_on)
- `computeDependsOn`: deduplicates when same change appears in overlap and conflict
- `computeDependsOn`: is effectively defensive code — escalation in classify() prevents most paths where it produces non-empty results
- `computeTouches`: always includes target Feature in touches list
- `computeTouches`: system_terms matching known System notes -> included in touches
- `computeTouches`: target Feature has systems[] -> those systems included
- `computeTouches`: system_terms that don't match any System note -> not included
- `computeTouches`: deduplicates overlapping entries

**propose.test.ts (integration):**

- Full propose flow with test vault: request matches existing Feature -> creates Change
- Full propose flow: request matches active Change -> returns continue action
- Full propose flow: no match -> creates Feature + Change
- Full propose flow: ambiguous candidates -> returns needs_confirmation
- Dry run mode: no files written, result still populated
- Force classification override: works correctly
- Sequencing conflict_candidate -> classification escalated to needs_confirmation
- Sequencing conflict_critical -> classification escalated to needs_confirmation
- Sequencing parallel_safe -> classification NOT escalated

### Edge Cases

- User request is a single word ("auth") -> normalized with limited terms
- User request contains wikilink syntax ("fix [[Feature: Auth Login]]") -> link extracted as feature term
- Index is empty (brand new vault) -> always `new_feature`
- All active changes are `applied` status -> should not be returned as `existing_change`
- Feature has no Requirements section yet -> Change creation still succeeds
- Multiple Features have the same alias -> `needs_confirmation` due to ambiguity warning
- Change creation fails (disk error) -> propagated as error. NOTE: for the `new_feature` path, a Feature note may already have been written before the Change creation fails, leaving partial state. This is acceptable for v1 (single-agent model) and the orphan Feature can be cleaned up by verify.
- `proposed -> planned` transition race condition -> not a concern in v1 (single-agent model)

---

## 5. Implementation Order

### Prerequisites

- **Plan 03** (vault-parser): parseNote(), section parsing, delta summary parsing.
- **Plan 04** (index-engine): VaultIndex, buildIndex().
- **Plan 05** (retrieval-engine): `retrieve()` — full pipeline including classification. Plan 07 does NOT call `search()`.
- **Plan 06** (sequencing-engine): `analyzeSequencing()` — returns full `SequencingResult`.

### Build Order

1. **types.ts** -- Define all interfaces (QueryObject, ClassificationResult, PreflightResult, ProposeResult, etc.).
2. **query-normalizer.ts** -- Implement normalizeQuery() with intent detection and term extraction. Unit test immediately.
3. **preflight.ts** -- Implement runPreflight() which calls analyzeSequencing() then retrieve(). Unit test with mock retrieval/sequencing engines.
4. **prerequisites.ts** -- Implement checkPlannedPrerequisites(). Unit test with fixture Change notes.
5. **post-action.ts** -- Implement createChangeNote(), createFeatureNote(), computeDependsOn(), computeTouches(), executePostClassification(). Unit test with temp vault directories.
6. **propose.ts** -- Wire together the full propose() flow. Integration test with test vault fixtures.
7. **index.ts** -- Re-exports.

NOTE: No classifier.ts step — classification is owned by plan 05.

### After This Plan

- **Plan 08** (workflow-continue) will pick up where propose leaves off: filling empty sections, transitioning `proposed -> planned`.
- **Plan 09** (workflow-apply) will consume the Change notes created by propose.
- **Plan 10** (workflow-verify) will validate the notes propose created.
- **Plan 12** (cli-init) will register the `ows propose` CLI command that invokes this workflow.
