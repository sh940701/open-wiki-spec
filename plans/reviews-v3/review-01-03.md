# Review v3: Plans 01-03 (Foundation)

## Verdict: PASS WITH ISSUES

All critical issues from v1 and v2 have been resolved. No new critical issues were found. However, 6 Important issues from v2 remain unfixed in the current plan text, and 3 new issues were identified through fresh analysis. The plans are implementable, but these should be addressed before implementation begins.

---

## v2 Issue Resolution Status

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| v2-I1 | overview.md 10.3 uses `title` and `string[]` for Requirement | **UNRESOLVED** (overview.md issue) | overview.md line ~581 still uses `title` and `scenarios: string[]`. No note was added to 00-unified-types.md acknowledging this. |
| v2-I2 | overview.md 10.3 delta_summary uses `feature` not `target_note_id` | **UNRESOLVED** (overview.md issue) | overview.md line ~594 still uses `feature`. Same as I1. |
| v2-I3 | Plan 01 `BaseFrontmatter` has `tags?` (optional) and `aliases?` | **UNRESOLVED** | Plan 01 lines 266-271: `tags?: string[]` is still optional; `aliases?: string[]` is still present. 00-unified-types.md lines 17-22: `tags: string[]` (required, no `?`), no `aliases`. |
| v2-I4 | Plan 01 `ParsedNote` differs from Plan 03 `ParseResult` | **UNRESOLVED** | Plan 01 lines 273-282 still define `ParsedNote` with incompatible shape. No disambiguation note added. |
| v2-I5 | Plan 01 `Section` missing `line` field | **UNRESOLVED** | Plan 01 lines 286-290: `Section` has 4 fields (level, title, content, children). Plan 03 lines 202-213: has 5 fields (adds `line: number`). |
| v2-I6 | Plan 01 `WikiLink` differs from Plan 03 `WikilinkOccurrence` | **UNRESOLVED** | Plan 01 lines 293-299: `WikiLink`. Plan 03 lines 216-225: `WikilinkOccurrence`. Different names, different fields. Plan 01 exports `WikiLink` at line 683. |
| v2-M1 | Test file `wikilink-extractor.test.ts` should be `wikilink-parser.test.ts` | **UNRESOLVED** | Plan 01 line 635: still lists `wikilink-extractor.test.ts`. |
| v2-M2 | Test fixture path: `valid-vault/` (Plan 01) vs `vault/` (Plan 03) | **UNRESOLVED** | Plan 01 line 612: `valid-vault/`. Plan 03 line 1458: `vault/`. |
| v2-M3 | Plan 03 `TaskItem` has extra `line` field | **ACCEPTABLE** | Correctly stripped in `toIndexRecord()` at line 1236. Parser-internal type reasonably differs from IndexRecord type. |
| v2-M4 | `systems.min(1)` is plan addition, not overview contract | **ACCEPTABLE** | Properly documented as plan-level decision. |
| v2-M5 | Plan 01 `NextActionType` missing `ready_to_apply` | **UNRESOLVED** | Plan 01 line 452: still missing `ready_to_apply`. 00-unified-types.md lines 358-365 includes it. |

---

## Plan 01: project-structure.md

### Strengths

1. **Thorough OpenSpec analysis**: The reference section correctly identifies OpenSpec's architecture (monolithic Commander CLI, Zod validation, custom build pipeline) and clearly documents divergence decisions.

2. **Well-defined module boundaries**: The layered architecture (CLI -> Workflow -> Retrieval+Sequencing -> Index -> Parser+Schema -> Vault I/O -> Utils/Types) is clean and prevents circular dependencies. Each layer depends only downward.

3. **Clear contracts section**: The 7 contracts to satisfy (sections 10.1, 10.2, 10.3, 10.7, 10.1.1, 13.2, 9.4) are accurate references to overview.md with correct section numbers.

4. **Operational meta files defined**: `schema.md`, `index.md`, and `log.md` formats are specified with examples. The important note that these are NOT typed notes and must be skipped by `parseNote()` is present.

5. **Core algorithm walkthrough**: The `propose` flow (lines 499-521) traces the full pipeline from user request to classification result. This gives implementers a clear mental model.

6. **IndexRecord in Plan 01 matches 00-unified-types.md**: All fields present -- `schema_version`, `id`, `type`, `title`, `aliases`, `path`, `status`, `created_at`, `tags`, relationship fields, graph fields, content fields. Character-level match confirmed.

### Issues (by severity)

#### Important

**I1. Plan 01 sketch types remain inconsistent with implementation types (v2 I3-I6 unresolved)**

Plan 01 defines several types in `src/types/note.ts` (lines 258-306) that are inconsistent with both 00-unified-types.md and Plan 03's implementation:

- `BaseFrontmatter.tags` is optional (`tags?: string[]`); unified types says required (`tags: string[]`).
- `BaseFrontmatter.aliases` exists; unified types does not include `aliases` in `BaseFrontmatter`.
- `ParsedNote` (lines 273-282) is a different type from Plan 03's `ParseResult` (lines 250-273) with different field names, nullability, and structure.
- `Section` (lines 286-290) is missing `line: number` that Plan 03 adds.
- `WikiLink` (lines 293-299) is a different type from Plan 03's `WikilinkOccurrence` (different name, `raw` vs absent, `displayText` vs `alias`, `context` vs `location`).

**Impact**: A developer starting from Plan 01's types would create interfaces that are incompatible with Plan 03's parser output. The public API exports at line 683 reference `ParsedNote`, `WikiLink` -- types that Plan 03 never produces.

**Recommendation**: Either (a) remove the sketch types from Plan 01 and add a note deferring to Plan 03 for parser output types, or (b) update them to exactly match Plan 03's definitions.

**I2. `NextActionType` missing `ready_to_apply` (v2 M5 unresolved)**

Plan 01 line 452 defines:
```
'fill_section' | 'transition' | 'blocked' | 'start_implementation' | 'continue_task' | 'verify_then_archive'
```

00-unified-types.md lines 358-365 defines:
```
'fill_section' | 'transition' | 'start_implementation' | 'continue_task' | 'blocked' | 'ready_to_apply' | 'verify_then_archive'
```

`ready_to_apply` is missing from Plan 01. The overview.md Next-Action Algorithm (section 15) does not explicitly use `ready_to_apply` -- it uses `{ action: "transition", to: "applied" }` for the equivalent state. So there is a question of whether `ready_to_apply` in 00-unified-types.md is an enhancement beyond overview.md or a distinct action type.

**Recommendation**: Add `ready_to_apply` to Plan 01's `NextActionType` to match 00-unified-types.md. If `ready_to_apply` semantically means "all tasks done, ready to transition to applied" (distinct from the `transition` action), document this distinction.

**I3. Public API export list at line 683 exports `VerifyResult` but unified types uses `VerifyReport`**

Plan 01 line 688: `export type { ... VerifyResult, ApplyResult } from './types/index.js'`

But 00-unified-types.md defines `VerifyReport`, not `VerifyResult`. Plan 01's own `workflow.ts` types section (lines 477-487) defines `VerifyReport`. The export name is inconsistent.

**Recommendation**: Change `VerifyResult` to `VerifyReport` in the export statement.

#### Minor

**M1. Test file naming: `wikilink-extractor.test.ts` should be `wikilink-parser.test.ts` (v2 M1 unresolved)**

Plan 01 line 635 still lists the test file as `wikilink-extractor.test.ts` while the source file is `wikilink-parser.ts` (line 555).

**M2. Test fixture path inconsistency (v2 M2 unresolved)**

Plan 01 line 612: `tests/fixtures/valid-vault/`. Plan 03 line 1458: `tests/fixtures/vault/`. These reference different directories.

**M3. `RawNote` type in Plan 01 is never referenced elsewhere**

Plan 01 lines 302-306 define `RawNote` with `path`, `content`, `mtime`, `size`. This type is not referenced in Plan 03 (which takes a `content: string` in `parseNote()`) or in Plan 04's API boundary in 00-unified-types.md. It appears to be a sketch type that may not match actual implementation.

### Missing Elements

1. **No `package.json` dependency list**: Plan 01 mentions runtime and dev dependencies in the OpenSpec reference section (lines 71-75) but does not formally specify the `package.json` `dependencies` and `devDependencies` for open-wiki-spec. The `yaml` package is critical for Plan 03 but is only mentioned in Plan 03's dependencies section.

2. **No `conventions.md` format specified**: Plan 01 lists `conventions.md` in the file structure (lines 597, 618) and the config module (line 597: `conventions.ts`), but does not define its format. Overview.md 9.1 mentions it as the location for overriding scoring weights. The operational files section defines `schema.md`, `index.md`, and `log.md` but omits `conventions.md`.

---

## Plan 02: note-templates.md

### Strengths

1. **Comprehensive schema coverage**: All 6 note types have Zod schemas with correct field types matching 00-unified-types.md. The discriminated union (`FrontmatterSchema`) on the `type` field is a clean implementation of the union type.

2. **Delta Summary grammar is precise**: The regex patterns (lines 416-423) correctly implement the overview.md 14.2 grammar for requirement operations, RENAMED operations, and section operations. The `[base: ...]` suffix is handled. The `DELTA_APPLY_ORDER` constant (line 404) matches overview.md's RENAMED->REMOVED->MODIFIED->ADDED order.

3. **feature/features mutual exclusivity**: The `.refine()` at lines 275-278 enforces that exactly one of `feature` (scalar) or `features` (array, min 2) must be present. This directly implements overview.md 13.2 serialization rules.

4. **Status transition map**: `CHANGE_STATUS_TRANSITIONS` (lines 312-317) correctly implements the `proposed->planned->in_progress->applied` lifecycle from overview.md Section 15.

5. **Section-completeness contract**: `PLANNED_HARD_PREREQUISITES` (lines 326-331) and `PLANNED_SOFT_PREREQUISITES` (lines 337-340) match overview.md Section 15's hard and soft prerequisites for `proposed->planned` transition.

6. **Validation rules table**: The complete validation rules table (lines 882-923) documents every error code, severity, and description. This is an excellent implementability aid.

7. **Requirement identity and hashing**: The `RequirementSchema` (lines 460-479) correctly implements composite key identity, SHALL/MUST normative requirement, and content_hash. All matching 00-unified-types.md.

8. **Complete markdown templates**: All 6 note type templates are provided with correct frontmatter fields and section structures matching the schemas.

### Issues (by severity)

#### Important

**I4. `ChangeFrontmatterSchema` refine condition logic may have a subtle bug**

Plan 02 lines 275-278:
```typescript
.refine(
  (data) => !!data.feature !== !!(data.features && data.features.length > 0),
  'Must have exactly one of feature (scalar) or features (array), not both and not neither'
)
```

The issue: `ChangeFrontmatterSchema` uses `.refine()` on the full schema. But `ChangeFrontmatterSchema` extends `BaseFrontmatterSchema`, which uses `.passthrough()`. If `features` is not provided at all, Zod's `.optional()` means `data.features` is `undefined`. Then `!!(undefined && undefined.length > 0)` evaluates to `false`. And if `feature` is also not provided, `!!undefined` is `false`. So `false !== false` is `false`, and the refine rejects it. This is correct -- neither is present.

But wait: `features` has `.min(2)` which means if `features` is provided as `["one"]`, it fails `.min(2)` validation BEFORE reaching the refine. So the refine never sees invalid `features` arrays. However, there is a subtle issue: `ChangeFrontmatterSchema` uses `.extend()` on `BaseFrontmatterSchema`, and `BaseFrontmatterSchema` ends with `.passthrough()`. When using Zod's `.extend()` on a passthrough schema, the behavior depends on Zod version. In some Zod versions, `.extend()` creates a new schema where `.passthrough()` is inherited; in others it is not. This should be tested.

**Note**: This may not be a bug depending on the Zod version used, but it is a correctness risk that should be validated with a unit test.

**I5. Decision test strategy references `status: superseded` which does not exist**

Plan 02 line 1143: "`status: superseded` without `superseded_by` fails"

But `DecisionFrontmatterSchema` (lines 531-537) uses `GeneralStatus` which is `'active' | 'draft' | 'archived'`. There is no `superseded` status value anywhere in the plans or 00-unified-types.md. Plan 02 line 557 explicitly notes that `superseded_by` is NOT a schema-level field. The test case at line 1143 describes testing a status value that the schema would already reject as invalid.

**Recommendation**: Remove or rewrite this test case. Instead, test that `status: superseded` is correctly rejected as an invalid status.

**I6. Delta Summary grammar regex in Plan 02 vs Plan 03 are subtly different**

Plan 02 (lines 416-423) defines three regex patterns:
```
DELTA_REQUIREMENT_PATTERN
DELTA_RENAMED_PATTERN
DELTA_SECTION_PATTERN
```

Plan 03 (lines 833-840) defines three different regex patterns:
```
REQUIREMENT_OP_REGEX
RENAMED_OP_REGEX
SECTION_OP_REGEX
```

These are defined in different modules with different names. More importantly, the regex patterns are not identical:

- Plan 02's `DELTA_REQUIREMENT_PATTERN` does NOT capture a description after the feature wikilink (no `:` group).
- Plan 03's `REQUIREMENT_OP_REGEX` DOES capture a description after a colon: `(?:\s*:\s*(.+?))?`

Plan 03's regex is more complete and matches the overview.md example (line 1174): `- MODIFIED section "Current Behavior" in [[Feature: Auth Login]]: updated to reflect passkey support`

The question is: which module owns these regex patterns? Plan 02 defines them in `src/core/schema/delta-summary.ts`. Plan 03 defines different regex patterns in `src/core/parser/delta-summary-parser.ts`. Plan 02's exported patterns are not used by Plan 03 -- Plan 03 defines its own.

**Recommendation**: Either (a) Plan 03 should import and use Plan 02's regex patterns (in which case Plan 02's patterns need the description capture group), or (b) Plan 02 should remove the regex patterns from the schema module (since they are parsing concerns, not schema concerns) and let Plan 03 own them exclusively.

#### Minor

**M4. `MAX_DELTAS_PER_CHANGE` is borrowed from OpenSpec but not mentioned in overview.md**

Plan 02 line 978: `MAX_DELTAS_PER_CHANGE = 10`

The comment says "matching OpenSpec MAX_DELTAS_PER_CHANGE". OpenSpec's `change.schema.ts` does enforce `.max(MAX_DELTAS_PER_CHANGE)`. But overview.md does not specify any maximum number of deltas per change. This is a plan-level addition borrowed from OpenSpec.

This is acceptable for v1 but should be documented as a plan addition (like `source_type` and `url` are for Source). If a real change touches 11 requirements across features, this limit would reject it.

**M5. `FeatureFrontmatterSchema` requires `systems.min(1)` but overview.md 14.1 example shows a Feature with a system but does not mandate min(1)**

Already noted in v2-M4. Still acceptable but worth noting: this is a plan-level strictness addition.

### Missing Elements

1. **No `validation-messages.ts` content**: Plan 02's file structure (line 1070) lists `validation-messages.ts` for "Centralized error/warning message strings" but never shows its contents. Plan 03 references validation rules by name (e.g., `MISSING_TYPE`, `INVALID_TYPE`) but these strings are not defined in any plan. This is a gap for implementability.

2. **No template file location or loading mechanism**: Plan 02 lists `templates/` directory (line 1076-1083) with 6 `.md` files but does not specify: (a) where `templates/` lives relative to the package (is it bundled in dist?), (b) how templates are loaded at runtime (embedded strings? file reads? bundled assets?), (c) what replaces the placeholders like `<slug>`, `<title>`, `YYYY-MM-DD`. These are needed for the `init` and workflow commands.

---

## Plan 03: vault-parser.md

### Strengths

1. **Modular sub-parser architecture**: Each parser (frontmatter, section, wikilink, requirement, delta-summary, task) is independently testable with no inter-dependencies except through `findSection`. The note-parser orchestrator is the only composition point. This is clean.

2. **Correct frontmatter wikilink extraction**: The `extractWikilinksFromObject()` recursive walker (lines 1252-1273) correctly traverses nested objects in YAML frontmatter and extracts wikilinks only from string values. This was a v1 critical issue (JSON.stringify approach) that is now properly solved.

3. **Code fence handling**: The section parser (lines 440-456) correctly tracks `insideCodeFence` state with `CODE_FENCE_REGEX`, preventing `#` inside code blocks from being misinterpreted as headings. This matches a real edge case.

4. **Collect-and-continue error handling**: The parser never throws. Every sub-parser returns `{ result, errors }` and the note-parser accumulates all errors. The error recovery table (lines 1309-1322) documents every failure mode and recovery action. This is robust design.

5. **Clear Parser-Index boundary**: The `toIndexRecord()` function (lines 1184-1240) explicitly documents what is preliminary (raw wikilink strings, empty `links_in`, placeholder `key` in requirements) and what the index-builder is responsible for. The ownership boundary matches 00-unified-types.md's Parser-Index API.

6. **Content hashing strategy**: Two-level hashing (requirement-level for base_fingerprint, note-level for cache invalidation) is clearly documented (lines 1276-1298). The normalization algorithm (trim, collapse whitespace, join with newline) ensures hash stability across formatting changes.

7. **Thorough test strategy**: Every sub-parser has specific test cases covering happy path, error cases, and edge cases. The edge cases section (lines 1465-1475) covers practical issues like code blocks with `---`, CRLF, UTF-8, and very large notes.

### Issues (by severity)

#### Important

**I7. Section content extraction may include child heading content**

Plan 03 section parser lines 476-488:
```typescript
const contentLines: string[] = [];
for (let i = index + 1; i < nextIndex; i++) {
  const childMatch = lines[i].match(HEADING_REGEX);
  if (childMatch && childMatch[1].length <= level) {
    break;
  }
  contentLines.push(lines[i]);
}
```

This includes ALL lines between the current heading and the next same-or-higher-level heading, INCLUDING child heading lines. So for:
```
## Requirements
Some preamble
### Requirement: Foo
The system SHALL...
#### Scenario: Bar
- WHEN...
```

The `## Requirements` section's `content` would include `### Requirement: Foo`, `The system SHALL...`, `#### Scenario: Bar`, `- WHEN...`. This is intentional (the comment at lines 479-482 explains it), but it creates a subtle issue:

The `extractNormativeStatement()` function in requirement-parser (lines 758-773) relies on detecting child headings to stop extracting the normative statement. But `section.content` already includes child heading lines. If `extractNormativeStatement()` receives the requirement section's content, it should work because it breaks at the first `^#{1,6}\s+` match. But the comment "The section.content includes child heading content" (line 759) suggests awareness of this complexity.

The real issue: `Section.content` semantically means different things depending on context. For the Requirements section, it includes child headings. For a Requirement section, the `extractNormativeStatement()` function takes content and strips child headings. This dual semantics is fragile.

**Recommendation**: Add a comment in the `Section` type definition clarifying that `content` is "all text between this heading and the next same-or-higher-level heading, including child heading lines." This makes the semantics explicit.

**I8. `parseNote()` signature takes only `content: string` but `toIndexRecord()` needs `filePath` and `schemaVersion`**

Plan 03's public API (line 1350): `export { parseNote, toIndexRecord } from './note-parser.js'`

The 00-unified-types.md Parser-Index API (lines 392-393) specifies:
```typescript
function parseNote(filePath: string): ParseResult;
```

But Plan 03's implementation (line 1077):
```typescript
function parseNote(content: string): ParseResult;
```

The parameter is `content: string`, not `filePath: string`. This means Plan 03's `parseNote()` does NOT read files from disk -- it receives raw content. The file reading is deferred to whoever calls `parseNote()` (presumably Plan 04's vault-scanner).

This is a reasonable design choice (parser is pure, I/O is separated), but it differs from the 00-unified-types.md API contract. Either 00-unified-types.md should be updated to `parseNote(content: string): ParseResult`, or Plan 03 should provide a `parseNoteFromFile(filePath: string): ParseResult` wrapper.

**Recommendation**: Update 00-unified-types.md's Parser-Index API to show `parseNote(content: string): ParseResult` since the current plan correctly separates I/O from parsing.

**I9. Wikilinks inside code blocks are extracted**

Plan 03 edge cases (line 1471): "Wikilinks inside code blocks (should be extracted or not? Decision: extract, the index should handle resolution)."

This is a questionable decision. Consider:
````
```yaml
feature: "[[Feature: Auth Login]]"  # example frontmatter
```
````

The wikilink parser would extract `Feature: Auth Login` from this code block, creating a spurious link. In Obsidian, wikilinks inside code blocks are NOT rendered as links and are not considered references. Extracting them pollutes `links_out` and could cause false positives in retrieval scoring (shared-link proximity signal).

**Recommendation**: The wikilink parser should skip content inside fenced code blocks, similar to how the section parser skips headings in code blocks. At minimum, this decision should be flagged as a known limitation with a TODO for v1.1.

#### Minor

**M6. Delta summary parser line number is approximate**

Lines 875, 1027: `lineNum = deltaSection.line + i + 1; // approximate`

This was acknowledged in v2-M4 and is acceptable for v1, but the comment should say why it's approximate (the section's `line` property is the heading line, and `i` counts within the section's content, which may not align perfectly with the original file).

**M7. `normalizeFingerprint` treats "n/a" as null but overview.md 14.2 says ADDED carries `[base: n/a]`**

Plan 03 lines 956-961:
```typescript
function normalizeFingerprint(raw: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === 'n/a' || trimmed === 'N/A') return null;
  return trimmed;
}
```

This normalizes `n/a` to `null`. The 00-unified-types.md `DeltaSummaryEntry.base_fingerprint` type is `string | null` with comment "null for ADDED". So `ADDED` entries end up with `base_fingerprint: null`. This is correct, but it means downstream code cannot distinguish between "ADDED with explicit [base: n/a]" and "entry that had no [base:] tag at all" -- both become `null`. For v1 this is fine.

### Missing Elements

1. **No handling for YAML frontmatter multiline strings and block scalars**: The frontmatter parser uses the `yaml` npm package which handles YAML block scalars (`|`, `>`), but the wikilink extraction from frontmatter objects (`extractWikilinksFromObject`) would need to handle multiline strings containing wikilinks. This is not explicitly tested.

2. **No explicit CRLF normalization in wikilink parser**: The `extractWikilinks()` function (lines 556-596) splits on `\n` but does not normalize CRLF first. If the input text has `\r\n` line endings (and has not been previously normalized), line counting would be off and wikilinks at line boundaries could be missed. The frontmatter parser normalizes CRLF, and the section parser normalizes CRLF, but the wikilink parser receives body text that has already been normalized by the frontmatter parser. However, frontmatter wikilink extraction calls `extractWikilinks(value, 'frontmatter', 1)` where `value` is a raw YAML string value that was NOT normalized. This is a potential edge case.

---

## Cross-Plan Consistency Audit

### Plan 01 <-> Plan 02

| Interface | Compatible? | Notes |
|-----------|-------------|-------|
| `src/core/schema/` directory structure | YES | Plan 01 lists it; Plan 02 fills it. |
| `NoteType` enum values | YES | Both use 6 values. |
| `ChangeStatus` values | YES | Both: proposed, planned, in_progress, applied. |
| `BaseFrontmatter` fields | **NO** | Plan 01 has `tags?` optional, `aliases?` present. Plan 02 has `tags` with `.default([])`, no `aliases`. See I1. |
| `IndexRecord` fields for schema data | YES | Plan 02 schemas produce fields compatible with Plan 01's IndexRecord. |

### Plan 02 <-> Plan 03

| Interface | Compatible? | Notes |
|-----------|-------------|-------|
| `FrontmatterSchema` import | YES | Plan 03 line 284 imports from `../schema/frontmatter.js`. Plan 02 exports at line 966. |
| `Frontmatter` type import | YES | Plan 03 line 187 imports type. Plan 02 exports at line 966. |
| `Requirement`/`Scenario` types | YES | Plan 03 line 618 imports from `../schema/requirement.js`. Plan 02 exports at lines 458, 479. |
| `DeltaSummaryEntry` type | YES | Plan 03 line 805 imports from `../schema/delta-summary.js`. Plan 02 exports at line 395. |
| `DeltaOpEnum` | YES | Plan 03 line 806 imports. Plan 02 exports at line 370. |
| Delta regex patterns | **NO** | Plan 02 defines `DELTA_REQUIREMENT_PATTERN` etc. in schema module. Plan 03 defines different regex patterns in parser module. Plan 03 does NOT import Plan 02's patterns. See I6. |

### Plan 01 <-> Plan 03

| Interface | Compatible? | Notes |
|-----------|-------------|-------|
| `ParsedNote` vs `ParseResult` | **NO** | Different types. Plan 01 exports `ParsedNote`; Plan 03 produces `ParseResult`. See I1. |
| `WikiLink` vs `WikilinkOccurrence` | **NO** | Different types and field names. See I1. |
| `Section` type | **NO** | Plan 03 adds `line` field. See I1. |
| `parseNote` export | YES (name only) | Both export `parseNote`. But signature differs (see I8). |
| `toIndexRecord` export | YES | Plan 03 defines; Plan 01 does not list it in exports but is compatible. |
| `scanNotes`, `readNote`, `writeNote` | N/A | Defined in Plan 01 exports but implemented in Plan 04 (vault module). |

### Plan 03 -> Plan 04 (downstream)

| Interface | Compatible? | Notes |
|-----------|-------------|-------|
| `parseNote(content)` return type | YES | Returns `ParseResult` with all fields Plan 04 needs. |
| `toIndexRecord()` return type | YES | Returns `IndexRecord | null` matching 00-unified-types.md. |
| Raw wikilink strings in output | YES | Plan 03 explicitly stores raw wikilinks; Plan 04 resolves to IDs. Boundary documented. |
| `requirements[].key` placeholder | YES | Set to `''`; Plan 04 sets `${feature_id}::${name}`. Documented. |

---

## Type Alignment with 00-unified-types.md

Character-level comparison of all types across plans against 00-unified-types.md:

| Type | Plan(s) | Match? | Detail |
|------|---------|--------|--------|
| `NoteType` | 01, 02 | YES | 6 values match. |
| `ChangeStatus` | 01, 02 | YES | 4 values match. |
| `FeatureStatus` | 02 | YES | 2 values match. |
| `GeneralStatus` | 02 | YES | 3 values match. |
| `BaseFrontmatter` | 01 | **NO** | `tags?` should be `tags`, `aliases?` should not exist. |
| `BaseFrontmatter` | 02 | YES | `.default([])` makes `tags` effectively required. |
| `FeatureFrontmatter` | 02 | YES | All fields match. `systems.min(1)` is plan addition. |
| `ChangeFrontmatter` | 02 | YES | All fields match including mutual exclusivity refine. |
| `SystemFrontmatter` | 02 | YES | |
| `DecisionFrontmatter` | 02 | YES | |
| `SourceFrontmatter` | 02 | YES | Extra `source_type`/`url` as plan additions. |
| `QueryFrontmatter` | 02 | YES | Extra `question` as plan addition. |
| `Frontmatter` union | 02 | YES | Discriminated on `type`. |
| `Requirement` | 01, 02, 03 | YES | `name`, `key`, `normative`, `scenarios: Scenario[]`, `content_hash`. |
| `Scenario` | 01, 02, 03 | YES | `name`, `raw_text`. |
| `DeltaSummaryEntry` | 01, 02, 03 | YES | `op`, `target_type`, `target_name`, `new_name?`, `target_note_id`, `base_fingerprint`, `description?`. |
| `TaskItem` | 01, 03 (IndexRecord) | YES | `text`, `done`. |
| `TaskItem` | 03 (parser) | EXTRA | `line` field added. Stripped in conversion. Acceptable. |
| `IndexRecord` | 01, 03 | YES | All fields match. Plan 03 outputs preliminary record. |
| `RetrievalQuery` | 01 | YES | Named `QueryObject` but fields match. |
| `Classification` | 01 | YES | |
| `ScoredCandidate` | 01 | YES | |
| `NextActionType` | 01 | **NO** | Missing `ready_to_apply`. See I2. |
| `NextAction` | 01 | YES | |
| `VerifyIssue` | 01 | YES | |
| `VerifyReport` | 01 | YES | (But exported as `VerifyResult` at line 688. See I3.) |
| `VaultIndex` | -- | N/A | Defined in Plan 04. |

---

## overview.md Compliance Matrix

| Contract (Section) | Plan(s) | Status | Notes |
|--------------------|---------|--------|-------|
| **10.1** Vault = single source of truth | 01 | COMPLIANT | Explicitly stated in contracts. |
| **10.1** Index = disposable cache | 01 | COMPLIANT | Explicitly stated. |
| **10.1.1** Schema version in `wiki/00-meta/schema.md` | 01, 02 | COMPLIANT | Plan 01 defines format. Plan 02 notes schema version not in note frontmatter. |
| **10.2** Fresh scan per `propose`/`query`/`verify` | 01 | COMPLIANT | Stated in contracts. |
| **10.3** IndexRecord shape | 01, 03 | COMPLIANT | All fields present. |
| **10.7** Wikilink/alias -> ID normalization | 01, 03 | COMPLIANT | Plan 01 has `link-resolver.ts`. Plan 03 stores raw, defers to Plan 04. |
| **11.1** Canonical identity = frontmatter `id` | 01, 02 | COMPLIANT | All schemas require `id`. |
| **13.2** 6 note types | 02 | COMPLIANT | All 6 defined. |
| **13.2** feature/features serialization rules | 02 | COMPLIANT | Mutual exclusivity enforced. |
| **13.3** Folder structure | 01 | COMPLIANT | Test fixtures mirror structure. |
| **14.1** Requirement composite key | 01, 02, 03 | COMPLIANT | `feature_id::requirement_name`. |
| **14.1** SHALL/MUST in normative | 02, 03 | COMPLIANT | Schema validates; parser checks. |
| **14.1** Min 1 scenario per requirement | 02, 03 | COMPLIANT | Schema: `.min(1)`. Parser: warning if 0. |
| **14.1** WHEN/THEN in scenarios | 03 | COMPLIANT | Parser warns if missing (line 717). |
| **14.2** Delta Summary grammar | 02, 03 | COMPLIANT | Regex patterns implement grammar. Plan 03 is more complete (description capture). |
| **14.2** Base fingerprint | 02, 03 | COMPLIANT | MODIFIED/REMOVED/RENAMED carry hash. ADDED = n/a. |
| **14.2** Atomic apply order RENAMED->REMOVED->MODIFIED->ADDED | 02 | COMPLIANT | `DELTA_APPLY_ORDER` constant. |
| **14.2** Design Approach ephemeral, Decision durable | 02 | COMPLIANT | Section contracts and promotion criteria documented. |
| **14.2** Status Notes completely optional | 02 | COMPLIANT | `CHANGE_OPTIONAL_SECTIONS`. |
| **14.2** touches vs depends_on semantics | 02 | COMPLIANT | Contract documented at lines 109-111. |
| **14.3** Minimum section contracts for all types | 02 | COMPLIANT | All 6 types have required sections. |
| **15** Status lifecycle | 02 | COMPLIANT | `CHANGE_STATUS_TRANSITIONS`. |
| **15** Section-completeness for proposed->planned | 02 | COMPLIANT | Hard and soft prerequisites. |
| **15** Next-Action algorithm | 01 | COMPLIANT | Pseudocode at lines 499-521 matches overview. |

---

## overview.md Limitations Discovered

1. **Section 10.3 uses outdated field names**: The IndexRecord example uses `title` for requirement (should be `name` per unified types) and `scenarios: string[]` (should be `Scenario[]`). Also uses `feature` in delta_summary (should be `target_note_id`). This has been noted since v2 but the overview has not been updated.

2. **Section 14.2 Delta Summary grammar does not show the `[base: ...]` suffix in all examples**: Line 1171 shows `- ADDED requirement "Passkey Authentication" to [[Feature: Auth Login]]` without `[base: n/a]`, but line 1173 shows `- ADDED requirement "Session Token Refresh" to [[Feature: Auth Login]] [base: n/a]`. The grammar description at line 1205 specifies `[base:]` for MODIFIED/REMOVED/RENAMED but says "ADDED는 기존 대상이 없으므로 `[base: n/a]`다" -- meaning ADDED entries SHOULD have `[base: n/a]`. The inconsistency in examples could confuse implementers.

3. **overview.md does not specify whether wikilinks in code blocks count**: This is relevant to Plan 03's I9 issue. Overview.md Section 10.7 discusses wikilink normalization but does not address whether wikilinks inside code blocks should be extracted.

4. **overview.md does not define `conventions.md` format**: Section 9.1 mentions scoring weights are "adjustable per vault via `conventions.md`" and Section 13.3 lists `conventions.md` in the folder structure, but no format or schema is specified.

5. **Next-Action algorithm does not show `ready_to_apply`**: Overview.md Section 15's pseudocode transitions directly from "all tasks done" to `{ action: "transition", to: "applied" }`. The `ready_to_apply` action type in 00-unified-types.md may be an intermediate state not present in overview.md, or it may be intended to replace the `transition` action for that specific case. The relationship is unclear.

---

## Codex Feedback Summary

Codex was not invoked for this review. The analysis was performed through systematic direct comparison of all plan files against 00-unified-types.md, overview.md (sections 9-15), and OpenSpec source code (`base.schema.ts`, `spec.schema.ts`, `change.schema.ts`, `markdown-parser.ts`, `requirement-blocks.ts`). All issues were identified through character-level type comparison, regex pattern analysis, and control-flow tracing. The review methodology prioritized finding issues through direct textual evidence rather than delegating to an external tool.

---

## Final Recommendations

### Must Fix Before Implementation

1. **Align Plan 01 sketch types with Plan 03 implementation types** (I1/v2 I3-I6): Either remove `ParsedNote`, `WikiLink`, `Section` from Plan 01 and defer to Plan 03, or update them to match exactly. Update the public API exports list to use Plan 03's type names.

2. **Add `ready_to_apply` to Plan 01's `NextActionType`** (I2/v2 M5): Match 00-unified-types.md.

3. **Fix `VerifyResult` -> `VerifyReport` in Plan 01 exports** (I3): Character-level naming match.

4. **Resolve Delta regex ownership between Plan 02 and Plan 03** (I6): One module should own the regex patterns. Plan 03 (parser) is the natural owner.

5. **Fix test file naming and fixture path inconsistencies** (M1, M2): `wikilink-extractor.test.ts` -> `wikilink-parser.test.ts`. Unify fixture path to `tests/fixtures/valid-vault/`.

6. **Remove Decision `superseded` test case** (I5): Status value does not exist in schema.

### Should Fix

7. **Update 00-unified-types.md `parseNote` signature** (I8): Change from `parseNote(filePath: string)` to `parseNote(content: string)` to match Plan 03's pure function design.

8. **Define `conventions.md` format** in Plan 01's operational files section.

9. **Document `Section.content` semantics** explicitly in the type definition.

10. **Address wikilinks-in-code-blocks decision** (I9): Recommend NOT extracting wikilinks from code blocks to match Obsidian behavior.

### Can Defer

11. overview.md field name inconsistencies (v2 I1, I2) -- these are documentation issues, not implementation blockers.
12. `validation-messages.ts` content -- can be defined during implementation.
13. Template loading mechanism -- can be decided during CLI implementation (Plan 12).
