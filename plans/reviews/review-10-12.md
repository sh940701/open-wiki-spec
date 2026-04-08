# Review: Plans 10-12 (Verify, Query, CLI/Init)

Reviewer: Devil's Advocate Agent
Date: 2026-04-06

---

## Plan 10: Verify Workflow (`10-workflow-verify.md`)

### overview.md Compliance

**Strong compliance.** This plan is the most faithful to the overview.md contract of all three plans in this batch.

1. **3-Dimension Verification** (section 10.8): All three dimensions (Completeness, Correctness, Coherence) are implemented with itemized checks that map directly to the overview.md bullet points. The plan also adds a fourth pseudo-dimension `vault_integrity` which is consistent with section 10.8's vault integrity checklist. This is a reasonable organizational choice.

2. **Operation Validation Matrix** (section 10.8): Fully implemented. The `runOperationValidationMatrix()` function covers all four operations (ADDED/MODIFIED/REMOVED/RENAMED) in both pre-apply and post-apply phases. The matrix matches the overview.md table exactly.

3. **Stale-Change Detection** (section 10.8): Fully addressed. `checkStaleBase()` compares `base_fingerprint` against current `content_hash`. The `stale_base` warning is raised correctly. The auto-apply blocking behavior is documented.

4. **Vault Integrity Items** (section 10.8): All 10 items from the overview.md list are covered:
   - duplicate/missing id: `duplicateIdCheck`, `missingIdCheck`
   - unresolved wikilink: `unresolvedWikilinkCheck`
   - ambiguous alias/title collision: `ambiguousAliasCheck`
   - schema mismatch: `schemaVersionCheck`, `checkSchemaVersionMatch`
   - invalid frontmatter: `malformedFrontmatterCheck`, `invalidFrontmatterTypeCheck`
   - orphan note: `orphanNoteCheck`
   - broken depends_on: `checkDependsOnConsistency` (in coherence), `checkStatusTransition` (in correctness)
   - archive placement violation: `archivePlacementCheck`
   - stale base_fingerprint: `checkStaleBase`
   - requirement-level conflict: `checkRequirementLevelConflicts`

5. **Section 15 verify items**: All four categories listed in section 15 (Completeness, Correctness, Coherence, Vault integrity) are explicitly addressed.

6. **Parallel change conflict detection** (section 15): Explicitly implemented at both touches level (`checkTouchesOverlap`) and requirement level (`checkRequirementLevelConflicts`).

7. **Schema mismatch detection** (section 10.1.1): Covered by `schemaVersionCheck` and per-note `checkSchemaVersionMatch`.

### Issues Found

**ISSUE V-1: Naming inconsistency with plan 04 -- `VaultIndex` vs `IndexSnapshot`.**
The plan references `IndexSnapshot` throughout, but plan 04 defines the type as `VaultIndex`. The plan also references `index.allRecords()`, `index.getById()`, `index.resolveLink()`, `index.schemaVersion` -- but plan 04's `VaultIndex` interface uses `records: Map<string, IndexRecord>`, `schema_version: string` (snake_case), and has no `allRecords()` or `getById()` convenience methods defined. Either plan 04 needs to expose these as methods on an `IndexSnapshot` wrapper class, or plan 10 needs to align with the raw `VaultIndex` shape. This must be resolved before implementation.

**ISSUE V-2: `checkDriftForStatus` mentioned but never defined.**
The main verify flow at line 310 calls `checkDriftForStatus(change, index)` under correctness checks, and overview.md section 11.4 defines acceptable drift by status. However, no algorithm or pseudocode is provided for this function. What does "excessive drift" mean in programmatic terms? How is drift measured without codebase analysis? Section 11.4 says drift for `applied` status is an error, but what signals does the engine use to detect this without scanning actual source code? This is a gap -- the plan needs to either define the drift detection algorithm or explicitly defer it to a future iteration.

**ISSUE V-3: `checkDescriptionConsistency` referenced but undefined.**
The coherence section at line 316 calls `checkDescriptionConsistency(allNotes)`. The overview.md section 10.8 Coherence bullet says "Feature, Change, Decision, System descriptions should not contradict each other." But the plan provides no pseudocode for how description consistency is checked programmatically. String-level comparison? Keyword contradiction detection? This seems like it requires LLM judgment, which contradicts the plan's positioning as "deterministic programmatic checks." Either remove this check from v1 or specify the algorithm.

**ISSUE V-4: `checkDecisionConsistency` referenced but undefined.**
Similar to V-3 -- line 315 calls `checkDecisionConsistency(allDecisions, allFeatures)` but provides no pseudocode. Detecting "conflicting Decisions" programmatically without LLM reasoning is non-trivial.

**ISSUE V-5: Redundancy with plan 06 (sequencing-engine) for conflict detection.**
The plan acknowledges (line 771-772) that sequencing-engine has touches severity model but says verify "re-implements its own conflict checks for independence." This creates two parallel implementations of the same logic: `computeTouchesSeverity()` in plan 06 and `checkTouchesOverlap()` in plan 10. The severity classification is slightly different: plan 06 uses four levels (parallel_safe/needs_review/conflict_candidate/blocked) while plan 10 maps Feature overlap to ERROR and System overlap to WARNING. These should either share the same implementation or the plan should document why the divergence is intentional.

**ISSUE V-6: `touches` overlap logic is simplified compared to plan 06.**
Plan 06's `computeTouchesSeverity()` considers `depends_on` relationships to determine `blocked` status, while plan 10's `checkTouchesOverlap()` only checks whether two changes touch the same target. The `blocked` severity case is handled separately in `checkStatusTransition()`, but plan 10 doesn't classify touches results using the four-level severity model from overview.md section 10.5.1. The overview.md contract says: "Preflight and verify must classify using the severity model." The plan should use the same four-level classification.

**ISSUE V-7: Archive placement check is too lenient.**
`archivePlacementCheck()` checks that notes in `99-archive/` have `status: applied`, but the comment at line 633 says `applied` notes in `04-changes/` are "allowed per hybrid lifecycle" and only generates INFO. However, overview.md section 15 apply says: "After an explicit retention window or explicit archive command, move it to 99-archive/." The plan doesn't define what the retention window is or how to detect notes that have exceeded it. For v1 this is acceptable as INFO, but it should be explicitly noted as a future enhancement.

**ISSUE V-8: Missing `EXCESSIVE_DRIFT` severity classification.**
The `VerifyIssueCode` type includes `EXCESSIVE_DRIFT` but no algorithm produces it. The only drift-related function mentioned is `checkDriftForStatus` which is undefined (see V-2).

### OpenSpec Fidelity

**Good translation.** The plan correctly identifies that OpenSpec's verify is LLM-driven (prompt-based) while open-wiki-spec's verify should be deterministic and programmatic. The 3-dimension structure is preserved. The key shift -- from "search codebase for evidence" to "validate vault graph consistency" -- is well-reasoned and aligned with the different architecture.

However, the plan loses OpenSpec's codebase-level verification entirely (searching for requirement implementation evidence in actual source code). This is acknowledged in the differences table but not discussed as a potential gap. For v1 this is acceptable since vault integrity is the primary concern, but the plan should mention whether codebase-level verification is planned for future versions.

### Implementability

**High implementability.** The algorithms are detailed, the pseudocode is clear, and the test strategy is comprehensive. The modular file structure (one file per concern) makes each check independently testable.

The main implementability risk is V-2/V-3/V-4: three functions referenced in the orchestrator but lacking pseudocode definitions. An implementer would have to invent these algorithms or skip them.

### Missing Elements

- **No summary generation algorithm.** The `VerifyReport` has a `passed` field but the plan doesn't specify the aggregation rule (e.g., `passed = errors === 0`). This is trivially inferable but should be explicit.
- **No `--fix` or auto-remediation.** The plan is purely diagnostic. This is correct for v1 but worth stating as a non-goal.
- **Verify invocation context not fully specified.** Does `ows verify` always scan the entire vault, or does `--changeId` narrow the scope? The `VerifyOptions` interface has `changeId` and `skipCoherence`, but the relationship between scope narrowing and skipped checks is not algorithmed out.

### Over-engineering Assessment

**Appropriate for v1.** The plan is detailed but not bloated. The 10-file structure is justified by the separation of concerns. The exhaustive `VerifyIssueCode` enum is useful for programmatic consumers (the agent needs to match on codes).

---

## Plan 11: Query Workflow (`11-workflow-query.md`)

### overview.md Compliance

**Adequate compliance with some gaps.**

1. **Section 13.2 (Note Types)**: Query is correctly identified as one of the six note types. The role description ("analysis notes and captured investigation outputs") matches.

2. **Section 15 (query workflow)**: The two requirements are met:
   - "Search related notes in the vault graph" -- implemented via `querySearch()`.
   - "Store the output as a Query note when appropriate" -- implemented via `createQueryNote()` with heuristic gating.

3. **Section 11.1 (Canonical Identity)**: Query notes have an immutable `id` field. Correct.

4. **Section 10.2 (Index Refresh)**: Fresh vault scan at start of query. Specified in the workflow orchestrator.

5. **Section 10.4 (Query Object Contract)**: Explicitly addressed with `normalizeToQueryObject()` producing a structured `QueryObject` before retrieval.

### Issues Found

**ISSUE Q-1: QueryObject interface diverges from overview.md 10.4.**
Overview.md section 10.4 defines the query object format (not quoted here but readable in the file). The plan defines a `QueryObject` with fields `intent`, `summary`, `feature_terms`, `system_terms`, `entity_terms`, `status_bias`. This appears to match the overview.md contract, but the plan says it "reuses the same QueryObject contract defined for the retrieval engine" -- plan 05 (retrieval-engine) should be the canonical source. Cross-check needed: does plan 05 define the same fields? If plan 05 uses different field names or adds fields, the query plan will be out of sync.

**ISSUE Q-2: `querySearch()` reimplements retrieval-engine scoring logic.**
The plan says "reuse scoring logic from retrieval-engine" (line 303-304) with weights like `exact title match: +40`, `alias match: +35`, etc. But then it defines its own full search algorithm. This creates ambiguity: is `querySearch()` calling into the retrieval engine, or copy-pasting its weights? The dependency table says query needs retrieval-engine for "Scoring logic reuse" but the algorithm appears self-contained. If query reimplements search independently, the weights will drift from the retrieval engine over time. The plan should specify whether it calls the retrieval engine's search function directly or duplicates the logic.

**ISSUE Q-3: Graph expansion logic may be expensive.**
Phase 1 step 6 expands graph context "one hop from top 5 candidates" including all notes sharing the same system or feature. In a vault with many notes per system, this could produce a large `graphContext` array. No cap is specified. The test strategy mentions "Very broad question matching 50+ notes -> candidates capped at top N" but no cap is defined for graphContext nodes.

**ISSUE Q-4: `consulted` frontmatter field is agent-dependent.**
The Query note frontmatter includes `consulted: string[]` -- wikilinks to all notes "read during investigation." But the engine provides search results, not a list of notes the agent actually read. The `QueryNoteInput.consultedNotes` field is described as "Notes that were consulted during investigation" but this is populated by the agent, not the engine. The plan should clarify that this is an agent-supplied input and cannot be validated by the engine.

**ISSUE Q-5: Query note id collision handling is under-specified.**
Edge case section mentions "Slug collision (two queries with same title on same date) -> handled by appending counter or timestamp" but the `createQueryNote()` pseudocode generates `query-${slug}-${dateStr}` with no collision check. The implementer must add this.

**ISSUE Q-6: `resolveQueryNote()` changes status but doesn't specify file write.**
The function `resolveQueryNote(queryId, vaultPath)` updates frontmatter status from 'open' to 'resolved', but the plan doesn't specify how the markdown file is modified. Does it reparse the frontmatter and rewrite the file? Does it use a shared utility from vault-parser or note-templates? This should reference the shared frontmatter-writing mechanism used by other workflows.

**ISSUE Q-7: `listQueries()` doesn't need to be in the query module.**
The `listQueries()` function (line 699) filters index records by type 'query' with optional status/feature/system filters. This is generic enough to be part of the index-engine or the CLI list command. Duplicating it in the query module creates unnecessary coupling.

**ISSUE Q-8: Noteworthiness heuristics use hardcoded English patterns.**
The `assessNoteworthiness()` function uses regex patterns like `/\b(why|how should|what if|compare|trade-?off)\b/i` to detect analytical questions. This breaks for non-English input. While v1 may be English-only, this limitation should be documented. The overview.md does not specify language requirements.

### OpenSpec Fidelity

**Good differentiation.** The plan correctly identifies that OpenSpec's `explore` is a thinking stance with no persistent output, while `query` creates persistent notes. The comparison table is accurate. The key innovation -- query notes as accumulated knowledge -- fills a real gap in OpenSpec's design.

The concern is that the plan is quite heavy for what overview.md section 15 specifies in just two bullet points:
- "Search related notes in the vault graph"
- "Store the output as a Query note when appropriate"

The plan builds a 5-file module with noteworthiness heuristics, graph expansion, context document construction, and a detailed note builder. Whether this complexity is justified for v1 depends on the team's ambition, but the heuristics layer in particular feels over-engineered.

### Implementability

**Medium-high.** The algorithms are detailed and the data structures are clear. The main risk is:
- The two-phase interaction model (engine provides structure, agent fills analysis) requires careful prompt engineering for the agent phase that is not specified in this plan.
- `normalizeToQueryObject()` classification logic (e.g., distinguishing "investigate" from "compare" intent) is non-trivial and may require iteration.

### Missing Elements

- **No pagination for search results.** What if the vault has hundreds of notes matching a query? The context document could become huge.
- **No update mechanism for existing Query notes.** The heuristics suggest "existing open Query could be updated" but no `updateQueryNote()` function is defined.
- **No archive/lifecycle for Query notes.** Query notes have `open` and `resolved` statuses, but no archiving mechanism. Do resolved queries eventually move to `99-archive/`? This is probably covered by the general archive mechanism but should be noted.

### Over-engineering Assessment

**Moderately over-engineered for v1.** The noteworthiness heuristics with multi-factor scoring (5 heuristics, score thresholds at 50/30/15) feel premature for a first version. A simpler approach: always offer to save, let the user decide. The heuristics can be added in v2 once usage patterns emerge. The graph expansion and context construction are well-designed but add complexity that may not be needed if the retrieval engine already provides good search results.

---

## Plan 12: CLI & Init (`12-cli-init.md`)

### overview.md Compliance

**Good compliance.**

1. **Section 13.3 (Folder Structure)**: The `VAULT_DIRS` constant exactly matches the overview.md folder structure: `00-meta/`, `01-sources/`, `02-systems/`, `03-features/`, `04-changes/`, `05-decisions/`, `06-queries/`, `99-archive/`.

2. **Section 10.1.1 (Schema Version)**: `schema.md` is created during init with version, migration notes, and deprecated fields.

3. **CLI Commands**: The plan defines `ows init`, `ows propose`, `ows continue`, `ows apply`, `ows verify`, `ows query`, `ows status`, `ows list`. This matches the contracts in section 15 (propose, continue, apply, verify, query) plus operational commands.

4. **Section 9.4 (v1 Claude Code only)**: Correctly scoped. Skill generation targets `.claude/commands/` only.

5. **Section 6.2D (Plain Vault Mode)**: The plan reads/writes markdown directly. No Obsidian runtime dependency.

6. **`--json` output**: All commands support `--json` via `CliOptions.json`.

7. **Section 15 (Section-Completeness Contract)**: `ows status` implements `checkPlannedPrerequisites()` and `nextAction()` as defined in overview.md section 15.

### Issues Found

**ISSUE C-1: `ows status` has no `--json` output path explicitly shown.**
The StatusResult interface is well-defined, but the `status()` pseudocode at line 506-521 says "Return structured result or format for human display" without showing the JSON serialization path. The pattern is implied by `CliOptions.json` but should be explicit.

**ISSUE C-2: No `ows archive` command.**
Overview.md section 15 apply says: "After an explicit retention window or explicit archive command, move it to 99-archive/." OpenSpec has an `archive` command. The plan's CLI commands are: init, propose, continue, apply, verify, query, status, list -- no `archive`. This means there's no CLI mechanism to move applied changes to `99-archive/`. Is archiving intended to be manual? This should be explicitly addressed as either a v1 non-goal or an omission.

**ISSUE C-3: No `ows validate` standalone command.**
OpenSpec has `validate [item-name]` as a separate command. The plan uses `ows verify` for validation, but `verify` as defined in plan 10 is vault-wide. There's no command to validate a single note's structure (e.g., check if a Feature note has valid frontmatter before committing). This could be covered by `ows verify --noteId <id>` but this option comes from plan 10, not plan 12.

**ISSUE C-4: Skill file instructions are placeholders.**
The `WORKFLOW_SKILLS` record uses `description: '...', instructions: '...'` placeholders. The example for `ows-propose` is provided but the other five workflow skills are not shown. Given that skill instructions are the primary interface between Claude Code and the CLI, these are critical artifacts. The plan should at least outline the key steps for each skill, or reference where they will be defined.

**ISSUE C-5: `conventions.md` template has hardcoded content.**
The conventions template at lines 460-501 includes specific conventions (kebab-case filenames, SHALL/MUST requirements, delta summary operations). These conventions should derive from the overview.md contract, and they do, but they're inlined as string literals in `meta-files.ts`. If conventions change, this template must be manually updated. Consider referencing the overview.md as the source of truth for conventions content.

**ISSUE C-6: `ows init` extend mode is under-specified.**
The init algorithm at step 3 says: "If extend mode and not --force: Log warning and return." But what does extend mode actually do? OpenSpec's extend mode migrates existing projects to the profile system. The plan mentions detecting `wiki/` directory existence but doesn't define what extending means: does it add missing directories? Regenerate skill files? Update schema.md? The only behavior specified is "log warning and return" which makes extend mode useless.

**ISSUE C-7: `ows init` doesn't create `.gitignore` entries.**
When creating `wiki/` in a git repository, there may be Obsidian-specific files (.obsidian/ cache, workspace files) that should be gitignored. The plan doesn't address this.

**ISSUE C-8: No vault discovery / auto-detection.**
Commands like `ows status`, `ows list`, `ows propose` need to know where the vault is. The plan doesn't specify how `vaultPath` is resolved. Is it always `./wiki/`? Does it walk up the directory tree like git does? Is there a config file? This is a critical UX question for the CLI.

**ISSUE C-9: `StatusResult.sectionCompleteness.designApproach` uses `null` for N/A.**
TypeScript allows `boolean | null` but this is unusual. A cleaner approach would be to omit the field entirely or use a discriminated union. Minor, but worth noting for API cleanliness.

**ISSUE C-10: No error handling pattern defined.**
The plan doesn't define how CLI errors are displayed. What happens when `ows propose` is called but no vault exists? What's the error format? Is there a consistent error JSON structure for `--json` mode? OpenSpec uses `ora` spinners and chalk colors. The plan should specify an error handling contract.

**ISSUE C-11: `log.md` is written during init but no other operation updates it.**
The init creates `log.md` with an `init` entry. But no other CLI command (propose, apply, verify, etc.) is shown appending to the log. Overview.md says `log.md` is an operational log, but the plan doesn't define the log-writing mechanism. If only init writes to it, the log will be a single-entry file forever.

### OpenSpec Fidelity

**Reasonable adaptation.** The plan correctly simplifies OpenSpec's multi-tool, multi-profile init into a Claude Code-only init. The key differences are well-documented:
- No profile selection (all workflows available)
- No tool selection (Claude Code only)
- No onboarding walkthrough

The missing onboarding walkthrough is a notable gap. OpenSpec's onboard provides a guided first-cycle experience that helps users understand the workflow. For v1, this could be replaced by good `getting-started` documentation, but the plan doesn't provide either.

### Implementability

**High.** The init engine is straightforward directory/file creation. The CLI commands are thin wrappers. The main implementation risk is the skill file content (C-4) which is the most important part for user experience but is left as placeholders.

### Missing Elements

- **No `ows help` or `ows --help` behavior specified.** Commander provides this automatically, but the help text for each command should be defined.
- **No versioning in package.json / binary.** The plan shows `bin/ows.js` as entry shim but doesn't define how the package is distributed (npm, standalone binary, etc.).
- **No `ows update` command** to regenerate skill files when the tool is updated.
- **No telemetry / feedback mechanism** (OpenSpec has `feedback <message>`).

### Over-engineering Assessment

**Appropriately scoped for v1.** The plan is lean -- perhaps too lean in some areas (skill file content, extend mode, vault discovery). The thin-wrapper pattern for workflow commands is correct.

---

## Cross-Plan Consistency

### Plan 10 (Verify) x Plan 04 (Index)

- **Type naming**: Plan 10 uses `IndexSnapshot`, plan 04 uses `VaultIndex`. Must reconcile.
- **Method access**: Plan 10 calls `index.allRecords()`, `index.getById()`, `index.resolveLink()`, `index.schemaVersion`. Plan 04's `VaultIndex` exposes `records: Map`, `schema_version: string`. Either plan 04 needs to add convenience methods or plan 10 needs to use the raw Map directly.
- **Snake_case vs camelCase**: Plan 04 uses `schema_version`, plan 10 uses `schemaVersion`. Plan 06 uses `depends_on`, plan 10 uses `dependsOn` in algorithm but `depends_on` in some places. The project needs a convention.

### Plan 10 (Verify) x Plan 06 (Sequencing)

- **Conflict detection duplication**: Both plans implement touches overlap and requirement-level conflict detection. Plan 06 produces `TouchesSeverityResult` and `RequirementConflict`, while plan 10 produces `VerifyIssue` with codes `TOUCHES_OVERLAP_*` and `REQUIREMENT_CONFLICT_CRITICAL`. The verify plan should ideally call sequencing engine functions and map the results to `VerifyIssue` format, rather than reimplementing the logic.
- **Severity model divergence**: Plan 06 uses the four-level model from overview.md 10.5.1 (`parallel_safe/needs_review/conflict_candidate/blocked`). Plan 10 maps to ERROR/WARNING without using the four-level model. The overview.md explicitly says verify should use this model.

### Plan 10 (Verify) x Plan 09 (Apply)

- **Operation validation matrix is shared concern.** Both apply (pre-apply checks) and verify (pre/post-apply checks) need the operation validation matrix. The plan correctly places it in verify, but apply (plan 09) also needs to call `checkStaleBase()` before applying. The dependency direction should be verify -> shared utility, not apply -> verify. Consider extracting `operation-validator.ts` and `stale-detector.ts` to a shared module.

### Plan 11 (Query) x Plan 05 (Retrieval)

- **Search logic overlap.** The query plan defines its own search algorithm with scoring weights. Plan 05 (retrieval-engine) should be the canonical search implementation. Query should call into retrieval, not reimplement. The plan acknowledges this dependency but the algorithm is self-contained.

### Plan 12 (CLI) x All Workflow Plans

- **CLI command signatures match workflow function signatures.** Each CLI command calls the corresponding workflow function with correct parameters. The thin-wrapper pattern is consistent.
- **`buildIndex()` is called by every command**, but plan 12 references it as `buildIndex(vaultPath)` while plan 04 may define it differently. Need to verify the function signature matches.

---

## Priority Summary

### Must Fix Before Implementation

1. **V-1**: Reconcile `IndexSnapshot` vs `VaultIndex` naming and API shape across plans 04, 10, 11, 12.
2. **V-2**: Define or defer `checkDriftForStatus()` -- currently a phantom function.
3. **V-5/V-6**: Decide whether verify reuses sequencing-engine conflict detection or reimplements. If reimplements, align with the four-level severity model.
4. **C-2**: Address missing `archive` command or document it as v1 non-goal.
5. **C-8**: Define vault path discovery mechanism for all CLI commands.

### Should Fix

6. **V-3/V-4**: Define or remove `checkDescriptionConsistency` and `checkDecisionConsistency`.
7. **Q-2**: Clarify whether query calls retrieval-engine or duplicates its search logic.
8. **C-4**: Provide at least skeleton content for all six workflow skill files.
9. **C-6**: Define what extend mode actually does beyond logging a warning.
10. **C-11**: Define which operations append to `log.md`.

### Nice to Have

11. **Q-8**: Document English-only limitation of noteworthiness heuristics.
12. **Q-3**: Add caps for graph expansion node count.
13. **C-10**: Define consistent error handling contract for CLI.
14. **V-7**: Define retention window for archive placement check.
