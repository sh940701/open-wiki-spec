# Review v4: Plans 06 (Sequencing Engine) and 07 (Workflow Propose)

**Reviewer**: Devil's Advocate Agent
**Date**: 2026-04-06
**Review type**: Fourth-round fresh review (ignoring all prior reviews)
**Verdict**: Both plans are implementation-ready. No must-fix issues remain. Two advisories and three observations documented below.

---

## Plan 06: Sequencing Engine

### 1. overview.md Compliance

**Touches Severity Model (10.5.1)**: PASS.
All four severity levels correctly implemented. `computeTouchesSeverity()` (lines 296-343) checks `blocked` first (depends_on with incomplete target), then classifies overlap: Feature overlap = `conflict_candidate`, System-only overlap = `needs_review`, no overlap = `parallel_safe`. This matches the overview.md table at line 677 exactly. The fallback for non-feature/non-system overlap targets returning `parallel_safe` (line 342) is a sound defensive choice.

**Requirement-Level Conflict Model (10.5.1)**: PASS.
All four overview.md conflict pairs are present in `isConflictingPair()` (lines 399-412):
- MODIFIED vs MODIFIED
- MODIFIED vs REMOVED (both directions)
- RENAMED vs MODIFIED (both directions)
- ADDED vs ADDED

Plus defensible extensions: RENAMED vs REMOVED (both directions), RENAMED_TO vs ADDED (both directions). The `ConflictOp` pseudo-op `RENAMED_TO` is correctly scoped to conflict detection only (line 186) and does not leak into `DeltaSummaryEntry.op`.

**Deterministic Ordering (10.5.1)**: PASS.
Kahn's algorithm with `(created_at, change_id)` priority queue tiebreaking (lines 440-445). `drainAll()` snapshot semantics are explicitly documented (lines 457-463) ensuring correct depth tracking. Cycle detection via DFS with back-edge detection (lines 496-517) is sound. User-priority override (overview.md rule 4) is explicitly deferred to v2 with rationale (line 539).

**Base Fingerprint / Stale Detection (10.8)**: PASS.
`checkBaseFingerprints()` (lines 544-587) correctly handles all cases:
- Skips ADDED (no base)
- Skips null `base_fingerprint`
- Returns `actual_hash: 'MISSING'` when requirement missing from Feature for MODIFIED/RENAMED
- Compares `content_hash` vs `base_fingerprint`
- Skips broken Feature references (reported by verify)

**Out-of-Order Detection (10.5.1)**: PASS.
`detectOutOfOrderErrors()` (lines 604-636) implements the overview.md requirement precisely. Status rank comparison (`proposed(0) < planned(1) < in_progress(2) < applied(3)`) is correct. Only flags when change has jumped ahead (rank >= 2) and dependency is behind (rank < changeRank AND rank < 3). Missing dependencies are correctly skipped here (already handled by `blocked_by` in ordering).

**Sequencing in Retrieval Output (10.6)**: PASS.
`summarizeForRetrieval()` (lines 813-819) produces the compact `SequencingSummary` with `status`, `related_changes`, `reasons`. Matches the retrieval subagent output contract exactly.

**Overall Severity Precedence (analyzeSequencing)**: PASS.
The precedence `conflict_critical > blocked > conflict_candidate > needs_review > parallel_safe` (lines 677-700) is well-reasoned. The rationale that `conflict_critical` requires human intervention while `blocked` resolves through natural workflow is documented in the comment block (lines 683-691).

### 2. Type Consistency with 00-unified-types.md

**PASS with one naming observation.**

All output types match 00-unified-types.md:
- `TouchesSeverity` (line 236 unified, line 190 plan)
- `TouchesSeverityResult` (line 278 unified, line 200 plan)
- `RequirementConflictPair` (line 287 unified, line 215 plan)
- `OrderedChange` (line 293 unified, line 225 plan)
- `CycleError` (line 299 unified, line 233 plan)
- `StaleBaseEntry` (line 303 unified, line 239 plan)
- `OutOfOrderError` (line 314 unified, line 247 plan)
- `SequencingResult` (line 321 unified, line 255 plan)
- `SequencingSummary` (line 217 unified, line 286 plan)

**OBSERVATION-06-A: `RequirementConflictLevel` vs `RequirementConflictSeverity`.** Plan 06 uses `RequirementConflictLevel` (line 197) while 00-unified-types.md uses `RequirementConflictSeverity` (line 237). Both define `type = 'conflict_critical'`. Semantically identical. Trivial to standardize during implementation -- use the unified-types name.

**PerChangeSequencingResult**: 00-unified-types.md defines `PerChangeSequencingResult` (line 247) as a per-change view. Plan 06 does not produce this type but produces the aggregate `SequencingResult` from which per-change views are trivially derivable. The Ownership Rules table (line 392) correctly assigns sequencing analysis to plan 06 and states consumers must call, not reimplement. This is acceptable -- consumers derive per-change views from the aggregate.

### 3. Implementability

**GOOD.** All six algorithms have clear pseudocode with explicit step-by-step flow:

1. `computeTouchesSeverity` -- Set intersection on touches, O(|touches|) per pair
2. `detectRequirementConflicts` -- Map-based grouping, O(n * d) where d = delta entries
3. `computeDeterministicOrder` -- Kahn's algorithm, O(V + E) with priority queue
4. `checkBaseFingerprints` -- Linear scan of delta entries, O(d) per change
5. `detectOutOfOrderErrors` -- Linear scan of changes and dependencies, O(n * deps)
6. `analyzeSequencing` -- Orchestration: O(n^2) pairwise + above sub-algorithms

The priority queue with `drainAll()` snapshot semantics is the most complex piece, but the behavior is clearly specified. The `findCycles()` DFS pseudo-code (lines 500-516) is detailed enough to implement directly.

**File structure** (lines 738-751) is well-organized with clean single-responsibility modules. The public API (lines 755-819) exports precisely what downstream consumers need.

### 4. OpenSpec Fidelity

**GOOD.** Plan 06 correctly identifies and documents the key differences from OpenSpec:
- OpenSpec uses `provides`/`requires` capability markers; open-wiki-spec replaces these with `touches` severity + requirement-level conflict detection (line 101)
- OpenSpec tiebreaks lexicographically by change ID; open-wiki-spec uses `(created_at, change_id)` FIFO (line 99)
- OpenSpec's `buildUpdatedSpec()` has no fingerprint validation (line 52); open-wiki-spec's `checkBaseFingerprints()` fills this gap

The OpenSpec reference section (lines 3-53) provides genuine source-code-level analysis, not surface-level paraphrasing.

### 5. Cross-Plan Consistency (05 <-> 06 <-> 07 <-> 08 <-> 09)

**PASS.**

- **06 -> 05**: Plan 05's `retrieve()` accepts `options.sequencing` (a full `SequencingResult` from plan 06) and internally calls `summarizeForRetrieval()` to derive `SequencingSummary` for output. Plan 06's `summarizeForRetrieval()` export (line 813) matches exactly what plan 05 expects.

- **06 -> 07**: Plan 07's `runPreflight()` (line 358) calls `analyzeSequencing(index)` from plan 06 and retains the full `SequencingResult`. It then passes this to `retrieve()` via `options.sequencing`. The dual-parameter pattern (`sequencingFull` for logic, `retrieval.sequencing` for display) is correctly documented in plan 07's `executePostClassification()` comment (lines 409-412).

- **06 -> 09**: Plan 06 exports `checkBaseFingerprints()` (line 788) for plan 09 (workflow-apply) to gate auto-apply. The ownership table (line 393) correctly assigns this.

- **06 -> 10**: Plan 06 exports `analyzeSequencing()`, `detectRequirementConflicts()`, `computeDeterministicOrder()`, and `detectOutOfOrderErrors()` for plan 10 (workflow-verify). The integration section (lines 860-877) maps sequencing results to verify dimensions clearly.

- **Ownership table alignment**: The Ownership Rules in 00-unified-types.md (lines 386-394) match plan 06's scope exactly. Sequencing analysis is owned by plan 06. Verify and continue must call, not reimplement.

### 6. Gaps

**No blocking gaps.**

**ADVISORY-06-A: computeTouchesSeverity blocked check is one-directional per pair.**
The `blocked` check (lines 300-303) tests `changeA.depends_on includes changeB.id` and `changeB.depends_on includes changeA.id` separately. If both directions are true (mutual dependency), this would return `blocked` for the first match and never reach the second. This is correct behavior -- mutual dependency implies a cycle, which is detected separately by `computeDeterministicOrder()`. No fix needed, but the interaction is subtle.

**ADVISORY-06-B: `computeDeterministicOrder` external dependency handling.**
For `depends_on` targets outside the active set (lines 436-437, 467-471), the algorithm marks them as `blocked_by` in the `OrderedChange`. However, the actual check for whether an external dependency is resolved (exists and is `applied`) is deferred to an index lookup comment ("delegated to index lookup"). During implementation, this needs to actually call `index.get(depId)` and check `status === 'applied'`. The pseudo-code acknowledges this but doesn't fully spell out the implementation. This is minor -- the contract is clear enough.

### 7. Over-Engineering Assessment

**CLEAN.** Plan 06 is appropriately scoped:
- Six pure functions with no side effects
- No speculative abstractions
- The `PerChangeSequencingResult` conversion is correctly left to consumers
- User-priority override deferred to v2 with rationale
- No unnecessary configuration options

---

## Plan 07: Workflow Propose

### 1. overview.md Compliance

**Preflight Similarity Scan (8.2, 8.3)**: PASS.
`propose()` enforces mandatory preflight via `runPreflight()` (line 358) which calls `analyzeSequencing()` then `retrieve()`. No note creation occurs before preflight completes. This directly satisfies overview.md 8.2: "propose must not immediately create a new Change."

**Query Object Contract (10.4)**: PASS.
`normalizeQuery()` (lines 304-340) produces a `QueryObject` with `intent`, `summary`, `feature_terms`, `system_terms`, `entity_terms`, `status_bias`. The extended local intents (`fix` -> `modify`, `investigate` -> `query`) are correctly documented (lines 196-199) as mapped before passing to the retrieval engine.

**Classification Thresholds (10.5)**: PASS by delegation.
Plan 07 explicitly does NOT own classification. The `classify()` function lives in plan 05 (retrieval-engine). Plan 07's comment block (lines 376-382) states this clearly. The `buildClassificationResult()` wrapper (lines 387-395) only extracts metadata from the already-classified `RetrievalResult`.

**Sequencing Evaluation (10.5.1)**: PASS.
Plan 07 runs `analyzeSequencing()` in `runPreflight()` before retrieval (line 358), passes the full `SequencingResult` to `retrieve()` for classification escalation (Rule 0b), and retains it for `executePostClassification()`. The escalation contract (`conflict_candidate`/`conflict_critical` -> `needs_confirmation`) is correctly handled inside plan 05's `classify()`, not reimplemented in plan 07.

**Post-Classification Actions (10.5.2)**: PASS.
All four classifications map to correct actions:
- `existing_change` -> `continued_change` (lines 422-437): hands off to plan 08
- `existing_feature` -> `created_change` (lines 439-457): creates Change, links to existing Feature
- `new_feature` -> `created_feature_and_change` (lines 459-478): creates Feature first, then Change
- `needs_confirmation` -> `asked_user` (lines 480-491): no files created

**Section-Completeness / proposed -> planned (Section 15)**: PASS.
`checkPlannedPrerequisites()` (lines 497-525) checks all four hard prerequisites:
1. `Why` non-empty
2. `Delta Summary` has >= 1 entry
3. `Tasks` has >= 1 item
4. `Validation` non-empty

And two soft prerequisites:
5. `Design Approach` exists or `N/A`
6. `Decision` link if complex

This matches overview.md section 15 (lines 1274-1286) exactly.

**Propose Workflow (Section 15 propose)**: PASS.
The full flow: similarity scan -> classify -> act -> check prerequisites -> transition. Matches the overview.md recommended propose workflow (lines 1316-1327).

### 2. Type Consistency with 00-unified-types.md

**PASS.**

- `QueryObject` maps to `RetrievalQuery` from unified types (line 204). The extended intents (`fix`, `investigate`) are local aliases mapped to canonical intents before passing to plan 05.
- `ProposalClassification` is explicitly declared as an alias for `Classification` from unified types (line 213).
- `RetrievalResult` is imported from shared types, not redefined locally (lines 244-258).
- `SequencingSummary` in `RetrievalResult` is the compact subset; `SequencingResult` is retained as a separate parameter. Both come from 00-unified-types.md.
- `ScoredCandidate` matches unified types (lines 229-241).

**No type conflicts found.**

### 3. Implementability

**GOOD.** The plan decomposes cleanly into six modules:

1. `query-normalizer.ts` -- Regex-based intent detection + term extraction. Simple, testable.
2. `preflight.ts` -- Two function calls (`analyzeSequencing` + `retrieve`), returns `PreflightResult`.
3. `prerequisites.ts` -- Section existence checks against parsed note. Straightforward.
4. `post-action.ts` -- Note creation + `computeDependsOn`/`computeTouches` helpers. Most complex piece.
5. `propose.ts` -- Orchestration: build index -> normalize -> preflight -> classify -> act -> transition.
6. `types.ts` -- Interfaces only.

The most complex logic (`computeDependsOn`, `computeTouches`) has clear pseudocode with step-by-step explanations. The `computeDependsOn` deadlock concern from v2/v3 reviews is resolved: lines 654-682 explicitly state that only the EARLIER change in a conflicting pair is added as a dependency, preventing unsatisfiable `depends_on` cycles. The rationale comment (lines 664-667) explains why.

**Note creation** (`createChangeNote`, `createFeatureNote`) has complete frontmatter templates and body stubs. The `created_at` ISO 8601 format requirement is called out with a CRITICAL comment (lines 567-570).

### 4. OpenSpec Fidelity

**GOOD.** The comparison table (lines 92-101) and the visual flow comparison (lines 847-867) accurately capture the fundamental difference: OpenSpec is create-first, open-wiki-spec is search-first. Plan 07 correctly identifies what OpenSpec does NOT do (lines 26-33):
- No similarity check
- No scoring/classification
- No sequencing analysis
- No preflight enforcement
- No explicit `proposed -> planned` gate

### 5. Cross-Plan Consistency (05 <-> 06 <-> 07 <-> 08 <-> 09)

**PASS.**

- **07 -> 05**: Plan 07's `runPreflight()` calls `retrieve(index, query, { sequencing: sequencingFull })` (line 364). Plan 05's `retrieve()` signature accepts `options.sequencing` as `SequencingResult` (plan 05, line 975). The types match. Plan 07 consumes `RetrievalResult.classification` without re-classifying (lines 376-382), respecting plan 05's ownership.

- **07 -> 06**: Plan 07 calls `analyzeSequencing(index)` (line 358) which returns `SequencingResult`. The full result is retained as `sequencingFull` and passed to both `retrieve()` and `executePostClassification()`. Plan 06 exports this function (line 776). Types match.

- **07 -> 08**: The `existing_change` path (lines 422-437) returns `continued_change` action with `target_change` populated. Plan 08 (workflow-continue) picks up from here. The hand-off point is the `ProposeResult` with a populated `target_change`.

- **07 -> 03**: Plan 07 uses `parseNote()` and `parseDeltaSummary()` from plan 03 (vault-parser) in `checkPlannedPrerequisites()` (lines 499-503). These are listed in the dependency table (line 840).

- **API Boundary**: The `Retrieval <-> Workflow API Boundary` in 00-unified-types.md (lines 425-445) is respected. Plan 07 calls `retrieve()` from plan 05, receives fully classified results, and does not reimplement classification.

### 6. Gaps

**No blocking gaps. The v2/v3 SequencingSummary/SequencingResult data flow issue is RESOLVED.**

The resolution is clear in the current plan text:
- `runPreflight()` returns `PreflightResult { retrieval: RetrievalResult, sequencingFull: SequencingResult }` (lines 347-353)
- `retrieval.sequencing` is `SequencingSummary` (compact, for display)
- `sequencingFull` is `SequencingResult` (full, for `computeDependsOn`/`computeTouches` logic)
- `executePostClassification()` receives both as separate parameters (lines 400-412)
- The comment at lines 409-412 explicitly calls out this resolution

**OBSERVATION-07-A: `classify()` ownership clarity.**
Plan 07 repeatedly states it does NOT own classification (lines 376, 380, 382, 802, 886, 975). This is correct and well-documented. However, the `buildClassificationResult()` function (lines 387-395) wraps `RetrievalResult` fields into a `ClassificationResult` envelope. This is not reclassification -- it's reshaping for local consumption. The distinction is clear in the code but could confuse a new implementer. No action needed, just awareness.

**OBSERVATION-07-B: `computeDependsOn` practical reach.**
The long comment block at lines 641-642 explains that `computeDependsOn()` is "effectively defensive code" because escalation in `classify()` prevents most paths where it produces non-empty results. This is honest and accurate. In practice, the function will almost always return an empty array because:
1. `conflict_candidate` -> `needs_confirmation` -> no Change created
2. `conflict_critical` -> `needs_confirmation` -> no Change created
3. Only `parallel_safe` and `needs_review` proceed to create a Change, where Feature-level pairwise overlaps are unlikely

The code is still correct as defensive coverage. No change needed.

**OBSERVATION-07-C: v1 limitation on cross-cutting changes.**
Plan 07 always creates single-feature Changes using `feature:` (singular). The `features:` (plural) path for cross-cutting changes is not supported in v1 propose (line 553-555). This is a deliberate scope limit matching overview.md 13.2's guidance that plural features is "allowed as an exception" but "v1 default is a single-feature change."

### 7. Over-Engineering Assessment

**CLEAN.** Plan 07 avoids common over-engineering traps:
- No local `classify()` reimplementation -- delegates to plan 05
- No speculative multi-feature support in v1
- `normalizeQuery()` is intentionally simple with a note that better extraction can come in v2 (line 342)
- `forceClassification` is a testing-only parameter, not a production override mechanism
- `dryRun` mode is minimal and does not introduce a parallel execution path
- No unnecessary abstraction layers between the workflow steps

---

## Cross-Cutting Assessment

### SequencingSummary / SequencingResult Data Flow: RESOLVED

This was flagged as must-fix in v2 and v3 reviews. The current plans resolve it completely:

1. Plan 06 produces `SequencingResult` (full aggregate) via `analyzeSequencing()`
2. Plan 06 exports `summarizeForRetrieval()` to convert to `SequencingSummary`
3. Plan 05's `retrieve()` accepts full `SequencingResult` via `options.sequencing`, internally derives `SequencingSummary`, embeds it in `RetrievalResult.sequencing`
4. Plan 07's `runPreflight()` retains full `SequencingResult` as `sequencingFull` alongside `RetrievalResult`
5. Plan 07's `executePostClassification()` receives both as separate parameters

The data flow is now unambiguous with no type confusion.

### classify() Ownership: CLEAR

- Plan 05 owns `classify()` (plan 05 lines 661-755)
- Plan 07 consumes `RetrievalResult.classification` (plan 07 lines 376-382)
- Plan 10 (verify) must call `analyzeSequencing()` from plan 06, not reimplement conflict detection
- Ownership Rules table in 00-unified-types.md (lines 386-394) is consistent with both plans

### computeDependsOn Deadlock: RESOLVED

The v2/v3 concern about `computeDependsOn()` creating unsatisfiable `depends_on` by adding both sides of a conflicting pair is explicitly addressed. The current algorithm (plan 07 lines 654-682) adds only the EARLIER change (by ordering position) as a dependency. The rationale comment (lines 664-667) explains: "depending on BOTH would create an unsatisfiable depends_on" and "depend on whichever comes first in deterministic order."

---

## Summary Table

| Checklist Item | Plan 06 | Plan 07 |
|---|---|---|
| overview.md compliance | PASS | PASS |
| Type consistency | PASS (1 naming obs) | PASS |
| Implementability | GOOD | GOOD |
| OpenSpec fidelity | GOOD | GOOD |
| Cross-plan consistency | PASS | PASS |
| Gaps | 0 blocking, 2 advisory | 0 blocking, 3 observations |
| Over-engineering | CLEAN | CLEAN |

**Final Verdict**: Both plans are implementation-ready. All previously flagged must-fix issues are resolved. Proceed to implementation in plan 06 -> plan 07 order (plan 06 is a prerequisite for plan 07).
