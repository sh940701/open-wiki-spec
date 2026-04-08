# Workflow: Apply Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec's apply workflow has two distinct operations that work together:

1. **`apply-change`** (task implementation) -- Reads context files (proposal, specs, design, tasks), finds unchecked tasks, implements them one by one, and marks them complete with `- [ ]` -> `- [x]`. This is the "do the implementation work" phase.

2. **`sync-specs`** / **`specs-apply.ts`** (canonical spec update) -- Takes delta specs from `openspec/changes/<name>/specs/` and applies their operations (ADDED, MODIFIED, REMOVED, RENAMED) to the main specs at `openspec/specs/`. This is the "merge changes into canonical state" phase.

3. **`archive-change`** (lifecycle completion) -- After apply + sync, moves the change directory to `openspec/changes/archive/YYYY-MM-DD-<name>/`.

The key insight is that OpenSpec separates the delta (change spec) from the canonical (main spec). The `buildUpdatedSpec()` function in `specs-apply.ts` is the core algorithm that parses delta specs, validates operations, and rebuilds the canonical spec file. It enforces a strict atomic apply order: **RENAMED -> REMOVED -> MODIFIED -> ADDED**.

### Key Source Files

| File | Role |
|------|------|
| `src/core/templates/workflows/apply-change.ts` | Skill template: reads context files, loops through tasks, implements code, marks checkboxes |
| `src/core/templates/workflows/sync-specs.ts` | Skill template: agent-driven intelligent merging of delta specs to main specs |
| `src/core/specs-apply.ts` | Core logic: `findSpecUpdates()`, `buildUpdatedSpec()`, `applySpecs()` -- programmatic delta application |
| `src/core/parsers/requirement-blocks.ts` | Parses requirement blocks, delta specs, extracts `## Requirements` section, normalizes names |
| `src/core/templates/workflows/archive-change.ts` | Archive workflow: checks completion, syncs specs if needed, moves to archive dir |

### Core Algorithm / Flow

**OpenSpec `buildUpdatedSpec()` -- The Delta Application Engine:**

```
1. Read change spec content (delta format)
2. Parse deltas via parseDeltaSpec():
   - Extract ADDED Requirements section -> RequirementBlock[]
   - Extract MODIFIED Requirements section -> RequirementBlock[]
   - Extract REMOVED Requirements section -> string[] (names only)
   - Extract RENAMED Requirements section -> {from, to}[]

3. Pre-validate:
   a. No duplicates WITHIN each section
   b. No cross-section conflicts:
      - MODIFIED + REMOVED same name -> ERROR
      - MODIFIED + ADDED same name -> ERROR
      - ADDED + REMOVED same name -> ERROR
      - RENAMED FROM + MODIFIED old name -> ERROR (must use new name)
      - RENAMED TO + ADDED same name -> ERROR (collision)

4. Load or create target spec:
   - If target exists: read it
   - If target doesn't exist:
     - Only ADDED allowed (MODIFIED/RENAMED -> ERROR)
     - REMOVED -> warning, ignored
     - Create skeleton spec with buildSpecSkeleton()

5. extractRequirementsSection(targetContent):
   - Split into: before, headerLine, preamble, bodyBlocks[], after
   - Each bodyBlock = { headerLine, name, raw }

6. Build nameToBlock map from bodyBlocks

7. Apply operations in ATOMIC ORDER:
   a. RENAMED:
      - FROM must exist in nameToBlock -> rename header line, re-key in map
      - TO must NOT already exist -> error if collision
   b. REMOVED:
      - Must exist in nameToBlock -> delete from map
      - For new specs: skip with warning
   c. MODIFIED:
      - Must exist in nameToBlock -> replace block with provided content
      - Header must match the key
   d. ADDED:
      - Must NOT exist in nameToBlock -> add to map
      - If already exists -> error

8. Recompose:
   - Kept order: iterate original bodyBlocks, find replacement in map
   - Append any newly added blocks not in original order
   - Rebuild: before + headerLine + preamble + body + after
   - Normalize: collapse 3+ newlines to 2

9. Post-validate (optional):
   - Run Validator.validateSpecContent() on rebuilt spec
   - Reject if structural errors

10. Write to disk
```

**OpenSpec `applySpecs()` Orchestrator:**

```
1. Verify change directory exists
2. findSpecUpdates(changeDir, mainSpecsDir):
   - Scan changeDir/specs/ for subdirectories
   - For each subdir: check if spec.md exists
   - Check if target mainSpecsDir/<name>/spec.md exists
   - Return SpecUpdate[] with { source, target, exists }
3. For each SpecUpdate: buildUpdatedSpec() (validation pass, no writes)
4. Optional: validate all rebuilt specs
5. Write all updated specs to disk
6. Return counts: { added, modified, removed, renamed } per capability
```

**OpenSpec `parseDeltaSpec()` Grammar:**

```
## ADDED Requirements
### Requirement: <name>
<normative statement>
#### Scenario: <name>
- WHEN ...
- THEN ...

## MODIFIED Requirements
### Requirement: <name>
<full replacement block>

## REMOVED Requirements
### Requirement: <name>
  (or)
- `### Requirement: <name>`

## RENAMED Requirements
- FROM: `### Requirement: <old name>`
- TO: `### Requirement: <new name>`
```

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

**Section 15 -- apply workflow:**
- Check `base_fingerprint` of each Delta Summary entry against current Feature requirement `content_hash`. If mismatch: report `stale_base`, block auto-apply until user resolves.
- Apply Delta Summary operations in atomic order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
- Reflect the implemented change into the canonical Feature.
- Update Requirements as well as narrative sections when canonical behavior changes.
- Keep Delta Summary aligned with actual canonical edits.
- Update any necessary Decision and System notes together.
- Change the Change status to `applied`.
- Keep the applied note in `04-changes/` first.
- After explicit retention window or explicit archive command, move to `99-archive/` while preserving `id`.

**Section 14.2 -- Delta Summary grammar:**
- requirement operation: `- (ADDED|MODIFIED|REMOVED) requirement "<name>" (to|in|from) [[<Feature>]]`
- RENAMED: `- RENAMED requirement "<old>" to "<new>" in [[<Feature>]]`
- section operation: `- (ADDED|MODIFIED|REMOVED) section "<section>" in [[<note>]]`
- MODIFIED, REMOVED, RENAMED entries have `[base: <content_hash>]` -- the requirement body hash at writing time. ADDED has `[base: n/a]`.

**Section 14.2 -- Atomic apply order (same as OpenSpec):**
1. RENAMED -- rename first so later ops use new names
2. REMOVED
3. MODIFIED
4. ADDED

**Section 10.3 -- content_hash:**
- `content_hash` is the normalized hash of requirement body (normative statement + scenarios).
- Used by Delta Summary `base_fingerprint` to detect stale changes.

**Section 10.8 -- Stale-Change Detection:**
- Delta Summary's MODIFIED/REMOVED/RENAMED entries record `base_fingerprint` (the target requirement's `content_hash` at writing time).
- At apply time, if current requirement `content_hash` != `base_fingerprint`, another Change modified the base.
- `verify` reports `stale_base` warning.
- Auto-apply is blocked until user resolves.

**Section 10.8 -- Operation Validation Matrix:**

| Operation | Before Apply | After Apply |
|-----------|-------------|-------------|
| ADDED | requirement MUST NOT exist in Feature | requirement MUST exist |
| MODIFIED | requirement MUST exist | requirement MUST exist (content_hash changed) |
| REMOVED | requirement MUST exist | requirement MUST NOT exist |
| RENAMED | old name MUST exist, new MUST NOT | old MUST NOT exist, new MUST exist |

MODIFIED "updated" check: if content_hash is identical before and after, the modification was a no-op -> warning.

**Section 6.2C -- Hybrid lifecycle:**
- Completed Change notes remain in `04-changes/` with `status: applied`.
- After retention window or explicit archive -> move to `99-archive/`.
- `id`-based identity survives the move.

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec |
|--------|---------|----------------|
| Delta format | Separate `spec.md` files per capability in `changes/<name>/specs/<cap>/spec.md` | Inline `## Delta Summary` section within the Change note |
| Delta granularity | Full requirement blocks in delta spec files | One-line entries with operation + target + base_fingerprint |
| Apply target | `openspec/specs/<cap>/spec.md` (separate spec files) | `wiki/03-features/<feature>.md` (Feature notes in vault) |
| Stale detection | None (no base_fingerprint concept) | `base_fingerprint` vs current `content_hash` comparison |
| Validation | Optional `Validator.validateSpecContent()` on rebuilt spec | Operation validation matrix (before/after assertions) |
| Archive | Immediate directory move to `archive/` | Status-first (`applied`), then later move to `99-archive/` |
| Scope | Per-capability spec files | Per-Feature notes (one Feature can have many requirements) |
| Merge strategy | Programmatic block replacement | **Agent-assisted**: agent reads Delta Summary, applies to Feature |
| Section operations | Not supported (only requirement operations) | Supported: `ADDED/MODIFIED/REMOVED section "<name>" in [[note]]` |
| Cross-note updates | Not applicable | Must update Decision and System notes when they're affected |

**Critical architectural difference:** OpenSpec has full requirement blocks in delta files that are merged programmatically. open-wiki-spec has compact Delta Summary entries that the agent interprets and applies to Feature notes. The apply logic is **agent-driven with programmatic guardrails**, not purely programmatic.

### Contracts to Satisfy

1. **Stale detection is mandatory**: Before applying any MODIFIED/REMOVED/RENAMED operation, compare `base_fingerprint` against current requirement `content_hash`. Block if mismatched.
2. **Atomic apply order**: RENAMED -> REMOVED -> MODIFIED -> ADDED. No exceptions.
3. **Operation validation matrix**: After apply, verify each operation's postcondition.
4. **Feature update**: The canonical Feature note must be updated with the applied changes.
5. **Status transition**: Change status moves to `applied` after successful apply.
6. **Hybrid lifecycle**: Applied Change stays in `04-changes/`, not immediately archived.
7. **Delta Summary must be parseable**: The programmatic layer must parse Delta Summary entries and extract operation, target requirement name, target Feature, and base_fingerprint.
8. **Section operations**: Support for narrative section operations (not just requirements).
9. **Cross-note propagation**: If Decision or System notes need updates, apply must handle them.
10. **Idempotency consideration**: Running apply twice should either succeed idempotently or fail safely with "already applied" detection.

---

## 3. Implementation Plan

### Architecture Overview

The apply workflow has three layers:

```
src/core/workflow/
  apply.ts              # Main apply orchestrator
  delta-parser.ts       # Parse Delta Summary entries from Change note
  stale-detector.ts     # base_fingerprint vs content_hash comparison
  feature-updater.ts    # Apply operations to Feature note Requirements
  section-updater.ts    # Apply section-level operations to any note
  apply-validator.ts    # Operation validation matrix (pre/post assertions)
  types.ts              # Shared types (extended from continue workflow types)
```

The flow is:

```
  ┌──────────────┐     ┌─────────────────┐     ┌────────────────┐
  │ Delta Summary │────►│ Stale Detection  │────►│ Feature Update  │
  │   Parsing     │     │ (base_fingerprint│     │ (atomic order)  │
  │               │     │  vs content_hash)│     │                 │
  └──────────────┘     └─────────────────┘     └────────────────┘
                                                        │
                                                        ▼
                                               ┌────────────────┐
                                               │ Post-Validation │
                                               │ (op matrix)     │
                                               └────────────────┘
                                                        │
                                                        ▼
                                               ┌────────────────┐
                                               │ Status Update   │
                                               │ (-> applied)    │
                                               └────────────────┘
```

### Data Structures

```typescript
// src/core/workflow/delta-parser.ts -- types

/**
 * A single parsed Delta Summary entry.
 * Corresponds to one line in the Change note's ## Delta Summary section.
 *
 * NOTE on naming convention: This internal type uses camelCase (TypeScript convention).
 * The unified types in 00-unified-types.md define `DeltaSummaryEntry` with snake_case
 * (consistent with frontmatter YAML keys). A mapping utility `toDeltaSummaryEntry()`
 * converts between the two:
 *
 *   function toDeltaSummaryEntry(entry: DeltaEntry): DeltaSummaryEntry {
 *     return {
 *       op: entry.op,
 *       target_type: entry.targetType,
 *       target_name: entry.targetName,
 *       new_name: entry.newName,
 *       target_note_id: entry.targetNoteId ?? '',
 *       base_fingerprint: entry.baseFingerprint,
 *       description: entry.description,
 *     };
 *   }
 *
 * Plan 04 (index-engine) stores `DeltaSummaryEntry` in `IndexRecord.delta_summary`.
 * Plan 09 parses `DeltaEntry` internally. The mapping runs when delta entries are
 * stored into the index or when plan 09 reads entries from the index.
 */
export interface DeltaEntry {
  /** The operation type */
  op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  /** What kind of target */
  targetType: 'requirement' | 'section';
  /** Name of the requirement or section being operated on */
  targetName: string;
  /** For RENAMED: the new name */
  newName?: string;
  /** The Feature (or note) this operation applies to, as a wikilink */
  targetNote: string;
  /** The resolved id of the target note */
  targetNoteId?: string;
  /** base_fingerprint -- content_hash at the time this entry was written */
  baseFingerprint: string | null;  // null for ADDED operations ("n/a")
  /** Description for section ops (what changed) */
  description?: string;
  /** The raw line from the Delta Summary */
  rawLine: string;
}

/**
 * Parsed Delta Summary grouped by target note.
 */
export interface DeltaPlan {
  /** All entries parsed from Delta Summary */
  entries: DeltaEntry[];
  /** Entries grouped by target note id */
  byTargetNote: Map<string, DeltaEntry[]>;
  /** Parsing warnings (malformed lines, etc.) */
  warnings: string[];
}

// src/core/workflow/stale-detector.ts -- types

/**
 * Result of stale detection for a single entry.
 */
export interface StaleCheckResult {
  entry: DeltaEntry;
  isStale: boolean;
  currentHash: string | null;   // null if requirement doesn't exist
  expectedHash: string | null;  // the base_fingerprint
  reason?: string;
}

/**
 * Result of stale detection for the entire Delta Summary.
 */
export interface StaleReport {
  hasStaleEntries: boolean;
  staleEntries: StaleCheckResult[];
  cleanEntries: StaleCheckResult[];
  /** If true, auto-apply is blocked */
  blocked: boolean;
}

// src/core/workflow/feature-updater.ts -- types

/**
 * A single operation to apply to a Feature note.
 * Operations are sorted in atomic order before execution.
 */
export interface ApplyOperation {
  /** Execution order priority (1=RENAMED, 2=REMOVED, 3=MODIFIED, 4=ADDED) */
  priority: number;
  entry: DeltaEntry;
}

/**
 * Result of applying all operations to a single Feature note.
 */
export interface FeatureApplyResult {
  featureId: string;
  featurePath: string;
  operations: ApplyOperationResult[];
  updatedContent: string;
  requiresWrite: boolean;
}

export interface ApplyOperationResult {
  entry: DeltaEntry;
  success: boolean;
  error?: string;
  /** For MODIFIED: was the content actually changed? */
  contentChanged?: boolean;
}

// src/core/workflow/apply-validator.ts -- types

/**
 * Pre-apply validation: checks that prerequisites hold before each operation.
 */
export interface PreValidation {
  entry: DeltaEntry;
  valid: boolean;
  error?: string;
}

/**
 * Post-apply validation: checks that postconditions hold after each operation.
 */
export interface PostValidation {
  entry: DeltaEntry;
  valid: boolean;
  error?: string;
  /** For MODIFIED: content_hash changed check */
  hashChanged?: boolean;
}

// src/core/workflow/apply.ts -- main types

/**
 * Options for the apply workflow.
 */
export interface ApplyOptions {
  changeId: string;
  vaultRoot: string;
  /** If true, only validate without writing */
  dryRun?: boolean;
  /** Force apply even if stale entries detected (requires user confirmation) */
  forceStale?: boolean;
}

/**
 * Full result of the apply workflow.
 */
export interface ApplyResult {
  changeId: string;
  changeName: string;
  /** Whether apply succeeded */
  success: boolean;
  /** Stale detection report */
  staleReport: StaleReport;
  /** Per-feature apply results (programmatic ops only) */
  featureResults: FeatureApplyResult[];
  /** Section operation results */
  sectionResults: SectionApplyResult[];
  /** Post-validation results (programmatic ops only; agent ops validated by verifyApply) */
  postValidation: PostValidation[];
  /** Agent-driven ops that need content editing by the agent before finalization.
   *  If non-empty, status is NOT set to 'applied' -- call verifyApply() after agent edits. */
  pendingAgentOps: PendingAgentOp[];
  /** Snapshot of requirement content_hashes taken BEFORE agent edits (Phase B).
   *  Pass this to verifyApply() for correct post-edit hash comparison.
   *  Map: featureId -> Map<requirementName, contentHash> */
  preEditSnapshots: Map<string, Map<string, string>>;
  /** Whether status was transitioned to 'applied' */
  statusTransitioned: boolean;
  /** Warnings */
  warnings: string[];
  /** Errors (if any) */
  errors: string[];
}

/**
 * An agent-driven operation that passed pre-validation but needs
 * the agent to perform the actual content edit on the Feature note.
 */
export interface PendingAgentOp {
  /** The delta entry describing what to do */
  entry: DeltaEntry;
  /** Resolved feature id */
  featureId: string;
  /** File path of the Feature note */
  featurePath: string;
}

export interface SectionApplyResult {
  noteId: string;
  notePath: string;
  sectionName: string;
  op: 'ADDED' | 'MODIFIED' | 'REMOVED';
  success: boolean;
  error?: string;
}
```

### Core Algorithm

#### Delta Summary Parsing

```typescript
// src/core/workflow/delta-parser.ts

/**
 * Regex patterns for Delta Summary entry parsing.
 *
 * Requirement ops:
 *   - ADDED requirement "<name>" to [[Feature: ...]]
 *   - MODIFIED requirement "<name>" in [[Feature: ...]] [base: sha256:...]
 *   - REMOVED requirement "<name>" from [[Feature: ...]] [base: sha256:...]
 *   - RENAMED requirement "<old>" to "<new>" in [[Feature: ...]] [base: sha256:...]
 *
 * Section ops:
 *   - ADDED section "<name>" in [[Note: ...]]
 *   - MODIFIED section "<name>" in [[Note: ...]]: <description>
 *   - REMOVED section "<name>" from [[Note: ...]]
 */

const REQUIREMENT_OP_RE =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/;

const RENAMED_RE =
  /^-\s+RENAMED\s+requirement\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/;

const SECTION_OP_RE =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+section\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?::\s*(.+))?/;

export function parseDeltaSummary(
  change: ParsedNote,
  index: VaultIndex
): DeltaPlan {
  const deltaSummary = change.sections.get('Delta Summary');
  if (!deltaSummary) {
    return { entries: [], byTargetNote: new Map(), warnings: ['No Delta Summary section found'] };
  }

  const lines = deltaSummary.body.split('\n');
  const entries: DeltaEntry[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('-')) continue;

    // Try RENAMED first (more specific pattern)
    const renamedMatch = trimmed.match(RENAMED_RE);
    if (renamedMatch) {
      const targetNoteId = index.resolveWikilink(renamedMatch[3]);
      entries.push({
        op: 'RENAMED',
        targetType: 'requirement',
        targetName: renamedMatch[1],
        newName: renamedMatch[2],
        targetNote: renamedMatch[3],
        targetNoteId: targetNoteId ?? undefined,
        baseFingerprint: parseBaseFingerprint(renamedMatch[4]),
        rawLine: trimmed,
      });
      continue;
    }

    // Try requirement operation
    const reqMatch = trimmed.match(REQUIREMENT_OP_RE);
    if (reqMatch) {
      const targetNoteId = index.resolveWikilink(reqMatch[4]);
      entries.push({
        op: reqMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED',
        targetType: 'requirement',
        targetName: reqMatch[2],
        targetNote: reqMatch[4],
        targetNoteId: targetNoteId ?? undefined,
        baseFingerprint: parseBaseFingerprint(reqMatch[5]),
        rawLine: trimmed,
      });
      continue;
    }

    // Try section operation
    const secMatch = trimmed.match(SECTION_OP_RE);
    if (secMatch) {
      const targetNoteId = index.resolveWikilink(secMatch[4]);
      entries.push({
        op: secMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED',
        targetType: 'section',
        targetName: secMatch[2],
        targetNote: secMatch[4],
        targetNoteId: targetNoteId ?? undefined,
        baseFingerprint: null,  // section ops don't have base_fingerprint
        description: secMatch[5]?.trim(),
        rawLine: trimmed,
      });
      continue;
    }

    // Unrecognized line
    warnings.push(`Unparseable Delta Summary entry: "${trimmed}"`);
  }

  // Group by target note
  const byTargetNote = new Map<string, DeltaEntry[]>();
  for (const entry of entries) {
    const key = entry.targetNoteId ?? entry.targetNote;
    const group = byTargetNote.get(key) ?? [];
    group.push(entry);
    byTargetNote.set(key, group);
  }

  return { entries, byTargetNote, warnings };
}

function parseBaseFingerprint(raw?: string): string | null {
  if (!raw || raw === 'n/a') return null;
  return raw;  // e.g., "sha256:abc123..."
}
```

#### Cross-Section Conflict Validation

```typescript
// src/core/workflow/delta-parser.ts (continued)

/**
 * Validate that Delta Summary entries don't have cross-section conflicts.
 * Mirrors OpenSpec's pre-validation in buildUpdatedSpec().
 */
export function validateDeltaConflicts(plan: DeltaPlan): string[] {
  const errors: string[] = [];

  // Group entries by target note + target name for conflict detection
  for (const [noteKey, entries] of plan.byTargetNote) {
    const reqEntries = entries.filter(e => e.targetType === 'requirement');

    // Build maps per operation type
    const added = new Set(reqEntries.filter(e => e.op === 'ADDED').map(e => e.targetName));
    const modified = new Set(reqEntries.filter(e => e.op === 'MODIFIED').map(e => e.targetName));
    const removed = new Set(reqEntries.filter(e => e.op === 'REMOVED').map(e => e.targetName));
    const renamedFrom = new Map(
      reqEntries.filter(e => e.op === 'RENAMED').map(e => [e.targetName, e.newName!])
    );
    const renamedTo = new Set(
      reqEntries.filter(e => e.op === 'RENAMED').map(e => e.newName!)
    );

    // Duplicate within same operation
    const addedList = reqEntries.filter(e => e.op === 'ADDED').map(e => e.targetName);
    const addedDupes = findDuplicates(addedList);
    for (const d of addedDupes) {
      errors.push(`Duplicate ADDED requirement "${d}" in ${noteKey}`);
    }

    const modifiedList = reqEntries.filter(e => e.op === 'MODIFIED').map(e => e.targetName);
    const modDupes = findDuplicates(modifiedList);
    for (const d of modDupes) {
      errors.push(`Duplicate MODIFIED requirement "${d}" in ${noteKey}`);
    }

    // Cross-section conflicts
    for (const name of modified) {
      if (removed.has(name)) errors.push(`"${name}" in ${noteKey}: MODIFIED + REMOVED conflict`);
      if (added.has(name)) errors.push(`"${name}" in ${noteKey}: MODIFIED + ADDED conflict`);
    }
    for (const name of added) {
      if (removed.has(name)) errors.push(`"${name}" in ${noteKey}: ADDED + REMOVED conflict`);
    }

    // RENAMED interplay
    for (const [from, to] of renamedFrom) {
      if (modified.has(from)) {
        errors.push(`"${from}" in ${noteKey}: RENAMED FROM + MODIFIED old name (use new name "${to}")`);
      }
      if (added.has(to)) {
        errors.push(`"${to}" in ${noteKey}: RENAMED TO + ADDED collision`);
      }
    }
  }

  return errors;
}

function findDuplicates(arr: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const item of arr) {
    if (seen.has(item)) dupes.add(item);
    seen.add(item);
  }
  return [...dupes];
}
```

#### Stale Detection

```typescript
// src/core/workflow/stale-detector.ts

import { computeContentHash } from '../../util/hash.js';

/**
 * Check all Delta Summary entries for stale base_fingerprints.
 *
 * For each MODIFIED/REMOVED/RENAMED entry:
 *   1. Find the target requirement in the current Feature note
 *   2. Compute the current content_hash of that requirement
 *   3. Compare with the entry's base_fingerprint
 *   4. If different: the base has changed since this delta was written -> stale
 */
export function detectStale(
  plan: DeltaPlan,
  index: VaultIndex,
  featureNotes: Map<string, ParsedNote>
): StaleReport {
  const staleEntries: StaleCheckResult[] = [];
  const cleanEntries: StaleCheckResult[] = [];

  for (const entry of plan.entries) {
    // Only check entries that reference a base
    if (entry.targetType !== 'requirement') continue;
    if (entry.op === 'ADDED') {
      // ADDED has no base to check
      cleanEntries.push({
        entry,
        isStale: false,
        currentHash: null,
        expectedHash: null,
      });
      continue;
    }

    // Entry is MODIFIED, REMOVED, or RENAMED
    const featureNote = featureNotes.get(entry.targetNoteId ?? entry.targetNote);
    if (!featureNote) {
      staleEntries.push({
        entry,
        isStale: true,
        currentHash: null,
        expectedHash: entry.baseFingerprint,
        reason: `Target Feature note not found: ${entry.targetNote}`,
      });
      continue;
    }

    // Find the requirement in the Feature
    const reqName = entry.op === 'RENAMED' ? entry.targetName : entry.targetName;
    const requirement = findRequirementInFeature(featureNote, reqName);

    if (!requirement) {
      // For REMOVED/RENAMED: the requirement doesn't exist (maybe already removed)
      if (entry.op === 'REMOVED' || entry.op === 'RENAMED') {
        staleEntries.push({
          entry,
          isStale: true,
          currentHash: null,
          expectedHash: entry.baseFingerprint,
          reason: `Requirement "${reqName}" not found in ${entry.targetNote} (may have been removed by another change)`,
        });
      } else {
        // MODIFIED: requirement must exist
        staleEntries.push({
          entry,
          isStale: true,
          currentHash: null,
          expectedHash: entry.baseFingerprint,
          reason: `Requirement "${reqName}" not found in ${entry.targetNote}`,
        });
      }
      continue;
    }

    // Compute current content_hash
    const currentHash = computeRequirementHash(requirement);

    if (entry.baseFingerprint && currentHash !== entry.baseFingerprint) {
      staleEntries.push({
        entry,
        isStale: true,
        currentHash,
        expectedHash: entry.baseFingerprint,
        reason: `Base changed: expected ${entry.baseFingerprint}, current ${currentHash}`,
      });
    } else {
      cleanEntries.push({
        entry,
        isStale: false,
        currentHash,
        expectedHash: entry.baseFingerprint,
      });
    }
  }

  return {
    hasStaleEntries: staleEntries.length > 0,
    staleEntries,
    cleanEntries,
    blocked: staleEntries.length > 0,
  };
}

/**
 * Compute content_hash for a requirement (normative statement + scenarios).
 * Matches the hash format used when writing Delta Summary entries.
 */
function computeRequirementHash(requirement: ParsedRequirement): string {
  // Normalize: trim, collapse whitespace, lowercase for hash stability
  const normalized = [
    requirement.normative,
    ...requirement.scenarios.map(s => s.trim()),
  ].join('\n').trim();

  return `sha256:${computeContentHash(normalized)}`;
}
```

#### Feature Updater (Atomic Apply Order)

```typescript
// src/core/workflow/feature-updater.ts

/**
 * Apply delta operations to a Feature note's Requirements section.
 * Operations are executed in atomic order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
 *
 * This function does NOT write to disk. It returns the updated content
 * for the caller to write.
 */
export function applyDeltaToFeature(
  featureNote: ParsedNote,
  entries: DeltaEntry[],
): FeatureApplyResult {
  const operations: ApplyOperationResult[] = [];
  let content = featureNote.rawContent;

  // Sort entries by atomic order
  const sorted = [...entries]
    .filter(e => e.targetType === 'requirement')
    .sort((a, b) => getAtomicPriority(a.op) - getAtomicPriority(b.op));

  // Parse the Requirements section from current content
  let requirements = parseRequirementsSection(content);

  for (const entry of sorted) {
    const result = applySingleOperation(requirements, entry);
    operations.push(result);

    if (result.success) {
      // Re-parse after each operation (since content has changed)
      content = rebuildFeatureContent(featureNote, requirements);
      requirements = parseRequirementsSection(content);
    }
  }

  return {
    featureId: featureNote.frontmatter.id as string,
    featurePath: featureNote.path,
    operations,
    updatedContent: content,
    requiresWrite: operations.some(o => o.success),
  };
}

/**
 * Map operation to atomic priority.
 * RENAMED(1) -> REMOVED(2) -> MODIFIED(3) -> ADDED(4)
 */
function getAtomicPriority(
  op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'
): number {
  switch (op) {
    case 'RENAMED': return 1;
    case 'REMOVED': return 2;
    case 'MODIFIED': return 3;
    case 'ADDED': return 4;
  }
}

function applySingleOperation(
  requirements: RequirementsMap,
  entry: DeltaEntry
): ApplyOperationResult {
  switch (entry.op) {
    case 'RENAMED': {
      const oldReq = requirements.get(entry.targetName);
      if (!oldReq) {
        return { entry, success: false, error: `Requirement "${entry.targetName}" not found for RENAME` };
      }
      if (requirements.has(entry.newName!)) {
        return { entry, success: false, error: `Target name "${entry.newName}" already exists` };
      }
      // Rename: remove old key, add new key with updated header
      requirements.delete(entry.targetName);
      oldReq.name = entry.newName!;
      oldReq.headerLine = `### Requirement: ${entry.newName}`;
      requirements.set(entry.newName!, oldReq);
      return { entry, success: true };
    }

    case 'REMOVED': {
      if (!requirements.has(entry.targetName)) {
        return { entry, success: false, error: `Requirement "${entry.targetName}" not found for REMOVE` };
      }
      requirements.delete(entry.targetName);
      return { entry, success: true };
    }

    case 'MODIFIED': {
      const existing = requirements.get(entry.targetName);
      if (!existing) {
        return { entry, success: false, error: `Requirement "${entry.targetName}" not found for MODIFY` };
      }
      // MODIFIED in open-wiki-spec is agent-driven.
      // The agent will read the Delta Summary description and apply the change.
      // This function marks the requirement as needing modification.
      // The actual content change is performed by the agent.
      return { entry, success: true, contentChanged: true };
    }

    case 'ADDED': {
      if (requirements.has(entry.targetName)) {
        return { entry, success: false, error: `Requirement "${entry.targetName}" already exists for ADD` };
      }
      // Mark that a new requirement should be added.
      // The agent will provide the actual content.
      return { entry, success: true };
    }
  }
}
```

**Important architectural note on MODIFIED and ADDED:**

Unlike OpenSpec where delta files contain the full replacement content, open-wiki-spec's Delta Summary only has one-line operation descriptions. The actual content modifications are **agent-driven**: the apply workflow tells the agent what needs to happen, and the agent performs the edits on the Feature note. The `feature-updater.ts` validates preconditions and postconditions, but the actual content writing is done by the agent using the note editing tools.

For programmatic operations (RENAMED, REMOVED), the updater can perform these mechanically. For content-changing operations (MODIFIED, ADDED), the updater validates the operation is legal and the agent provides the content.

#### Operation Validation Matrix

```typescript
// src/core/workflow/apply-validator.ts

/**
 * Pre-apply validation: check that prerequisites hold for each operation.
 * Should be run BEFORE any operations are executed.
 */
export function preValidate(
  entries: DeltaEntry[],
  featureNote: ParsedNote
): PreValidation[] {
  const requirements = parseRequirementsSection(featureNote.rawContent);
  const results: PreValidation[] = [];

  for (const entry of entries) {
    if (entry.targetType !== 'requirement') continue;

    switch (entry.op) {
      case 'ADDED': {
        const exists = requirements.has(entry.targetName);
        results.push({
          entry,
          valid: !exists,
          error: exists ? `Requirement "${entry.targetName}" already exists (ADDED requires non-existence)` : undefined,
        });
        break;
      }
      case 'MODIFIED': {
        const exists = requirements.has(entry.targetName);
        results.push({
          entry,
          valid: exists,
          error: !exists ? `Requirement "${entry.targetName}" not found (MODIFIED requires existence)` : undefined,
        });
        break;
      }
      case 'REMOVED': {
        const exists = requirements.has(entry.targetName);
        results.push({
          entry,
          valid: exists,
          error: !exists ? `Requirement "${entry.targetName}" not found (REMOVED requires existence)` : undefined,
        });
        break;
      }
      case 'RENAMED': {
        const oldExists = requirements.has(entry.targetName);
        const newExists = requirements.has(entry.newName!);
        const valid = oldExists && !newExists;
        let error: string | undefined;
        if (!oldExists) error = `Old name "${entry.targetName}" not found`;
        if (newExists) error = `New name "${entry.newName}" already exists`;
        results.push({ entry, valid, error });
        break;
      }
    }
  }

  return results;
}

/**
 * Post-apply validation: check that postconditions hold after apply.
 * Should be run AFTER all operations are executed.
 */
export function postValidate(
  entries: DeltaEntry[],
  updatedFeatureNote: ParsedNote,
  originalFeatureNote: ParsedNote
): PostValidation[] {
  const currentReqs = parseRequirementsSection(updatedFeatureNote.rawContent);
  const originalReqs = parseRequirementsSection(originalFeatureNote.rawContent);
  const results: PostValidation[] = [];

  for (const entry of entries) {
    if (entry.targetType !== 'requirement') continue;

    switch (entry.op) {
      case 'ADDED': {
        const exists = currentReqs.has(entry.targetName);
        results.push({
          entry,
          valid: exists,
          error: !exists ? `Requirement "${entry.targetName}" MUST exist after ADDED` : undefined,
        });
        break;
      }
      case 'MODIFIED': {
        const exists = currentReqs.has(entry.targetName);
        if (!exists) {
          results.push({
            entry,
            valid: false,
            error: `Requirement "${entry.targetName}" MUST exist after MODIFIED`,
          });
          break;
        }
        // Check content_hash actually changed
        const original = originalReqs.get(entry.targetName);
        const updated = currentReqs.get(entry.targetName);
        const hashChanged = original && updated
          ? computeRequirementHash(original) !== computeRequirementHash(updated)
          : true;
        results.push({
          entry,
          valid: exists,
          hashChanged,
          error: !hashChanged ? `Requirement "${entry.targetName}" content_hash unchanged after MODIFIED (no-op warning)` : undefined,
        });
        break;
      }
      case 'REMOVED': {
        const exists = currentReqs.has(entry.targetName);
        results.push({
          entry,
          valid: !exists,
          error: exists ? `Requirement "${entry.targetName}" MUST NOT exist after REMOVED` : undefined,
        });
        break;
      }
      case 'RENAMED': {
        const oldExists = currentReqs.has(entry.targetName);
        const newExists = currentReqs.has(entry.newName!);
        const valid = !oldExists && newExists;
        let error: string | undefined;
        if (oldExists) error = `Old name "${entry.targetName}" MUST NOT exist after RENAMED`;
        if (!newExists) error = `New name "${entry.newName}" MUST exist after RENAMED`;
        results.push({ entry, valid, error });
        break;
      }
    }
  }

  return results;
}
```

#### Section-Level Operations

```typescript
// src/core/workflow/section-updater.ts

/**
 * Apply section-level operations to a note.
 * Section operations are simpler than requirement operations:
 * - ADDED: add a new ## section to the note
 * - MODIFIED: the agent will update the section content
 * - REMOVED: remove the ## section from the note
 */
export function applySectionOps(
  note: ParsedNote,
  entries: DeltaEntry[]
): SectionApplyResult[] {
  const sectionEntries = entries.filter(e => e.targetType === 'section');
  const results: SectionApplyResult[] = [];

  for (const entry of sectionEntries) {
    const section = note.sections.get(entry.targetName);

    switch (entry.op) {
      case 'ADDED': {
        if (section) {
          results.push({
            noteId: note.frontmatter.id as string,
            notePath: note.path,
            sectionName: entry.targetName,
            op: 'ADDED',
            success: false,
            error: `Section "${entry.targetName}" already exists`,
          });
        } else {
          // Agent will add the section content
          results.push({
            noteId: note.frontmatter.id as string,
            notePath: note.path,
            sectionName: entry.targetName,
            op: 'ADDED',
            success: true,
          });
        }
        break;
      }
      case 'MODIFIED': {
        if (!section) {
          results.push({
            noteId: note.frontmatter.id as string,
            notePath: note.path,
            sectionName: entry.targetName,
            op: 'MODIFIED',
            success: false,
            error: `Section "${entry.targetName}" not found`,
          });
        } else {
          // Agent will update the section based on entry.description
          results.push({
            noteId: note.frontmatter.id as string,
            notePath: note.path,
            sectionName: entry.targetName,
            op: 'MODIFIED',
            success: true,
          });
        }
        break;
      }
      case 'REMOVED': {
        if (!section) {
          results.push({
            noteId: note.frontmatter.id as string,
            notePath: note.path,
            sectionName: entry.targetName,
            op: 'REMOVED',
            success: false,
            error: `Section "${entry.targetName}" not found for removal`,
          });
        } else {
          // Programmatic removal of the section
          results.push({
            noteId: note.frontmatter.id as string,
            notePath: note.path,
            sectionName: entry.targetName,
            op: 'REMOVED',
            success: true,
          });
        }
        break;
      }
    }
  }

  return results;
}
```

#### Main Apply Orchestrator

```typescript
// src/core/workflow/apply.ts

/**
 * Main apply workflow.
 *
 * Main apply workflow using a TWO-PHASE COMMIT pattern to prevent
 * partial vault corruption on multi-Feature changes.
 *
 * Phase 1 (Validate & Compute -- no disk writes):
 *   1. Load Change note and parse Delta Summary
 *   2. Validate Delta Summary (no conflicts, no duplicates)
 *   3. Load target Feature notes
 *   4. Run stale detection (base_fingerprint vs content_hash)
 *   5. If stale: block (unless forceStale)
 *   6. Pre-validate ALL operations across ALL Features
 *   7. Compute updated content for each Feature (atomic order)
 *   8. Post-validate ALL computed results
 *   9. Validate section operations
 *   If ANY validation fails at ANY step, abort entirely -- nothing written.
 *
 * Phase 2 (Write -- only if Phase 1 passes completely):
 *   10. Write ALL updated Feature files to disk
 *   11. Update Change status to 'applied' (sole transition owner per unified types)
 *
 * Agent-driven execution model (3 phases total):
 *   Phase A: applyChange() validates and does mechanical ops (RENAMED, REMOVED)
 *   Phase B: Agent performs content ops (MODIFIED, ADDED) guided by the result
 *   Phase C: postValidate() is called AFTER the agent finishes writing
 *   For programmatic ops (RENAMED, REMOVED), all 3 phases happen within applyChange().
 *   For agent-driven ops (MODIFIED, ADDED), Phase B and C happen after applyChange() returns.
 */
export async function applyChange(
  options: ApplyOptions,
  index: VaultIndex
): Promise<ApplyResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Load Change note
  const changeRecord = index.getById(options.changeId);
  if (!changeRecord) {
    throw new Error(`Change "${options.changeId}" not found in index`);
  }
  const change = await parseNoteFromPath(changeRecord.path);

  // Verify status allows apply.
  // Per unified ownership rules (00-unified-types.md), apply(09) is the
  // sole owner of the `in_progress -> applied` transition.
  // Only `in_progress` status is accepted. The `planned` status is NOT
  // accepted because the lifecycle requires going through `in_progress`
  // first (tasks must be completed during implementation).
  const status = change.frontmatter.status as string;
  if (status !== 'in_progress') {
    throw new Error(
      `Cannot apply change with status "${status}". ` +
      `Expected "in_progress". Use 'continue' to advance through ` +
      `the status lifecycle first.`
    );
  }

  // Check all tasks are complete.
  // This enforces the gate from plan 08: continue(08) returns
  // `ready_to_apply` only when all tasks are done. If unchecked
  // tasks remain, the caller bypassed the continue workflow.
  const unchecked = getUncheckedTasks(change);
  if (unchecked.length > 0) {
    throw new Error(
      `Cannot apply: ${unchecked.length} unchecked task(s) remaining. ` +
      `Complete all tasks via 'continue' before applying.`
    );
  }

  // 2. Parse Delta Summary
  const deltaPlan = parseDeltaSummary(change, index);
  warnings.push(...deltaPlan.warnings);

  if (deltaPlan.entries.length === 0) {
    return {
      changeId: options.changeId,
      changeName: change.title,
      success: false,
      staleReport: { hasStaleEntries: false, staleEntries: [], cleanEntries: [], blocked: false },
      featureResults: [],
      sectionResults: [],
      postValidation: [],
      statusTransitioned: false,
      warnings,
      errors: ['No Delta Summary entries found. Nothing to apply.'],
    };
  }

  // Validate delta conflicts
  const conflictErrors = validateDeltaConflicts(deltaPlan);
  if (conflictErrors.length > 0) {
    return {
      changeId: options.changeId,
      changeName: change.title,
      success: false,
      staleReport: { hasStaleEntries: false, staleEntries: [], cleanEntries: [], blocked: false },
      featureResults: [],
      sectionResults: [],
      postValidation: [],
      statusTransitioned: false,
      warnings,
      errors: conflictErrors,
    };
  }

  // 3. Load target Feature notes
  const featureNotes = new Map<string, ParsedNote>();
  for (const [noteKey, entries] of deltaPlan.byTargetNote) {
    const noteRecord = index.getById(noteKey);
    if (!noteRecord) {
      errors.push(`Target note "${noteKey}" not found in index`);
      continue;
    }
    const note = await parseNoteFromPath(noteRecord.path);
    featureNotes.set(noteKey, note);
  }

  if (errors.length > 0) {
    return {
      changeId: options.changeId,
      changeName: change.title,
      success: false,
      staleReport: { hasStaleEntries: false, staleEntries: [], cleanEntries: [], blocked: false },
      featureResults: [],
      sectionResults: [],
      postValidation: [],
      statusTransitioned: false,
      warnings,
      errors,
    };
  }

  // 4. Stale detection
  const staleReport = detectStale(deltaPlan, index, featureNotes);

  // 5. Block if stale (unless forced)
  if (staleReport.blocked && !options.forceStale) {
    return {
      changeId: options.changeId,
      changeName: change.title,
      success: false,
      staleReport,
      featureResults: [],
      sectionResults: [],
      postValidation: [],
      statusTransitioned: false,
      warnings: [
        ...warnings,
        'Stale base detected. Another change has modified the base requirements.',
        'Resolve conflicts and update base_fingerprint values, or use forceStale option.',
      ],
      errors: staleReport.staleEntries.map(s =>
        `STALE: ${s.entry.op} "${s.entry.targetName}" - ${s.reason}`
      ),
    };
  }

  // ──────────────────────────────────────────────────────────
  // TWO-PHASE COMMIT for multi-Feature apply
  //
  // Phase 1 (Validate & Compute): validate all operations across
  //   ALL Features. Compute updated content. NO disk writes.
  //   If ANY validation fails for ANY Feature, abort entirely.
  //
  // Phase 2 (Write): write ALL updated Feature files to disk.
  //   Only reached if Phase 1 passes completely.
  //   If a disk write fails mid-way, return partial results with
  //   error -- caller must handle recovery.
  //
  // This prevents partial vault corruption where Feature A is
  // updated but Feature B fails, leaving the vault inconsistent.
  // ──────────────────────────────────────────────────────────

  // === PHASE 1: Validate and compute all updates (no writes) ===

  const featureResults: FeatureApplyResult[] = [];
  const allPostValidations: PostValidation[] = [];
  const pendingAgentOps: PendingAgentOp[] = [];

  // 6. Pre-validate all requirement operations across ALL Features first
  for (const [noteKey, entries] of deltaPlan.byTargetNote) {
    const featureNote = featureNotes.get(noteKey)!;
    const reqEntries = entries.filter(e => e.targetType === 'requirement');

    if (reqEntries.length === 0) continue;

    const preValidations = preValidate(reqEntries, featureNote);
    const preErrors = preValidations.filter(v => !v.valid);
    if (preErrors.length > 0) {
      errors.push(...preErrors.map(e => `Pre-validation: ${e.error}`));
    }
  }

  // Abort if ANY pre-validation failed across ANY Feature
  if (errors.length > 0) {
    return {
      changeId: options.changeId,
      changeName: change.title,
      success: false,
      staleReport,
      featureResults: [],
      sectionResults: [],
      postValidation: [],
      statusTransitioned: false,
      warnings,
      errors,
    };
  }

  // 7. Compute all updated content for programmatic ops (still no writes).
  //
  // IMPORTANT: Agent-driven execution model
  // ────────────────────────────────────────
  // RENAMED and REMOVED are fully programmatic -- applyDeltaToFeature()
  // performs the mechanical work and post-validation can run immediately.
  //
  // MODIFIED and ADDED are agent-driven -- the Delta Summary has only
  // one-line descriptions, not full replacement content. The agent must
  // read the apply result and perform the actual content edits afterward.
  // Post-validation for these ops runs in a SEPARATE call (verifyApply)
  // after the agent finishes writing.
  //
  // Call sequence:
  //   Phase A: applyChange() validates + does mechanical ops (RENAMED, REMOVED)
  //   Phase B: Agent performs content ops (MODIFIED, ADDED) guided by result
  //   Phase C: verifyApply() is called AFTER the agent finishes writing
  //
  // For this reason, applyChange() only post-validates programmatic ops
  // (RENAMED, REMOVED). Agent-driven ops (MODIFIED, ADDED) are returned
  // in `pendingAgentOps` for the caller to act on.

  const programmaticOps = ['RENAMED', 'REMOVED'] as const;
  const agentDrivenOps = ['MODIFIED', 'ADDED'] as const;

  for (const [noteKey, entries] of deltaPlan.byTargetNote) {
    const featureNote = featureNotes.get(noteKey)!;
    const reqEntries = entries.filter(e => e.targetType === 'requirement');

    if (reqEntries.length === 0) continue;

    // Apply only programmatic operations mechanically
    const mechEntries = reqEntries.filter(e =>
      (programmaticOps as readonly string[]).includes(e.op)
    );
    const agentEntries = reqEntries.filter(e =>
      (agentDrivenOps as readonly string[]).includes(e.op)
    );

    const result = applyDeltaToFeature(featureNote, mechEntries);
    featureResults.push(result);

    // Post-validate programmatic ops only (agent ops validated later)
    if (result.requiresWrite) {
      const updatedNote = await parseNoteFromContent(result.updatedContent, featureNote.path);
      const postResults = postValidate(mechEntries, updatedNote, featureNote);
      allPostValidations.push(...postResults);

      const postErrors = postResults.filter(v => !v.valid);
      if (postErrors.length > 0) {
        errors.push(...postErrors.map(e => `Post-validation: ${e.error}`));
      }
    }

    // Collect agent-driven ops as pending instructions
    for (const entry of agentEntries) {
      pendingAgentOps.push({
        entry,
        featureId: noteKey,
        featurePath: featureNote.path,
      });
    }
  }

  // ── Snapshot content_hashes BEFORE agent edits (V3-09-01 fix) ──
  // Before returning pendingAgentOps for the agent to act on, snapshot
  // the current requirement content_hashes for each Feature that has
  // agent-driven ops. After the agent edits (Phase B), verifyApply()
  // compares the post-edit hashes against this snapshot to confirm
  // the agent actually changed the content.
  const preEditSnapshots = new Map<string, Map<string, string>>();
  for (const op of pendingAgentOps) {
    if (!preEditSnapshots.has(op.featureId)) {
      const featureNote = featureNotes.get(op.featureId)!;
      const reqs = parseRequirementsSection(featureNote.rawContent);
      const hashMap = new Map<string, string>();
      for (const [name, req] of reqs) {
        hashMap.set(name, computeRequirementHash(req));
      }
      preEditSnapshots.set(op.featureId, hashMap);
    }
  }

  // 8. Validate section operations (still no writes)
  const sectionResults: SectionApplyResult[] = [];
  for (const [noteKey, entries] of deltaPlan.byTargetNote) {
    const note = featureNotes.get(noteKey)!;
    const secEntries = entries.filter(e => e.targetType === 'section');
    if (secEntries.length === 0) continue;

    const secResults = applySectionOps(note, secEntries);
    sectionResults.push(...secResults);

    const secErrors = secResults.filter(r => !r.success);
    if (secErrors.length > 0) {
      errors.push(...secErrors.map(e => `Section op: ${e.error}`));
    }
  }

  // Abort if ANY post-validation or section op failed
  if (errors.length > 0) {
    return {
      changeId: options.changeId,
      changeName: change.title,
      success: false,
      staleReport,
      featureResults,
      sectionResults,
      postValidation: allPostValidations,
      pendingAgentOps: [],
      statusTransitioned: false,
      warnings,
      errors,
    };
  }

  // === PHASE 2: Write all files (only if Phase 1 passed completely) ===

  let statusTransitioned = false;

  if (!options.dryRun) {
    // Write all updated Feature files (programmatic changes only)
    for (const result of featureResults) {
      if (result.requiresWrite) {
        await writeFile(result.featurePath, result.updatedContent);
      }
    }

    // If there are NO agent-driven ops, we can set status to applied now.
    // If there ARE agent-driven ops, status transition is deferred until
    // verifyApply() confirms the agent completed its work.
    if (pendingAgentOps.length === 0) {
      updateFrontmatterField(change.path, 'status', 'applied');
      statusTransitioned = true;
    }
  }

  return {
    changeId: options.changeId,
    changeName: change.title,
    success: true,
    staleReport,
    featureResults,
    sectionResults,
    postValidation: allPostValidations,
    pendingAgentOps,
    preEditSnapshots,
    statusTransitioned,
    warnings,
    errors,
  };
}

/**
 * Verify and finalize after agent completes MODIFIED/ADDED content edits.
 * Called in Phase C after the agent has written content guided by pendingAgentOps.
 *
 * 1. Re-reads the Feature notes that had agent-driven changes
 * 2. Post-validates MODIFIED and ADDED postconditions using a DEDICATED check
 *    (not the generic postValidate(), which would compare the note against itself)
 * 3. If all pass, transitions status to 'applied'
 *
 * IMPORTANT (V3-09-01 fix): This function does NOT use the generic postValidate()
 * for agent-driven ops. The generic postValidate() compares originalFeatureNote
 * against updatedFeatureNote, but since the agent has already written to disk,
 * we only have the current (post-edit) note. Passing the same note as both
 * original and updated would always yield hashChanged=false, causing every
 * MODIFIED op to fail with a false "content_hash unchanged" error.
 *
 * Instead, verifyApply() uses base_fingerprint from each DeltaSummaryEntry
 * to validate that the agent actually changed the requirement content.
 * For pre-apply validation, base_fingerprint comparison is authoritative.
 * For post-apply validation, we snapshot content_hashes before Phase B
 * and compare against the snapshot after Phase B.
 */
export async function verifyApply(
  options: ApplyOptions,
  pendingOps: PendingAgentOp[],
  preEditSnapshots: Map<string, Map<string, string>>,  // featureId -> Map<reqName, contentHash>
  index: VaultIndex
): Promise<{ success: boolean; postValidation: PostValidation[]; statusTransitioned: boolean; errors: string[] }> {
  const errors: string[] = [];
  const allPostValidations: PostValidation[] = [];

  // Group pending ops by feature
  const byFeature = new Map<string, PendingAgentOp[]>();
  for (const op of pendingOps) {
    const group = byFeature.get(op.featureId) ?? [];
    group.push(op);
    byFeature.set(op.featureId, group);
  }

  for (const [featureId, ops] of byFeature) {
    const featureRecord = index.getById(featureId);
    if (!featureRecord) {
      errors.push(`Feature "${featureId}" not found during verify`);
      continue;
    }

    const updatedNote = await parseNoteFromPath(featureRecord.path);
    const currentReqs = parseRequirementsSection(updatedNote.rawContent);
    const snapshot = preEditSnapshots.get(featureId) ?? new Map();

    for (const op of ops) {
      const entry = op.entry;

      if (entry.op === 'MODIFIED') {
        const req = currentReqs.get(entry.targetName);
        if (!req) {
          allPostValidations.push({
            entry,
            valid: false,
            error: `Requirement "${entry.targetName}" MUST exist after MODIFIED`,
          });
          errors.push(`Post-validation: Requirement "${entry.targetName}" MUST exist after MODIFIED`);
          continue;
        }
        const currentHash = computeRequirementHash(req);
        // Compare against SNAPSHOT hash (taken before agent edits in Phase B).
        // This correctly detects whether the agent actually modified the content.
        const snapshotHash = snapshot.get(entry.targetName);
        // Also compare against base_fingerprint as a secondary check:
        // if currentHash still equals base_fingerprint, the content is unchanged.
        const changedFromSnapshot = snapshotHash ? currentHash !== snapshotHash : true;
        const changedFromBase = entry.baseFingerprint ? currentHash !== entry.baseFingerprint : true;
        const hashChanged = changedFromSnapshot && changedFromBase;

        allPostValidations.push({
          entry,
          valid: true,
          hashChanged,
          error: !hashChanged
            ? `Requirement "${entry.targetName}" content_hash unchanged after MODIFIED (no-op warning)`
            : undefined,
        });
        if (!hashChanged) {
          errors.push(`Post-validation: MODIFIED requirement "${entry.targetName}" content_hash unchanged (no-op)`);
        }
      }

      if (entry.op === 'ADDED') {
        const exists = currentReqs.has(entry.targetName);
        allPostValidations.push({
          entry,
          valid: exists,
          error: !exists
            ? `Requirement "${entry.targetName}" MUST exist after ADDED`
            : undefined,
        });
        if (!exists) {
          errors.push(`Post-validation: Requirement "${entry.targetName}" MUST exist after ADDED`);
        }
      }
    }
  }

  let statusTransitioned = false;

  if (errors.length === 0) {
    const changeRecord = index.getById(options.changeId);
    if (changeRecord) {
      updateFrontmatterField(changeRecord.path, 'status', 'applied');
      statusTransitioned = true;
    }
  }

  return { success: errors.length === 0, postValidation: allPostValidations, statusTransitioned, errors };
}
```

#### Agent-Phase (Phase B) Failure Recovery

The three-phase execution model (Phase A: mechanical ops, Phase B: agent content edits, Phase C: verifyApply) creates a window where the vault can be in a partially-applied state if Phase B fails (agent crash, incorrect content, partial edit).

**State after Phase B failure:**
- RENAMED/REMOVED ops are already written to disk (Phase A completed successfully)
- MODIFIED/ADDED ops are incomplete or incorrect
- Status is NOT `applied` (Phase C hasn't run)
- `preEditSnapshots` was captured before Phase B started

**Recovery strategy (v1):**

1. **Detection**: If the agent crashes during Phase B, the Change note remains at `in_progress` status with `pendingAgentOps` still pending. Re-running `ows apply <changeId>` will detect this state.

2. **Re-run apply**: Since `applyChange()` runs pre-validation before any writes:
   - RENAMED ops are **idempotent**: if old name already doesn't exist and new name does, the pre-validation detects "already applied" and skips. The `applySingleOperation` for RENAMED returns success if the new name exists and the old name doesn't.
   - REMOVED ops are **idempotent**: if the requirement is already gone, the pre-validation detects "requirement not found for REMOVE" and treats it as a warning (not an error) since the postcondition is already satisfied.
   - MODIFIED/ADDED agent ops are re-attempted: the agent gets fresh `pendingAgentOps` and tries again.

3. **Manual recovery**: If re-run doesn't work (e.g., Feature content is corrupted), the user can:
   - Use `git diff` to see what changed in the Feature file
   - Restore the Feature from git: `git checkout -- wiki/03-features/<feature>.md`
   - Re-run `ows apply` from scratch

4. **Future enhancement (v2)**: Store a backup copy of each affected Feature note before Phase A writes. If Phase B fails, offer `ows apply --rollback <changeId>` to restore from backup.

**Design rationale:** v1 relies on git as the recovery mechanism rather than implementing a custom backup/restore system. This is pragmatic because every ows vault is expected to be in a git repository, and git provides the exact file-level rollback capability needed.

#### Hybrid Lifecycle (Keep Then Archive)

```typescript
// src/core/workflow/apply.ts (continued)

/**
 * Archive an applied Change by moving it to 99-archive/.
 * Separate from apply -- this is invoked explicitly or after retention window.
 *
 * The Change note:
 * - Retains its id (immutable)
 * - Moves from wiki/04-changes/<name>.md to wiki/99-archive/<name>.md
 * - Wikilinks using the note title still resolve because id-based lookup is primary
 *
 * This preserves the hybrid lifecycle from overview.md section 6.2C:
 * applied -> (retention period) -> archived
 */
export interface ArchiveOptions {
  changeId: string;
  vaultRoot: string;
}

export async function archiveChange(
  options: ArchiveOptions,
  index: VaultIndex
): Promise<{ success: boolean; fromPath: string; toPath: string; indexInvalidated: boolean; error?: string }> {
  const changeRecord = index.getById(options.changeId);
  if (!changeRecord) {
    throw new Error(`Change "${options.changeId}" not found`);
  }

  const note = await parseNoteFromPath(changeRecord.path);
  const status = note.frontmatter.status as string;

  if (status !== 'applied') {
    return {
      success: false,
      fromPath: changeRecord.path,
      toPath: '',
      indexInvalidated: false,
      error: `Cannot archive change with status "${status}". Must be "applied".`,
    };
  }

  // Compute archive path
  const filename = path.basename(changeRecord.path);
  const archiveDir = path.join(options.vaultRoot, 'wiki', '99-archive');
  const toPath = path.join(archiveDir, filename);

  // Check for collision
  if (await fileExists(toPath)) {
    return {
      success: false,
      fromPath: changeRecord.path,
      toPath,
      indexInvalidated: false,
      error: `Archive target already exists: ${toPath}`,
    };
  }

  // Move file
  await ensureDir(archiveDir);
  await moveFile(changeRecord.path, toPath);

  // The index is now stale: the old path no longer exists and
  // the new path is not yet indexed. The caller MUST rebuild
  // the index after archiving to keep links_in/links_out correct.
  return {
    success: true,
    fromPath: changeRecord.path,
    toPath,
    indexInvalidated: true,
  };
}
```

### File Structure

```
src/core/workflow/
  apply.ts              # Main apply orchestrator + archiveChange
  delta-parser.ts       # parseDeltaSummary() + validateDeltaConflicts()
  stale-detector.ts     # detectStale() + computeRequirementHash()
  feature-updater.ts    # applyDeltaToFeature() + atomic ordering
  section-updater.ts    # applySectionOps()
  apply-validator.ts    # preValidate() + postValidate()
  types.ts              # All shared types (extended from existing)

src/cli/commands/
  apply.ts              # CLI command handler
  archive.ts            # CLI archive command handler
```

### Public API / Interface

```typescript
// Exported from src/core/workflow/apply.ts
export { applyChange, verifyApply, archiveChange } from './apply.js';
export type { ApplyOptions, ApplyResult, PendingAgentOp, ArchiveOptions } from './apply.js';

// Exported from src/core/workflow/delta-parser.ts
export { parseDeltaSummary, validateDeltaConflicts } from './delta-parser.js';
export type { DeltaEntry, DeltaPlan } from './delta-parser.js';

// Exported from src/core/workflow/stale-detector.ts
export { detectStale } from './stale-detector.js';
export type { StaleReport, StaleCheckResult } from './stale-detector.js';

// Exported from src/core/workflow/feature-updater.ts
export { applyDeltaToFeature } from './feature-updater.js';
export type { FeatureApplyResult, ApplyOperationResult } from './feature-updater.js';

// Exported from src/core/workflow/apply-validator.ts
export { preValidate, postValidate } from './apply-validator.js';
export type { PreValidation, PostValidation } from './apply-validator.js';
```

### Dependencies on Other Modules

| Module | What is Needed | Plan |
|--------|---------------|------|
| `core/parser` | `parseNoteFromPath()`, `ParsedNote`, `SectionContent`, requirement extraction | 03-vault-parser |
| `core/index` | `VaultIndex`, `resolveWikilink()`, `getById()` | 04-index-engine |
| `core/schema` | Zod schemas for frontmatter validation | 02-note-templates |
| `core/workflow/continue` | `getUncheckedTasks()`, `parseTasks()` | 08-workflow-continue |
| `util/hash` | `computeContentHash()` for requirement hashing | 01-project-structure |
| `util/path` | Path normalization utilities | 01-project-structure |

---

## 4. Test Strategy

### Unit Tests

**`delta-parser.test.ts`:**
- Parse valid ADDED entry -> correct DeltaEntry with op, targetName, targetNote, baseFingerprint: null
- Parse valid MODIFIED entry -> correct base_fingerprint extracted
- Parse valid REMOVED entry -> correct structure
- Parse valid RENAMED entry -> old name, new name, base_fingerprint
- Parse section ADDED entry -> targetType: 'section'
- Parse section MODIFIED entry -> description extracted
- Unparseable line -> added to warnings, not to entries
- Empty Delta Summary -> empty entries + warning
- Mixed requirement and section entries -> correctly separated

**`delta-parser.test.ts` (conflict validation):**
- MODIFIED + REMOVED same name -> error
- MODIFIED + ADDED same name -> error
- ADDED + REMOVED same name -> error
- RENAMED FROM + MODIFIED old name -> error suggesting new name
- RENAMED TO + ADDED collision -> error
- Duplicate ADDED same name -> error
- No conflicts -> empty errors array

**`stale-detector.test.ts`:**
- ADDED entry -> always clean (no base to check)
- MODIFIED with matching base_fingerprint -> clean
- MODIFIED with mismatched base_fingerprint -> stale, blocked
- REMOVED with requirement missing -> stale (already removed by another change)
- RENAMED with matching base -> clean
- Target Feature note not found -> stale with "not found" reason
- All entries clean -> `blocked: false`
- One stale entry among many clean -> `blocked: true`

**`feature-updater.test.ts`:**
- RENAMED: old name exists, new doesn't -> success, map updated
- RENAMED: old name doesn't exist -> error
- RENAMED: new name already exists -> collision error
- REMOVED: name exists -> success, removed from map
- REMOVED: name doesn't exist -> error
- ADDED: name doesn't exist -> success
- ADDED: name already exists -> error
- Atomic order: RENAMED before REMOVED before MODIFIED before ADDED
  - Create a scenario where order matters (RENAME X->Y, then ADD X) -> succeeds in correct order
  - Same scenario in wrong order (ADD X first, then RENAME X->Y) -> would fail

**`apply-validator.test.ts` (pre-validation):**
- ADDED + requirement exists -> invalid
- ADDED + requirement doesn't exist -> valid
- MODIFIED + requirement exists -> valid
- MODIFIED + requirement doesn't exist -> invalid
- REMOVED + requirement exists -> valid
- REMOVED + requirement doesn't exist -> invalid
- RENAMED + old exists, new doesn't -> valid
- RENAMED + old doesn't exist -> invalid
- RENAMED + new already exists -> invalid

**`apply-validator.test.ts` (post-validation):**
- ADDED + requirement now exists -> valid
- ADDED + requirement still missing -> invalid
- MODIFIED + requirement exists + hash changed -> valid
- MODIFIED + requirement exists + hash unchanged -> warning (no-op)
- REMOVED + requirement gone -> valid
- REMOVED + requirement still exists -> invalid
- RENAMED + old gone, new exists -> valid
- RENAMED + old still exists -> invalid

### Integration Tests

**End-to-end apply flow:**
- Create a Feature with 2 requirements, a Change with Delta Summary (ADD 1, MODIFY 1), run applyChange() -> Feature has 3 requirements, modified one has new content, status is 'applied'
- Create a Change with stale base_fingerprint -> apply returns blocked, no changes written
- Create a Change with stale base_fingerprint + forceStale option -> applies with warnings
- Dry run mode -> no files written, result shows what would happen
- Change with section operations -> sections added/modified/removed correctly
- Change with status 'planned' -> error (only 'in_progress' accepted)
- Change with status 'proposed' -> error

**Two-phase commit tests:**
- Multi-Feature Change: Feature A ops valid, Feature B ops invalid -> NOTHING written (neither A nor B)
- Multi-Feature Change: all ops valid -> ALL Features written atomically
- Single-Feature Change: pre-validation fails -> no files written, no status change
- Dry run on multi-Feature -> computes all results but writes nothing

**Lifecycle test:**
- Apply + then archive -> file moved from `04-changes/` to `99-archive/`, id preserved in frontmatter, indexInvalidated: true
- Attempt archive on non-applied Change -> error, indexInvalidated: false

### Edge Cases

- Delta Summary with no entries -> error (nothing to apply)
- Delta Summary with only section operations (no requirement ops) -> applies section ops only
- Feature with no `## Requirements` section -> ADDED creates the section; MODIFIED/REMOVED/RENAMED error
- MODIFIED entry that doesn't actually change anything -> post-validation warning
- Same requirement name in different Features -> operations are scoped per Feature
- Cross-cutting Change with multiple Features -> two-phase commit ensures atomicity
- Requirement name with special characters (quotes, brackets) -> regex handles escaping
- Very large Feature note (1000+ lines) -> performance acceptable
- Concurrent apply attempts on same Feature -> file-level write lock or last-write-wins with hash check

---

## 5. Implementation Order

### Prerequisites

- Plan 03 (Vault Parser): `parseNoteFromPath()`, requirement extraction, section parsing
- Plan 04 (Index Engine): `VaultIndex`, `resolveWikilink()`, `getById()`
- Plan 02 (Note Templates): Feature and Change frontmatter/section contracts
- Plan 08 (Workflow Continue): `getUncheckedTasks()`, `parseTasks()`
- Plan 01 (Project Structure): `util/hash.ts` for content hashing

### Build Order

```
Step 1: Delta Summary Parser
  - Implement regex patterns for all Delta Summary grammar forms
  - Implement parseDeltaSummary()
  - Implement validateDeltaConflicts()
  - Test: all delta-parser unit tests
  - No dependencies beyond parser types

Step 2: Stale Detector
  - Implement detectStale()
  - Implement computeRequirementHash()
  - Test: all stale-detector unit tests
  - Depends on: delta parser, requirement parsing, hash utility

Step 3: Apply Validator
  - Implement preValidate()
  - Implement postValidate()
  - Test: all apply-validator unit tests
  - Depends on: delta parser types, requirement parsing

Step 4: Feature Updater
  - Implement applyDeltaToFeature()
  - Implement atomic ordering (getAtomicPriority)
  - Implement applySingleOperation() for each op type
  - Test: all feature-updater unit tests
  - Depends on: delta parser, requirement parsing

Step 5: Section Updater
  - Implement applySectionOps()
  - Test: section operation tests
  - Depends on: delta parser, section parsing

Step 6: Main Apply Orchestrator
  - Wire all components into applyChange()
  - Implement archiveChange()
  - Test: integration tests
  - Depends on: all above + index + status transition

Step 7: CLI Commands
  - Implement apply CLI command
  - Implement archive CLI command
  - Test: CLI smoke tests
```

### Dependency Graph

```
01-project-structure (util/hash)
  |
  v
02-note-templates (Feature/Change contracts)
  |
  v
03-vault-parser (parseNote, requirement extraction)
  |
  v
04-index-engine (VaultIndex, resolveWikilink)
  |
  v
08-workflow-continue (status transition, task parsing)
  |
  v
09-workflow-apply
  delta-parser.ts       (depends on: parser types)
  stale-detector.ts     (depends on: delta-parser, hash, parser)
  apply-validator.ts    (depends on: delta-parser, parser)
  feature-updater.ts    (depends on: delta-parser, parser)
  section-updater.ts    (depends on: delta-parser, parser)
  apply.ts              (orchestrates all above + index + transitions)
```
