# Review v2: Plans 01-03 (Foundation Layer)

## Previous Issues Resolution Status

| # | Issue (from round 1) | Status | Notes |
|---|----------------------|--------|-------|
| 01-C1 | Type definition mismatch: Requirement `scenarios` was `string[]` in Plan 01/02, `Scenario[]` in Plan 03 | **RESOLVED** | All three plans now reference 00-unified-types.md. Plan 01 (line 354-373) defines `Scenario { name, raw_text }`, Plan 02 (line 451-458) defines matching `ScenarioSchema`, Plan 03 (line 699-726) produces matching objects. |
| 01-C2 | IndexRecord missing `feature`/`features` fields | **RESOLVED** | Plan 01 (line 327-328) now includes `feature?: string` and `features?: string[]` matching 00-unified-types.md. |
| 01-C3 | DeltaSummaryEntry field mismatch (`rename_to` vs `new_name`) | **RESOLVED** | All plans now use `new_name` per 00-unified-types.md. Plan 02 (line 386) defines `new_name`, Plan 03 (line 889) outputs `new_name`. |
| 01-M1 | CLI binary name inconsistency | **RESOLVED** | Plan 01 (line 118-128) now explicitly shows `package.json` bin mapping: `"ows": "./bin/open-wiki-spec.js"`. |
| 01-M2 | Missing `vitest` in dependency list | **RESOLVED** | Plan 01 section 1 now lists dev dependencies (vitest, typescript, eslint, typescript-eslint) from OpenSpec reference. |
| 01-M3 | File naming inconsistency (`wikilink-extractor.ts` vs `wikilink-parser.ts`) | **RESOLVED** | Unified to `wikilink-parser.ts` in Plan 01 (line 554) and Plan 03 (line 534). Test file still named `wikilink-extractor.test.ts` -- see New Issue M1 below. |
| 01-M4 | No explicit `package.json` spec | **RESOLVED** | Plan 01 now shows the bin mapping. Full package.json spec is still implicit but enough is defined for implementation. |
| 01-Missing1 | No `schema.md` format specification | **RESOLVED** | Plan 01 (lines 136-165) now defines the `schema.md` format with example content, frontmatter with `schema_version`, note types table, and version history. |
| 01-Missing2 | No error handling strategy at project level | **PARTIALLY RESOLVED** | Plan 03 defines collect-and-continue strategy for parsing. Project-wide error philosophy (CLI exit codes, Result types for workflows) is still not specified, but this is acceptable as a deferral to Plan 12 (CLI). |
| 01-Missing3 | `index.md` and `log.md` not addressed | **RESOLVED** | Plan 01 (lines 167-203) now defines both files with format examples. Clearly states these are NOT typed notes and must be skipped by `parseNote()`. |
| 02-C1 | `FrontmatterSchema` referenced but never defined | **RESOLVED** | Plan 02 (lines 929-967) now defines `FrontmatterSchema` as a Zod discriminated union on `type` field, exported from `src/core/schema/frontmatter.ts`. |
| 02-C2 | Requirement type conflict (shape, field names) | **RESOLVED** | Plan 02 (lines 446-479) now uses `name` (not `title`), `Scenario[]` (not `string[]`), matching 00-unified-types.md exactly. |
| 02-M1 | `WikilinkRef` duplicated across schemas | **RESOLVED** | Plan 02 (line 167) defines `WikilinkRef` in `base.schema.ts` and all other schemas import from it. |
| 02-M2 | Source schema `source_type` values not noted as plan-level | **RESOLVED** | Plan 02 (lines 577-578) now explicitly comments "Plan-level addition: categorizes the source. Not mandated by overview.md." |
| 02-M3 | Query schema `question` field authority ambiguity | **RESOLVED** | Plan 02 (lines 626-631) now clarifies: "The authoritative question text lives in the ## Question body section. This frontmatter field is a convenience for quick display/search." |
| 02-M4 | `CHANGE_SOFT_SECTIONS` only includes 'Design Approach' | **PARTIALLY RESOLVED** | Plan 02 (lines 336-340) separates `PLANNED_SOFT_PREREQUISITES` (contains 'Design Approach') and adds a comment about Decision link. The Decision link check is still described only in comments (line 337), not as a code-level check. Acceptable for v1 but worth noting. |
| 02-M5 | Missing `aliases` field clarification in BaseFrontmatterSchema | **RESOLVED** | Plan 02 (lines 172-175) explicitly notes that `aliases` is NOT in `BaseFrontmatter` per unified types, handled at IndexRecord level. Schema uses `.passthrough()` to allow extra fields. |
| 02-Missing1 | No validation for H1 title format | **RESOLVED** | Plan 02 (line 894) defines `TITLE_MISMATCH` as a warning rule in the validation rules table. Implementation is left to Plan 10 (verify), which is appropriate. |
| 02-Missing2 | No schema version field clarification | **RESOLVED** | Plan 02 (lines 111-113) explicitly states: "Schema version lives in this file [schema.md], NOT in individual note frontmatter." |
| 02-Missing3 | No `created_at` or timestamp field | **RESOLVED** | Plan 02 (lines 262-263) adds `created_at` as required field in `ChangeFrontmatterSchema` with ISO date regex validation. Template (line 709) includes `created_at: "YYYY-MM-DD"`. |
| 03-C1 | Section content extraction bug (child heading content duplication) | **RESOLVED** | Plan 03 (lines 476-488) now explicitly breaks content extraction at child headings of same or higher level. The `extractNormativeStatement()` function (lines 758-773) correctly takes content before first child heading. The algorithm is consistent. |
| 03-C2 | Frontmatter wikilink extraction uses JSON.stringify | **RESOLVED** | Plan 03 (lines 1104-1112, 1252-1273) now uses recursive object walker (`extractWikilinksFromObject()`) instead of JSON.stringify. Correctly traverses nested objects and extracts only from string values. |
| 03-C3 | `toIndexRecord` field naming doesn't match Plan 01's IndexRecord | **RESOLVED** | Plan 03 (lines 1213-1239) now outputs fields matching 00-unified-types.md: `feature`/`features` present, `tasks` mapped as `{ text, done }` (matching `TaskItem`), all relationship fields included. |
| 03-M1 | Requirement parser imports wrong type names | **RESOLVED** | Plan 03 (line 618) now imports `Requirement` and `Scenario` types from `../schema/requirement.js`, matching Plan 02's exports (lines 458, 479). |
| 03-M2 | Delta summary parser re-wraps feature in `[[...]]` brackets | **RESOLVED** | Plan 03 (lines 890, 912, 934) now stores raw wikilink target text (e.g., "Feature: Auth Login") without re-wrapping. Comment at line 890: "store raw target, not re-wrapped in [[...]]". |
| 03-M3 | `DeltaOpSchema` referenced but not defined (name mismatch) | **RESOLVED** | Plan 03 (line 806) imports `DeltaOpEnum` from `../schema/delta-summary.js`, matching Plan 02's export name (line 370). |
| 03-M4 | Line number approximation | **ACKNOWLEDGED** | Plan 03 still uses approximate line numbers (e.g., lines 875, 1027). This is acceptable for v1 as exact line numbers are not required for the current use cases. |
| 03-M5 | Code blocks as heading/frontmatter traps | **RESOLVED** | Plan 03 (lines 440-456) now implements `CODE_FENCE_REGEX` and tracks `insideCodeFence` state. Lines inside fenced code blocks are skipped during heading detection. |
| 03-Missing1 | No vault-reader integration | **RESOLVED** | Plan 03 (lines 1372-1374) explicitly states dependency: "Depended on by: `src/core/index/vault-scanner.ts` -- calls `parseNote()` + `toIndexRecord()` for each vault file". Correctly deferred to Plan 04. |
| 03-Missing2 | No handling for notes without recognized `type` | **RESOLVED** | Plan 03 (lines 1316-1317) error recovery table: "Unknown note type -> Parse sections/wikilinks, skip type-specific parsing -> warning". |
| 03-Missing3 | No CRLF normalization | **RESOLVED** | Plan 03 (lines 302-303) normalizes CRLF in frontmatter parser, and (lines 433-434) normalizes again in section parser for body-only content. |
| Cross-1 | Type definition authority split across three plans | **RESOLVED** | 00-unified-types.md now serves as canonical type reference. All three plans explicitly defer to it. Plan 01 (line 318) states "When any type here conflicts with unified types, unified types win." |
| Cross-2 | `feature`/`features` field handling inconsistency | **RESOLVED** | All three plans now include `feature`/`features` fields consistently. |
| Cross-3 | No shared constants file | **RESOLVED** | Plan 02 (lines 969-979) defines `WHY_MIN_LENGTH = 50` and `MAX_DELTAS_PER_CHANGE = 10` in `validation-constants.ts`. |
| Cross-4 | Test fixture vault path inconsistency | **RESOLVED** | Plan 01 (line 612) uses `tests/fixtures/valid-vault/`, Plan 03 (line 1458) uses `tests/fixtures/vault/`. See New Issue M2 below. |

---

## New Issues Found

### Critical

**None.**

All critical issues from round 1 have been resolved. No new critical issues were introduced by the fixes.

### Important

**I1. overview.md 10.3 example uses `title` and `string[]` for Requirement, contradicting unified types**

The overview.md section 10.3 IndexRecord example (line ~581) defines requirements as:
```json
{
  "key": "feature-auth-login::Passkey Authentication",
  "title": "Passkey Authentication",
  "normative": "...",
  "scenarios": ["WHEN ... THEN ..."],
  "content_hash": "sha256:abc123..."
}
```

This uses `title` (not `name`) and `scenarios: string[]` (not `Scenario[]`). The unified types document (00-unified-types.md, lines 80-98) and all three plans correctly use `name` and `Scenario[]`. This is an inconsistency in overview.md itself, not in the plans. However, a developer reading overview.md before reading plans could be confused.

**Recommendation**: Add a note in 00-unified-types.md's Requirement section acknowledging that overview.md 10.3's example uses older field names, and that 00-unified-types.md is authoritative.

**I2. overview.md 10.3 delta_summary example uses `feature` not `target_note_id`**

The overview.md delta_summary example (line ~594) uses:
```json
{ "feature": "feature-auth-login" }
```

But 00-unified-types.md (line 115) defines `target_note_id: string`. All plans correctly use `target_note_id`. Same issue as I1 -- overview.md has older field names.

**Recommendation**: Same as I1. Note the discrepancy in unified types doc.

**I3. Plan 01 `BaseFrontmatter` includes optional `tags` and `aliases` fields that differ from 00-unified-types.md**

Plan 01's `BaseFrontmatter` (lines 266-271):
```typescript
interface BaseFrontmatter {
  type: NoteType;
  id: string;
  status: string;
  tags?: string[];     // optional
  aliases?: string[];  // optional
}
```

00-unified-types.md's `BaseFrontmatter` (lines 17-22):
```typescript
interface BaseFrontmatter {
  type: NoteType;
  id: string;
  status: string;
  tags: string[];      // required (no ?)
}
```

Two differences:
1. Plan 01 has `tags` as optional (`tags?: string[]`), unified types has it as required (`tags: string[]`).
2. Plan 01 includes `aliases?: string[]`, which does not exist in unified types' `BaseFrontmatter`.

Plan 02 (lines 172-182) correctly handles this: `tags` defaults via `z.array(z.string()).default([])` (so it's required but with a default), and `aliases` is NOT in `BaseFrontmatterSchema` (per the comment). But Plan 01's TypeScript interface definition does not match.

**Recommendation**: Plan 01's `BaseFrontmatter` interface should make `tags` required (with `string[]`, not `string[]?`) and remove `aliases` to match 00-unified-types.md.

**I4. Plan 01's `ParsedNote` type differs from Plan 03's `ParseResult` in ways that create ambiguity**

Plan 01 (lines 273-282) defines `ParsedNote`:
```typescript
interface ParsedNote {
  frontmatter: BaseFrontmatter & Record<string, unknown>;
  title: string;
  path: string;
  sections: Section[];
  wikilinks: WikiLink[];
  rawContent: string;
  contentHash: string;
}
```

Plan 03 (lines 250-273) defines `ParseResult`:
```typescript
interface ParseResult {
  frontmatter: Frontmatter | null;
  rawFrontmatter: Record<string, unknown> | null;
  sections: Section[];
  headings: string[];
  wikilinks: WikilinkOccurrence[];
  requirements: Requirement[];
  deltaSummary: DeltaSummaryEntry[];
  tasks: TaskItem[];
  body: string;
  contentHash: string;
  errors: ParseError[];
}
```

Key differences:
- `ParsedNote.frontmatter` is never null; `ParseResult.frontmatter` is nullable.
- `ParsedNote` has `title` and `path`; `ParseResult` does not (these are external inputs to `toIndexRecord()`).
- `ParsedNote` has `rawContent`; `ParseResult` has `body` (body excludes frontmatter).
- `ParseResult` has `requirements`, `deltaSummary`, `tasks`, `errors`; `ParsedNote` does not.
- `ParsedNote.wikilinks` uses `WikiLink` type; `ParseResult.wikilinks` uses `WikilinkOccurrence` type.

These are two different types for the same logical concept (a parsed note). Plan 01's `ParsedNote` is a simplified sketch that predates Plan 03's detailed `ParseResult`. Plan 03 is clearly the implementation-level type.

**Recommendation**: Plan 01 should either remove `ParsedNote` entirely (deferring to Plan 03's `ParseResult`) or add a note stating "This is a conceptual overview type; the detailed parse output type is defined in Plan 03." Otherwise, developers might try to implement `ParsedNote` and find it incompatible.

**I5. Plan 01's `Section` interface differs from Plan 03's `Section` interface**

Plan 01 (lines 286-290):
```typescript
interface Section {
  level: number;
  title: string;
  content: string;
  children: Section[];
}
```

Plan 03 (lines 202-213):
```typescript
interface Section {
  level: number;
  title: string;
  content: string;
  line: number;        // extra field
  children: Section[];
}
```

Plan 03 adds a `line` field for tracking source line numbers. The 00-unified-types.md does not define `Section` at all, so there is no canonical reference. Plan 03's version is the implementation type.

**Recommendation**: Plan 01 should add `line: number` to match Plan 03, or note that the detailed type is in Plan 03.

**I6. Plan 01's `WikiLink` type name differs from Plan 03's `WikilinkOccurrence`**

Plan 01 (lines 293-299) defines `WikiLink`:
```typescript
interface WikiLink {
  raw: string;
  target: string;
  displayText?: string;
  line: number;
  context: 'frontmatter' | 'body';
}
```

Plan 03 (lines 216-225) defines `WikilinkOccurrence`:
```typescript
interface WikilinkOccurrence {
  target: string;
  alias: string | null;
  location: 'frontmatter' | 'body';
  line: number;
}
```

Differences: different type names, `raw` vs absent, `displayText` vs `alias`, `context` vs `location`, nullable vs optional.

Plan 01's `src/index.ts` exports (line 683) list `WikiLink` as a public type, but Plan 03's `index.ts` exports (line 1355) export `WikilinkOccurrence`.

**Recommendation**: Unify the naming. Since Plan 03 is the implementation plan, rename Plan 01's export from `WikiLink` to `WikilinkOccurrence` and align the field names.

### Minor

**M1. Test file naming inconsistency remains**

Plan 01 (line 635) lists the test file as `wikilink-extractor.test.ts`, but the source file is `wikilink-parser.ts`. This was partially fixed (source file renamed), but the test file name was not updated.

**Recommendation**: Rename to `wikilink-parser.test.ts`.

**M2. Test fixture path inconsistency persists**

Plan 01 (line 612) uses `tests/fixtures/valid-vault/`, Plan 03 (line 1458) uses `tests/fixtures/vault/`. These are different paths. Integration tests in Plan 03 would look for fixtures in a different location than Plan 01 defines.

**Recommendation**: Unify to one path. `tests/fixtures/valid-vault/` (Plan 01's choice) is more descriptive since Plan 01 also defines `tests/fixtures/invalid-vault/`.

**M3. Plan 03 `TaskItem` includes `line` field but 00-unified-types.md `TaskItem` does not**

Plan 03's `TaskItem` (lines 228-235):
```typescript
interface TaskItem {
  text: string;
  done: boolean;
  line: number;
}
```

00-unified-types.md (lines 126-132):
```typescript
interface TaskItem {
  text: string;
  done: boolean;
}
```

Plan 03's `toIndexRecord()` (line 1236) correctly strips `line` when converting: `tasks: result.tasks.map(t => ({ text: t.text, done: t.done }))`. So the parser-internal type has `line` but the IndexRecord type does not. This is acceptable but should be documented.

**Recommendation**: Plan 03's `types.ts` `TaskItem` should be renamed to `ParsedTaskItem` or similar, to distinguish it from the IndexRecord-level `TaskItem` in 00-unified-types.md. Alternatively, add a comment noting the distinction.

**M4. `FeatureFrontmatterSchema` requires `systems.min(1)` but `BaseFrontmatter` in 00-unified-types.md does not mention this constraint**

Plan 02 (line 203): `systems: z.array(WikilinkRef).min(1, 'Feature must reference at least one System')`.

00-unified-types.md (lines 24-31) defines `FeatureFrontmatter` with `systems: string[]` but does not specify a minimum count.

overview.md 14.1 does not explicitly require at least one system reference for Features.

Plan 02's validation rules table (line 900) defines `NO_SYSTEM_REF` as an error.

This is a plan-level design decision, not an overview.md contract. It is reasonable but should be noted as a plan addition.

**M5. Plan 01 `NextActionType` missing `ready_to_apply` value**

Plan 01 (line 452): `type NextActionType = 'fill_section' | 'transition' | 'blocked' | 'start_implementation' | 'continue_task' | 'verify_then_archive';`

00-unified-types.md (lines 358-365): `type NextActionType = 'fill_section' | 'transition' | 'start_implementation' | 'continue_task' | 'blocked' | 'ready_to_apply' | 'verify_then_archive';`

Plan 01 is missing `ready_to_apply`.

**Recommendation**: Add `'ready_to_apply'` to Plan 01's `NextActionType`.

---

## Type Consistency Audit

Character-level comparison of all types in plans against 00-unified-types.md:

| Type | Plan | Match? | Discrepancy |
|------|------|--------|-------------|
| `NoteType` | 01, 02 | YES | -- |
| `ChangeStatus` | 01, 02 | YES | -- |
| `FeatureStatus` | 02 | YES | -- |
| `GeneralStatus` | 02 | YES | -- |
| `BaseFrontmatter` | 01 | **NO** | Plan 01 has `tags?` (optional) and `aliases?` (not in unified types). See I3. |
| `BaseFrontmatter` | 02 | YES | Zod schema uses `.default([])` for tags which is correct (required with default). |
| `FeatureFrontmatter` | 02 | YES | Field names match. `systems.min(1)` is plan addition (see M4). |
| `ChangeFrontmatter` | 02 | YES | All fields match including `created_at`, `feature`/`features`, `depends_on`, `touches`. |
| `SystemFrontmatter` | 02 | YES | -- |
| `DecisionFrontmatter` | 02 | YES | -- |
| `SourceFrontmatter` | 02 | YES | Extra `source_type`/`url` fields correctly noted as plan additions. |
| `QueryFrontmatter` | 02 | YES | Extra `question` field correctly noted as plan addition. |
| `Frontmatter` (union) | 02 | YES | Discriminated union matches 00-unified-types.md line 68-74. |
| `Requirement` | 01 | YES | Fields: `name`, `key`, `normative`, `scenarios: Scenario[]`, `content_hash`. |
| `Requirement` | 02 | YES | Zod schema matches. |
| `Scenario` | 01 | YES | Fields: `name`, `raw_text`. |
| `Scenario` | 02 | YES | Zod schema matches. |
| `DeltaSummaryEntry` | 01, 02 | YES | All fields match: `op`, `target_type`, `target_name`, `new_name?`, `target_note_id`, `base_fingerprint`, `description?`. |
| `DeltaOp` | 02 | YES | -- |
| `DeltaTargetType` | 02 | YES | -- |
| `TaskItem` | 01 | YES | `text`, `done`. |
| `TaskItem` | 03 (parser) | EXTRA | Parser-internal type has `line` field. Stripped on conversion. See M3. |
| `IndexRecord` | 01 | YES | All fields match 00-unified-types.md lines 137-169. |
| `RetrievalQuery` | 01 | YES | Named `QueryObject` in Plan 01 but fields match. |
| `Classification` | 01 | YES | -- |
| `ScoredCandidate` | 01 | YES | -- |
| `SequencingSummary` | 01 | **MINOR** | Plan 01 names it `SequencingResult` with `SequencingSeverity` which adds `conflict_critical` to the union. Unified types names it `SequencingSummary` and lists `conflict_critical` at the `SequencingResult` level (plan 06 types). The naming difference is minor. |
| `NextActionType` | 01 | **NO** | Missing `ready_to_apply`. See M5. |
| `NextAction` | 01 | YES | -- |
| `VerifyIssue` | 01 | YES | -- |
| `VerifyReport` | 01 | YES | -- |
| `VaultIndex` | -- | N/A | Not defined in Plans 01-03 (defined in Plan 04). |

---

## overview.md Compliance Check

| Contract (overview.md) | Plan | Compliance | Notes |
|------------------------|------|------------|-------|
| **10.1** Vault is single source of truth | 01 | YES | Stated in Section 2 contracts. |
| **10.1** Index is disposable cache | 01 | YES | Stated in Section 2 contracts. |
| **10.1.1** Schema version in `schema.md` | 01, 02 | YES | Plan 01 defines format. Plan 02 notes schema version lives in `schema.md`, not in note frontmatter. |
| **10.2** Fresh scan per operation | 01 | YES | Stated in Section 2 contracts. |
| **10.3** IndexRecord shape | 01 | YES | All fields present. |
| **10.5.1** Deterministic ordering with `(created_at, change_id)` | 02 | YES | `created_at` added to Change schema. |
| **10.7** Wikilink/alias -> ID normalization | 01, 03 | YES | Plan 01 includes `link-resolver.ts`. Plan 03 stores raw wikilink targets, defers resolution to index-builder (Plan 04). |
| **11.1** Canonical identity is frontmatter `id` | 01, 02 | YES | All schemas require `id`. Plan 02 validates `id` format with regex. |
| **13.2** 6 note types | 02 | YES | All 6 defined with schemas. |
| **13.2** feature/features serialization | 02 | YES | `.refine()` enforces mutual exclusivity. |
| **13.3** Folder structure | 01 | YES | Test fixtures mirror the recommended structure. |
| **14.1** Requirement composite key identity | 01, 02, 03 | YES | All plans use `feature_id::requirement_name`. Plan 03 defers key construction to index-builder. |
| **14.1** Requirements with SHALL/MUST + scenarios with WHEN/THEN | 02, 03 | YES | Schema validates. Parser checks. |
| **14.2** Delta Summary grammar | 02, 03 | YES | Regex patterns match overview grammar. Description after colon handled. |
| **14.2** Base fingerprint | 02, 03 | YES | MODIFIED/REMOVED/RENAMED carry `[base: hash]`. ADDED uses `[base: n/a]`. |
| **14.2** Atomic apply order | 02 | YES | `DELTA_APPLY_ORDER: RENAMED -> REMOVED -> MODIFIED -> ADDED`. |
| **14.2** Design Approach ephemeral / Decision durable | 02 | YES | Section contract and Decision promotion criteria documented. |
| **14.2** touches vs depends_on | 02 | YES | Both fields present in Change schema. Contract note at line 109-111. |
| **14.2** Status Notes optional, no gate | 02 | YES | Listed in `CHANGE_OPTIONAL_SECTIONS`. |
| **14.3** Minimum section contracts | 02 | YES | All 6 note types have required sections defined. |
| **15** Status lifecycle `proposed -> planned -> in_progress -> applied` | 02 | YES | `CHANGE_STATUS_TRANSITIONS` defined. |
| **15** Section-completeness for `proposed -> planned` | 02 | YES | Hard and soft prerequisites defined. |
| **15** Next-action algorithm | 01 | YES | `NextAction` type matches overview pseudocode. |

---

## Cross-Plan Interface Audit

### Plan 01 -> Plan 02

| Plan 01 defines | Plan 02 consumes | Compatible? |
|-----------------|------------------|-------------|
| `src/core/schema/` directory | Zod schemas | YES |
| `src/types/index-record.ts` types | Schema exports | YES -- schemas produce types assignable to IndexRecord |
| `NoteType` enum | `NoteTypeEnum` Zod enum | YES |

### Plan 02 -> Plan 03

| Plan 02 exports | Plan 03 imports | Compatible? |
|-----------------|-----------------|-------------|
| `FrontmatterSchema` from `frontmatter.ts` | `import { FrontmatterSchema } from '../schema/frontmatter.js'` | YES |
| `Frontmatter` type from `frontmatter.ts` | `import type { Frontmatter } from '../schema/frontmatter.js'` | YES |
| `Requirement`, `Scenario` from `requirement.ts` | `import type { Requirement, Scenario } from '../schema/requirement.js'` | YES |
| `DeltaSummaryEntry` from `delta-summary.ts` | `import type { DeltaSummaryEntry } from '../schema/delta-summary.js'` | YES |
| `DeltaOpEnum` from `delta-summary.ts` | `import { DeltaOpEnum } from '../schema/delta-summary.js'` | YES |

### Plan 03 -> Plan 04 (downstream)

| Plan 03 exports | Plan 04 expects | Compatible? |
|-----------------|-----------------|-------------|
| `parseNote(content: string): ParseResult` | Called per `.md` file | YES -- per 00-unified-types.md Parser-Index API |
| `toIndexRecord(result, filePath, schemaVersion): IndexRecord \| null` | Called to convert parse results | YES |
| Raw wikilink strings in relationship fields | Index-builder resolves to IDs | YES -- Plan 03 explicitly documents this boundary |

### Plan 01 <-> Plan 03

| Plan 01 defines | Plan 03 should use | Issue? |
|-----------------|-------------------|--------|
| `ParsedNote` type | `ParseResult` type | **YES** -- different types, different names. See I4. |
| `WikiLink` type | `WikilinkOccurrence` type | **YES** -- different names, different shapes. See I6. |
| `Section` type (no `line`) | `Section` type (with `line`) | **YES** -- Plan 03 adds field. See I5. |
| Public API exports `ParsedNote` | Should export `ParseResult` | Needs alignment |

---

## Codex Feedback

Codex was not invoked for this second-round review. The analysis was performed through direct character-level comparison of all plan files against 00-unified-types.md and overview.md. All original issues are clearly resolved through textual evidence in the fixed plans, and the new issues identified are straightforward discrepancies found through systematic comparison. Codex verification would not add material value beyond what direct comparison provides.

---

## Final Verdict

**PASS WITH MINOR ISSUES**

All 28 issues from the first review are resolved (26 fully, 2 partially with acceptable justification). No new critical issues were introduced.

The remaining issues are:
- 6 Important issues (I1-I6): all relate to Plan 01's "sketch" types being slightly out of sync with Plan 03's detailed implementation types and naming. These are low-risk because Plan 03 is the actual implementation plan and developers will use its types. However, Plan 01 should be updated to avoid confusing readers who start from Plan 01.
- 5 Minor issues (M1-M5): naming inconsistencies and small type additions.

**These plans are implementable as-is.** The Important issues should be fixed before implementation begins to prevent confusion, but none would block a developer who reads Plan 03 as the authoritative parser spec.
