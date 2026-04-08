# Project Structure Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec is a Node.js CLI tool built with TypeScript. It uses a standard ESM module system with `commander` for CLI routing, `zod` for schema validation, and a custom build pipeline that shells out to `tsc`. The project is structured as a monolithic package published to npm under `@fission-ai/openspec`.

### Key Source Files

| File | Role |
|------|------|
| `package.json` | ESM module config, dependencies, scripts, bin entry |
| `tsconfig.json` | TypeScript config: ES2022 target, NodeNext module resolution, strict mode |
| `build.js` | Custom build script: cleans `dist/`, runs `tsc` |
| `eslint.config.js` | Flat ESLint config with typescript-eslint |
| `src/index.ts` | Package entry: re-exports `cli/` and `core/` |
| `src/cli/index.ts` | CLI entry: all `commander` route definitions, option parsing, telemetry hooks |
| `src/core/index.ts` | Core barrel: re-exports global config utilities |
| `src/core/config.ts` | Constants: `OPENSPEC_DIR_NAME`, AI tool registry, marker comments |

### Core Algorithm / Flow

OpenSpec operates on a fixed filesystem convention:

```
project/
  openspec/
    specs/           # Source-of-truth spec documents
      auth/
        spec.md
    changes/         # Active change proposals
      add-dark-mode/
        proposal.md
        design.md
        tasks.md
        .openspec.yaml
        specs/       # Delta specs
          auth/
            spec.md
      archive/       # Completed changes
    schemas/         # Workflow schema definitions (YAML)
```

The architecture is layered:

```
CLI Layer (src/cli/index.ts)
  - 400+ line Commander program
  - All commands registered in one file
  - telemetry hooks (preAction/postAction)

Command Handlers (src/commands/)
  - spec.ts, change.ts, validate.ts, show.ts
  - workflow/: status, instructions, apply, templates, schemas, new-change

Core Layer (src/core/)
  - parsers/: MarkdownParser, ChangeParser, requirement-blocks
  - schemas/: Zod schemas for Spec, Change, Delta, Requirement, Scenario
  - validation/: constants, types, validator
  - artifact-graph/: SchemaYaml, Artifact DAG, completion state, instruction loader
  - init.ts, archive.ts, list.ts, view.ts, update.ts
```

Key flows:
1. **Parse**: Read markdown -> split into Sections -> extract Requirements/Deltas
2. **Validate**: Parse -> apply Zod schema -> check constraints
3. **Archive**: Validate change -> merge delta sections into main spec -> move to archive/
4. **Status**: Read artifact-graph schema -> check which artifacts exist -> show completion

Dependencies (runtime):
- `commander` (CLI), `zod` (validation), `yaml` (YAML parsing), `chalk` (colors), `ora` (spinners), `fast-glob` (file scanning), `@inquirer/prompts` (interactive prompts)

Dependencies (dev):
- `vitest` (testing), `typescript` (compiler), `eslint` (linting), `typescript-eslint` (TypeScript ESLint rules)

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

- **Section 18**: New-repo-based hybrid extraction, not a fork. Design architecture from scratch in Obsidian-first way.
- **Section 9.4**: v1 targets Claude Code only. No broad multi-runtime compatibility.
- **Section 6.D**: Plain Vault Mode -- reads/writes markdown/frontmatter/wikilinks directly from vault directory. No Obsidian app dependency.
- **Section 10.1**: Canonical data lives in raw vault markdown. Index is disposable derived cache.
- **Section 10.2**: Fresh vault scan at start of `propose`, `query`, `verify`. Default is in-memory index.
- **Section 12**: The product is a "code management wiki workflow engine", not just document templates.

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec | Why |
|--------|---------|----------------|-----|
| Storage model | Fixed filesystem directories (`specs/`, `changes/`) | Obsidian vault with typed notes, frontmatter, wikilinks | Graph-based knowledge layer |
| Module scope | Monolithic CLI with 20+ AI tool adapters | Focused engine library + thin CLI, Claude Code only | Reduce scope, stabilize one environment first |
| Parsing target | Markdown sections only (no frontmatter) | YAML frontmatter + markdown sections + wikilinks | Notes need typed metadata |
| Index strategy | None (read filesystem each time) | In-memory index rebuilt per operation (10.2) | Faster retrieval, scoring, graph traversal |
| Artifact model | DAG of file-based artifacts per change | Section-completeness checks on single Change note | Simpler, no DAG needed (overview 15) |
| Build system | Custom `build.js` calling `tsc` | Standard `tsc` via npm scripts | Simpler toolchain |
| Schema validation | Zod schemas for spec/change only | Zod schemas for 6 note types + frontmatter | More note types, same validation approach |
| Identity model | Filesystem path is identity | Frontmatter `id` is canonical identity (immutable) | Survives rename/move (overview 11.1) |
| CLI binary name | `openspec` | `ows` (open-wiki-spec) | Distinct identity |

### Contracts to Satisfy

1. **Vault is the single source of truth** (10.1) -- all canonical data in raw vault markdown
2. **Index is disposable cache** (10.1) -- reconstructable by rescanning raw markdown
3. **Fresh scan per operation** (10.2) -- `propose`, `query`, `verify` trigger full vault scan
4. **6 note types parseable into index records** (10.3) -- Feature, Change, System, Decision, Source, Query
5. **Wikilink/alias -> ID normalization** (10.7) -- humans write `[[wikilinks]]`, machines use `id`
6. **Schema version tracking** (10.1.1) -- `wiki/00-meta/schema.md` declares current schema version
7. **v1 = Claude Code only** (9.4) -- no multi-runtime abstraction

---

## 3. Implementation Plan

### Package.json Bin Mapping

The CLI binary name is `ows`. The `bin` field in `package.json` maps this name to the entry point file:

```json
{
  "bin": {
    "ows": "./bin/open-wiki-spec.js"
  }
}
```

### Operational Files Format

overview.md references operational files in `wiki/00-meta/`. Their formats are defined here.

**Important**: These files do NOT have typed frontmatter and are NOT note types. The vault-scanner (Plan 04) must skip `wiki/00-meta/index.md`, `log.md`, and `schema.md` when calling `parseNote()`, or handle them separately. Only `schema.md` has YAML frontmatter (for `schema_version`); the others are plain markdown. Passing them to `parseNote()` would produce spurious errors.

#### `schema.md`

Declares the current schema version for the vault. Format defined in overview.md Section 10.1.1. The engine reads this file to determine which schema rules to apply during parsing and validation.

```markdown
---
schema_version: "1.0.0"
---

# Schema

Current version: 1.0.0

## Note Types

| Type | Status Values | Required Frontmatter |
|------|---------------|---------------------|
| feature | active, deprecated | type, id, status, tags, systems |
| change | proposed, planned, in_progress, applied | type, id, status, tags, created_at, feature/features |
| system | active, draft, archived | type, id, status, tags |
| decision | active, draft, archived | type, id, status, tags |
| source | active, draft, archived | type, id, status, tags |
| query | active, draft, archived | type, id, status, tags |

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | YYYY-MM-DD | Initial schema |
```

#### `index.md`

Operational index file following the Karpathy wiki pattern. The engine reads this file during vault scan. It provides a human-readable summary of all notes in the vault, organized by type.

```markdown
# Wiki Index

## Features
- [[Feature: <name>]] — <one-line summary>

## Systems
- [[System: <name>]] — <one-line summary>

## Active Changes
- [[Change: <name>]] (status) — <one-line summary>

## Decisions
- [[Decision: <name>]] — <one-line summary>

## Sources
- [[Source: <name>]] — <one-line summary>

## Queries
- [[Query: <name>]] — <one-line summary>
```

#### `log.md`

Operational log file following the Karpathy wiki pattern. Records significant vault events in reverse chronological order. The engine appends entries when changes are applied.

```markdown
# Wiki Log

## YYYY-MM-DD
- Applied [[Change: <name>]]: <summary of what changed>
- Created [[Feature: <name>]]
```

### Architecture Overview

open-wiki-spec is structured as a layered engine with clear module boundaries. Each layer depends only on layers below it, never sideways or upward.

```
CLI (thin commander wrappers)
 |
Workflow (propose, continue, apply, verify, query)
 |
Retrieval + Sequencing
 |
Index Engine
 |
Parser + Schema Validation
 |
Vault I/O
 |
Utils / Types
```

Top-level directory structure:

```
open-wiki-spec/
  package.json
  tsconfig.json
  vitest.config.ts
  eslint.config.js
  .gitignore
  bin/
    open-wiki-spec.js       # Shebang entry point
  src/
    cli/                    # Thin CLI layer
    core/                   # All business logic
      vault/                # Vault file I/O
      parser/               # Frontmatter + markdown + wikilink parsing
      schema/               # Zod schemas for 6 note types
      index/                # In-memory index builder + store
      retrieval/            # Similarity scan, scoring, classification
      sequencing/           # depends_on, touches, conflict detection
      workflow/             # propose, continue, apply, verify, query
      config/               # Project config, schema version
    types/                  # Shared TypeScript type definitions
    utils/                  # Pure utility functions
  tests/                    # Vitest tests mirroring src/ structure
    fixtures/               # Test vault fixtures
```

### Data Structures

```typescript
// ──────────────────────────────────────────────
// src/types/note.ts -- Core note representation
// ──────────────────────────────────────────────

/** Discriminated union of all note types */
type NoteType = 'feature' | 'change' | 'system' | 'decision' | 'source' | 'query';
type ChangeStatus = 'proposed' | 'planned' | 'in_progress' | 'applied';

/** Parsed frontmatter common to all note types (matches 00-unified-types.md) */
interface BaseFrontmatter {
  type: NoteType;
  id: string;              // immutable after creation
  status: string;
  tags: string[];          // required per 00-unified-types.md
}

/**
 * Complete parse result for a single note.
 * Matches Plan 03's ParseResult definition exactly.
 * See 03-vault-parser.md for the canonical definition.
 */
interface ParseResult {
  frontmatter: Frontmatter | null;        // validated frontmatter (null if invalid)
  rawFrontmatter: Record<string, unknown> | null;
  sections: Section[];                     // parsed heading tree
  headings: string[];                      // flat list of heading titles
  wikilinks: WikilinkOccurrence[];         // extracted [[links]] from both frontmatter and body
  requirements: Requirement[];             // Feature notes only
  deltaSummary: DeltaSummaryEntry[];       // Change notes only
  tasks: TaskItem[];                       // Change notes only
  body: string;                            // markdown without frontmatter
  contentHash: string;                     // SHA-256 of body
  errors: ParseError[];                    // errors encountered during parsing
}

/** A section in the heading hierarchy (matches Plan 03 Section) */
interface Section {
  level: number;           // 1-6
  title: string;
  content: string;         // text between this heading and the next heading at same or higher level
  line: number;            // line number of the heading (1-indexed)
  children: Section[];
}

/** A wikilink occurrence in the document (matches Plan 03 WikilinkOccurrence) */
interface WikilinkOccurrence {
  target: string;          // "Feature: Auth Login" (without brackets)
  alias: string | null;    // display alias if [[target|alias]]
  location: 'frontmatter' | 'body';
  line: number;            // line number (1-indexed)
}
```

```typescript
// ──────────────────────────────────────────────
// src/types/index-record.ts -- Follows 00-unified-types.md
// ──────────────────────────────────────────────

/**
 * All types below follow 00-unified-types.md as the canonical reference.
 * When any type here conflicts with unified types, unified types win.
 */

interface IndexRecord {
  schema_version: string;
  id: string;
  type: NoteType;
  title: string;
  aliases: string[];
  path: string;               // relative to vault root
  status: string;
  created_at?: string;        // only for Change (ISO date YYYY-MM-DD)
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

/** Requirement identity: composite key = feature_id + "::" + name */
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

interface DeltaSummaryEntry {
  op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  target_type: 'requirement' | 'section';
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

interface TaskItem {
  /** Raw markdown text of the task */
  text: string;
  /** Whether the checkbox is checked */
  done: boolean;
}
```

```typescript
// ──────────────────────────────────────────────
// src/types/query.ts -- Retrieval types (overview 10.4, 10.5, 10.6)
// ──────────────────────────────────────────────

/**
 * Follows 00-unified-types.md RetrievalQuery.
 */
interface QueryObject {
  intent: 'add' | 'modify' | 'remove' | 'query';  // constrained enum per unified types
  summary: string;
  feature_terms: string[];
  system_terms: string[];
  entity_terms: string[];
  status_bias: string[];   // defaults per intent (see overview.md 10.4)
}

interface ScoredCandidate {
  id: string;
  type: NoteType;
  title: string;
  score: number;
  reasons: string[];
}

type Classification = 'existing_change' | 'existing_feature' | 'new_feature' | 'needs_confirmation';

interface ClassificationResult {
  query: string;
  classification: Classification;
  confidence: 'high' | 'medium' | 'low';
  sequencing: SequencingResult;
  candidates: ScoredCandidate[];
  warnings: string[];
}

/**
 * Follows 00-unified-types.md SequencingSummary.
 * Includes 'conflict_critical' for requirement-level conflicts.
 */
type SequencingSeverity = 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'conflict_critical' | 'blocked';

interface SequencingResult {
  status: SequencingSeverity;
  related_changes: string[];
  reasons: string[];
}
```

```typescript
// ──────────────────────────────────────────────
// src/types/workflow.ts -- Workflow operation types
// ──────────────────────────────────────────────

type NextActionType = 'fill_section' | 'transition' | 'start_implementation' | 'continue_task' | 'blocked' | 'ready_to_apply' | 'verify_then_archive';

/**
 * Follows 00-unified-types.md NextAction.
 */
interface NextAction {
  action: NextActionType;
  target?: string;             // section name or task text
  to?: ChangeStatus;           // target status for transition (constrained to ChangeStatus)
  reason?: string;             // for blocked
  blockers?: string[];         // for blocked
}

/**
 * Verify types follow 00-unified-types.md VerifyIssue/VerifyReport shape.
 */
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

interface ApplyResult {
  success: boolean;
  updatedNotes: string[];  // paths of notes that were modified
  errors: string[];
}
```

### Core Algorithm

The core flow for a typical `propose` operation (the most complex workflow):

```
1. User provides a request string
2. CLI calls workflow/propose.ts
3. propose():
   a. indexEngine.buildIndex(vaultRoot) -> VaultIndex
      - Scan wiki/**/*.md
      - For each file: parser.parseNote(filePath) -> ParseResult
      - Resolve all wikilinks to IDs (link-resolver)
      - Compute links_in as reverse of links_out
      - Hash content for each note and requirement
      - Compute requirement composite keys (feature_id::name)
   b. queryNormalizer.normalize(request) -> RetrievalQuery
   c. sequencingEngine.analyzeSequencing(index, activeChanges) -> SequencingResult
   d. sequencingEngine.summarizeForRetrieval(sequencingResult) -> SequencingSummary
   e. retrievalEngine.retrieve(index, query, { sequencing }) -> RetrievalResult
      - Lexical retrieval + graph expansion + scoring + classification
   f. Based on result.classification:
      - existing_change: return change to continue
      - existing_feature: create new Change linked to Feature
      - new_feature: create Feature, then Change
      - needs_confirmation: return candidates for user choice
   g. Return result to CLI for output
```

### File Structure

```
open-wiki-spec/
  package.json
  tsconfig.json
  vitest.config.ts
  eslint.config.js
  .gitignore
  bin/
    open-wiki-spec.js
  src/
    index.ts                          # Library API exports
    cli/
      index.ts                        # Commander program
      commands/
        init.ts
        propose.ts
        continue.ts
        apply.ts
        verify.ts
        query.ts
        status.ts
    core/
      vault/
        vault-reader.ts               # scanNotes(), readNote()
        vault-writer.ts               # writeNote(), moveNote()
        index.ts
      parser/
        frontmatter-parser.ts         # YAML frontmatter extraction
        section-parser.ts             # Heading hierarchy builder
        wikilink-parser.ts         # [[wikilink]] extraction
        requirement-parser.ts         # ### Requirement: block parsing
        delta-summary-parser.ts       # ## Delta Summary line parsing
        task-parser.ts                # Checkbox parsing
        note-parser.ts                # Orchestrator combining sub-parsers
        index.ts
      schema/
        base.schema.ts                # Common frontmatter Zod schema
        feature.schema.ts
        change.schema.ts
        system.schema.ts
        decision.schema.ts
        source.schema.ts
        query.schema.ts
        validation-messages.ts        # Centralized error messages
        index.ts
      index/
        index-builder.ts              # Full vault -> IndexRecord[] pipeline
        index-store.ts                # In-memory queryable store
        link-resolver.ts              # Wikilink -> ID normalization (overview 10.7)
        content-hasher.ts             # SHA-256 hashing
        index.ts
      retrieval/
        query-normalizer.ts           # Request -> QueryObject
        scorer.ts                     # Multi-signal scoring
        classifier.ts                 # Score -> classification
        retrieval-engine.ts           # Orchestrator
        index.ts
      sequencing/
        sequencing-engine.ts          # depends_on/touches conflict detection
        topological-sort.ts           # Deterministic change ordering
        index.ts
      workflow/
        propose.ts                    # Preflight + similarity scan + create/continue
        continue.ts                   # Next-action + section filling
        apply.ts                      # base_fingerprint check + atomic delta apply
        verify.ts                     # 3-dimension + vault integrity checks
        query.ts                      # Search + optional Query note creation
        next-action.ts                # Deterministic next-action calculator
        index.ts
      config/
        project-config.ts             # Vault root detection, wiki/00-meta/ reading
        schema-version.ts             # schema.md parsing
        conventions.ts                # conventions.md reading
        index.ts
    types/
      note.ts
      index-record.ts
      query.ts
      workflow.ts
      index.ts
    utils/
      hash.ts                         # SHA-256 content hashing
      normalize.ts                    # String normalization utilities
      id-generator.ts                 # Deterministic ID generation
      index.ts
  tests/
    fixtures/
      valid-vault/                    # Complete vault with all 6 note types
        wiki/
          00-meta/
            index.md
            log.md
            schema.md
            conventions.md
          01-sources/
          02-systems/
          03-features/
          04-changes/
          05-decisions/
          06-queries/
          99-archive/
      invalid-vault/                  # Vault with intentional errors
      notes/                          # Individual .md fixture files
    core/
      vault/
        vault-reader.test.ts
        vault-writer.test.ts
      parser/
        frontmatter-parser.test.ts
        section-parser.test.ts
        wikilink-extractor.test.ts
        requirement-parser.test.ts
        delta-summary-parser.test.ts
        task-parser.test.ts
        note-parser.test.ts
      schema/
        feature.schema.test.ts
        change.schema.test.ts
        system.schema.test.ts
        decision.schema.test.ts
        source.schema.test.ts
        query.schema.test.ts
      index/
        index-builder.test.ts
        index-store.test.ts
        link-resolver.test.ts
      retrieval/
        scorer.test.ts
        classifier.test.ts
        retrieval-engine.test.ts
      sequencing/
        sequencing-engine.test.ts
        topological-sort.test.ts
      workflow/
        propose.test.ts
        continue.test.ts
        apply.test.ts
        verify.test.ts
        query.test.ts
        next-action.test.ts
    utils/
      hash.test.ts
      normalize.test.ts
      id-generator.test.ts
```

### Public API / Interface

The package exports two entry points:

```typescript
// src/index.ts -- Library API (for programmatic use by agents/subagents)
export { buildIndex, IndexStore } from './core/index/index.js';
export { search, classify } from './core/retrieval/index.js';
export { checkSequencing } from './core/sequencing/index.js';
export { propose, continueChange, apply, verify, query } from './core/workflow/index.js';
export { parseNote } from './core/parser/index.js';
export { scanNotes, readNote, writeNote } from './core/vault/index.js';
export type {
  ParseResult, Section, WikilinkOccurrence, NoteType,
  IndexRecord, Requirement, Scenario, DeltaSummaryEntry, TaskItem,
  QueryObject, ScoredCandidate, ClassificationResult, SequencingResult,
  NextAction, VerifyReport, ApplyResult,
} from './types/index.js';
```

```javascript
// bin/open-wiki-spec.js -- CLI entry
#!/usr/bin/env node
import '../dist/cli/index.js';
```

### Dependencies on Other Modules

This plan defines the project skeleton. Every other plan document depends on this one for:
- Module boundaries and file locations
- Shared type definitions (`src/types/`)
- Build and test configuration
- Dependency inventory

No other plan is a prerequisite for this one.

---

## 4. Test Strategy

### Unit Tests

Each module has its own test directory mirroring `src/`:

- **Vault I/O**: Read/write markdown files from fixture vault directory
- **Parser**: Frontmatter extraction, section hierarchy, wikilink extraction, requirement parsing, delta summary parsing against fixture `.md` files
- **Schema**: Zod schema validation for each note type (valid input, missing required fields, invalid types, edge cases)
- **Index**: Index building from parsed notes, link resolution, deduplication, error detection
- **Retrieval**: Individual scoring signals, combined scoring, classification threshold logic
- **Sequencing**: Topological sort, conflict severity classification, depends_on validation
- **Workflow**: Each operation with mock index/vault

### Integration Tests

- **Full pipeline**: raw vault directory -> parse -> index -> retrieve -> classify
- **Verify pipeline**: scan vault -> detect all error categories (completeness, correctness, coherence, integrity)
- **Apply pipeline**: delta summary -> check base_fingerprint -> apply atomically -> verify canonical Feature update

### Edge Cases

- Notes with missing or malformed YAML frontmatter
- Wikilinks targeting non-existent notes
- Duplicate IDs across notes
- Circular `depends_on` references
- Empty vault (no notes)
- Notes placed outside expected `wiki/` subdirectories
- Very large vaults (performance regression tests)
- Files with Windows line endings (`\r\n`)
- Frontmatter with unexpected extra fields (should be preserved, not rejected)
- Notes with no sections (only frontmatter)

### Test Fixtures

`tests/fixtures/` directory with:
- `valid-vault/`: Minimal complete vault with all 6 note types, properly linked
- `invalid-vault/`: Vault with duplicate IDs, broken wikilinks, missing frontmatter, invalid status values, schema mismatches
- `notes/`: Individual `.md` files for parser unit tests (one per test scenario)

---

## 5. Implementation Order

### Phase 1: Skeleton
1. Initialize repository: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`
2. Create all directories and barrel `index.ts` files
3. Define shared types in `src/types/` (note.ts, index-record.ts, query.ts, workflow.ts)
4. Create utility functions in `src/utils/` (hash.ts, normalize.ts, id-generator.ts)
5. Create test fixture vault

### Phase 2: Foundation (depends on Phase 1)
6. Implement `src/core/vault/` -- vault reader and writer
7. Implement `src/core/parser/` -- all sub-parsers
8. Implement `src/core/schema/` -- Zod schemas for all 6 note types
9. Write parser and schema unit tests

### Phase 3: Index (depends on Phase 2)
10. Implement `src/core/index/` -- index builder, store, link resolver, content hasher
11. Write index unit and integration tests

### Phase 4: Retrieval + Sequencing (depends on Phase 3)
12. Implement `src/core/retrieval/` -- query normalizer, scorer, classifier, engine
13. Implement `src/core/sequencing/` -- sequencing engine, topological sort
14. Write retrieval and sequencing tests

### Phase 5: Workflow (depends on Phase 4)
15. Implement `src/core/workflow/` -- propose, continue, apply, verify, query, next-action
16. Write workflow integration tests

### Phase 6: CLI (depends on Phase 5)
17. Implement `src/cli/` -- Commander program with thin command wrappers
18. End-to-end tests

### Dependencies

This plan (01) has no prerequisites. All other plans depend on this one for:
- File locations and module boundaries
- Type definitions
- Build/test infrastructure
