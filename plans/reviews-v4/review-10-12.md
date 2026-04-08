# Review V4: Plans 10 (Verify), 11 (Query), 12 (CLI & Init)

**Reviewer**: Devil's Advocate Agent
**Date**: 2026-04-06
**Review scope**: Fresh review against overview.md, unified types, OpenSpec source, and cross-plan contracts.

---

## Executive Summary

Plans 10, 11, and 12 are mature and well-structured. Prior review rounds have resolved the major issues (sequencing delegation, deduplication, API boundary consistency). This review found **2 medium issues**, **5 low issues**, and **3 observations** across the three plans. No blocking issues were found.

The plans are **implementation-ready** with the caveats noted below.

---

## Plan 10: Workflow Verify

### overview.md Compliance

**Section 10.8 (Verify Dimensions)**: PASS. All three dimensions (Completeness, Correctness, Coherence) are implemented with the correct check items. The Operation Validation Matrix at lines 350-421 exactly reproduces the overview.md table (line 837-843). Stale-change detection via `base_fingerprint` is correctly implemented at lines 427-461.

**Section 10.8 (Vault Integrity)**: PASS. All ten integrity check items from overview.md line 861-872 are covered:
- duplicate/missing id: `duplicateIdCheck()`, `missingIdCheck()`
- unresolved wikilink: `unresolvedWikilinkCheck()`
- ambiguous alias: `ambiguousAliasCheck()`
- schema mismatch: `schemaVersionCheck()`
- invalid frontmatter: `malformedFrontmatterCheck()`, `invalidFrontmatterTypeCheck()`
- orphan note: `orphanNoteCheck()`
- broken depends_on: checked in `checkDependsOnConsistency()` and `checkStatusTransition()`
- archive placement: `archivePlacementCheck()`
- stale base_fingerprint: `checkStaleBase()`
- requirement-level conflict: `checkConflictsViaSequencing()`

**Section 15 (verify)**: PASS. The plan explicitly performs parallel change conflict detection at both touches level and requirement level (lines 463-536), matching the overview.md requirement at line 1359.

**Section 10.1.1 (Schema version)**: PASS. `checkSchemaVersionMatch()` at lines 604-626 checks per-note schema version against the declared vault version.

### Type Consistency with Unified Types

PASS. All types (`VerifyIssue`, `VerifyReport`, `IssueSeverity`, `VerifyDimension`) match the unified types definition at lines 337-357 of `00-unified-types.md`. The plan's `VerifyReport` adds a `skipped: SkippedCheck[]` field (line 212-219) not present in unified types -- this is an additive extension, not a conflict. However:

**LOW-10-01: `SkippedCheck` type not in unified types.**
The `SkippedCheck` interface (lines 215-219) is plan-specific and not declared in `00-unified-types.md`. Since consumers of `VerifyReport` (particularly plan 12's `archiveCommand`) may need to inspect it, this should either be added to unified types or documented as a plan-local extension.

**Recommendation**: Add `SkippedCheck` to the Verify Types section of `00-unified-types.md`, or add a comment in plan 10 noting it is a plan-local type not consumed externally.

### Implementability

**Sequencing delegation**: CLEAN. `checkConflictsViaSequencing()` correctly calls `computeTouchesSeverity()` and `detectRequirementConflicts()` from plan 06, satisfying the ownership rule at unified types line 387-388. The function signatures match plan 06's public API (lines 782, 794).

**MEDIUM-10-02: `computeTouchesSeverity` signature mismatch between plan 10 and plan 06.**
Plan 10 calls `computeTouchesSeverity(changeA, changeB, index)` at line 489, where `index` is implicitly the `VaultIndex`. Plan 06 defines `computeTouchesSeverity(changeA: IndexRecord, changeB: IndexRecord, index: Map<string, IndexRecord>)` at line 298 -- the third parameter is `Map<string, IndexRecord>`, not `VaultIndex`.

Plan 10 passes the full `VaultIndex` (or an implicit index), but plan 06 expects `Map<string, IndexRecord>`. The caller must pass `index.records` not `index`.

Similarly, `detectRequirementConflicts(changeA, changeB, index)` at plan 10 line 524 passes two changes and an index, but plan 06's signature at line 348 is `detectRequirementConflicts(activeChanges: IndexRecord[]): RequirementConflictPair[]` -- it takes an array of ALL active changes, not a pair.

**Impact**: Plan 10's `checkConflictsViaSequencing()` iterates pairs itself and calls per-pair, but plan 06's `detectRequirementConflicts` takes the full array and does its own pair iteration internally. This is a semantic mismatch.

**Recommendation**: Either:
(a) Plan 10 should call `detectRequirementConflicts(activeChanges)` once with the full array (not per-pair), matching plan 06's API. Then map the returned `RequirementConflictPair[]` to `VerifyIssue[]`.
(b) Plan 06 should export a per-pair variant. Given the ownership rule says verify must not reimplement, option (a) is correct.

For `computeTouchesSeverity`, the caller must pass `index.records` instead of `index`.

**Deduplication contract (V3-1 fix)**: CLEAN. The `coveredByMatrix` set mechanism at lines 667-691 correctly prevents duplicate issues between `runOperationValidationMatrix()` and `checkDriftForStatus()`. The explanation is thorough and the implementation is sound.

**Graceful degradation**: PASS. The `determineAvailableChecks()` function at lines 847-868 correctly skips checks when data is missing, and records skipped checks for the report.

### OpenSpec Fidelity

PASS. The plan correctly identifies the key difference: OpenSpec's verification is LLM-driven (prompt-based heuristic evaluation), while open-wiki-spec's is deterministic programmatic checks. The 3-dimension framework is preserved. The programmatic `Validator` class patterns (Zod schemas, business rules) are adapted into the structured check functions.

### Cross-Plan Consistency (06 <-> 10)

See MEDIUM-10-02 above for the API signature mismatch. Otherwise:
- Plan 10's dependency declaration (line 927) correctly lists plan 06 as providing `computeTouchesSeverity()` and `detectRequirementConflicts()`.
- The ownership rules in unified types (lines 387-388, 393) are satisfied.
- Plan 10 does NOT reimplement conflict detection logic.

### Gaps

**LOW-10-03: `checkDependsOnConsistency()` is declared but not defined.**
The main verify flow at line 287 calls `checkDependsOnConsistency(allActiveChanges, index)` under coherence checks, but no pseudocode definition is provided. The `checkStatusTransition()` function at lines 639-659 partially covers depends_on checks (for `in_progress` changes), and `checkConflictsViaSequencing()` handles the blocked state via `computeTouchesSeverity`. It's unclear what additional logic `checkDependsOnConsistency` provides beyond these.

**Recommendation**: Either remove this function from the verify flow (since depends_on is already covered by status transition checks and sequencing delegation) or provide a pseudocode definition clarifying what additional checks it performs (e.g., circular depends_on detection, which is listed as an edge case at line 991).

**LOW-10-04: `missingIdCheck()` is listed in the flow but not defined.**
Line 265 calls `missingIdCheck(index)` but no pseudocode is provided, unlike the other vault integrity checks.

**Recommendation**: Add a brief pseudocode -- likely converting `VaultIndex.warnings` of type `'missing_id'` to `VerifyIssue[]`, similar to `duplicateIdCheck()`.

### Over-Engineering

No over-engineering detected. The plan maintains appropriate scope. The deduplication contract and graceful degradation are warranted by real implementation concerns.

---

## Plan 11: Workflow Query

### overview.md Compliance

**Section 13.2 (Note Types)**: PASS. Query is correctly implemented as one of the six note types with role "analysis notes and captured investigation outputs."

**Section 15 (query)**: PASS. The two core requirements are met:
1. "Search related notes in the vault graph" -- implemented via `querySearch()` using the retrieval engine (lines 305-370).
2. "Store the output as a Query note when appropriate" -- implemented via `assessNoteworthiness()` + `createQueryNote()` with user confirmation (lines 410-468, 474-553).

**Section 10.2 (Index Refresh)**: PASS. The workflow performs a fresh vault scan at start (line 668-669 in the public API: `queryWorkflow()` builds fresh index).

**Section 10.4 (Query Object Normalization)**: PASS. The plan includes `normalizeToQueryObject()` at lines 261-298, ensuring the retrieval layer does not receive raw natural language. The mapping from query-specific intents to the retrieval engine's `RetrievalQuery.intent: 'query'` is explicitly documented (lines 257-259).

**Section 11.1 (Canonical Identity)**: PASS. Query notes get a generated `id` (line 479: `id = query-${slug}-${dateStr}`).

### Type Consistency with Unified Types

PASS. `QueryNoteFrontmatter` correctly extends `QueryFrontmatter` from unified types (lines 63-70). The extension fields (`changes`, `decisions`, `sources`, `related_queries`, `created_at`) are documented as stored in `raw_text` and not separately indexed (lines 182-186). The core fields (`question`, `consulted`, `features`, `systems`) are indexed via the unified type.

**LOW-11-01: `created_at` field in `QueryNoteFrontmatter` vs unified types.**
The unified `QueryFrontmatter` does not include `created_at`, but `QueryNoteFrontmatter` adds it (line 207). For Change notes, `created_at` is in the unified `ChangeFrontmatter` and is indexed in `IndexRecord.created_at`. For Query notes, `created_at` is plan-local and stored only in `raw_text`.

This is consistent -- `IndexRecord.created_at` is documented as "only for Change" in unified types (line 149). But if future plans need to sort Query notes chronologically, they'll need to parse `raw_text` to extract `created_at`.

**Recommendation**: No action needed for v1. If chronological Query sorting becomes needed, promote `created_at` to the unified `QueryFrontmatter`.

### Implementability

**Retrieval engine delegation**: CLEAN. `querySearch()` correctly delegates scoring to `retrievalEngine.retrieve(index, retrievalQuery)` at lines 319-325, matching the unified types API boundary at line 427. The comment explicitly states "Query does NOT reimplement scoring weights" (line 327).

**Graph expansion**: The one-hop expansion algorithm at lines 346-360 has a reasonable cap of 30 nodes total with per-candidate limits of 5 for `same_system` and `same_feature`. This prevents explosion in large vaults.

**Noteworthiness heuristics**: Well-designed for v1. The rules are simple boolean checks rather than complex score thresholds. The English-only limitation for simple lookup detection is explicitly acknowledged (lines 470-471) with a rationale for why this is acceptable (false positives are harmless because user confirmation is always required).

### OpenSpec Fidelity

PASS. The plan correctly identifies that OpenSpec's `explore` is the conceptual ancestor, but the fundamental difference -- that query creates persistent notes while explore is ephemeral -- is well-articulated in the comparison table (lines 66-76).

### Cross-Plan Consistency (05 <-> 11)

PASS. The retrieval engine call at line 325 matches plan 05's exported `retrieve(index, query, options?)` signature. The `RetrievalQuery` construction at lines 308-316 correctly maps all fields.

**Note**: Plan 11's `querySearch()` does not pass `options.sequencing` to `retrieve()`, which is correct -- query workflow does not need sequencing analysis.

### Gaps

No significant gaps. The plan covers:
- Empty vault handling (edge case at line 798)
- Slug collision handling (edge case at line 796)
- Whitespace-only question rejection (edge case at line 797)
- Recursive query handling (edge case at line 795)

### Over-Engineering

No over-engineering detected. The plan maintains a clean separation between deterministic (search, classification) and LLM-driven (analysis, synthesis) phases.

---

## Plan 12: CLI & Init

### overview.md Compliance

**Section 13.3 (Folder Structure)**: PASS. `VAULT_DIRS` constant at lines 242-252 exactly matches the overview.md structure: `wiki/`, `00-meta/`, `01-sources/` through `06-queries/`, `99-archive/`.

**Section 9.4 (v1 Scope)**: PASS. v1 targets Claude Code only (lines 139, 152-153).

**Section 15 (archive)**: PASS. The `archive()` function at lines 652-681 correctly implements:
- Precondition: status must be `applied` (line 657)
- Verify before archive (lines 660-665)
- File move from `04-changes/` to `99-archive/` (lines 666-669)
- `id` preservation (line 683)
- User-initiated, not automatic (line 686)

**Section 10.2 (Index Refresh)**: PASS. All workflow commands build a fresh index before delegating (lines 725-764).

**Section 15 (workflow commands)**: PASS. All five workflows (`propose`, `continue`, `apply`, `verify`, `query`) plus `status`, `list`, and `archive` are registered as CLI commands.

### Type Consistency with Unified Types

PASS. `NextAction` uses the unified `NextActionType` (lines 289-302). `StatusResult` uses `ChangeStatus` from unified types. The `archiveChange()` public API correctly passes `VaultIndex` as required by plan 10's `verify()` API (line 662).

### Implementability

**Vault discovery**: Well-designed. The upward directory walk at lines 627-643 is the standard pattern (analogous to git's `.git/` discovery). The validation check for `00-meta/schema.md` prevents false positives from unrelated `wiki/` directories.

**MEDIUM-12-01: `archive()` function passes `index` to `verify()` but builds index inside `archive()`, creating potential staleness.**
At lines 651-669, `archive()` builds a fresh index at step 2, then calls `verify(index, { changeId })` at step 5. But between steps 2 and 5, no mutations occur, so the index is still fresh. This is actually fine.

However, the `archiveCommand()` at lines 760-763 calls `archive(changeId, options)` directly without passing the index. But the `archive()` function at line 652 takes `(changeId, options)` -- it builds its own index internally. Meanwhile, the `archiveChange()` public API at lines 837-841 takes `(changeId, index, vaultPath, options?)` -- it receives an externally-built index.

**Impact**: There's an inconsistency between the `archive()` pseudocode in the Core Algorithm section (builds own index) and the `archiveChange()` public API (receives index). The CLI handler at line 760-763 calls `archive()` (the internal version), but the public API signature is `archiveChange(changeId, index, vaultPath, options?)`.

**Recommendation**: Align the archive pseudocode with the public API. The `archiveCommand()` should build an index and pass it to `archiveChange()`, consistent with how all other commands work (build index -> delegate to workflow).

**log.md lifecycle**: Well-specified. The list of which operations append to log.md (lines 705-712) is explicit and makes sense -- read-only operations (`continue`, `query`, `status`, `list`) do not log.

**LOW-12-02: `continue` and `query` are classified as not writing to log.md, but `query` can create notes.**
Line 712 states `continue`, `query`, `status`, `list` do NOT write to log.md. However, `query` can create a new Query note (when `assessNoteworthiness` recommends and user confirms). Creating a new note seems like a vault-mutating operation that should be logged.

**Recommendation**: Either add `query` to the list of operations that append to log.md (when a note is created), or document why query-note creation is not logged.

### OpenSpec Fidelity

PASS. The plan correctly adapts OpenSpec's init pattern:
- Directory creation: `openspec/` -> `wiki/` with numbered subdirectories
- Config: `openspec/config.yaml` -> `wiki/00-meta/schema.md` + `conventions.md`
- Skill generation: OpenSpec's multi-tool skill generation -> Claude Code-only skill files
- The extend mode (smart re-init without overwriting existing notes) is a useful adaptation of OpenSpec's extend mode.

### Cross-Plan Consistency (04 <-> 12, 10 <-> 12)

**Plan 04**: CLI commands correctly call `buildIndex(vaultPath)` from plan 04 before delegating to workflows.

**Plan 10**: The `verifyCommand()` at lines 750-753 correctly passes `index` as the first argument to `verify()`, matching plan 10's public API signature `verify(index: VaultIndex, options?)`. The comment at line 750-751 reinforces this.

**Plan 07/08/09/11**: The thin wrapper pattern is consistent across all workflow commands.

### Gaps

**LOW-12-03: No `--version` flag or help customization documented.**
The CLI uses Commander, which provides `--version` and `--help` automatically, but the plan doesn't document version string sourcing. OpenSpec reads from `package.json` (seen in the source at `src/cli/index.ts`). Plan 12's `bin/ows.js` is just a shim -- the version should be set in `src/cli/index.ts` via Commander's `.version()`.

**Recommendation**: Minor. Add a note that `program.version()` reads from `package.json`, consistent with OpenSpec's pattern.

**First-run experience**: The plan covers `ows init` creating the vault structure and skill files. The meta file templates (lines 452-582) provide good scaffolding. There is no interactive onboarding walkthrough like OpenSpec's `onboard.ts`, which is appropriate for v1 -- the skill files guide the user through the workflow.

**Partial vault**: The extend mode at lines 409-426 handles the case where `wiki/` exists but may be missing subdirectories. It creates missing directories without overwriting existing notes. This is well-designed.

### Over-Engineering

No over-engineering detected. The `conventions.md` template at lines 537-582 is thorough but all content is directly useful for vault users. The skill generation is minimal and appropriate.

---

## Cross-Plan Consistency Summary

| Interface | Plan A | Plan B | Status |
|-----------|--------|--------|--------|
| `verify(index, options?)` | 10 (exports) | 12 (calls in archive) | ALIGNED |
| `computeTouchesSeverity(A, B, index)` | 06 (exports, index=Map) | 10 (calls, index=VaultIndex) | MISMATCH (MEDIUM-10-02) |
| `detectRequirementConflicts(activeChanges)` | 06 (exports, takes array) | 10 (calls per-pair) | MISMATCH (MEDIUM-10-02) |
| `retrieve(index, query, options?)` | 05 (exports) | 11 (calls) | ALIGNED |
| `buildIndex(vaultPath)` | 04 (exports) | 12 (calls in all commands) | ALIGNED |
| `queryWorkflow(request, vaultPath)` | 11 (exports) | 12 (calls) | ALIGNED |
| `NextAction` / `NextActionType` | 00-unified-types | 12 (uses) | ALIGNED |
| `VerifyReport` | 00-unified-types / 10 | 12 (consumes in archive) | ALIGNED (plan 10 adds `skipped` field) |

---

## Issue Summary

| ID | Severity | Plan | Description |
|----|----------|------|-------------|
| MEDIUM-10-02 | Medium | 10 | `computeTouchesSeverity` and `detectRequirementConflicts` API signature mismatch with plan 06 |
| MEDIUM-12-01 | Medium | 12 | `archive()` pseudocode vs `archiveChange()` public API inconsistency |
| LOW-10-01 | Low | 10 | `SkippedCheck` type not in unified types |
| LOW-10-03 | Low | 10 | `checkDependsOnConsistency()` declared but not defined |
| LOW-10-04 | Low | 10 | `missingIdCheck()` listed but not defined |
| LOW-11-01 | Low | 11 | `created_at` not in unified `QueryFrontmatter` |
| LOW-12-02 | Low | 12 | Query note creation not logged in `log.md` |
| LOW-12-03 | Low | 12 | No `--version` sourcing documented |

### Observations (informational, no action needed)

1. **Plan 10's `archivePlacementCheck`** correctly allows applied Changes to remain in `04-changes/` per the hybrid lifecycle model (line 596-598). This is consistent with overview.md section 6.2C.

2. **Plan 11's English-only limitation** for simple lookup detection is well-documented and acceptable for v1. The mitigation (user always confirms) is sound.

3. **Plan 12's skill instruction content** (lines 329-392) provides clear, actionable guidance for the Claude Code agent. The instructions correctly reference `--json` output and describe the expected interaction pattern.

---

## Verdict

**Plans 10, 11, 12 are implementation-ready.** The two medium issues should be resolved before implementation begins to prevent integration failures. The low issues can be resolved during implementation.

Priority order for fixes:
1. **MEDIUM-10-02**: Fix plan 10's sequencing API calls to match plan 06's actual signatures. This is the most likely source of integration bugs.
2. **MEDIUM-12-01**: Align archive pseudocode with public API to prevent confusion during implementation.
