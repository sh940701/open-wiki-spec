# Verify Workflow Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec's verification is structured as a 3-dimension check (Completeness, Correctness, Coherence) performed by an LLM-driven skill template rather than deterministic code. The `verify-change` workflow loads all change artifacts (proposal.md, design.md, tasks.md, delta specs), then instructs the agent to evaluate each dimension and produce a structured markdown report.

The programmatic validation layer (`Validator` class) handles structural checks: Zod schema validation of parsed specs and changes, delta spec format enforcement (ADDED/MODIFIED/REMOVED/RENAMED sections), requirement body rules (SHALL/MUST keywords, scenario counts), and cross-section conflict detection within a single spec file.

### Key Source Files

- `src/core/templates/workflows/verify-change.ts` -- Skill template defining the 3-dimension verification flow (Completeness, Correctness, Coherence). This is prompt instructions for the agent, not executable code.
- `src/core/validation/validator.ts` -- `Validator` class with methods `validateSpec()`, `validateChange()`, `validateChangeDeltaSpecs()`. Handles structural validation using Zod schemas, requirement format rules, and cross-section conflict detection.
- `src/core/validation/types.ts` -- `ValidationLevel` (`'ERROR' | 'WARNING' | 'INFO'`), `ValidationIssue`, `ValidationReport` interfaces.
- `src/core/validation/constants.ts` -- Threshold constants (`MIN_PURPOSE_LENGTH`, `MAX_REQUIREMENT_TEXT_LENGTH`) and `VALIDATION_MESSAGES` with guidance snippets.

### Core Algorithm / Flow

**OpenSpec verify-change workflow (agent-driven):**

1. Select a change (interactively or by argument).
2. Run `openspec status --change "<name>" --json` to understand schema and existing artifacts.
3. Run `openspec instructions apply --change "<name>" --json` to get artifact context files.
4. Initialize a report with 3 dimensions, each having CRITICAL/WARNING/SUGGESTION severity.
5. **Completeness**: Parse tasks.md checkboxes (incomplete = CRITICAL). Extract requirements from delta specs and search codebase for evidence (missing = CRITICAL).
6. **Correctness**: For each requirement, search for implementation evidence. If divergence detected = WARNING. For each scenario, check code/test coverage (uncovered = WARNING).
7. **Coherence**: If design.md exists, verify implementation follows decisions (contradictions = WARNING). Check code pattern consistency (deviations = SUGGESTION).
8. Generate a report with summary scorecard table, grouped issues, and final assessment.

**Graceful degradation**: If only tasks.md exists, verify task completion only. If tasks + specs exist, verify completeness and correctness. If full artifacts, verify all three.

**OpenSpec Validator class (programmatic):**

1. Parse markdown into structured objects using `MarkdownParser`/`ChangeParser`.
2. Validate against Zod schemas (`SpecSchema`, `ChangeSchema`).
3. Apply business rules: purpose length, requirement text length, SHALL/MUST presence, scenario count, delta description quality.
4. For delta specs specifically: validate each section (ADDED/MODIFIED must have SHALL/MUST + scenarios; REMOVED is names only; RENAMED checks pairs), detect duplicates within sections, detect cross-section conflicts (same requirement in MODIFIED and REMOVED, etc.).
5. Return `ValidationReport` with `valid`, `issues[]`, and `summary` counts.

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

**Section 10.8: Verify Dimensions and Vault Integrity Contract**

Three verification dimensions:

- **Completeness**: Required sections present. Feature has machine-verifiable Requirements. Change has Delta Summary, Tasks, Validation. Required Decision/System/Source links not missing.
- **Correctness**: Wikilink/frontmatter references match actual notes. Delta Summary matches canonical edits. Status transitions follow allowed paths. Schema version matches note contract. Drift acceptable for current status.
- **Coherence**: No conflicting Decisions or Feature descriptions. depends_on/touches consistent across active change set. Parallel changes not competing on same touch surface without sequencing. No contradictions between Feature/Change/Decision/System descriptions.

**Operation Validation Matrix** (section 10.8):

| Operation | Before Apply | After Apply |
|-----------|-------------|-------------|
| ADDED | requirement MUST NOT exist in Feature | requirement MUST exist |
| MODIFIED | requirement MUST exist | requirement MUST exist (content_hash changed) |
| REMOVED | requirement MUST exist | requirement MUST NOT exist |
| RENAMED | old name MUST exist, new MUST NOT | old MUST NOT exist, new MUST exist |

MODIFIED where content_hash unchanged = warning (no real change).

**Stale-Change Detection** (section 10.8): Each MODIFIED/REMOVED/RENAMED entry has `base_fingerprint`. If current requirement `content_hash` differs from `base_fingerprint`, another Change was applied first. Report `stale_base`, block auto-apply.

**Vault Integrity** (section 10.8): duplicate/missing id, unresolved wikilink, ambiguous alias/title collision, schema mismatch, invalid frontmatter, orphan note, broken depends_on target, archive placement violation, stale base_fingerprint, requirement-level conflict across active Changes.

**Section 15 (verify)**: Explicitly perform parallel change conflict detection at both touches level and requirement level.

**Section 10.1.1**: Schema version mismatch detection between parsed notes and `wiki/00-meta/schema.md`.

**Section 10.5.1**: Touches severity model and requirement-level conflict model.

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec |
|--------|---------|----------------|
| Verification target | Change artifacts (proposal, design, tasks, delta specs) in `openspec/changes/<name>/` | The entire vault graph: all notes, all links, all active Changes |
| Completeness check | Checklist items + requirement codebase search | Section-completeness contract + frontmatter link completeness + requirement existence |
| Correctness check | Requirement-to-codebase mapping | Wikilink resolution + Delta Summary vs canonical Feature + status transition + schema version |
| Coherence check | Design adherence + code pattern consistency | Cross-note consistency + parallel change conflict + depends_on/touches coherence |
| Stale detection | Not explicit in verify (implicitly in apply) | Explicit `base_fingerprint` vs `content_hash` comparison |
| Vault integrity | N/A (no vault concept) | Full vault-level structural integrity checks |
| Execution model | Agent-driven heuristic evaluation | Deterministic programmatic checks + structured report |
| Report format | Markdown for human consumption | Structured JSON for agent consumption + human-readable summary |

### Contracts to Satisfy

1. 3-dimension verification (Completeness, Correctness, Coherence) as defined in section 10.8.
2. Operation validation matrix for ADDED/MODIFIED/REMOVED/RENAMED pre/post conditions.
3. Stale-change detection via `base_fingerprint` vs `content_hash`.
4. Vault integrity checks (all items listed in section 10.8).
5. Parallel change conflict detection at touches level AND requirement level (section 10.5.1).
6. Schema mismatch detection (section 10.1.1).
7. Severity levels: ERROR, WARNING, INFO.
8. Structured output for agent consumption.
9. Graceful degradation when only some sections exist.

---

## 3. Implementation Plan

### Architecture Overview

```
src/
  verify/
    verify-engine.ts        -- Main orchestrator, runs all checks
    dimensions/
      completeness.ts       -- Completeness dimension checks
      correctness.ts        -- Correctness dimension checks
      coherence.ts          -- Coherence dimension checks
    vault-integrity.ts      -- Vault-wide structural integrity checks
    operation-validator.ts  -- Delta Summary operation validation matrix
    stale-detector.ts       -- base_fingerprint vs content_hash comparison
    conflict-detector.ts    -- Parallel change conflict detection
    types.ts                -- All verify-related types
    report-formatter.ts     -- JSON and human-readable output formatting
```

The verify engine is stateless -- it takes a `VaultIndex` (from index-engine, as defined in `00-unified-types.md`) and runs all checks in a single pass. It does not modify any vault files.

**Accessing VaultIndex data:** The `VaultIndex` interface exposes `records: Map<string, IndexRecord>`. Throughout this plan, all index access uses this Map directly:
- `index.records.values()` to iterate all records
- `index.records.get(id)` to look up by id
- `index.schema_version` to read schema version (snake_case per unified types)
- Wikilink resolution uses a helper `resolveLink(index, link)` that searches `records` by id, title, and aliases

### Data Structures

```typescript
// ─── Severity & Issue Types ──────────────────────────────

type IssueSeverity = 'error' | 'warning' | 'info';

type VerifyDimension = 'completeness' | 'correctness' | 'coherence' | 'vault_integrity';

interface VerifyIssue {
  /** Which dimension this issue belongs to */
  dimension: VerifyDimension;
  /** Severity level */
  severity: IssueSeverity;
  /** Machine-readable issue code, e.g. "V001", "V042" */
  code: string;
  /** Human-readable description */
  message: string;
  /** File path relative to vault root (if applicable) */
  note_path?: string;
  /** The note id where the issue was found (if applicable) */
  note_id?: string;
  /** Suggested fix for the issue */
  suggestion?: string;
}

// Exhaustive issue code constants for programmatic matching.
// The VerifyIssue.code field is `string` per unified types, but implementations
// SHOULD use only these constants for consistency.
type VerifyIssueCode =
  // Completeness
  | 'MISSING_SECTION'
  | 'MISSING_REQUIREMENTS'
  | 'MISSING_DELTA_SUMMARY'
  | 'MISSING_TASKS'
  | 'MISSING_VALIDATION'
  | 'MISSING_LINK'
  | 'MISSING_DESIGN_APPROACH'
  | 'INCOMPLETE_TASKS'
  // Correctness
  | 'UNRESOLVED_WIKILINK'
  | 'INVALID_FRONTMATTER_REF'
  | 'DELTA_MISMATCH_ADDED'
  | 'DELTA_MISMATCH_MODIFIED'
  | 'DELTA_MISMATCH_REMOVED'
  | 'DELTA_MISMATCH_RENAMED'
  | 'MODIFIED_NO_CHANGE'
  | 'INVALID_STATUS_TRANSITION'
  | 'SCHEMA_MISMATCH'
  | 'MALFORMED_FRONTMATTER'
  | 'STALE_BASE'
  | 'EXCESSIVE_DRIFT'
  // Coherence
  | 'CONFLICTING_DESCRIPTIONS'
  | 'BROKEN_DEPENDS_ON'
  | 'TOUCHES_OVERLAP_NEEDS_REVIEW'
  | 'TOUCHES_OVERLAP_CONFLICT'
  | 'REQUIREMENT_CONFLICT_CRITICAL'
  | 'INCONSISTENT_DECISION'
  // Vault Integrity
  | 'DUPLICATE_ID'
  | 'MISSING_ID'
  | 'AMBIGUOUS_ALIAS'
  | 'ORPHAN_NOTE'
  | 'ARCHIVE_PLACEMENT_ERROR'
  | 'INVALID_FRONTMATTER_TYPE';

// ─── Report Types ────────────────────────────────────────

interface VerifyReport {
  /** ISO timestamp of when verify was run */
  scanned_at: string;
  /** Total note count scanned */
  total_notes: number;
  /** Flat list of all issues */
  issues: VerifyIssue[];
  /** Summary counts by dimension */
  summary: Record<VerifyDimension, { errors: number; warnings: number; info: number }>;
  /** Overall pass/fail -- true if zero errors */
  pass: boolean;
  /** Which checks were skipped and why */
  skipped: SkippedCheck[];
}

interface SkippedCheck {
  dimension: VerifyDimension;
  check: string;
  reason: string;
}

// ─── Operation Validation Types ──────────────────────────

// Operation validation uses `DeltaSummaryEntry` from 00-unified-types.md directly.
// Re-exported here for clarity:
//   op: DeltaOp ('ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED')
//   target_type: DeltaTargetType ('requirement' | 'section')
//   target_name: string
//   target_note_id: string
//   base_fingerprint: string | null
//   new_name?: string
//   description?: string

interface OperationValidationResult {
  entry: DeltaSummaryEntry;
  /** 'pre' = before apply, 'post' = after apply */
  phase: 'pre' | 'post';
  passed: boolean;
  issue?: VerifyIssue;
}

// ─── Conflict Detection Types ────────────────────────────

type TouchesSeverity = 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'blocked';

type RequirementConflictSeverity = 'conflict_critical';

// Conflict detection types are owned by sequencing-engine (plan 06).
// Verify imports and uses:
//   TouchesOverlap { other_change_id, shared_surface, severity: TouchesSeverity }
//   RequirementConflict { other_change_id, feature_id, requirement_name, this_op, other_op }
// as defined in 00-unified-types.md SequencingResult / TouchesOverlap / RequirementConflict.
```

### Core Algorithm

#### Main Verify Flow

```
function verify(index: VaultIndex, options?: VerifyOptions): VerifyReport
  1. Read schema version from wiki/00-meta/schema.md via index
  2. Initialize empty issues array and skipped checks array
  3. Run vault integrity checks (always first -- these may affect other checks)
     - duplicateIdCheck(index)
     - missingIdCheck(index)
     - unresolvedWikilinkCheck(index)
     - ambiguousAliasCheck(index)
     - orphanNoteCheck(index)
     - archivePlacementCheck(index)
     - malformedFrontmatterCheck(index)
     - invalidFrontmatterTypeCheck(index)
  4. Run completeness checks for each note by type
     - For each Feature: checkFeatureCompleteness(feature, index)
     - For each Change: checkChangeCompleteness(change, index)
     - For each Decision/System/Source: checkMinimumSections(note)
  5. Run correctness checks
     - For each note: checkWikilinkResolution(note, index)
     - For each note: checkFrontmatterRefResolution(note, index)
     - For each Change with status 'applied': runOperationValidationMatrix(change, index)
     - For all Changes: checkStaleBase(change, index)
     - For each note: checkSchemaVersionMatch(note, schemaVersion)
     - For each Change: checkStatusTransition(change)
     - For each Change: checkDriftForStatus(change, index, coveredByMatrix)
       // V3-1 fix: pass the set of requirements already covered by
       // runOperationValidationMatrix() so drift detection skips them.
       // This prevents duplicate issues for applied Changes.
  6. Run coherence checks
     - checkDependsOnConsistency(allActiveChanges, index)
     - checkConflictsViaSequencing(allActiveChanges, index)  // delegates to sequencing-engine (06)
     - checkDecisionConsistency(allDecisions, allFeatures)
     - checkDescriptionConsistency(allNotes)
  7. Aggregate results into VerifyReport
     - pass = (issues.filter(i => i.severity == 'error').length == 0)
     - summary = group issue counts by dimension and severity
  8. Return report
```

#### Completeness Checks Detail

```
function checkFeatureCompleteness(feature: IndexRecord, index: VaultIndex): VerifyIssue[]
  issues = []
  
  // Required sections
  requiredSections = ['Purpose', 'Current Behavior', 'Requirements']
  for section in requiredSections:
    if section not in feature.headings:
      issues.push({ dimension: 'completeness', severity: 'error', code: 'MISSING_SECTION', ... })
  
  // Machine-verifiable requirements
  if feature.requirements.length == 0:
    issues.push({ dimension: 'completeness', severity: 'error', code: 'MISSING_REQUIREMENTS', ... })
  
  // Each requirement must have SHALL/MUST and at least one scenario
  for req in feature.requirements:
    if not /\b(SHALL|MUST)\b/.test(req.normative):
      issues.push({ dimension: 'completeness', severity: 'error', ... })
    if req.scenarios.length == 0:
      issues.push({ dimension: 'completeness', severity: 'error', ... })
  
  return issues

function checkChangeCompleteness(change: IndexRecord, index: VaultIndex): VerifyIssue[]
  issues = []
  
  // Hard prerequisites (section-completeness contract for planned transition)
  if 'Why' not in change.headings:
    issues.push({ code: 'MISSING_SECTION', severity: 'error', ... })
  if change.delta_summary.length == 0:
    issues.push({ code: 'MISSING_DELTA_SUMMARY', severity: 'error', ... })
  if change.tasks.length == 0:
    issues.push({ code: 'MISSING_TASKS', severity: 'error', ... })
  if 'Validation' not in change.headings:
    issues.push({ code: 'MISSING_VALIDATION', severity: 'error', ... })
  
  // Soft prerequisites (warnings)
  if 'Design Approach' not in change.headings and isComplexChange(change):
    issues.push({ code: 'MISSING_DESIGN_APPROACH', severity: 'warning', ... })
  
  // Required links
  if change.feature is null and change.features is null:
    issues.push({ code: 'MISSING_LINK', severity: 'error', message: 'Change has no linked Feature' })
  if change.systems.length == 0:
    issues.push({ code: 'MISSING_LINK', severity: 'warning', message: 'Change has no linked System' })
  
  return issues
```

#### Correctness: Operation Validation Matrix

```
function runOperationValidationMatrix(
  change: IndexRecord,
  index: VaultIndex
): VerifyIssue[]
  issues = []
  
  for entry in change.delta_summary:
    featureRecord = index.records.get(entry.target_note_id)
    if featureRecord is null:
      issues.push({ code: 'INVALID_FRONTMATTER_REF', message: 'Delta references non-existent Feature' })
      continue
    
    existingReqs = new Map(featureRecord.requirements.map(r => [r.name, r]))
    
    if change.status == 'applied':
      // Post-apply validation
      switch entry.op:
        case 'ADDED':
          if not existingReqs.has(entry.target_name):
            issues.push({ code: 'DELTA_MISMATCH_ADDED', severity: 'error',
              message: `ADDED requirement "${entry.target_name}" not found in Feature after apply` })
        
        case 'MODIFIED':
          req = existingReqs.get(entry.target_name)
          if not req:
            issues.push({ code: 'DELTA_MISMATCH_MODIFIED', severity: 'error',
              message: `MODIFIED requirement "${entry.target_name}" not found in Feature after apply` })
          else if entry.base_fingerprint and req.content_hash == entry.base_fingerprint:
            issues.push({ code: 'MODIFIED_NO_CHANGE', severity: 'warning',
              message: `MODIFIED requirement "${entry.target_name}" content_hash unchanged after apply` })
        
        case 'REMOVED':
          if existingReqs.has(entry.target_name):
            issues.push({ code: 'DELTA_MISMATCH_REMOVED', severity: 'error',
              message: `REMOVED requirement "${entry.target_name}" still exists in Feature after apply` })
        
        case 'RENAMED':
          if existingReqs.has(entry.target_name):
            issues.push({ code: 'DELTA_MISMATCH_RENAMED', severity: 'error',
              message: `RENAMED old name "${entry.target_name}" still exists in Feature` })
          if not existingReqs.has(entry.new_name):
            issues.push({ code: 'DELTA_MISMATCH_RENAMED', severity: 'error',
              message: `RENAMED new name "${entry.new_name}" not found in Feature` })
    
    else:
      // Pre-apply validation (status is proposed/planned/in_progress)
      switch entry.op:
        case 'ADDED':
          if existingReqs.has(entry.target_name):
            issues.push({ code: 'DELTA_MISMATCH_ADDED', severity: 'error',
              message: `ADDED requirement "${entry.target_name}" already exists in Feature (pre-apply)` })
        
        case 'MODIFIED':
          if not existingReqs.has(entry.target_name):
            issues.push({ code: 'DELTA_MISMATCH_MODIFIED', severity: 'error',
              message: `MODIFIED requirement "${entry.target_name}" does not exist in Feature (pre-apply)` })
        
        case 'REMOVED':
          if not existingReqs.has(entry.target_name):
            issues.push({ code: 'DELTA_MISMATCH_REMOVED', severity: 'error',
              message: `REMOVED requirement "${entry.target_name}" does not exist in Feature (pre-apply)` })
        
        case 'RENAMED':
          if not existingReqs.has(entry.target_name):
            issues.push({ code: 'DELTA_MISMATCH_RENAMED', severity: 'error',
              message: `RENAMED old name "${entry.target_name}" does not exist in Feature` })
          if existingReqs.has(entry.new_name):
            issues.push({ code: 'DELTA_MISMATCH_RENAMED', severity: 'error',
              message: `RENAMED new name "${entry.new_name}" already exists in Feature` })
  
  return issues
```

#### Correctness: Stale-Change Detection

```
function checkStaleBase(change: IndexRecord, index: VaultIndex): VerifyIssue[]
  issues = []
  
  for entry in change.delta_summary:
    // Only MODIFIED, REMOVED, RENAMED have base_fingerprint
    if entry.op == 'ADDED':
      continue
    if entry.base_fingerprint is null:
      issues.push({ code: 'STALE_BASE', severity: 'warning',
        message: `${entry.op} entry for "${entry.target_name}" has no base_fingerprint` })
      continue
    
    featureRecord = index.records.get(entry.target_note_id)
    if featureRecord is null:
      continue  // Already caught by ref resolution
    
    currentReq = featureRecord.requirements.find(r => r.name == entry.target_name)
    if currentReq is null:
      // For RENAMED, check old name
      if entry.op == 'RENAMED':
        currentReq = featureRecord.requirements.find(r => r.name == entry.target_name)
      if currentReq is null:
        continue  // Requirement doesn't exist; caught by operation validation
    
    if currentReq.content_hash != entry.base_fingerprint:
      issues.push({ dimension: 'correctness', code: 'STALE_BASE', severity: 'error',
        message: `${entry.op} "${entry.target_name}": base_fingerprint mismatch. ` +
                 `Expected ${entry.base_fingerprint}, current is ${currentReq.content_hash}. ` +
                 `Another Change may have been applied since this Delta Summary was written.`,
        note_id: change.id,
        suggestion: 'Re-read the current Feature requirement and update the Delta Summary base_fingerprint.'
      })
  
  return issues
```

#### Coherence: Parallel Change Conflict Detection (delegates to sequencing-engine)

Per the ownership rules in `00-unified-types.md`, conflict detection (both touches-level and requirement-level) is owned by `sequencing-engine` (plan 06). The verify workflow MUST call sequencing-engine functions and map results to `VerifyIssue` format, not reimplement the logic.

```
function checkConflictsViaSequencing(
  activeChanges: IndexRecord[],
  index: VaultIndex
): VerifyIssue[]
  issues = []

  // Import from sequencing-engine (plan 06)
  // computeTouchesSeverity(changeA, changeB, index) -> TouchesOverlap
  // detectRequirementConflicts(changeA, changeB, index) -> RequirementConflict[]

  // Check each pair of active changes
  checkedPairs = new Set<string>()
  for i in range(activeChanges.length):
    for j in range(i+1, activeChanges.length):
      changeA = activeChanges[i]
      changeB = activeChanges[j]
      pairKey = [changeA.id, changeB.id].sort().join('::')
      if checkedPairs.has(pairKey): continue
      checkedPairs.add(pairKey)

      // --- Touches-level conflict (four-level severity model) ---
      touchesResult = computeTouchesSeverity(changeA, changeB, index)

      // Map the four-level model to VerifyIssue using overview.md 10.5.1 semantics
      switch touchesResult.severity:
        case 'parallel_safe':
          // No issue to report
          break
        case 'needs_review':
          issues.push({
            dimension: 'coherence', severity: 'warning',
            code: 'TOUCHES_OVERLAP_NEEDS_REVIEW',
            message: `Changes "${changeA.id}" and "${changeB.id}" both touch ` +
                     `System "${touchesResult.shared_surface}" -- needs_review`,
            suggestion: 'Confirm that these changes affect independent areas of the shared system.'
          })
          break
        case 'conflict_candidate':
          issues.push({
            dimension: 'coherence', severity: 'error',
            code: 'TOUCHES_OVERLAP_CONFLICT',
            message: `Changes "${changeA.id}" and "${changeB.id}" both touch ` +
                     `Feature "${touchesResult.shared_surface}" -- conflict_candidate`,
            suggestion: 'User confirmation required. Auto-apply is blocked.'
          })
          break
        case 'blocked':
          issues.push({
            dimension: 'coherence', severity: 'error',
            code: 'BROKEN_DEPENDS_ON',
            message: `Change "${changeA.id}" is blocked by unresolved depends_on target "${changeB.id}"`,
            suggestion: 'Resolve the blocking change before proceeding.'
          })
          break

      // --- Requirement-level conflict ---
      reqConflicts = detectRequirementConflicts(changeA, changeB, index)
      for conflict in reqConflicts:
        issues.push({
          dimension: 'coherence', severity: 'error',
          code: 'REQUIREMENT_CONFLICT_CRITICAL',
          message: `Requirement-level conflict: Changes "${changeA.id}" (${conflict.this_op}) and ` +
                   `"${changeB.id}" (${conflict.other_op}) both target ` +
                   `"${conflict.feature_id}::${conflict.requirement_name}" -- conflict_critical`,
          suggestion: 'Neither change can be auto-applied. User must resolve the conflict.'
        })

  return issues
```

#### Vault Integrity Checks

```
function duplicateIdCheck(index: VaultIndex): VerifyIssue[]
  // VaultIndex.records is Map<string, IndexRecord> keyed by id.
  // Duplicate ids are already detected during index build and stored in
  // VaultIndex.warnings with type 'duplicate_id'. We convert those to VerifyIssues.
  return index.warnings
    .filter(w => w.type == 'duplicate_id')
    .map(w => ({
      dimension: 'vault_integrity', severity: 'error', code: 'DUPLICATE_ID',
      message: w.message,
      note_path: w.note_path,
      suggestion: 'Each note must have a unique id. Rename one of the duplicates.'
    }))

function unresolvedWikilinkCheck(index: VaultIndex): VerifyIssue[]
  issues = []
  for record in index.records.values():
    for link in record.links_out:
      if not resolveLink(index, link):
        issues.push({ dimension: 'vault_integrity', severity: 'error',
          code: 'UNRESOLVED_WIKILINK',
          message: `Unresolved wikilink "[[${link}]]" in ${record.path}`,
          note_id: record.id, note_path: record.path })
  return issues

function orphanNoteCheck(index: VaultIndex): VerifyIssue[]
  issues = []
  for record in index.records.values():
    // Skip meta files
    if record.path.startsWith('wiki/00-meta/'): continue
    if record.links_in.length == 0 and record.links_out.length == 0:
      issues.push({ dimension: 'vault_integrity', severity: 'warning',
        code: 'ORPHAN_NOTE',
        message: `Note "${record.title}" (${record.path}) has no incoming or outgoing links`,
        note_id: record.id, note_path: record.path })
  return issues

function schemaVersionCheck(index: VaultIndex, declaredVersion: string): VerifyIssue[]
  // Compare declared schema version in 00-meta/schema.md against
  // the schema_version recorded during index build
  if index.schema_version != declaredVersion:
    return [{ dimension: 'vault_integrity', severity: 'error',
      code: 'SCHEMA_MISMATCH',
      message: `Index schema version "${index.schema_version}" does not match ` +
               `declared version "${declaredVersion}" in wiki/00-meta/schema.md` }]
  return []

function archivePlacementCheck(index: VaultIndex): VerifyIssue[]
  issues = []
  for record in index.records.values():
    isInArchive = record.path.startsWith('wiki/99-archive/')
    if isInArchive and record.status != 'applied':
      issues.push({ dimension: 'vault_integrity', severity: 'error',
        code: 'ARCHIVE_PLACEMENT_ERROR',
        message: `Note "${record.id}" in 99-archive/ has status "${record.status}" (expected "applied")` })
    if not isInArchive and record.type == 'change' and record.status == 'applied':
      // This is allowed per hybrid lifecycle -- applied stays in 04-changes/ first
      // Only report if it's been there too long? For v1, this is just INFO
      pass
  return issues
```

#### Correctness: Schema Version Match Per Note

```
function checkSchemaVersionMatch(note: IndexRecord, declaredVersion: string): VerifyIssue[]
  // Check if note's schema_version matches the declared vault schema version.
  // IndexRecord carries schema_version (from its frontmatter at parse time).
  // Also check that expected fields for this note type are populated.
  issues = []

  if note.schema_version != declaredVersion:
    issues.push({ dimension: 'correctness', code: 'SCHEMA_MISMATCH', severity: 'error',
      message: `Note "${note.id}" has schema_version "${note.schema_version}" ` +
               `but vault declares "${declaredVersion}"` })

  // Check required fields are present by inspecting the IndexRecord fields
  // (which are already extracted from frontmatter by vault-parser).
  // getExpectedFields() returns field names that must be non-empty on IndexRecord.
  expectedFields = getExpectedFields(note.type, declaredVersion)
  for field in expectedFields.required:
    if note[field] is undefined or note[field] is null or note[field] == '':
      issues.push({ dimension: 'correctness', code: 'SCHEMA_MISMATCH', severity: 'error',
        message: `Note "${note.id}" missing required field "${field}" per schema ${declaredVersion}` })

  return issues
```

#### Correctness: Status Transition Validation

```
// Allowed transitions (overview.md section 15)
ALLOWED_TRANSITIONS = {
  'proposed': ['planned'],
  'planned': ['in_progress'],
  'in_progress': ['applied'],
  'applied': []  // terminal for verify; archive is a separate action
}

function checkStatusTransition(change: IndexRecord): VerifyIssue[]
  // We can't check historical transitions without a log.
  // What we CAN check: if status is planned, are hard prerequisites met?
  // If status is in_progress, was it valid to leave planned? etc.
  issues = []
  
  if change.status == 'planned':
    missing = checkPlannedPrerequisites(change)
    if missing.length > 0:
      issues.push({ code: 'INVALID_STATUS_TRANSITION', severity: 'error',
        message: `Change "${change.id}" is "planned" but missing prerequisites: ${missing.join(', ')}` })
  
  if change.status == 'in_progress':
    // Check depends_on targets are all resolved
    for dep in change.depends_on:
      depRecord = index.records.get(dep)
      if depRecord and depRecord.status != 'applied':
        issues.push({ code: 'BROKEN_DEPENDS_ON', severity: 'error',
          message: `Change "${change.id}" is "in_progress" but depends_on "${dep}" is "${depRecord.status}"` })
  
  return issues
```

#### Correctness: Drift Detection by Status

Per overview.md section 11.4, drift between vault and code is acceptable during active work but is an error in completed state. Since v1 operates on vault-level verification only (no codebase scanning), drift detection checks whether the Change's Delta Summary is consistent with the current Feature state relative to the Change's status.

```
function checkDriftForStatus(
  change: IndexRecord,
  index: VaultIndex,
  coveredByMatrix?: Set<string>  // V3-1 fix: set of "featureId::reqName" already checked by operation validation
): VerifyIssue[]
  issues = []

  // Only meaningful for changes that have a Delta Summary
  if change.delta_summary.length == 0:
    return issues

  for entry in change.delta_summary:
    if entry.target_type != 'requirement': continue

    // V3-1 fix: skip requirements already covered by runOperationValidationMatrix().
    // For applied Changes, the operation validation matrix produces the same checks
    // (ADDED missing, REMOVED still exists, MODIFIED unchanged) with more specific
    // issue codes (DELTA_MISMATCH_ADDED, etc.) and appropriate severities.
    // Without this skip, the report would contain duplicate issues with conflicting
    // severity signals (e.g., MODIFIED_NO_CHANGE is a warning in the matrix but
    // EXCESSIVE_DRIFT is an error here).
    entryKey = `${entry.target_note_id}::${entry.target_name}`
    if coveredByMatrix and coveredByMatrix.has(entryKey):
      continue

    featureRecord = index.records.get(entry.target_note_id)
    if featureRecord is null: continue  // caught by ref resolution

    existingReq = featureRecord.requirements.find(r => r.name == entry.target_name)

    switch change.status:
      case 'proposed':
        // Drift is expected. No check needed.
        break

      case 'planned':
        // Drift is tolerated but worth noting if base_fingerprint has gone stale.
        // Stale base is already caught by checkStaleBase(). No additional drift check.
        break

      case 'in_progress':
        // Partial drift is allowed. Only flag if the Delta Summary is clearly
        // inconsistent with current state (e.g., ADDED but requirement already exists
        // AND was not added by this change). This overlaps with operation validation,
        // so only produce a warning for awareness.
        break

      case 'applied':
        // Drift is an error. The Feature should reflect the applied changes.
        // NOTE: For applied Changes WITH a Delta Summary, runOperationValidationMatrix()
        // should have already covered these checks. This branch only fires for entries
        // NOT covered by the matrix (e.g., if coveredByMatrix was not passed).
        if entry.op == 'ADDED' and existingReq is null:
          issues.push({ dimension: 'correctness', severity: 'error',
            code: 'EXCESSIVE_DRIFT',
            message: `Change "${change.id}" is applied but ADDED requirement ` +
                     `"${entry.target_name}" is missing from Feature "${entry.target_note_id}"`,
            suggestion: 'Either the Feature was not updated during apply, or the requirement was subsequently removed.' })
        if entry.op == 'REMOVED' and existingReq is not null:
          issues.push({ dimension: 'correctness', severity: 'error',
            code: 'EXCESSIVE_DRIFT',
            message: `Change "${change.id}" is applied but REMOVED requirement ` +
                     `"${entry.target_name}" still exists in Feature "${entry.target_note_id}"`,
            suggestion: 'The Feature was not updated during apply. Re-run apply or update manually.' })
        if entry.op == 'MODIFIED' and existingReq is not null:
          if entry.base_fingerprint and existingReq.content_hash == entry.base_fingerprint:
            issues.push({ dimension: 'correctness', severity: 'error',
              code: 'EXCESSIVE_DRIFT',
              message: `Change "${change.id}" is applied but MODIFIED requirement ` +
                       `"${entry.target_name}" content_hash is unchanged in Feature "${entry.target_note_id}"`,
              suggestion: 'The requirement was not actually modified during apply.' })

  return issues
```

**Deduplication contract:** In the main `verify()` flow, `runOperationValidationMatrix()` runs first for applied Changes. It builds a `Set<string>` of `"featureId::reqName"` keys for every requirement entry it processes. This set is passed to `checkDriftForStatus()` as `coveredByMatrix`. For Changes that do NOT have a Delta Summary (where the matrix can't run), `coveredByMatrix` is empty and drift detection runs in full.

#### Coherence: Description Consistency Check

This check detects contradictions between Feature, Change, Decision, and System descriptions at a structural level. Full semantic contradiction detection would require LLM judgment, which is out of scope for the deterministic verify engine. Instead, v1 checks for concrete structural inconsistencies.

```
function checkDescriptionConsistency(allNotes: IndexRecord[]): VerifyIssue[]
  issues = []

  // Check 1: Feature purpose vs linked Change 'Why' section
  // If a Change says it is removing or deprecating functionality but the linked
  // Feature has status 'active', flag a potential inconsistency.
  features = allNotes.filter(n => n.type == 'feature')
  changes = allNotes.filter(n => n.type == 'change' and n.status != 'applied')

  for change in changes:
    // If a Change has REMOVED ops on all requirements of a Feature,
    // but the Feature is still 'active', flag it
    featureId = change.feature || (change.features?.[0])
    if featureId is null: continue
    feature = features.find(f => f.id == featureId)
    if feature is null: continue

    removedCount = change.delta_summary.filter(
      e => e.op == 'REMOVED' and e.target_note_id == featureId
    ).length
    totalReqs = feature.requirements.length
    if totalReqs > 0 and removedCount == totalReqs and feature.status == 'active':
      issues.push({ dimension: 'coherence', severity: 'warning',
        code: 'CONFLICTING_DESCRIPTIONS',
        message: `Change "${change.id}" removes all requirements from Feature "${featureId}" ` +
                 `but Feature status is still "active"`,
        suggestion: 'Consider whether the Feature should be deprecated after this Change is applied.' })

  // Check 2: Decision status vs Feature status
  // If a Decision is 'archived' but the Feature it links to is 'active' and
  // still references that Decision, flag it.
  decisions = allNotes.filter(n => n.type == 'decision')
  for decision in decisions:
    if decision.status != 'archived': continue
    for featureId in (decision.features || []):
      feature = features.find(f => f.id == featureId)
      if feature and feature.status == 'active' and feature.decisions?.includes(decision.id):
        issues.push({ dimension: 'coherence', severity: 'info',
          code: 'CONFLICTING_DESCRIPTIONS',
          message: `Active Feature "${featureId}" references archived Decision "${decision.id}"`,
          suggestion: 'Consider updating the Feature to reference a current Decision or remove the link.' })

  return issues
```

#### Coherence: Decision Consistency Check

Detects structural conflicts between Decision notes and the Features/Changes they relate to.

```
function checkDecisionConsistency(
  allDecisions: IndexRecord[],
  allFeatures: IndexRecord[]
): VerifyIssue[]
  issues = []

  // Check 1: Two active Decisions linked to the same Feature that address
  // the same topic (detected by shared tags or identical heading names).
  featureDecisionMap = new Map<string, IndexRecord[]>()
  for decision in allDecisions:
    if decision.status == 'archived': continue
    for featureId in (decision.features || []):
      featureDecisionMap.get(featureId) ??= []
      featureDecisionMap.get(featureId).push(decision)

  for [featureId, decisions] of featureDecisionMap:
    if decisions.length < 2: continue
    // Check for heading overlap as a proxy for topic overlap
    for i in range(decisions.length):
      for j in range(i+1, decisions.length):
        sharedHeadings = decisions[i].headings.filter(
          h => decisions[j].headings.includes(h) and h != 'Context' and h != 'Decision'
        )
        sharedTags = decisions[i].tags.filter(t => decisions[j].tags.includes(t))
        if sharedHeadings.length > 0 or sharedTags.length > 1:
          issues.push({ dimension: 'coherence', severity: 'warning',
            code: 'INCONSISTENT_DECISION',
            message: `Decisions "${decisions[i].id}" and "${decisions[j].id}" are both active ` +
                     `and linked to Feature "${featureId}" with overlapping topics ` +
                     `(shared: ${[...sharedHeadings, ...sharedTags].join(', ')})`,
            suggestion: 'Review whether these Decisions conflict or should be consolidated.' })

  // Check 2: A Decision references a Feature that does not link back to the Decision
  for decision in allDecisions:
    for featureId in (decision.features || []):
      feature = allFeatures.find(f => f.id == featureId)
      if feature and not feature.decisions?.includes(decision.id):
        issues.push({ dimension: 'coherence', severity: 'info',
          code: 'INCONSISTENT_DECISION',
          message: `Decision "${decision.id}" references Feature "${featureId}" but ` +
                   `the Feature does not link back to the Decision`,
          suggestion: 'Add the Decision to the Feature frontmatter decisions list.' })

  return issues
```

#### Graceful Degradation

```
function determineAvailableChecks(note: IndexRecord): CheckScope
  scope = { completeness: true, correctness: true, coherence: true }
  skipped = []
  
  // If note has no Requirements section, skip requirement-level checks
  if note.type == 'feature' and note.requirements.length == 0:
    skipped.push({ dimension: 'completeness', check: 'requirement_quality',
                   reason: 'No Requirements section found' })
  
  // If note has no Delta Summary, skip operation validation
  if note.type == 'change' and note.delta_summary.length == 0:
    skipped.push({ dimension: 'correctness', check: 'operation_validation',
                   reason: 'No Delta Summary entries found' })
  
  // If no active changes, skip coherence parallel-conflict checks
  if activeChanges.length < 2:
    skipped.push({ dimension: 'coherence', check: 'parallel_conflict',
                   reason: 'Fewer than 2 active changes -- no conflict possible' })
  
  return { scope, skipped }
```

### File Structure

| File | Responsibility |
|------|----------------|
| `src/verify/verify-engine.ts` | Main `verify()` function. Orchestrates all checks, aggregates results into `VerifyReport`. |
| `src/verify/dimensions/completeness.ts` | `checkFeatureCompleteness()`, `checkChangeCompleteness()`, `checkMinimumSections()` |
| `src/verify/dimensions/correctness.ts` | `checkWikilinkResolution()`, `checkFrontmatterRefResolution()`, `checkStatusTransition()`, `checkSchemaVersionMatch()`, `checkDriftForStatus()` |
| `src/verify/dimensions/coherence.ts` | `checkDependsOnConsistency()`, `checkDescriptionConsistency()` (structural inconsistency detection), `checkDecisionConsistency()` (Decision overlap and backlink validation) |
| `src/verify/vault-integrity.ts` | `duplicateIdCheck()`, `missingIdCheck()`, `unresolvedWikilinkCheck()`, `ambiguousAliasCheck()`, `orphanNoteCheck()`, `archivePlacementCheck()`, `malformedFrontmatterCheck()`, `invalidFrontmatterTypeCheck()` |
| `src/verify/operation-validator.ts` | `runOperationValidationMatrix()` -- pre/post apply checks per Delta Summary entry |
| `src/verify/stale-detector.ts` | `checkStaleBase()` -- base_fingerprint vs content_hash comparison |
| `src/verify/conflict-detector.ts` | `checkConflictsViaSequencing()` -- delegates to sequencing-engine (06), maps results to VerifyIssue format |
| `src/verify/types.ts` | All TypeScript interfaces and types listed above |
| `src/verify/report-formatter.ts` | `formatJson()`, `formatHumanReadable()` -- output formatting |

### Public API / Interface

```typescript
// Main entry point.
// IMPORTANT: All callers (including plan 12's archive() and verifyCommand())
// MUST pass the VaultIndex as the first parameter. verify() is stateless --
// it does NOT build its own index. The caller is responsible for building
// or providing a fresh index via buildIndex(vaultPath).
function verify(index: VaultIndex, options?: VerifyOptions): VerifyReport;

interface VerifyOptions {
  /** Verify only a specific change by id */
  changeId?: string;
  /** Verify only a specific note by id */
  noteId?: string;
  /** Skip coherence checks (faster for single-note verification) */
  skipCoherence?: boolean;
  /** Strict mode: treat warnings as errors */
  strict?: boolean;
}

// Report formatting
function formatVerifyReport(report: VerifyReport, format: 'json' | 'human'): string;

// Individual check functions (exported for unit testing)
function checkFeatureCompleteness(feature: IndexRecord, index: VaultIndex): VerifyIssue[];
function checkChangeCompleteness(change: IndexRecord, index: VaultIndex): VerifyIssue[];
function runOperationValidationMatrix(change: IndexRecord, index: VaultIndex): VerifyIssue[];
function checkStaleBase(change: IndexRecord, index: VaultIndex): VerifyIssue[];
function checkConflictsViaSequencing(activeChanges: IndexRecord[], index: VaultIndex): VerifyIssue[];
function checkDriftForStatus(change: IndexRecord, index: VaultIndex, coveredByMatrix?: Set<string>): VerifyIssue[];
function checkDescriptionConsistency(allNotes: IndexRecord[]): VerifyIssue[];
function checkDecisionConsistency(allDecisions: IndexRecord[], allFeatures: IndexRecord[]): VerifyIssue[];
```

### Dependencies on Other Modules

| Module | What verify needs from it |
|--------|---------------------------|
| `04-index-engine` | `VaultIndex` with `records: Map<string, IndexRecord>`, `schema_version: string`. Access via `records.values()`, `records.get(id)`. |
| `03-vault-parser` | Implicitly through the index -- verify does not parse raw markdown directly |
| `02-note-templates` | Expected fields per note type per schema version (`getExpectedFields()`, `getDeprecatedFields()`) |
| `06-sequencing-engine` | `computeTouchesSeverity()` and `detectRequirementConflicts()` -- verify CALLS these functions and maps results to VerifyIssue. Per ownership rules, verify must not reimplement conflict detection. |

---

## 4. Test Strategy

### Unit Tests

**Completeness dimension:**
- Feature with all sections present -> no issues
- Feature missing Requirements section -> ERROR
- Feature with requirements but no scenarios -> ERROR
- Change missing Why section -> ERROR
- Change missing Delta Summary -> ERROR
- Change with Design Approach absent but complex (many delta entries) -> WARNING
- Change with all sections present -> no issues

**Operation Validation Matrix:**
- ADDED pre-apply: requirement does not exist in Feature -> pass
- ADDED pre-apply: requirement already exists -> ERROR
- ADDED post-apply: requirement exists -> pass
- ADDED post-apply: requirement missing -> ERROR
- MODIFIED pre-apply: requirement exists -> pass
- MODIFIED pre-apply: requirement missing -> ERROR
- MODIFIED post-apply: content_hash unchanged -> WARNING
- REMOVED pre-apply: requirement exists -> pass
- REMOVED post-apply: requirement still exists -> ERROR
- RENAMED pre-apply: old exists, new does not -> pass
- RENAMED post-apply: old gone, new exists -> pass

**Stale detection:**
- base_fingerprint matches current content_hash -> no issue
- base_fingerprint mismatches -> STALE_BASE ERROR
- ADDED entry (no base_fingerprint expected) -> skip
- Missing base_fingerprint on MODIFIED -> WARNING

**Conflict detection:**
- Two changes touching different features -> parallel_safe (no issues)
- Two changes touching same system but different features -> needs_review WARNING
- Two changes touching same feature -> conflict_candidate ERROR
- Two changes MODIFY same requirement -> conflict_critical ERROR
- One MODIFY + one REMOVE same requirement -> conflict_critical ERROR
- ADD + ADD same requirement name -> conflict_critical ERROR

**Vault integrity:**
- Duplicate id across two files -> ERROR
- Wikilink pointing to non-existent note -> ERROR
- Note with no links in or out -> WARNING (orphan)
- Change in 99-archive/ with status != 'applied' -> ERROR
- Ambiguous alias matching two notes -> ERROR

### Integration Tests

- Full vault with valid structure -> verify returns `passed: true`
- Vault with mixed issues across all dimensions -> report correctly aggregates
- Verify with `changeId` option filters to that change only
- Verify with `strict: true` treats warnings as errors
- Graceful degradation: vault with Feature that has no Requirements section -> skipped check recorded, no crash

### Edge Cases

- Empty vault (only 00-meta files) -> passes with INFO about empty vault
- Single Feature, no Changes -> completeness only, no coherence conflict checks
- Change referencing deleted Feature (Feature file removed) -> UNRESOLVED_WIKILINK + INVALID_FRONTMATTER_REF
- Circular depends_on (A depends on B, B depends on A) -> BROKEN_DEPENDS_ON for both

---

## 5. Implementation Order

1. **types.ts** -- Define all interfaces first. No dependencies.
2. **vault-integrity.ts** -- Standalone checks that only need VaultIndex. Start with `duplicateIdCheck`, `unresolvedWikilinkCheck`, `orphanNoteCheck`.
3. **completeness.ts** -- Section-presence checks. Needs note-templates for expected sections.
4. **operation-validator.ts** -- Delta Summary matrix checks. Needs index for Feature record lookup.
5. **stale-detector.ts** -- base_fingerprint comparison. Needs index.
6. **correctness.ts** -- Wikilink/ref resolution, status transition, schema match. Needs index + schema version.
7. **conflict-detector.ts** -- Touches overlap + requirement-level conflicts. Needs all active Changes from index.
8. **coherence.ts** -- Cross-note consistency. Needs all notes from index.
9. **verify-engine.ts** -- Main orchestrator that calls all the above. Wire up graceful degradation.
10. **report-formatter.ts** -- JSON and human-readable formatting. Can be done in parallel with 9.

**Prerequisites from other plans:**
- Requires plan 04 (index-engine) for `VaultIndex` interface
- Requires plan 02 (note-templates) for expected fields per type/version
- Requires plan 03 (vault-parser) to be working so the index has data
- Requires plan 06 (sequencing-engine) for `computeTouchesSeverity()` and `detectRequirementConflicts()`
