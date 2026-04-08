# Unified Type Definitions

This document is the canonical type reference for all plan files. When any plan file defines a type that conflicts with this document, this document wins.

## Note Types

```typescript
type NoteType = 'feature' | 'change' | 'system' | 'decision' | 'source' | 'query';
type ChangeStatus = 'proposed' | 'planned' | 'in_progress' | 'applied';
type FeatureStatus = 'active' | 'deprecated';
type GeneralStatus = 'active' | 'draft' | 'archived';
```

## Frontmatter Schemas

```typescript
interface BaseFrontmatter {
  type: NoteType;
  id: string;              // immutable after creation
  status: string;
  tags: string[];
}

interface FeatureFrontmatter extends BaseFrontmatter {
  type: 'feature';
  status: FeatureStatus;
  systems: string[];       // wikilinks to System notes
  sources: string[];       // wikilinks to Source notes
  decisions: string[];     // wikilinks to Decision notes
  changes: string[];       // wikilinks to Change notes
}

interface ChangeFrontmatter extends BaseFrontmatter {
  type: 'change';
  status: ChangeStatus;
  created_at: string;      // ISO date YYYY-MM-DD, required for deterministic ordering
  feature?: string;        // singular wikilink (default)
  features?: string[];     // plural wikilinks (cross-cutting only, mutually exclusive with feature)
  depends_on: string[];    // wikilinks to other Change notes
  touches: string[];       // wikilinks to Feature/System notes (impact surface)
  systems: string[];
  sources: string[];
  decisions: string[];
}

interface SystemFrontmatter extends BaseFrontmatter {
  type: 'system';
  status: GeneralStatus;
}

interface DecisionFrontmatter extends BaseFrontmatter {
  type: 'decision';
  status: GeneralStatus;
  features: string[];
  changes: string[];
}

interface SourceFrontmatter extends BaseFrontmatter {
  type: 'source';
  status: GeneralStatus;
}

interface QueryFrontmatter extends BaseFrontmatter {
  type: 'query';
  status: GeneralStatus;
  question?: string;         // the original question or investigation prompt
  consulted?: string[];      // wikilinks to notes consulted during investigation
  features?: string[];       // wikilinks to related Feature notes
  systems?: string[];        // wikilinks to related System notes
}

type Frontmatter =
  | FeatureFrontmatter
  | ChangeFrontmatter
  | SystemFrontmatter
  | DecisionFrontmatter
  | SourceFrontmatter
  | QueryFrontmatter;
```

## Requirement

```typescript
interface Requirement {
  /** Stable name from `### Requirement: <name>` header */
  name: string;
  /** Composite key: `${feature_id}::${name}` */
  key: string;
  /** Normative statement containing SHALL or MUST */
  normative: string;
  /** Array of scenario objects */
  scenarios: Scenario[];
  /** SHA-256 hash of normalized (normative + scenarios) body */
  content_hash: string;
}

interface Scenario {
  /** Name from `#### Scenario: <name>` header */
  name: string;
  /** Raw text of the scenario (WHEN/THEN lines) */
  raw_text: string;
}
```

## Delta Summary Entry

```typescript
type DeltaOp = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
type DeltaTargetType = 'requirement' | 'section';

interface DeltaSummaryEntry {
  op: DeltaOp;
  target_type: DeltaTargetType;
  /** Name of the requirement or section */
  target_name: string;
  /** For RENAMED: the new name */
  new_name?: string;
  /** Wikilink-resolved feature/note id */
  target_note_id: string;
  /** SHA-256 hash of the target at time of writing. null for ADDED. */
  base_fingerprint: string | null;
  /** Free-text description of the change */
  description?: string;
}
```

## Task Item

```typescript
interface TaskItem {
  /** Raw markdown text of the task */
  text: string;
  /** Whether the checkbox is checked */
  done: boolean;
}
```

## Index Record

```typescript
interface IndexRecord {
  schema_version: string;
  id: string;
  type: NoteType;
  title: string;
  aliases: string[];
  path: string;               // relative to vault root
  status: string;
  created_at?: string;        // only for Change
  tags: string[];

  // Relationship fields (wikilink-resolved to ids)
  systems: string[];
  sources: string[];
  decisions: string[];
  changes: string[];
  feature?: string;            // Change: singular target
  features?: string[];         // Change: plural targets
  depends_on: string[];
  touches: string[];

  // Graph fields
  links_out: string[];         // all outgoing wikilink targets (resolved to ids)
  links_in: string[];          // computed reverse index

  // Content fields
  headings: string[];
  requirements: Requirement[]; // only meaningful for Feature
  delta_summary: DeltaSummaryEntry[]; // only meaningful for Change
  tasks: TaskItem[];           // only meaningful for Change
  raw_text: string;
  content_hash: string;        // SHA-256 of entire note body
}
```

## Vault Index

```typescript
interface VaultIndex {
  schema_version: string;
  scanned_at: string;         // ISO timestamp
  records: Map<string, IndexRecord>; // keyed by id
  warnings: IndexWarning[];
}

interface IndexWarning {
  type: 'duplicate_id' | 'unresolved_wikilink' | 'ambiguous_alias' |
        'missing_id' | 'schema_mismatch' | 'invalid_frontmatter';
  note_path: string;
  message: string;
}
```

## Retrieval Types

```typescript
interface RetrievalQuery {
  intent: 'add' | 'modify' | 'remove' | 'query';
  summary: string;
  feature_terms: string[];
  system_terms: string[];
  entity_terms: string[];
  status_bias: string[];  // defaults per intent (see overview.md 10.4)
}

type Classification = 'existing_change' | 'existing_feature' | 'new_feature' | 'needs_confirmation';
type Confidence = 'high' | 'medium' | 'low';

interface ScoredCandidate {
  id: string;
  type: NoteType;
  title: string;
  score: number;
  reasons: string[];
}

interface SequencingSummary {
  status: 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'conflict_critical' | 'blocked';
  related_changes: string[];
  reasons: string[];
}

interface RetrievalResult {
  query: string;
  classification: Classification;
  confidence: Confidence;
  sequencing: SequencingSummary;
  candidates: ScoredCandidate[];
  warnings: string[];
}
```

## Sequencing Types

```typescript
type TouchesSeverity = 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'blocked';
type RequirementConflictSeverity = 'conflict_critical';

/**
 * ConflictOp extends DeltaOp with a pseudo-op for the new-name side of RENAMED.
 * Only used in conflict detection; does NOT appear in DeltaSummaryEntry.op.
 */
type ConflictOp = DeltaOp | 'RENAMED_TO';

// ── Per-change view (used by consumers like retrieval, verify) ──

interface PerChangeSequencingResult {
  change_id: string;
  overall_severity: TouchesSeverity | RequirementConflictSeverity;
  touches_overlaps: TouchesOverlap[];
  requirement_conflicts: RequirementConflict[];
  blocked_by: string[];        // unresolved depends_on targets
  ordering_position?: number;  // position in deterministic order
}

interface TouchesOverlap {
  other_change_id: string;
  shared_surface: string;      // Feature or System id
  severity: TouchesSeverity;
}

interface RequirementConflict {
  other_change_id: string;
  feature_id: string;
  requirement_name: string;
  this_op: ConflictOp;
  other_op: ConflictOp;
}

// ── Aggregate analysis (produced by sequencing engine, plan 06) ──

interface TouchesSeverityResult {
  severity: TouchesSeverity;
  change_a: string;
  change_b: string;
  overlapping_features: string[];
  overlapping_systems: string[];
  reasons: string[];
}

interface RequirementConflictPair {
  change_a: string;
  change_b: string;
  feature_id: string;
  requirement_name: string;
  this_op: ConflictOp;
  other_op: ConflictOp;
  reason: string;
}

interface OrderedChange {
  id: string;
  depth: number;               // topological depth (0 = no dependencies)
  position: number;            // global position in order
  blocked_by: string[];        // IDs of incomplete dependencies
  conflicts_with: string[];    // IDs of conflicting changes
}

interface CycleError {
  cycle: string[];             // IDs forming the cycle
  message: string;
}

interface StaleBaseEntry {
  change_id: string;
  delta_entry: DeltaSummaryEntry;
  expected_hash: string;       // base_fingerprint from delta
  actual_hash: string;         // current content_hash from index
  feature_id: string;
  requirement_key: string;     // composite key: feature_id::requirement_name
}

interface OutOfOrderError {
  change_id: string;            // the change that jumped ahead
  change_status: string;        // current status (in_progress | applied)
  dependency_id: string;        // the dependency that is behind
  dependency_status: string;    // current status of the dependency
  message: string;
}

interface SequencingResult {
  status: TouchesSeverity | RequirementConflictSeverity;
  pairwise_severities: TouchesSeverityResult[];
  requirement_conflicts: RequirementConflictPair[];
  ordering: OrderedChange[];
  cycles: CycleError[];
  stale_bases: StaleBaseEntry[];
  out_of_order_errors: OutOfOrderError[];
  reasons: string[];
  related_changes: string[];
}
```

## Verify Types

```typescript
type IssueSeverity = 'error' | 'warning' | 'info';
type VerifyDimension = 'completeness' | 'correctness' | 'coherence' | 'vault_integrity';

interface VerifyIssue {
  dimension: VerifyDimension;
  severity: IssueSeverity;
  code: string;                // e.g. "V001", "V042"
  message: string;
  note_path?: string;
  note_id?: string;
  suggestion?: string;
}

interface VerifyReport {
  scanned_at: string;
  total_notes: number;
  issues: VerifyIssue[];
  summary: Record<VerifyDimension, { errors: number; warnings: number; info: number }>;
  pass: boolean;               // true if zero errors
}
```

## Next-Action Types

```typescript
type NextActionType =
  | 'fill_section'
  | 'transition'
  | 'start_implementation'
  | 'continue_task'
  | 'blocked'
  | 'ready_to_apply'
  | 'verify_then_archive';

interface NextAction {
  action: NextActionType;
  target?: string;             // section name or task text
  to?: ChangeStatus;           // target status for transition
  reason?: string;             // for blocked
  blockers?: string[];         // for blocked
}
```

## Ownership Rules

| Concern | Owner Module | Not Allowed In |
|---------|-------------|----------------|
| Status transition (proposed→planned) | workflow-propose (07) or workflow-continue (08) | workflow-apply (09) |
| Status transition (planned→in_progress) | workflow-continue (08) | workflow-apply (09) |
| Status transition (in_progress→applied) | workflow-apply (09) | workflow-continue (08) |
| Conflict detection (touches) | sequencing-engine (06) | workflow-verify (10) — must call, not reimplement |
| Conflict detection (requirement-level) | sequencing-engine (06) | workflow-verify (10) — must call, not reimplement |
| Note parsing | vault-parser (03) | index-engine (04) — must call, not reimplement |
| Index building | index-engine (04) | retrieval-engine (05) — receives VaultIndex |
| Classification (scoring → classification) | retrieval-engine (05) | workflow-propose (07) — must consume, not reimplement |
| Sequencing analysis | sequencing-engine (06) | workflow-propose (07) — calls analyzeSequencing(), receives SequencingResult |
| Sequencing delegation in verify | sequencing-engine (06) | workflow-verify (10) — calls analyzeSequencing(), maps to VerifyIssue |
| checkDependsOn in continue | sequencing-engine (06) | workflow-continue (08) — must call, not reimplement |

## Parser↔Index API Boundary

```typescript
// vault-parser (03) exports:
function parseNote(filePath: string): ParseResult;
// Reads the file at filePath, parses frontmatter/sections/wikilinks/requirements/delta-summary.
// Returns ParseResult with raw wikilinks (not resolved to ids).
// Also exports:
function stripWikilinkSyntax(wikilink: string): string;
// Strips [[...]] syntax, returns the display text or target.
// Also exports (for lightweight schema version reading):
function extractFrontmatter(content: string): { raw: RawFrontmatter | null; errors: ParseError[] };
// Parses YAML frontmatter from a markdown string without full note parsing.

// index-engine (04) uses:
function buildIndex(vaultPath: string): VaultIndex;
// internally calls parseNote(filePath) for each .md file, then:
// - resolves wikilinks to ids (using stripWikilinkSyntax + title/alias lookup)
// - computes links_in (reverse index)
// - computes requirement composite keys (feature_id::name)
// - detects duplicate ids
// - checks schema version

// index-engine does NOT re-parse frontmatter or sections.
// It only transforms ParseResult[] → VaultIndex.
```

## Retrieval↔Workflow API Boundary

```typescript
// retrieval-engine (05) exports:
function retrieve(index: VaultIndex, query: RetrievalQuery, options?: { sequencing?: SequencingResult }): RetrievalResult;
// Performs lexical retrieval, graph expansion, scoring, AND classification.
// Returns fully classified RetrievalResult.
// Classification ownership is HERE, not in the workflow layer.

// workflow-propose (07) consumes:
// 1. Calls sequencingEngine.analyzeSequencing(index, activeChanges) → SequencingResult
// 2. Calls retrievalEngine.retrieve(index, query, { sequencing }) → RetrievalResult
// 3. Reads result.classification — does NOT re-classify
// 4. Executes post-classification action (create/update/continue)

// workflow-verify (10) consumes:
// 1. Calls sequencingEngine.analyzeSequencing(index, activeChanges) → SequencingResult
// 2. Maps SequencingResult fields to VerifyIssue[] — does NOT reimplement detection logic

// workflow-continue (08) consumes:
// 1. Calls sequencingEngine.analyzeSequencing(index, [thisChange]) for depends_on checks
// 2. Does NOT reimplement checkDependsOn()
```
