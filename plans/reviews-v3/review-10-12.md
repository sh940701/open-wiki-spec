# Review v3: Plans 10-12 (Verify, Query, CLI/Init)

Reviewer: Devil's Advocate Agent (Round 3)
Date: 2026-04-06

---

## Prior Issue Resolution Summary

Rounds 1 and 2 identified 25 issues total. 22 are resolved. The 3 remaining "Should Fix" items from round 2 are tracked below alongside new findings.

| Round 2 Issue | Status | Notes |
|---------------|--------|-------|
| V2-1: `checkDriftForStatus()` overlaps with `runOperationValidationMatrix()` | **STILL OPEN** | Both functions produce issues for the same conditions on applied Changes (ADDED missing, REMOVED still exists, MODIFIED unchanged). No dedup mechanism or skip logic has been added. See V3-1 for detailed analysis. |
| V2-5: Query extension frontmatter not in unified types | **STILL OPEN** | `QueryFrontmatter` in `00-unified-types.md` still only has `type: 'query'` and `status: GeneralStatus`. Plan 11's `QueryNoteFrontmatter` adds `question`, `features`, `systems`, `changes`, `decisions`, `sources`, `related_queries`, `consulted`, `created_at`. These fields are not registered anywhere the vault-parser can discover them. See V3-2. |
| V2-7: `verifyEngine.run()` call signature mismatch | **STILL OPEN** | Plan 12 calls `verifyEngine.run({ changeId })` at lines 659 and 748, but plan 10's public API is `verify(index: VaultIndex, options?: VerifyOptions): VerifyReport`. The index parameter is missing in plan 12's calls. See V3-3. |

---

## Round 3: Fresh Review

### Plan 10: Verify Workflow

#### overview.md Compliance

**Strong.** All section 10.8 contracts are covered:

- 3-dimension verification: Completeness, Correctness, Coherence -- each has detailed check functions.
- Operation validation matrix: `runOperationValidationMatrix()` covers all four operations in both pre/post phases, matching the table in overview.md exactly.
- Stale-change detection: `checkStaleBase()` correctly compares `base_fingerprint` against `content_hash`.
- Vault integrity: All 10 items from section 10.8 are implemented as individual check functions.
- Parallel change conflict detection (section 15): `checkConflictsViaSequencing()` correctly delegates to sequencing-engine (plan 06) and maps all four severity levels, satisfying the ownership rules in unified types.
- Schema mismatch detection (section 10.1.1): Both vault-level and per-note checks via `schemaVersionCheck()` and `checkSchemaVersionMatch()`.

#### Type Consistency with Unified Types

Types are well-aligned. `VerifyIssue`, `VerifyReport`, `IssueSeverity`, `VerifyDimension` all match the definitions in `00-unified-types.md` (lines 332-353). One discrepancy persists:

**ISSUE V3-4: `VerifyReport.skipped` field is not in unified types.**

Plan 10 defines `VerifyReport` with a `skipped: SkippedCheck[]` field (line 213) and a `SkippedCheck` interface (lines 215-219). The unified types `VerifyReport` (lines 345-353) has no `skipped` field. This means:
- Any consumer importing `VerifyReport` from unified types won't see `skipped`.
- The `determineAvailableChecks()` function (lines 826-846) produces `SkippedCheck[]` entries but they have nowhere to land in the canonical type.

Resolution: Add `skipped: SkippedCheck[]` and the `SkippedCheck` interface to `00-unified-types.md`.

**Severity: Low.** Easy fix, but must be done before implementation to avoid type incompatibilities.

#### Issues Found

**ISSUE V3-1: Duplicate issue production for applied Changes (carried from V2-1).**

This remains the most significant unresolved issue. When `verify()` runs on an applied Change:

1. `runOperationValidationMatrix()` (post-apply branch) checks:
   - ADDED: requirement must exist -> `DELTA_MISMATCH_ADDED` error if missing
   - REMOVED: requirement must not exist -> `DELTA_MISMATCH_REMOVED` error if present
   - MODIFIED: content_hash must have changed -> `MODIFIED_NO_CHANGE` warning if unchanged

2. `checkDriftForStatus()` (applied branch) checks:
   - ADDED: requirement must exist -> `EXCESSIVE_DRIFT` error if missing
   - REMOVED: requirement must not exist -> `EXCESSIVE_DRIFT` error if present
   - MODIFIED: content_hash must have changed -> `EXCESSIVE_DRIFT` error if unchanged

These produce **two errors for the same underlying problem**, with different codes and different severities (MODIFIED_NO_CHANGE is a warning in the matrix but an error in drift detection). An agent parsing the report will see conflicting severity signals.

**Recommended fix:** In the main `verify()` flow, run `runOperationValidationMatrix()` first. For applied Changes that pass through the matrix, skip `checkDriftForStatus()` entirely -- the matrix already covers everything. `checkDriftForStatus()` should only fire for Changes that DON'T have a Delta Summary (where the matrix can't run) or for detecting drift not captured by the matrix.

Alternatively, add a note to the algorithm: "If `change.status == 'applied'` and `change.delta_summary.length > 0`, skip drift detection for entries already covered by the operation validation matrix."

**Severity: Medium.** Will produce confusing duplicate output.

**ISSUE V3-5: `checkStaleBase()` has a dead code path for RENAMED.**

At lines 442-445:
```
if entry.op == 'RENAMED':
  currentReq = featureRecord.requirements.find(r => r.name == entry.target_name)
```

This re-searches for the same `entry.target_name` that was already searched at line 440. The variable `currentReq` was set to null at line 440 (via `find` returning undefined), and then the RENAMED branch searches for the same name again. For a RENAMED entry, the stale check should compare against the **old name's** hash. The old name is `entry.target_name` and that requirement may have already been renamed away by another Change, so the search by old name is correct -- but the code path is redundant because it repeats the exact same search. The `currentReq` will still be null.

The actual intent should be: for RENAMED, the base_fingerprint should be compared against the requirement that existed under the **old name** at the time the delta was written. If that requirement no longer exists under the old name (because it was renamed by this or another Change), the stale detection cannot proceed -- which is handled by the `currentReq is null: continue` at line 446.

**Severity: Low.** The code is functionally correct (it continues on null), but the RENAMED branch is dead code that may confuse implementers.

**ISSUE V3-6: `isComplexChange()` referenced but never defined.**

At line 333: `if 'Design Approach' not in change.headings and isComplexChange(change):`

The function `isComplexChange()` is called to determine whether the absence of a Design Approach section warrants a warning, but it has no definition anywhere in the plan. What makes a change "complex"? Number of delta entries? Number of touched systems? Number of tasks?

Without this definition, implementers will either skip the warning entirely or invent arbitrary criteria.

**Recommended fix:** Add a one-line definition: `isComplexChange(change) = change.delta_summary.length >= 3 || change.systems.length >= 2` or similar heuristic.

**Severity: Low.** Minor gap, easy to fill at implementation time.

**ISSUE V3-7: `getExpectedFields()` referenced but never defined.**

At line 616: `expectedFields = getExpectedFields(note.type, declaredVersion)`

This function returns required fields per note type per schema version. It's called in `checkSchemaVersionMatch()` but no definition or algorithm is provided. The plan should either define the field requirements inline (they can be derived from the unified types' frontmatter schemas) or reference plan 02 (note-templates) as the provider.

**Severity: Low.** The information exists in unified types, but the plan doesn't connect the dots.

**ISSUE V3-8: No `missingIdCheck()` pseudocode.**

The main verify flow at line 264 calls `missingIdCheck(index)`. The function is listed in the vault-integrity file structure (line 856) but has no pseudocode. Unlike `duplicateIdCheck()` which leverages `VaultIndex.warnings`, missing-id detection needs its own logic: iterate all records and flag those where `id` is empty/undefined.

**Severity: Low.** Trivially implementable.

**ISSUE V3-9: No `ambiguousAliasCheck()` or `malformedFrontmatterCheck()` pseudocode.**

Similar to V3-8, these two vault integrity checks are listed in the file structure (line 856) and called from the main flow (lines 266, 269) but have no pseudocode definitions. The checks are conceptually straightforward:
- `ambiguousAliasCheck`: find aliases that resolve to multiple notes
- `malformedFrontmatterCheck`: find notes where frontmatter fails type validation

But without pseudocode, the implementer must invent the algorithm. Some of these may overlap with `VaultIndex.warnings` (like `ambiguous_alias` warning type exists in `IndexWarning`).

**Severity: Low.** Can be handled similarly to `duplicateIdCheck()` by converting `VaultIndex.warnings`.

#### Cross-Plan Consistency (Plan 10)

**Plan 10 x Plan 06 (Sequencing):** Clean. `checkConflictsViaSequencing()` correctly calls `computeTouchesSeverity()` and `detectRequirementConflicts()` from sequencing-engine and maps all four severity levels plus requirement-level conflicts. The ownership rule in unified types (line 383-384) is satisfied.

**Plan 10 x Plan 04 (Index):** Consistent. Access via `index.records.values()`, `index.records.get(id)`, `index.schema_version`. No phantom methods.

**Plan 10 x Plan 09 (Apply):** Both apply (pre-apply checks) and verify (pre/post checks) need the operation validation matrix. The matrix is in verify (`operation-validator.ts`). Plan 09 should call verify's pre-apply checks. This cross-dependency is not explicitly documented in plan 10's dependency table. Plan 10 only lists what verify needs FROM other modules, not what other modules need FROM verify.

#### Graceful Degradation

Well-handled. `determineAvailableChecks()` (lines 826-846) skips checks when data is missing:
- Feature with no requirements -> skip requirement quality check
- Change with no delta summary -> skip operation validation
- Fewer than 2 active changes -> skip parallel conflict checks

Skipped checks are recorded in `SkippedCheck[]`.

#### Over-Engineering Assessment

**Appropriate for v1.** The exhaustive `VerifyIssueCode` type (26 codes) is well-justified for agent consumption. The 10-file module structure maps cleanly to concerns. No unnecessary abstractions.

---

### Plan 11: Query Workflow

#### overview.md Compliance

**Solid.** The two requirements from section 15 are met:
1. "Search related notes in the vault graph" -- via `querySearch()` delegating to retrieval engine.
2. "Store the output as a Query note when appropriate" -- via `createQueryNote()` with heuristic-gated user confirmation.

Section 10.4 (Query Object Contract) is properly addressed with `normalizeToQueryObject()`.
Section 10.2 (Index Refresh) is satisfied by fresh vault scan at query start.
Section 11.1 (Canonical Identity) is satisfied by immutable `id`.

#### Type Consistency with Unified Types

**ISSUE V3-2: QueryNoteFrontmatter extension fields not declared in unified types (carried from V2-5).**

The unified `QueryFrontmatter` interface (unified types line 63-66) has only:
```typescript
interface QueryFrontmatter extends BaseFrontmatter {
  type: 'query';
  status: GeneralStatus;
}
```

Plan 11's `QueryNoteFrontmatter` (lines 173-188) extends this with 10 additional fields: `question`, `features`, `systems`, `changes`, `decisions`, `sources`, `related_queries`, `consulted`, `tags`, `created_at`.

This is problematic because:
1. **Vault-parser (plan 03)** needs to know about these fields to extract them into `IndexRecord`. If the parser is built against unified types only, these fields will be silently dropped during parsing.
2. **Index-engine (plan 04)** builds `IndexRecord` from parsed notes. The `IndexRecord` type in unified types has `systems`, `sources`, `decisions`, `changes` fields -- but these are the Change/Feature relationship fields, not Query-specific ones. A query note's `consulted` field, for example, has no home in `IndexRecord`.
3. **Retrieval-engine (plan 05)** searches `IndexRecord` data. If query-specific fields aren't in the index, they can't be searched.

**Recommended fix:** One of:
- (a) Extend `QueryFrontmatter` in unified types to include the extension fields, or
- (b) Document that query extension fields are stored in `IndexRecord.raw_text` and extracted on demand, not indexed separately, or
- (c) Add a `query_metadata?: QueryMetadata` optional field to `IndexRecord` for query-specific data.

Option (a) is simplest and most consistent.

**Severity: Medium.** Parser compatibility risk.

#### Issues Found

**ISSUE V3-10: `normalizeToQueryObject()` uses LLM-dependent classification functions.**

The pseudocode at lines 255-278 calls:
- `classifyIntent(question)` -- classifies "how does X work" vs "compare X and Y"
- `extractTermsForType(question, 'feature')` -- extracts feature terms
- `extractTermsForType(question, 'system')` -- extracts system terms
- `extractRemainingTechnicalTerms(question)` -- extracts entity terms

None of these functions have definitions. Are they regex-based? NLP-based? LLM-based? If they're LLM calls, the "engine handles deterministic parts" claim (line 109) is violated. If they're regex/keyword-based, the accuracy will be low for anything beyond trivial patterns.

The plan positions this as engine work (Phase 1, deterministic) but the classification task inherently requires language understanding. This is an architectural ambiguity: either the normalization is simple enough to be regex-based (in which case the intent classification adds little value over just passing the raw question), or it requires LLM judgment (in which case it belongs in the agent phase, not the engine).

**Recommended fix:** State explicitly that v1 uses simple keyword/regex matching for normalization, accepting low accuracy. Document that this is a natural candidate for LLM-assisted improvement in v2.

**Severity: Medium.** An implementer will block on these undefined functions.

**ISSUE V3-11: `relevantSections` extraction (Phase 1 step 7) is under-specified.**

At lines 342-345:
```
for each candidate:
  find sections whose headings or content match search terms
  attach as candidate.relevantSections (excerpted, not full body)
```

"Match search terms" is vague. Which search terms -- the raw question words? The `QueryObject.entity_terms`? How are sections matched -- substring? regex? TF-IDF? And "excerpted, not full body" -- what's the truncation length? These decisions affect both accuracy and performance.

**Severity: Low.** Implementers can make reasonable choices, but the plan should at least specify the truncation length (e.g., first 200 chars).

**ISSUE V3-12: `resolveQueryNote()` changes status to 'archived' but there's no workflow trigger.**

The function at line 697 marks a query as resolved by changing status from `active` to `archived`. But no CLI command or workflow invokes this function. `ows archive` only works on Changes with status `applied`. How does a user resolve a query note?

Options:
- (a) Add `ows query resolve <queryId>` subcommand, or
- (b) The user manually edits the frontmatter, or
- (c) A future `ows update-status` generic command handles it.

The plan should specify which option is intended for v1.

**Severity: Low.** Functional gap but not blocking. Users can manually edit frontmatter.

**ISSUE V3-13: `GraphContextNode.relationTo` is an id, but the type definition says `string`.**

At line 158: `relationTo: string; // id of the candidate it connects to`

This is fine semantically, but the comment and the type don't enforce that it's a valid note id. More importantly, the graph expansion (step 6, lines 324-339) uses `same_system` and `same_feature` relation types, which connect notes that share a system or feature. For `same_system`, `relationTo` would be the candidate id, not the system id. This is correct per the interface definition but could be confusing: the relation is "same_system" but `relationTo` points to the candidate, not the shared system.

**Severity: Low.** Naming/documentation concern only.

#### Cross-Plan Consistency (Plan 11)

**Plan 11 x Plan 05 (Retrieval):** Clean. `querySearch()` calls `retrievalEngine.search(retrievalQuery, index)` directly (step 2, line 300). No scoring weight duplication. The dependency table correctly lists retrieval-engine as providing `retrievalEngine.search()`.

**Plan 11 x Plan 04 (Index):** Uses `VaultIndex.records` correctly for graph expansion.

**Plan 11 x Plan 12 (CLI):** `queryCommand()` in plan 12 (line 752-755) calls `queryWorkflow({ question }, vaultPath)` which matches plan 11's API signature. However, plan 12's `queryCommand()` does NOT pass `index` to `queryWorkflow()`. Plan 11's API (line 653-656) takes `(request, vaultPath)` and presumably builds its own index internally. This is inconsistent with other commands that build index externally and pass it in. Acceptable since plan 11 specifies index build at step 2 of the workflow.

#### Over-Engineering Assessment

**Simplified appropriately since v1 review.** The noteworthiness heuristics (lines 396-443) have been reduced to 4 boolean rules instead of the original multi-factor scoring with thresholds. The graph expansion has a 30-node cap. These are reasonable for v1.

The one remaining over-engineering concern: the `QueryObject` normalization with intent classification (`investigate`/`compare`/`trace`/`lookup`) adds complexity that may not be needed. If the retrieval engine already maps all query intents to `intent: 'query'` (line 289), the fine-grained classification only affects `status_bias` derivation, which is a minor optimization. For v1, passing the raw question as `summary` with default status_bias might be sufficient.

---

### Plan 12: CLI & Init

#### overview.md Compliance

**Good.** All contracts satisfied:

1. Section 13.3 (Folder Structure): `VAULT_DIRS` exactly matches.
2. Section 10.1.1 (Schema Version): `schema.md` created with correct structure.
3. Section 9.4 (v1 Claude Code only): Skill generation targets `.claude/commands/` only.
4. Section 6.2D (Plain Vault Mode): Direct markdown read/write.
5. Section 15 (Workflows): All workflow commands defined as thin wrappers.
6. Section 15 (archive): `ows archive` fully defined with precondition checks.
7. `--json` on all commands.

#### Type Consistency with Unified Types

`NextAction`, `NextActionType`, `ChangeStatus` are correctly referenced from unified types. `StatusResult` and `ListResult` are plan-12-specific and appropriately scoped.

#### Issues Found

**ISSUE V3-3: `verifyEngine.run()` call signature mismatch (carried from V2-7).**

Plan 12's `archive()` function (line 659-660):
```
verifyResult = verifyEngine.run({ changeId })
```

Plan 12's `verifyCommand()` (line 748-749):
```
result = await verifyEngine.run({ changeId })
```

But plan 10's public API (line 867):
```typescript
function verify(index: VaultIndex, options?: VerifyOptions): VerifyReport;
```

Neither `archive()` nor `verifyCommand()` passes the `index` argument. Both functions build a fresh index at step 2 but don't pass it to verify. If verify builds its own internal index, that doubles the work (two index builds per command). If verify expects the caller to provide the index (as its signature suggests), these calls will fail.

**Recommended fix:** Change plan 12's pseudocode:
```
verifyResult = verify(index, { changeId })
```

This is consistent with plan 10's stateless design and avoids double-indexing.

**Severity: Medium.** API contract mismatch.

**ISSUE V3-14: `ows status` and `ows list` build fresh indexes but overview.md section 10.2 only mandates fresh scans for `propose`, `query`, and `verify`.**

Section 10.2 says: "Run a fresh vault scan at the start of `propose`, `query`, and `verify`."

Plan 12 builds fresh indexes for `status`, `list`, `archive`, `continue`, and `apply` as well (all command handlers call `buildIndex()`). This is not wrong -- more freshness is better -- but it has a performance implication: every single CLI invocation triggers a full vault scan. For large vaults, this could make simple operations like `ows status` and `ows list` slow.

For v1 with small vaults, this is fine. But the plan should note that `status` and `list` could potentially read a cached index if performance becomes a concern, since these are read-only operations.

**Severity: Low.** Not a bug; a performance consideration worth documenting.

**ISSUE V3-15: `conventions.md` template specifies apply order but doesn't match overview.md exactly.**

The `conventions.md` template (line 580) states:
```
Apply order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
```

Overview.md section 15 (apply) says:
```
Apply Delta Summary operations in atomic order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
```

These match, which is good. But `conventions.md` also says:
```
MODIFIED/REMOVED/RENAMED entries include `[base: <content_hash>]`.
```

This inline syntax `[base: <content_hash>]` is a serialization detail not specified in overview.md or the unified types. The `DeltaSummaryEntry` type stores `base_fingerprint` as a structured field. The `[base: ...]` syntax is presumably how it appears in the markdown. This serialization format should be defined in plan 03 (vault-parser) or plan 02 (note-templates), not invented in plan 12's conventions template.

**Severity: Low.** The convention is reasonable, but the source of truth for delta summary serialization format should be clarified.

**ISSUE V3-16: `ows status` calls `nextAction()` but the algorithm lives in overview.md section 15, not in any plan.**

The `nextAction()` algorithm from overview.md section 15 is:
```
if status == "proposed": check hard prereqs -> fill_section or transition
if status == "planned": check depends_on -> blocked or start_implementation
if status == "in_progress": check tasks -> continue_task or transition
if status == "applied": verify_then_archive
```

Plan 12 references this at line 600 (`Run nextAction() algorithm from overview section 15`) but doesn't define where this function lives in the codebase. The dependency table (line 883) says: `15-section-completeness (part of workflow-continue) -- checkPlannedPrerequisites(), nextAction()`. But there is no plan 15, and `workflow-continue` is plan 08. The `nextAction()` function should be defined in plan 08 (workflow-continue) or in a shared utility, and plan 12 should reference that specific location.

**Severity: Low.** The algorithm is clear from overview.md, but the module location needs to be specified.

**ISSUE V3-17: `appendLogEntry()` uses raw string concatenation for markdown table rows.**

At lines 696-701:
```
entry = `| ${date} | ${operation} | ${target} | ${agent || 'ows'} |`
appendFileSync(logPath, '\n' + entry)
```

This appends raw text without ensuring the log file ends with a newline before the append. If the file ends with `\n`, the result is `\n\n| row |` (double newline). If it ends without `\n`, the result is `text\n| row |`. Neither case corrupts the table, but the formatting inconsistency is avoidable.

More significantly, concurrent appends (which the edge case section acknowledges at line 962) could interleave writes. `appendFileSync` is atomic for small writes on most filesystems, but the plan should note this assumption.

**Severity: Low.** Minor formatting concern.

**ISSUE V3-18: Skill instructions for `continue` don't mention `fill_section` content creation.**

The `continue` skill instruction (lines 341-350) says:
```
If fill_section: help the user write the missing section content.
```

But it doesn't specify what "help the user write" means. Does the agent read the Feature note for context? Does it generate a draft? Does it ask the user to dictate? The `propose` skill (lines 331-339) is more specific about steps. The `continue` skill is the most complex workflow and deserves at least as much detail.

**Severity: Low.** Skill instructions are agent prompts and can be iterated.

#### Cross-Plan Consistency (Plan 12)

**Plan 12 x Plan 10 (Verify):** The API mismatch (V3-3) is the main concern. The `archive` command's verify step needs the correct signature.

**Plan 12 x Plan 07 (Propose):** `proposeCommand()` (line 723-729) calls `proposeWorkflow(description, index, vaultPath)`. This signature includes `index`, which is consistent with plan 10's pattern. However, plan 11's `queryWorkflow()` takes `(request, vaultPath)` without index. The inconsistency is acceptable since different workflows may have different needs, but it's worth noting that some workflows build their own index and others expect it passed in.

**Plan 12 x Plan 08 (Continue):** `continueCommand()` calls `continueWorkflow(changeId, index, vaultPath)`. The `nextAction()` function referenced in `ows status` should come from plan 08. Plan 12 should explicitly import it from the continue workflow module.

**Plan 12 x Plan 01 (Project Structure):** `VAULT_DIRS` should be defined in plan 01 and imported by plan 12, not redefined. The dependency table lists this correctly.

#### Log.md Lifecycle

**Well-defined.** The operations that write to log.md are explicitly listed:
- `init`: writes initial entry
- `propose`: on Change creation
- `apply`: on Change application
- `archive`: on file move
- `verify`: records that verification happened

The operations that don't write:
- `continue`: incremental editing
- `query`: read-only (but see V2-8 below)
- `status`: read-only
- `list`: read-only

**One remaining concern from V2-8:** When `ows query` creates a Query note, it performs a vault-mutating operation. The plan explicitly lists `query` as NOT writing to log.md, but `propose` logs on note creation. The inconsistency is documented but not resolved.

#### First-Run Experience

The plan handles the first-run scenario well:
1. `ows init` creates full structure with meta files and skill files.
2. Fresh vault has no notes, so `ows list` returns empty (tested in integration tests).
3. `discoverVaultPath()` gives a clear error if no vault exists.

What's missing: no getting-started guidance after init. OpenSpec has an onboarding walkthrough. The plan's init success message (line 447) should at least suggest "Next: use /ows-propose in Claude Code to create your first Feature."

**Severity: Low.** UX polish.

#### Vault Path Discovery

**Well-designed.** The `discoverVaultPath()` algorithm (lines 624-643) walks up the directory tree looking for `wiki/` with `00-meta/schema.md`. This is robust:
- Handles nested project structures
- Won't match a random `wiki/` directory without schema.md
- Clear error message on failure

One edge case not covered: what if there are nested `wiki/` directories (e.g., a monorepo with `packages/app/wiki/` and a root `wiki/`)? The algorithm finds the nearest ancestor, which is correct behavior.

#### Over-Engineering Assessment

**Lean.** The thin-wrapper pattern for workflow commands is correct. The init engine is straightforward. The skill definitions provide meaningful instructions. No unnecessary abstractions.

---

## Cross-Plan Consistency (All Three)

### Consistent Patterns

1. **VaultIndex access:** All three plans use `index.records.values()` / `index.records.get(id)` consistently.
2. **Snake_case alignment:** `schema_version`, `depends_on`, `base_fingerprint`, `content_hash` -- all match unified types.
3. **Ownership rules:** Verify correctly delegates to sequencing-engine. Query correctly delegates to retrieval-engine. CLI correctly delegates to workflow modules.

### Remaining Inconsistencies

1. **Index passing convention:** Some workflows expect `index` from caller (verify, propose, continue, apply), while query builds its own index internally. This is functional but architecturally inconsistent. A consistent convention (either always pass or always build) would be cleaner.

2. **`ready_to_apply` NextActionType:** The unified types define `NextActionType` with `'ready_to_apply'` as a value, but the `nextAction()` algorithm in overview.md section 15 doesn't produce this action. The `in_progress` -> all tasks done transition produces `{ action: 'transition', to: 'applied' }`. When is `ready_to_apply` used? Plan 12's `NextAction` type references unified types but never produces this value. Either it should be removed from unified types or its trigger condition should be specified.

3. **verify -> archive handoff:** Plan 12's `archive()` runs verify before archiving. But verify's `archivePlacementCheck()` flags notes in `99-archive/` with wrong status. After archive, the note is IN `99-archive/` with status `applied` -- this should pass. But what if verify runs DURING archive (between the status check and the file move)? The plan handles this correctly because verify runs before the move, but the temporal coupling should be noted.

---

## Priority Summary (Round 3)

### Must Fix Before Implementation

1. **V3-1 (V2-1):** Resolve duplicate issue production between `checkDriftForStatus()` and `runOperationValidationMatrix()` for applied Changes. Add skip logic or merge the functions.
2. **V3-3 (V2-7):** Fix verify call signature in plan 12's `archive()` and `verifyCommand()` to pass `index`.
3. **V3-2 (V2-5):** Register query extension frontmatter fields in unified types so vault-parser can handle them.

### Should Fix

4. **V3-10:** Define or explicitly defer `normalizeToQueryObject()` helper functions (`classifyIntent`, `extractTermsForType`). State whether they are regex or LLM-based.
5. **V3-4:** Add `SkippedCheck` and `skipped` field to unified types `VerifyReport`.
6. **V3-6:** Define `isComplexChange()` heuristic.
7. **V3-7:** Define or reference `getExpectedFields()`.
8. **V3-16:** Specify which module owns `nextAction()`.

### Low Priority / Nice to Have

9. **V3-5:** Clean up dead code path in `checkStaleBase()` RENAMED branch.
10. **V3-8, V3-9:** Add pseudocode for `missingIdCheck`, `ambiguousAliasCheck`, `malformedFrontmatterCheck`.
11. **V3-11:** Specify truncation length for `relevantSections`.
12. **V3-12:** Specify how Query notes get resolved (which command triggers `resolveQueryNote()`).
13. **V3-14:** Note that `status` and `list` do fresh scans beyond section 10.2 requirements.
14. **V3-15:** Clarify delta summary serialization format ownership.
15. **V3-17:** Minor log.md formatting edge case.
16. **V3-18:** Flesh out `continue` skill instructions.

---

## Overall Assessment

**Plans 10-12 are mature and ready for implementation** after resolving the 3 "Must Fix" items. The improvements from rounds 1 and 2 are substantial -- 22 of 25 original issues were resolved, and the remaining 3 are well-understood with clear fixes.

**Plan 10 (Verify)** is the strongest of the three. The 3-dimension verification, operation validation matrix, stale detection, and vault integrity checks are thorough, well-structured, and faithful to overview.md. The ownership delegation to sequencing-engine is clean. The main fix needed is the duplicate-issue problem between drift and operation validation.

**Plan 11 (Query)** is solid but has the most architectural ambiguity. The `normalizeToQueryObject()` classification functions are undefined, and the query extension frontmatter fields need to be registered in unified types. The heuristics have been appropriately simplified. The graph expansion caps are reasonable.

**Plan 12 (CLI & Init)** is lean and well-structured. The thin-wrapper pattern, vault path discovery, log.md lifecycle, archive command, and skill generation are all well-defined. The verify API signature mismatch is the main fix needed.

The 3 "Must Fix" items are all straightforward:
- V3-1: Add a conditional skip in the verify flow (5 lines of pseudocode).
- V3-3: Add `index` parameter to two function calls in plan 12.
- V3-2: Add ~10 fields to `QueryFrontmatter` in unified types.
