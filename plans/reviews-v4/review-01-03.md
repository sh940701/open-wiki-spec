# Review v4: Plans 01-03 (Foundation)

**Reviewer**: Devil's Advocate Agent
**Date**: 2026-04-06
**Scope**: 01-project-structure.md, 02-note-templates.md, 03-vault-parser.md
**References**: 00-unified-types.md, overview.md, OpenSpec source (git show HEAD:)

---

## Verdict

**Plans 01-03 are solid and implementation-ready with minor corrections.** The foundation is well-designed: type definitions are consistent, the parser architecture is clean, and the overview.md contract is faithfully translated. No architectural rewrites needed. Issues below are fixable without restructuring.

---

## Per-File Analysis

### 01-project-structure.md

**Strengths**
- Clean layered architecture with unidirectional dependencies
- Correct extraction of OpenSpec patterns (section parsing, requirement validation, delta operations)
- File structure is well-organized with appropriate module boundaries
- Public API exports are comprehensive and match what downstream plans need
- Good separation of `src/types/` from `src/core/` avoids circular dependencies
- Test strategy covers all layers with appropriate fixture approach

**Issues**

| # | Severity | Issue | Location | Fix |
|---|----------|-------|----------|-----|
| 1 | Minor | `overview.md` section 18 is referenced as "Section 18" but overview.md section numbering ends at 19 -- this is correct but the section is cited in the design intent but never directly used as a contract constraint | Section 2 | No action needed, just noting |
| 2 | Minor | `ParseResult` in `src/types/note.ts` duplicates the canonical definition in `03-vault-parser.md:types.ts`. Plan 01 says "See 03-vault-parser.md for the canonical definition" which is correct, but the type is fully defined in both places | Section 3, Data Structures | Ensure Plan 01's copy is understood as reference, not authoritative. Plan 03's `src/core/parser/types.ts` is the actual implementation location per the file structure |
| 3 | Info | `QueryObject` in `src/types/query.ts` names the interface `QueryObject` while 00-unified-types.md names it `RetrievalQuery`. Both have identical fields | Section 3, query.ts | Rename to `RetrievalQuery` for exact match with unified types |
| 4 | Info | `ClassificationResult` in Plan 01's `src/types/query.ts` differs from 00-unified-types.md's `RetrievalResult` -- Plan 01 uses `ClassificationResult` with a `sequencing: SequencingResult` field, while unified types define `RetrievalResult` with `sequencing: SequencingSummary` | Section 3, query.ts | Use `RetrievalResult` name and `SequencingSummary` type per unified types. The full `SequencingResult` (with pairwise_severities, ordering, etc.) belongs to the sequencing engine output, not the retrieval output |
| 5 | Minor | `SequencingResult` in Plan 01's `src/types/query.ts` is a simplified 3-field version (`status`, `related_changes`, `reasons`), while 00-unified-types.md defines a much richer `SequencingResult` with 8 fields. Plan 01's version matches `SequencingSummary` in unified types | Section 3, query.ts | The type in `src/types/query.ts` should be named `SequencingSummary` (matching unified types) or import the full `SequencingResult` from the sequencing types |
| 6 | Info | `wikilink-parser.ts` vs `wikilink-extractor.ts` naming inconsistency -- file structure says `wikilink-parser.ts` but test file says `wikilink-extractor.test.ts` | File Structure + Test Strategy | Align to `wikilink-parser.ts` / `wikilink-parser.test.ts` consistently |

**Missing**
- No mention of `conventions.md` parsing in the config module, though the file is listed in the directory structure and Plan 01's `src/core/config/conventions.ts` implies it. Low priority for v1 but should be noted.
- No explicit handling of `.obsidian/` directory exclusion during vault scan. The scanner should skip `.obsidian/` (and any dot-directories).

---

### 02-note-templates.md

**Strengths**
- Excellent mapping from overview.md contracts to Zod schemas
- `feature/features` mutual exclusion via `.refine()` is correctly implemented
- All 6 note type schemas are complete with proper status enum constraints
- Delta Summary grammar regex patterns are thorough and match overview.md 14.2
- Validation rules table is comprehensive and maps cleanly to verify dimensions
- `SCHEMA_REGISTRY` pattern is elegant for dynamic schema lookup
- `CHANGE_STATUS_TRANSITIONS` and `PLANNED_HARD_PREREQUISITES` directly implement overview.md section 15
- Templates match their schemas structurally

**Issues**

| # | Severity | Issue | Location | Fix |
|---|----------|-------|----------|-----|
| 1 | Error | `SystemFrontmatterSchema` uses `GeneralStatusEnum` but this identifier is defined in `base.schema.ts` -- however the import statement is missing in the system.schema.ts code block. Same for Decision, Source, Query schemas | system.schema.ts, decision.schema.ts, source.schema.ts, query.schema.ts | Add `import { GeneralStatusEnum } from './base.schema.js'` to each. Currently only `BaseFrontmatterSchema` and `WikilinkRef` are imported |
| 2 | Error | `ChangeStatusEnum` is used in `change.schema.ts` but is imported from `base.schema.ts` via the `BaseFrontmatterSchema` import line only -- the actual import statement shows `import { BaseFrontmatterSchema, WikilinkRef } from './base.schema.js'` which does not include `ChangeStatusEnum` | change.schema.ts line 247 | Add `ChangeStatusEnum` to the import: `import { BaseFrontmatterSchema, WikilinkRef, ChangeStatusEnum } from './base.schema.js'` |
| 3 | Minor | Decision test says "`status: superseded` without `superseded_by` fails" but `DecisionFrontmatter` uses `GeneralStatus` which has no `superseded` value, and Plan 02 explicitly notes "`superseded_by` is not a schema-level field" | Test Strategy, Decision-Specific Tests | Remove this test case. The schema correctly uses GeneralStatus (active/draft/archived) with no superseded status |
| 4 | Minor | `FeatureFrontmatterSchema` requires `systems` to have `.min(1)` -- this enforces "Feature must reference at least one System" which matches overview.md 14.1's example, but overview.md does not explicitly state this is a hard requirement. It says Feature references systems, but a brand-new Feature might not have a system yet | feature.schema.ts line 203 | Consider whether `.min(1)` should be a schema validation error or a verify-level warning. A strict `.min(1)` may block Feature creation in the `propose` workflow. Recommend: keep `.min(1)` but the workflow must ensure a System link is populated before Feature creation |
| 5 | Minor | `QueryFrontmatter` adds `consulted` and `features`, `systems` fields from 00-unified-types.md, but the Zod schema in Plan 02 only defines `question` as optional. Missing: `consulted`, `features`, `systems` | query.schema.ts | Add `consulted: z.array(WikilinkRef).optional()`, `features: z.array(WikilinkRef).optional()`, `systems: z.array(WikilinkRef).optional()` to `QueryFrontmatterSchema` to match 00-unified-types.md |
| 6 | Minor | `DELTA_REQUIREMENT_PATTERN` in Plan 02's `delta-summary.ts` does not capture the optional description after colon. The regex in Plan 02 is: `/^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*([^\]]+)\])?$/` -- this has no capture group for description. But Plan 03's version of the same regex DOES include description: `(?:\s*:\s*(.+?))?` | delta-summary.ts lines 416-417 vs Plan 03 lines 891-892 | Plan 03's version is the correct one (includes description capture group). The Plan 02 regex patterns should be updated to match Plan 03, OR Plan 02 should note that these regexes are reference-only and Plan 03 is authoritative for the actual parsing regex |
| 7 | Info | `MAX_DELTAS_PER_CHANGE = 10` is borrowed from OpenSpec's validation constants, but overview.md does not specify this limit | validation-constants.ts | Document that this is a plan-level addition, not an overview.md requirement. Consider whether this is too restrictive for v1 |
| 8 | Info | The `url` field in SourceFrontmatterSchema has `.url()` validation. If a source references a local file or relative path, this would fail | source.schema.ts | Acceptable for v1 since most sources are external URLs. Could be relaxed later |

**Missing**
- No Zod schema for the `aliases` field. Plan 02 explicitly says "aliases is NOT in BaseFrontmatter" and is "handled at the IndexRecord level." However, the templates include `aliases: []` in frontmatter. The parser (Plan 03) needs to pass `aliases` through via `.passthrough()` on the base schema (which it does correctly). This is consistent but should be explicitly documented as a deliberate choice.
- No template for `conventions.md`. Overview.md mentions it in section 13.3. Low priority.

---

### 03-vault-parser.md

**Strengths**
- Excellent decomposition into independent sub-parsers with clean composition in `note-parser.ts`
- Faithful adaptation of OpenSpec's `MarkdownParser.parseSections()` algorithm with correct additions (line numbers, code fence detection)
- Correct `collect-and-continue` error handling strategy matching the "never crash on malformed input" requirement
- `ParseResult` clearly documents what is raw/unresolved (wikilinks, target_note_id, key) and what the index engine will compute -- this respects the ownership rules in 00-unified-types.md
- `toIndexRecord()` correctly produces a preliminary record with raw wikilinks and empty placeholders
- Code fence detection is implemented in both `section-parser.ts` and `wikilink-parser.ts` (matching overview.md 10.7 contract about ignoring wikilinks in code blocks)
- Content hashing normalization strategy is well-designed (stable across whitespace, sensitive to content changes)
- Test strategy is thorough with good edge case coverage

**Issues**

| # | Severity | Issue | Location | Fix |
|---|----------|-------|----------|-----|
| 1 | Error | `parseNote()` calls `readFileSync(filePath, 'utf-8')` but does not import `readFileSync` from `fs` or `node:fs`. The import is missing from the code block | note-parser.ts line 1142 | Add `import { readFileSync } from 'node:fs'` |
| 2 | Minor | Section content extraction logic is subtly incorrect. Lines 488-498: the inner loop breaks at same-or-higher-level headings, but the outer loop (line 483-484) already limits `nextIndex` to the next heading position regardless of level. This means the content will include child heading lines as raw text. This matches OpenSpec's behavior (section.content includes child heading text) but the comment says "excluding child headings" which contradicts the code | section-parser.ts lines 488-498 | Fix the comment to say "content includes lines up to next same-or-higher-level heading, including child heading lines" -- or restructure to truly exclude child headings. OpenSpec includes them in content, so including them is likely correct |
| 3 | Minor | `TaskItem` in Plan 03's `types.ts` has a `line: number` field, but the unified types `TaskItem` does NOT have `line`. The `toIndexRecord()` function correctly strips it (line 1301: `t => ({ text: t.text, done: t.done })`), but this creates a subtle shape difference between parser output and index output | types.ts line 234 | This is acceptable since parser-internal types can have extra fields. Just ensure the difference is documented |
| 4 | Minor | `extractWikilinksFromObject()` hardcodes `location: 'frontmatter'` when called from `parseNote()`, but the line numbers will always be `1` since the recursive walk has no line tracking. This means all frontmatter wikilinks will report `line: 1` | note-parser.ts line 1173 | Acceptable for v1 since frontmatter wikilinks are positionally deterministic from the YAML key. Line-level precision for frontmatter is not critical. Document this limitation |
| 5 | Minor | `parseTasks()` line numbers are approximate ("approximate" comment on line 1085). The approximation uses `taskSection.line + i + 1` but `i` is relative to the content lines, not the file lines. If the Tasks section has child sections, `gatherAllContent()` concatenates them with newlines, making `i` positions inaccurate | task-parser.ts line 1085 | Acceptable for v1 but document the approximation. Consider tracking line offsets more precisely in a future version |
| 6 | Info | `DELTA_SECTION_PATTERN` in Plan 03 uses `(in|from)` for section operations, but the `to` preposition (used with ADDED: "ADDED section to") is not included. However Plan 02's grammar shows "ADDED section ... in" not "to". But the requirement pattern uses "to" for ADDED | delta-summary-parser.ts lines 897-898 | Verify consistency: requirements use `to/in/from`, sections use only `in/from`. Plan 03's regex correctly matches `(in|from)` for sections. Plan 02's grammar example also shows sections using `in` for ADDED. This is correct |
| 7 | Info | The frontmatter parser's code fence detection during YAML extraction (`extractFrontmatter`) does not apply because the YAML content between `---` delimiters should not contain code fences. However, the function normalizes CRLF on the entire content before splitting, which is correct | frontmatter-parser.ts | No action needed |

**Missing**
- No explicit handling for BOM (Byte Order Mark) at the start of files. Some editors add BOM to UTF-8 files. The frontmatter parser checks `lines[0].trim() !== '---'` which would fail if BOM is present since `\uFEFF---` !== `---`.
- No mention of maximum file size handling. For "Very large note (> 100KB)" edge case listed in tests, there is no guard against memory issues from reading extremely large files synchronously.

---

## Cross-Plan Consistency Audit

### 01 <-> 02

| Interface | Status | Notes |
|-----------|--------|-------|
| File locations match | PASS | Plan 01 declares `src/core/schema/` directory; Plan 02 implements all files there |
| Type definitions align | PASS | Plan 01's `src/types/` types reference Plan 02's schema types correctly |
| Build order respects dependencies | PASS | Plan 01 Phase 2 step 8 (schemas) comes after Phase 1 (types) |
| Public API exports match | PASS | Plan 02's exports are consumed by Plan 01's public API re-exports |

### 02 <-> 03

| Interface | Status | Notes |
|-----------|--------|-------|
| `FrontmatterSchema` import path | PASS | Plan 03 imports from `'../schema/frontmatter.js'` which matches Plan 02's `src/core/schema/frontmatter.ts` |
| `Requirement` type shape | PASS | Both reference 00-unified-types.md. Plan 03 correctly uses `key: ''` placeholder |
| `DeltaSummaryEntry` shape | PASS | Both reference 00-unified-types.md. Plan 03 correctly stores raw wikilink target |
| Delta Summary regex | MINOR MISMATCH | Plan 02's `DELTA_REQUIREMENT_PATTERN` lacks description capture group that Plan 03's regex has (see Issue 02#6 above) |
| Section names | PASS | Plan 03's `findSection('Requirements')`, `findSection('Delta Summary')`, `findSection('Tasks')` match Plan 02's required section constants |
| Build order | PASS | Plan 03 prerequisites: "Plan 02 complete: `src/core/schema/` module with all Zod schemas available" |

### 01 <-> 03

| Interface | Status | Notes |
|-----------|--------|-------|
| `ParseResult` shape | PASS | Plan 01's `src/types/note.ts` version matches Plan 03's canonical version |
| `parseNote()` signature | PASS | Both define `parseNote(filePath: string): ParseResult` |
| `toIndexRecord()` exists | PASS | Plan 03 defines it; Plan 01's file structure lists `note-parser.ts` |
| `stripWikilinkSyntax()` export | PASS | Plan 03 exports it; Plan 01 lists it as needed by Plan 04 |
| `extractFrontmatter()` export | PASS | Plan 03 exports it; 00-unified-types.md lists it as part of Parser<->Index API |

### 01-03 <-> 04 (downstream)

| Interface | Status | Notes |
|-----------|--------|-------|
| `parseNote()` called by index-builder | PASS | Plan 04 intro confirms it calls `parseNote(filePath)` for each .md file |
| Raw wikilinks passed to index | PASS | Plan 03 explicitly documents that wikilinks are raw; Plan 04 resolves them |
| `VaultIndex` type used by retrieval | PASS | Plan 01 defines it; Plan 04 produces it; Plan 05 consumes it |
| `extractFrontmatter()` for schema.md | PASS | 00-unified-types.md lists it as a lightweight export for the config module |

### 01-03 <-> 05 (downstream)

| Interface | Status | Notes |
|-----------|--------|-------|
| `RetrievalQuery` shape | MINOR | Plan 01 calls it `QueryObject`; 00-unified-types.md calls it `RetrievalQuery`. Plan 05 would use the unified name |
| `RetrievalResult` shape | MINOR | Plan 01 calls it `ClassificationResult`; 00-unified-types.md calls it `RetrievalResult` |

---

## Type Audit (Character-Level Check Against 00-unified-types.md)

| Type | Plan | Match? | Discrepancy |
|------|------|--------|-------------|
| `NoteType` | 01, 02 | EXACT | -- |
| `ChangeStatus` | 01, 02 | EXACT | -- |
| `FeatureStatus` | 02 | EXACT | -- |
| `GeneralStatus` | 02 | EXACT | -- |
| `BaseFrontmatter` | 01, 02 | EXACT | -- |
| `FeatureFrontmatter` | 02 | EXACT | -- |
| `ChangeFrontmatter` | 02 | EXACT | -- |
| `SystemFrontmatter` | 02 | EXACT | -- |
| `DecisionFrontmatter` | 02 | EXACT | -- |
| `SourceFrontmatter` | 02 | EXACT | -- |
| `QueryFrontmatter` | 02 | MISMATCH | Missing `consulted`, `features`, `systems` optional fields |
| `Frontmatter` (union) | 02 | EXACT | -- |
| `Requirement` | 01, 02 | EXACT | -- |
| `Scenario` | 01, 02 | EXACT | -- |
| `DeltaSummaryEntry` | 01, 02 | EXACT | -- |
| `DeltaOp` | 02 | EXACT | -- |
| `DeltaTargetType` | 02 | EXACT | -- |
| `TaskItem` | 01 | EXACT | Plan 03's parser version adds `line` field (internal use only) |
| `IndexRecord` | 01 | EXACT | -- |
| `VaultIndex` | N/A | EXACT | Defined only in 00-unified-types.md, referenced by Plan 01 |
| `RetrievalQuery` | 01 | NAME MISMATCH | Plan 01 uses `QueryObject` |
| `Classification` | 01 | EXACT | -- |
| `ScoredCandidate` | 01 | EXACT | -- |
| `SequencingSummary` | 01 | NAME MISMATCH | Plan 01 uses `SequencingResult` (3-field version) |
| `RetrievalResult` | 01 | NAME MISMATCH | Plan 01 uses `ClassificationResult` |
| `VerifyIssue` | 01 | EXACT | -- |
| `VerifyReport` | 01 | EXACT | -- |
| `NextAction` | 01 | EXACT | -- |
| `NextActionType` | 01 | EXACT | -- |
| `Section` (parser) | 03 | EXTENDS | Adds `line: number` field not in OpenSpec's Section |
| `ParseResult` | 01, 03 | EXACT | Not in unified types (parser-internal) |
| `ParseError` | 03 | EXACT | Not in unified types (parser-internal) |

---

## overview.md Compliance

### Section 10.1 (Vault is truth, index is cache)
- **01**: PASS. Explicitly states "Canonical data lives in raw vault markdown. Index is disposable derived cache."
- **03**: PASS. Parser reads raw files; `toIndexRecord()` produces preliminary records.

### Section 10.2 (Fresh scan per operation)
- **01**: PASS. Core algorithm describes fresh `indexEngine.buildIndex()` call.
- **03**: PASS. Parser is stateless; each call reads from disk.

### Section 10.3 (Index record shape)
- **01**: PASS. `IndexRecord` matches overview.md example fields exactly.
- **03**: PASS. `toIndexRecord()` produces the right shape.

### Section 10.7 (Wikilink/Alias -> ID normalization)
- **01**: PASS. Describes normalization order.
- **03**: PASS. `stripWikilinkSyntax()` exported for use by index engine.

### Section 13 (Note types, folder structure)
- **01**: PASS. 6 note types, correct folder structure.
- **02**: PASS. All 6 types have schemas and templates.

### Section 14.1 (Feature = canonical spec with Requirements)
- **02**: PASS. `FeatureFrontmatterSchema` + `FEATURE_REQUIRED_SECTIONS` including Requirements.
- **03**: PASS. `parseRequirements()` extracts name, normative, scenarios, content_hash.

### Section 14.2 (Change = proposal + delta summary + tasks + status)
- **02**: PASS. Complete Change schema with all sections, delta grammar, status transitions.
- **03**: PASS. `parseDeltaSummary()` and `parseTasks()` implement parsing.

### Section 14.3 (Decision, System, Source minimum contracts)
- **02**: PASS. All have `REQUIRED_SECTIONS` constants.

### Section 15 (Status lifecycle + section-completeness contract)
- **02**: PASS. `CHANGE_STATUS_TRANSITIONS` + `PLANNED_HARD_PREREQUISITES` + `PLANNED_SOFT_PREREQUISITES`.
- **01**: PASS. `NextAction` type implements the deterministic algorithm.

---

## overview.md Limitations Discovered

1. **No explicit max delta count**: overview.md does not specify `MAX_DELTAS_PER_CHANGE`. Plan 02 borrows OpenSpec's limit of 10. This is reasonable but unspecified.

2. **`systems` min(1) for Feature ambiguity**: overview.md 14.1 shows Features with systems, but does not explicitly mandate at least one System reference. A new Feature in a new vault might not have any System notes yet.

3. **`conventions.md` format undefined**: overview.md 13.3 lists `conventions.md` in `00-meta/` but provides no format specification. Plan 01 lists a `conventions.ts` reader but there is no contract to implement against.

4. **`schema.md` frontmatter shape**: overview.md 13.3 shows `schema_version` and `note_types` in the frontmatter of `schema.md`, but Plan 01's `schema.md` format shows only `schema_version`. The `note_types` field is omitted. Minor discrepancy.

5. **Code fence handling not in overview.md**: overview.md 10.7 says "wikilinks inside fenced code blocks must be ignored" but does not specify the code fence detection algorithm. Plans 03 implements a reasonable approach. Not a gap, just noting that the implementation detail is plan-level.

---

## Recommendations

### Must Fix (before implementation)

1. **Plan 02**: Add missing imports for `GeneralStatusEnum`, `ChangeStatusEnum`, `FeatureStatusEnum` to each note type schema file.
2. **Plan 02**: Add `consulted`, `features`, `systems` optional fields to `QueryFrontmatterSchema` per 00-unified-types.md.
3. **Plan 02**: Remove the "Decision-Specific Tests: `status: superseded`" test case -- `superseded` is not a valid status value.
4. **Plan 03**: Add `import { readFileSync } from 'node:fs'` to note-parser.ts.

### Should Fix (low risk if deferred)

5. **Plan 01**: Rename `QueryObject` -> `RetrievalQuery`, `ClassificationResult` -> `RetrievalResult`, `SequencingResult` (3-field) -> `SequencingSummary` in `src/types/query.ts` to match 00-unified-types.md naming.
6. **Plan 01**: Rename `wikilink-extractor.test.ts` -> `wikilink-parser.test.ts` in test file listing.
7. **Plan 02**: Reconcile Delta Summary regex patterns between Plan 02 and Plan 03 (add description capture group to Plan 02's version, or document Plan 03 as authoritative).
8. **Plan 03**: Fix section-parser content extraction comment to match actual behavior (content includes child heading lines).

### Nice to Have (v1+)

9. **Plan 03**: Add BOM stripping (`content.replace(/^\uFEFF/, '')`) to `extractFrontmatter()`.
10. **Plan 01**: Add `.obsidian/` exclusion to vault scan documentation.
11. **Plan 02**: Document `MAX_DELTAS_PER_CHANGE = 10` as plan-level addition, not overview.md requirement.

---

## Summary Table

| Plan | Critical | Errors | Minor | Info | Verdict |
|------|----------|--------|-------|------|---------|
| 01 | 0 | 0 | 2 | 4 | Ready |
| 02 | 0 | 2 | 4 | 2 | Ready after import fixes |
| 03 | 0 | 1 | 4 | 2 | Ready after import fix |
| **Cross-plan** | 0 | 0 | 2 | 0 | Consistent |

All plans are implementable. The import errors are copy-paste omissions in code blocks, not design flaws. The type name mismatches with 00-unified-types.md should be fixed to prevent confusion during implementation but are not blocking.
