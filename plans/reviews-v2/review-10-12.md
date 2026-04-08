# Review v2: Plans 10-12 (Verify, Query, CLI/Init)

Reviewer: Devil's Advocate Agent (Round 2)
Date: 2026-04-06

---

## Summary of Round 1 Issues and Their Resolution Status

### Plan 10: Verify Workflow

| Issue | Status | Notes |
|-------|--------|-------|
| V-1: `IndexSnapshot` vs `VaultIndex` naming | **RESOLVED** | Plan 10 now consistently uses `VaultIndex` and accesses data via `index.records.values()`, `index.records.get(id)`, `index.schema_version`. Lines 122-129 explicitly document the access pattern. |
| V-2: `checkDriftForStatus` undefined | **RESOLVED** | Full pseudocode now provided (lines 659-720). Algorithm checks per-status drift: no-op for proposed/planned, partial check for in_progress, full EXCESSIVE_DRIFT errors for applied status. |
| V-3: `checkDescriptionConsistency` undefined | **RESOLVED** | Full pseudocode provided (lines 722-769). Scoped to structural inconsistencies: (1) Change removes all reqs from active Feature, (2) active Feature references archived Decision. Explicitly notes that semantic contradiction detection is out of scope for v1. |
| V-4: `checkDecisionConsistency` undefined | **RESOLVED** | Full pseudocode provided (lines 772-821). Checks: (1) two active Decisions linked to same Feature with overlapping headings/tags, (2) Decision references Feature that doesn't backlink. |
| V-5/V-6: Verify reimplements vs reuses sequencing-engine conflict detection | **RESOLVED** | Plan now explicitly states "Per the ownership rules in `00-unified-types.md`, conflict detection is owned by `sequencing-engine` (plan 06). The verify workflow MUST call sequencing-engine functions and map results to VerifyIssue format, not reimplement the logic." (line 462). `checkConflictsViaSequencing()` (lines 464-533) calls `computeTouchesSeverity()` and `detectRequirementConflicts()` from sequencing-engine and maps all four severity levels correctly. |
| V-7: Archive placement check too lenient | **No change needed** | Already acknowledged as acceptable for v1 as INFO. |
| V-8: `EXCESSIVE_DRIFT` code never produced | **RESOLVED** | `checkDriftForStatus()` now produces `EXCESSIVE_DRIFT` issues for applied Changes. |

### Plan 11: Query Workflow

| Issue | Status | Notes |
|-------|--------|-------|
| Q-1: QueryObject diverges from retrieval engine | **RESOLVED** | Plan now explicitly maps query-specific intents to `RetrievalQuery.intent: 'query'` (lines 236-248). The mapping is documented and intentional. |
| Q-2: `querySearch()` reimplements retrieval scoring | **RESOLVED** | Phase 1 algorithm now explicitly calls `retrievalEngine.search(retrievalQuery, index)` at step 2 (lines 299-303). Comments state: "The query workflow does NOT reimplement scoring weights." |
| Q-3: Graph expansion may be expensive | **RESOLVED** | Cap of `MAX_GRAPH_CONTEXT = 30` added at step 6 (line 322). Per-candidate same_system and same_feature expansion also limited to 5 nodes each (line 333-334). |
| Q-4: `consulted` field is agent-dependent | **No change needed** | This is inherently an agent-supplied input. The plan correctly positions it as such. |
| Q-5: Slug collision handling under-specified | **Partially addressed** | Edge case section still says "handled by appending counter or timestamp" (line 773) but `createQueryNote()` pseudocode still has no collision check code. Implementer still needs to add this. Low risk -- trivial to implement. |
| Q-6: `resolveQueryNote()` doesn't specify file write mechanism | **RESOLVED** | Line 697-698 now says: "Uses the shared frontmatter-writing utility from vault-parser (plan 03)." Status mapping clarified: 'active' -> 'archived' per GeneralStatus. |
| Q-7: `listQueries()` duplication | **RESOLVED** | The function has been removed from the query module. No standalone `listQueries()` exists. |
| Q-8: Noteworthiness heuristics hardcoded English | **RESOLVED** | Lines 447-448 now include an explicit language limitation notice: "The simple lookup detection patterns assume English input... This is acceptable for v1 because the default is to confirm with the user, so false positives are harmless." |

### Plan 12: CLI & Init

| Issue | Status | Notes |
|-------|--------|-------|
| C-1: `ows status` no `--json` output path | **RESOLVED** | Lines 602-606 now show explicit JSON path: `if options.json: return JSON.stringify(statusResult)`. |
| C-2: No `ows archive` command | **RESOLVED** | Full `archive` command added (lines 647-685). Includes precondition validation (status must be applied), optional verify check, file move from `04-changes/` to `99-archive/`, and log.md append. |
| C-3: No `ows validate` standalone | **No change needed** | Covered by `ows verify --noteId <id>` from plan 10's VerifyOptions. |
| C-4: Skill file instructions are placeholders | **RESOLVED** | All six workflow skills now have concrete multi-step instructions (lines 329-392): propose, continue, apply, verify, query, status. Each contains actual CLI commands and decision logic. |
| C-5: conventions.md hardcoded content | **No change needed** | Acceptable for v1 -- content derives from overview.md. |
| C-6: `ows init` extend mode under-specified | **RESOLVED** | Lines 408-425 now define extendVault behavior: (a) create missing directories, (b) regenerate skill files, (c) check schema.md version, (d) preserve existing meta files. |
| C-7: No `.gitignore` entries | **No change needed** | Minor, not blocking. |
| C-8: No vault discovery / auto-detection | **RESOLVED** | Full `discoverVaultPath()` algorithm added (lines 624-643). Walks up directory tree looking for `wiki/` with `00-meta/schema.md`. Used by every command handler. |
| C-9: StatusResult uses null for N/A | **Addressed** | Changed to `designApproach?: boolean` (optional, omitted if not applicable) at line 277. |
| C-10: No error handling pattern | **Partially addressed** | Error messages shown in edge cases (line 639 for vault not found, line 656 for non-applied archive). No unified error JSON structure defined for `--json` mode. Low priority for v1. |
| C-11: `log.md` never updated after init | **RESOLVED** | Full `appendLogEntry()` utility defined (lines 686-701). Explicit list of which operations write to log.md (lines 703-710): init, propose, apply, archive, verify. Which don't: continue, query, status, list. |

---

## Round 2: New Issues and Remaining Concerns

### Plan 10: Verify Workflow

**ISSUE V2-1: `checkDriftForStatus()` overlaps heavily with `runOperationValidationMatrix()`.**

The newly defined `checkDriftForStatus()` for `applied` status (lines 697-718) checks the same conditions as the post-apply branch of `runOperationValidationMatrix()` (lines 362-418). Specifically:

- Both check that ADDED requirements exist after apply.
- Both check that REMOVED requirements don't exist after apply.
- Both check that MODIFIED requirements have changed content_hash.

The only difference is the issue code (`EXCESSIVE_DRIFT` vs `DELTA_MISMATCH_*`). Running both functions on the same applied Change will produce **duplicate issues** with different codes for the same underlying problem. The verify engine should either:

(a) Skip `checkDriftForStatus()` for Changes that already passed through `runOperationValidationMatrix()`, or
(b) Merge the two functions for applied Changes, or
(c) Have `checkDriftForStatus()` skip entries already covered by the operation validation matrix (since drift is only meaningful for entries NOT caught by the matrix).

**Severity: Medium.** Duplicate issues will confuse users and agents parsing the report.

**ISSUE V2-2: `checkConflictsViaSequencing()` maps `blocked` severity to `BROKEN_DEPENDS_ON` issue code, but the blocked state comes from `computeTouchesSeverity()` which considers unresolved `depends_on`.**

At line 512-517, when `touchesResult.severity == 'blocked'`, the issue is mapped to `BROKEN_DEPENDS_ON`. However, `computeTouchesSeverity()` (from sequencing-engine, plan 06) determines `blocked` based on `depends_on` relationships between a pair of changes, not from touches overlap. The message says `Change "${changeA.id}" is blocked by unresolved depends_on target "${changeB.id}"` -- but the pair iteration `(changeA, changeB)` treats them symmetrically. The actual blocked direction (who blocks whom) comes from the `depends_on` field, not from the pair comparison. The message could be wrong if `changeB` depends on `changeA` rather than the reverse.

Additionally, `checkStatusTransition()` (lines 636-656) already checks `depends_on` resolution for `in_progress` changes. There's potential for duplicate BROKEN_DEPENDS_ON issues from both functions.

**Severity: Low-Medium.** The directionality error in the message could be confusing but the issue is still flagged correctly.

**ISSUE V2-3: `checkDescriptionConsistency()` only checks Feature-Change and Decision-Feature relationships.**

The overview.md section 10.8 Coherence says: "Feature, Change, Decision, System descriptions should not contradict each other." The implementation checks:
1. Change removing all reqs from an active Feature (lines 730-753)
2. Active Feature referencing archived Decision (lines 756-768)

Missing checks:
- System description inconsistency is not checked at all.
- Change "Why" section contradicting Feature "Purpose" section is not checked.
- Two Features sharing the same System but having contradictory descriptions is not checked.

This is acknowledged as a v1 limitation (line 724 says "v1 checks for concrete structural inconsistencies") but the gap between the overview.md contract and implementation should be documented in a `skipped` entry in the verify report.

**Severity: Low.** Acceptable for v1 scope, but should be tracked.

### Plan 11: Query Workflow

**ISSUE V2-4: Noteworthiness heuristics simplified but Rule 2 logic has an asymmetry.**

The simplified heuristics (lines 396-443) have a subtle issue in Rule 2:

```
if searchResult.existingQueries.length == 0:
    reasons.push("No existing Query note covers this topic")
else if searchResult.existingQueries[0].status == 'archived':
    shouldCreate = false
    reasons.push(...)
```

When `existingQueries.length > 0` and the first query is `archived`, `shouldCreate` is set to `false`. But what if the first existing query is `active` (open)? The code falls through without setting `shouldCreate = false` and without any reason being pushed. This means an active existing query doesn't suppress note creation, which is arguably correct (update the existing one instead), but the heuristics don't signal "suggest updating existing query" -- they just silently proceed as if no existing query was found.

Also, checking only `existingQueries[0]` ignores other existing queries in the array. If there are 3 existing queries and only the first is active while the second is resolved with a perfect match, the resolved one is never checked.

**Severity: Low.** The user always confirms, so the impact is limited to the quality of the recommendation.

**ISSUE V2-5: QueryNoteFrontmatter defines `question` as a query-specific extension field, but QueryFrontmatter in unified types only has `type` and `status`.**

Plan 11 line 173 says: "QueryNoteFrontmatter extends the BaseFrontmatter/QueryFrontmatter from 00-unified-types.md with query-specific fields." But the extension adds many fields (`question`, `features`, `systems`, `changes`, `decisions`, `sources`, `related_queries`, `consulted`, `created_at`) that are not declared in the unified types `QueryFrontmatter`. This is fine as an extension, but the unified types document should note that query notes may carry these additional fields, or the query plan should more clearly delineate which fields are "core" (from unified types) vs "extension" (query-specific).

The vault-parser (plan 03) will need to know about these extension fields to parse them into IndexRecord. If the parser only handles fields declared in the unified QueryFrontmatter, the query-specific fields will be silently dropped.

**Severity: Medium.** Parser compatibility risk. The vault-parser must be aware of query extension fields.

**ISSUE V2-6: `querySearch()` step 4 maps `ScoredCandidate[]` to `QueryCandidate[]` but ScoredCandidate doesn't have `relevantSections`.**

At step 4 (lines 310-315), the mapping sets `relevantSections: []` and fills it later in step 7. But `ScoredCandidate` (from unified types, line 204-211) only has `id`, `type`, `title`, `score`, `reasons`. The mapping needs to look up additional fields from the index (`path`, `status`) which it does correctly via `index.records.get(sc.id)`. However, `matchReasons` is mapped from `sc.reasons` -- this field name divergence (`reasons` in ScoredCandidate vs `matchReasons` in QueryCandidate) could cause confusion during implementation.

**Severity: Low.** Naming divergence, not a functional issue.

### Plan 12: CLI & Init

**ISSUE V2-7: `ows archive` runs verify but `verifyEngine.run()` signature doesn't match plan 10's API.**

At line 659, archive calls `verifyEngine.run({ changeId })`. But plan 10's public API (line 867) defines: `function verify(index: VaultIndex, options?: VerifyOptions): VerifyReport`. The archive command doesn't pass `index` to verify. Compare with `verifyCommand()` at line 748 which also calls `verifyEngine.run({ changeId })` without passing index.

The `archive` function at step 2 builds a fresh vault index (`Build fresh vault index`) but step 5 doesn't pass it to verify. Either:
- `verifyEngine.run()` is a wrapper that internally builds its own index (inconsistent with plan 10's stateless design), or
- The archive pseudocode needs to pass the index to verify.

**Severity: Medium.** API mismatch between plan 10 and plan 12.

**ISSUE V2-8: `appendLogEntry()` is defined but not called from `ows query`.**

Lines 703-710 explicitly list which operations append to log.md. `ows query` is listed as NOT appending because it's a "read-only" operation. However, when a Query note is created, the query workflow writes a new file to the vault. This is a mutating operation. If `ows propose` logs when creating a Change note, shouldn't `ows query` log when creating a Query note?

The `queryCommand()` at line 752-755 has no log append call, even though `queryWorkflow` may create a note (`result.createdNotePath`).

**Severity: Low.** Consistency issue. Not blocking, but should be considered.

**ISSUE V2-9: Extend mode doesn't handle schema migration.**

The `extendVault` behavior (lines 419-425) says it checks `schema.md` version and warns if different from CLI version, but doesn't perform any actual migration. If a future schema version adds required frontmatter fields or changes the folder structure, `ows init` (extend mode) won't transform existing notes. This is acceptable for v1 since there's only one schema version, but the plan should note this as a future requirement.

**Severity: Low.** v1 has no migration path because there's nothing to migrate from.

**ISSUE V2-10: `ows archive` doesn't update wikilinks in other notes after moving the file.**

The archive command (lines 647-685) moves the file from `04-changes/` to `99-archive/` using `renameSync`. The plan correctly notes that "id is preserved, so all wikilink references remain valid after index rebuild" (line 682). This is true for id-based lookups, but if any note uses a path-based reference (which conventions.md says not to do, but could happen), the link would break.

More importantly, the archived note's `path` field in the index will be stale until the next index rebuild. If another command runs between archive and the next index build, it will see the old path. Since every command builds a fresh index (section 10.2), this is only a problem if two commands run simultaneously -- which the edge case section acknowledges at line 962.

**Severity: Low.** Design is sound given the "id is identity" principle.

---

## Cross-Plan Consistency (Round 2)

### Plan 10 x Plan 06 (Sequencing): RESOLVED

The ownership boundary is now clean. Plan 10 calls sequencing-engine functions and maps results. The four-level severity model is correctly used in `checkConflictsViaSequencing()`. The ownership rules table in unified types (line 383-384) explicitly states: "Conflict detection (touches) -- Owner: sequencing-engine (06) -- Not Allowed In: workflow-verify (10) -- must call, not reimplement."

### Plan 10 x Unified Types: RESOLVED

`VaultIndex` naming is consistent. `schema_version` (snake_case) is used throughout. `VerifyIssue`, `VerifyReport` types match between plan 10 and unified types (lines 332-353 of unified types). One minor difference: plan 10's `VerifyReport` has a `skipped: SkippedCheck[]` field (line 213) that the unified types version does not. The unified types should be updated to include this field, or the plan should note that it extends the unified type.

### Plan 11 x Plan 05 (Retrieval): RESOLVED

Query now calls retrieval engine directly. No scoring weight duplication. The dependency table (lines 705-712) correctly lists retrieval-engine as providing `retrievalEngine.search()`.

### Plan 12 x All Workflow Plans: MOSTLY RESOLVED

CLI commands consistently use `discoverVaultPath()` + `buildIndex()` pattern. The `appendLogEntry()` utility provides consistent logging. The one remaining concern is the verify API mismatch noted in V2-7.

### Unified Types Completeness

The unified types document covers verify types (lines 330-353) and sequencing types (lines 229-328) completely. Query-specific extension fields (QueryNoteFrontmatter with `question`, `consulted`, etc.) are NOT in the unified types document -- only the base `QueryFrontmatter` with `type` and `status`. This should be addressed per V2-5.

---

## Priority Summary (Round 2)

### Should Fix Before Implementation

1. **V2-1**: Resolve overlap between `checkDriftForStatus()` and `runOperationValidationMatrix()` for applied Changes to prevent duplicate issues.
2. **V2-5**: Document query extension frontmatter fields in unified types or ensure vault-parser can handle them.
3. **V2-7**: Align `verifyEngine.run()` call signature in plan 12 with plan 10's `verify(index, options)` API.

### Should Fix (Low Priority)

4. **V2-2**: Clarify `blocked` severity directionality in conflict-via-sequencing mapping.
5. **V2-8**: Consider logging query note creation to `log.md`.
6. **V2-3**: Add `skipped` entries for description consistency checks not yet implemented.
7. **V2-4**: Improve existing-query handling in noteworthiness heuristics.

### No Action Needed

8. **V2-6**: Naming divergence (`reasons` vs `matchReasons`) -- implementer can handle.
9. **V2-9**: Schema migration is a future concern.
10. **V2-10**: Archive path staleness is mitigated by fresh-index-per-command design.

---

## Overall Assessment

**Plans 10-12 have improved substantially since round 1.** The five "Must Fix" items from round 1 are all resolved:

1. `VaultIndex` naming is now consistent across all three plans.
2. All three "phantom functions" (`checkDriftForStatus`, `checkDescriptionConsistency`, `checkDecisionConsistency`) now have full pseudocode.
3. Verify delegates to sequencing-engine instead of reimplementing, and uses the four-level severity model.
4. `ows archive` command is fully defined.
5. Vault path discovery is defined and used by all commands.

The remaining issues from round 2 are lower severity. The most important is the duplicate-issue problem between drift detection and operation validation (V2-1), which is straightforward to fix but would produce confusing output if left unaddressed. The query extension fields gap (V2-5) could cause parser issues but is easily resolved by documenting the fields. The verify API signature mismatch (V2-7) is a pseudocode inconsistency that any implementer would naturally resolve.

These plans are ready for implementation with the three "Should Fix" items addressed.
