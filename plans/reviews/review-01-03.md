# Review: Plans 01-03 (Foundation Layer)

## Summary Verdict

**PASS WITH ISSUES**

The foundation layer plans are thorough, well-structured, and largely faithful to both overview.md and the OpenSpec source. They are implementable as-is for v1 with minor corrections. However, there are several interface mismatches between the plans themselves, a few spec gaps that would cause confusion during implementation, and a couple of overview.md contracts that are underspecified enough to warrant clarification before coding begins.

---

## File-by-File Review

### 01-project-structure.md

#### Strengths
- Clear layered architecture diagram with explicit dependency direction (each layer depends only on layers below).
- Comprehensive type definitions for all core data structures (ParsedNote, IndexRecord, QueryObject, ClassificationResult, VerifyResult, etc.).
- Implementation phases are logically ordered and dependency-aware.
- Test strategy is thorough, covering edge cases like Windows line endings, circular depends_on, empty vaults, and notes outside expected directories.
- Correctly identifies that open-wiki-spec is NOT a fork (overview.md Section 18) and designs from scratch.
- Build toolchain is appropriately simplified from OpenSpec's custom `build.js` to standard `tsc` via npm scripts.

#### Issues (Critical)

1. **Type definition mismatch with Plan 02 schemas**: Plan 01 defines `IndexRecord` in `src/types/index-record.ts` with fields like `RequirementRecord.key`, `RequirementRecord.title`, `RequirementRecord.normative`, `RequirementRecord.scenarios: string[]`. But Plan 02 defines `RequirementSchema` in `src/core/schema/requirement.ts` with fields `key`, `title`, `normative`, `scenarios: z.array(z.string())`, `content_hash`. Plan 03 then defines a *different* `Requirement` type with `name`, `normative`, `scenarios: Scenario[]` (where Scenario is `{ name, rawText }`). These three definitions of the same concept are incompatible:
   - Plan 01's `RequirementRecord.scenarios` is `string[]`
   - Plan 02's `RequirementSchema.scenarios` is `z.array(z.string())`
   - Plan 03's `Requirement.scenarios` is `Scenario[]` with `{ name, rawText }`
   
   **Impact**: Implementing Plan 01's types first will force refactoring when Plan 02/03 are implemented. The `Scenario` type in Plan 03 is the richest and most correct; Plan 01 and 02 should align to it.

2. **IndexRecord field mismatch with Plan 03's toIndexRecord()**: Plan 01 defines `IndexRecord` without `feature` (singular scalar) or `features` (plural array). But Plan 03's `toIndexRecord()` function (line 1167-1168) outputs `feature: getScalar('feature')` and `features: fm.type === 'change' ? getArray('features') : undefined`. The Plan 01 IndexRecord type has neither field -- it only has `changes: string[]`. This means Plan 03's implementation would produce objects that don't match Plan 01's type.

3. **DeltaSummaryEntry mismatch**: Plan 01 defines `DeltaSummaryEntry` with `rename_to?: string`. Plan 03's delta-summary-parser (line 861) outputs `new_name: newName` for RENAMED operations. The field name is different (`rename_to` vs `new_name`).

#### Issues (Minor)

1. **CLI binary name inconsistency**: Plan 01 says the binary is `open-wiki-spec.js` under `bin/` and the CLI binary name for npm should be `ows`. But the `bin/` entry point is named `open-wiki-spec.js`, not `ows.js`. This is fine for npm (the `bin` field in package.json maps names to files), but the plan should explicitly show the `package.json` bin mapping to avoid confusion.

2. **Missing `vitest` in dependency list**: The plan mentions `vitest.config.ts` and test strategy but does not list `vitest` in the dependency section. Only runtime dependencies are listed (commander, zod, yaml, chalk, ora, fast-glob, @inquirer/prompts). Dev dependencies should at minimum include vitest, typescript, eslint, and typescript-eslint.

3. **File naming inconsistency**: Plan 01 names the wikilink parser `wikilink-extractor.ts` but Plan 03 names it `wikilink-parser.ts`. The file structure sections disagree.

4. **No explicit `package.json` spec**: Unlike the OpenSpec reference which is shown, Plan 01 does not show the target `package.json`. This means the ESM config (`"type": "module"`), exports field, bin field, and scripts are left implicit.

#### Missing Elements

1. **No conventions.md or schema.md content specification**: Plan 01 mentions `wiki/00-meta/schema.md` and `conventions.md` as part of the config module, but neither the expected content/format of these files nor the parsing logic for them is defined anywhere in plans 01-03. Overview.md 10.1.1 requires schema version tracking in `schema.md`, but no plan specifies what `schema.md` looks like.

2. **No error handling strategy at the project level**: While Plan 03 defines a collect-and-continue parser error strategy, Plan 01 does not define a project-wide error handling philosophy (e.g., should workflow operations throw or return Result types? Should the CLI use process.exit codes?).

3. **`wiki/00-meta/index.md` and `log.md` are not addressed** in any of the three plans. Overview.md references these operational files from the Karpathy wiki pattern, but no plan defines their format or how the engine reads/writes them.

#### Codex Feedback

Codex was not invoked for this review as the /codex:rescue skill should only be used when blocked or for independent second-opinion verification. The issues identified here are clear from direct textual comparison and do not require a second opinion.

---

### 02-note-templates.md

#### Strengths

- Extremely thorough schema definitions for all 6 note types with Zod.
- Correctly implements the `feature`/`features` serialization contract from overview.md 13.2 with a Zod `.refine()` that enforces mutual exclusivity.
- Delta Summary grammar is precisely defined with regex patterns matching overview.md 14.2 exactly.
- Validation rules table is comprehensive and maps well to overview.md contracts.
- Status transition map is explicit and correct (`proposed -> planned -> in_progress -> applied`).
- Hard/soft prerequisite separation for `proposed -> planned` transition matches overview.md Section 15 precisely.
- Complete markdown templates for all 6 note types, consistent with their schema definitions.
- ID generation algorithm is well-specified and deterministic.
- The `SCHEMA_REGISTRY` pattern is clean and extensible.
- Decision promotion criteria from overview.md 14.2 are correctly documented.

#### Issues (Critical)

1. **`FrontmatterSchema` referenced but never defined**: Plan 03's `frontmatter-parser.ts` imports from `../schema/frontmatter.js` with a `FrontmatterSchema` (discriminated union). But Plan 02 defines individual schemas (`FeatureFrontmatterSchema`, `ChangeFrontmatterSchema`, etc.) and a `SCHEMA_REGISTRY`, but never defines a unified `FrontmatterSchema` discriminated union. Plan 03 depends on this for `validateFrontmatter()`. Either Plan 02 needs to define this union type, or Plan 03 needs to use the SCHEMA_REGISTRY pattern to look up the correct schema by `type` field.

2. **Requirement type conflict**: Plan 02 defines `RequirementSchema` (line 413) with fields `{ key, title, normative, scenarios: string[], content_hash }`. But Plan 03's requirement-parser produces objects with `{ name, normative, scenarios: Scenario[], content_hash }` where `Scenario = { name, rawText }`. These are fundamentally different shapes:
   - Plan 02: `scenarios` is `string[]` (plain text)
   - Plan 03: `scenarios` is `{ name: string, rawText: string }[]` (structured)
   - Plan 02: identifier field is `title`
   - Plan 03: identifier field is `name`
   - Plan 02: has `key` (composite key) as a field
   - Plan 03: does not include `key` in parser output; expects the index builder to construct it

   **Impact**: The parser (Plan 03) and the schema (Plan 02) cannot validate against each other without a mapping layer that is not defined in either plan.

#### Issues (Minor)

1. **`WikilinkRef` duplicated across schemas**: The `WikilinkRef` Zod validator (`z.string().regex(/^\[\[.+\]\]$/)`) is defined independently in feature.schema.ts, change.schema.ts, system.schema.ts, decision.schema.ts, source.schema.ts, and query.schema.ts. This should be defined once in `base.schema.ts` and imported.

2. **Source schema `source_type` values**: The plan defines source types as `'prd' | 'issue' | 'meeting' | 'code_reading' | 'research' | 'other'`. Overview.md does not specify these values. While inventing them is fine for v1, the plan should note these are plan-specific additions not mandated by overview.md, to avoid confusion about which parts are binding contracts vs. plan-level decisions.

3. **Query schema `question` field in frontmatter**: The plan puts `question: z.string()` in the Query frontmatter. Overview.md does not specify this. The Query template also has a `## Question` section in the body. Having the question in both frontmatter and body creates a potential for drift. The plan should clarify whether the frontmatter `question` is the authoritative source or the body section.

4. **`CHANGE_SOFT_SECTIONS` includes only 'Design Approach'**: Overview.md 15 also mentions Decision link as a soft prerequisite. The plan's `PLANNED_SOFT_PREREQUISITES` array only includes 'Design Approach' but the comment mentions Decision link. This should either be added to the array or clarified as a separate check (not section-based).

5. **Missing `aliases` field in BaseFrontmatterSchema**: The schema defines `aliases: z.array(z.string()).optional()`. But the templates show `aliases: []` (empty array). The plan should clarify whether an empty `aliases` array passes validation when the field is optional -- Zod's `.optional()` means the field can be absent, but an empty array `[]` is a different thing. This works fine with `.optional()`, but it's worth being explicit.

#### Missing Elements

1. **No validation for H1 title format**: The validation rules table mentions `TITLE_MISMATCH` (warning when H1 doesn't start with type prefix), but no schema or code implements this check. It exists only as a table row. The section-completeness check needs a concrete implementation spec.

2. **No schema version field**: Overview.md 10.1.1 requires schema version tracking. The IndexRecord has `schema_version`, but neither the frontmatter schemas nor the templates include a `schema_version` field. The plan should clarify where schema version lives (answer: in `wiki/00-meta/schema.md`, not in individual note frontmatter -- but this should be stated explicitly).

3. **No `created_at` or timestamp field**: Overview.md's deterministic ordering (10.5.1) requires `(created_at, change_id)` tuple for tiebreaking. Neither the frontmatter schemas nor templates include a `created_at` field. This is a gap: the sequencing plan will need this data, but it's not in the schema.

#### Codex Feedback

Same note as above -- direct comparison was sufficient.

---

### 03-vault-parser.md

#### Strengths

- Excellent modular architecture: each sub-parser is independently testable with no cross-dependencies (only note-parser composes them).
- The collect-and-continue error strategy is well-defined with a clear error recovery table.
- Content hashing strategy is properly specified: whitespace-insensitive but content-sensitive normalization, with scenario order mattering.
- The `ParseResult` type is comprehensive and bridges cleanly to the index layer.
- `toIndexRecord()` function properly handles the parser-to-index conversion.
- Delta Summary regex patterns correctly handle all grammar variants from overview.md 14.2, including the optional description after colon.
- Wikilink extraction from both frontmatter YAML and body text is correctly handled.
- Test strategy is remarkably thorough, with specific test cases for each sub-parser.
- Edge cases are well-considered (code blocks with `---`, deeply nested headings, mixed line endings).

#### Issues (Critical)

1. **Section content extraction bug in section-parser**: The algorithm (lines 450-462) attempts to exclude child heading content from a section's `content` field, but the implementation has a logic error. It breaks on lines matching `HEADING_REGEX` with level <= current level, which is correct for stopping at sibling/parent headings. But it *includes* child heading lines (deeper level) in the content. Meanwhile, the section's `children` array also contains those deeper sections. This means requirement text and scenario text will appear both in the parent section's `content` AND in separate child Section nodes. The requirement-parser then reads from `child.content` (line 646), which already has the correct content. But the normative extraction function `extractNormativeStatement` (line 730-740) splits `section.content` by heading regex and takes lines before the first child heading -- this is fragile because `section.content` includes ALL lines up to the next sibling, including child heading markers. This could work in practice but the content model is confusing and should be clarified.

2. **Frontmatter wikilink extraction uses JSON.stringify**: The note-parser (line 1073) extracts wikilinks from frontmatter by doing `extractWikilinks(JSON.stringify(raw.data), 'frontmatter', 1)`. This is clever but fragile:
   - JSON.stringify escapes `"` in strings, so `"[[Feature: Auth Login]]"` becomes `\"[[Feature: Auth Login]]\"` -- the wikilink regex should still match inside this.
   - But line numbers will be wrong (always line 1 since JSON.stringify produces a single line by default).
   - Nested objects will have keys and values flattened, potentially matching wikilinks in unexpected places.
   
   A cleaner approach would be to walk the frontmatter object recursively and extract wikilinks from string values only.

3. **`toIndexRecord` field naming doesn't match Plan 01's IndexRecord**: As noted in Plan 01 review, the `toIndexRecord` function outputs `feature` and `features` fields that don't exist in Plan 01's `IndexRecord` type. It also maps `tasks` as `{ text, done }` but Plan 01's `TaskRecord` uses `{ text, checked, line }`. The `done` vs `checked` field name mismatch will cause type errors.

#### Issues (Minor)

1. **Requirement parser imports from `../schema/requirement.js`**: This assumes Plan 02 exports `Requirement` and `Scenario` types from that path. But Plan 02's `requirement.ts` exports `RequirementRecord` (from Zod inference), not `Requirement`/`Scenario` as separate types. The import will fail unless Plan 02 also exports these types under the names Plan 03 expects.

2. **Delta summary parser stores `feature` as `[[${feature}]]`**: At line 859, the parsed feature is re-wrapped in `[[...]]` brackets. But the overview.md contract (10.3, 10.7) says the index should store resolved IDs, not wikilinks. The parser should store the raw wikilink target (without brackets), and let the link resolver handle ID normalization later. Storing `[[...]]` means every downstream consumer must strip brackets.

3. **`DeltaOpSchema` referenced but not defined**: Line 774 imports `DeltaOpSchema` from `../schema/delta-summary.js`, but Plan 02 defines `DeltaOpEnum` (not `DeltaOpSchema`). Name mismatch.

4. **Line number approximation**: Multiple parsers use `approximate` line numbers (e.g., task-parser line 995: `taskSection.line + i + 1 // approximate`). For a system that needs to support editing notes at specific lines (e.g., task checkbox toggling), approximate line numbers may cause off-by-one errors. The plan should clarify whether exact line numbers are a v1 requirement.

5. **Code blocks as heading/frontmatter traps**: The edge cases section (line 1381-1382) correctly identifies that code blocks containing `---` or `#` could be misinterpreted. But no implementation code addresses this. The section parser should skip lines inside fenced code blocks (triple backticks). This is a known parser correctness issue.

#### Missing Elements

1. **No vault-reader integration**: Plan 03 defines the parser but not how files are read from disk. Plan 01's file structure includes `src/core/vault/vault-reader.ts` with `scanNotes()` and `readNote()`, but neither Plan 01 nor Plan 03 specifies the vault-reader implementation. The gap is: who calls `parseNote()` for each file? The answer is the vault-reader/index-builder, but that's in a future plan (04). This is acceptable but should be noted as a dependency.

2. **No handling for notes without a recognized `type`**: If a markdown file in `wiki/` has frontmatter but `type: "something_else"`, the parser will return `frontmatter: null` (Zod validation fails). But the note-parser then skips type-specific parsing. The plan says "Unknown note type" produces a warning, but the implementation returns `frontmatter: null` which means `toIndexRecord()` returns `null`. Should unrecognized files be silently ignored? The plan should be explicit.

3. **No CRLF normalization**: OpenSpec's `MarkdownParser` explicitly calls `normalizeContent()` to convert `\r\n` to `\n`. Plan 03's frontmatter-parser splits on `\n` without normalizing first. The edge cases section lists "Mixed line endings (CRLF + LF in same file)" but no parser code handles it.

---

## Cross-Cutting Concerns

1. **Type definition authority is split across three plans**: Plan 01 defines types in `src/types/`, Plan 02 defines Zod schemas in `src/core/schema/`, and Plan 03 defines parser output types in `src/core/parser/types.ts`. There are at least 3 different definitions of `Requirement`-like types, 2 different `Task`-like types, and 2 different `Section` types. A clear type hierarchy must be established before implementation:
   - Parser output types (Plan 03's `types.ts`) should be the raw parse results.
   - Schema types (Plan 02's Zod inferred types) should be validation contracts.
   - Index types (Plan 01's `IndexRecord`) should be the canonical in-memory representation.
   - Conversion functions between these (Plan 03's `toIndexRecord`) must be consistent with all three.

2. **`feature`/`features` field handling inconsistency**: Plan 01's `IndexRecord` does not have `feature`/`features` fields. Plan 02's `ChangeFrontmatterSchema` defines them. Plan 03's `toIndexRecord` outputs them. This must be reconciled before any implementation begins.

3. **No shared constants file**: `WHY_MIN_LENGTH = 50` appears in Plan 02's validation rules but is not defined as a constant. OpenSpec has `MIN_WHY_SECTION_LENGTH=50` in `src/core/validation/constants.ts`. Plan 02 should define this constant explicitly.

4. **Test fixture vault**: Plans 01 and 03 both reference test fixtures but describe slightly different directory structures. Plan 01 puts fixtures at `tests/fixtures/valid-vault/wiki/...`, Plan 03 puts them at `test/fixtures/vault/`. These should be unified to a single path convention.

---

## overview.md Limitations Discovered

1. **No `created_at` field specified**: Overview.md 10.5.1 requires deterministic ordering using `(created_at, change_id)` tuple, but Section 14.2's Change template does not include `created_at` in the frontmatter. This is a gap in overview.md itself -- the ordering algorithm depends on data that the document model doesn't capture.

2. **`aliases` resolution ambiguity**: Overview.md 10.7 says "if multiple alias matches exist, raise an ambiguous error." But it does not define what "alias match" means precisely. Is it case-sensitive? Does it match against the full alias string or allow partial matching? Plans 02-03 don't clarify this either.

3. **Section operations in Delta Summary underspecified**: Overview.md 14.2 shows section operations (`ADDED/MODIFIED/REMOVED section "name" in [[note]]`) but does not define what `base_fingerprint` means for sections (vs. requirements). Plan 02's regex (line 391) shows section operations do NOT have `[base:]` suffix in the pattern, which seems correct but is not explicitly stated in overview.md.

4. **`Query` note lifecycle is vague**: Overview.md says "store the output as a Query note when appropriate" (Section 15) but does not define when it's appropriate, what status transitions Query notes have, or how they relate to the Change workflow. Plan 02 assigns `status: 'active' | 'draft'` to Query which is reasonable but invented -- overview.md is silent on Query lifecycle.

5. **`wiki/00-meta/index.md` and `log.md` are mentioned in overview.md Section 13.3** as part of the folder structure but never specified in detail. No plan addresses their format or purpose beyond "operational files."

---

## Recommendations

1. **Before implementation, create a unified type mapping document** that resolves all Requirement/Task/Section type conflicts across the three plans. Specifically:
   - Decide whether `Scenario` is `string` or `{ name: string, rawText: string }`.
   - Decide whether `Requirement` uses `name` or `title` as the identifier field.
   - Decide whether `Task` uses `checked` or `done`, and whether `line` is required.
   - Add `feature`/`features` fields to `IndexRecord`.

2. **Add `created_at` to the Change frontmatter schema** (Plan 02) to support the deterministic ordering contract in overview.md 10.5.1.

3. **Define the `FrontmatterSchema` discriminated union** in Plan 02 so that Plan 03's `validateFrontmatter()` has something to import.

4. **Normalize file naming**: Pick either `wikilink-extractor.ts` or `wikilink-parser.ts` and use it consistently across all plans.

5. **Add CRLF normalization** to Plan 03's frontmatter parser and section parser as a first step before any line-splitting.

6. **Clarify code block handling** in Plan 03's section parser -- lines inside fenced code blocks should not be treated as headings or frontmatter delimiters.

7. **Unify test fixture paths** across plans (`tests/fixtures/` vs `test/fixtures/`).

8. **Add a `schema.md` format specification** to either Plan 01 or Plan 02, since it is required by overview.md 10.1.1 but no plan defines what this file should contain.
