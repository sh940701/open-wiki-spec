# Review v3: Plans 06 (Sequencing Engine) and 07 (Workflow Propose)

**Reviewer**: Devil's Advocate Agent
**Date**: 2026-04-06
**Review type**: Third-round fresh review
**Verdict**: Plan 06 is implementation-ready. Plan 07 has **one unresolved must-fix** from v2 (SequencingSummary/SequencingResult type mismatch in data flow) plus two new issues found in this round.

---

## Plan 06: Sequencing Engine

### 1. overview.md Compliance

**Touches Severity Model (10.5.1)**: PASS.
All four severity levels are correctly mapped. The `computeTouchesSeverity()` algorithm checks blocked first (depends_on), then classifies overlap by type (Feature = `conflict_candidate`, System-only = `needs_review`, no overlap = `parallel_safe`). This exactly matches the overview.md table at line 677.

**Requirement-Level Conflict Model (10.5.1)**: PASS.
All four overview.md pairs covered:
- MODIFY vs MODIFY
- MODIFY vs REMOVE
- RENAME vs MODIFY (old name)
- ADD vs ADD (same name)

Plus defensible extensions: RENAMED vs REMOVED, RENAMED_TO vs ADDED. The `isConflictingPair()` conflict matrix (lines 399-412) is complete and correct.

**Deterministic Ordering (10.5.1)**: PASS.
Kahn's algorithm with `(created_at, change_id)` tiebreaking. `drainAll()` snapshot semantics properly documented (lines 457-462). Cycle detection via DFS with back-edge detection (lines 500-516). The user-priority override (overview.md rule 4) is explicitly documented as deferred to v2 (line 539) with rationale.

**Base Fingerprint / Stale Detection (10.8)**: PASS.
`checkBaseFingerprints()` (lines 544-587) correctly:
- Skips ADDED entries
- Skips null base_fingerprint
- Handles missing requirement with `actual_hash: 'MISSING'`
- Compares `content_hash` against `base_fingerprint`

**Sequencing in Retrieval Output (10.6)**: PASS.
`summarizeForRetrieval()` (lines 813-819) produces `SequencingSummary` with `status`, `related_changes`, `reasons`, matching the retrieval subagent output contract.

**Out-of-Order Detection (10.5.1)**: PASS.
`detectOutOfOrderErrors()` (lines 604-636) faithfully implements the overview.md requirement: "depends_on target이 존재하지 않거나, 아직 완료되지 않은 선행 작업을 필요로 하는데 현재 Change가 in_progress 또는 applied로 앞서 나가 있으면 sequencing error로 보고해야 한다." Status rank comparison is sound.

**Post-Classification Actions (10.5.2)**: N/A (plan 06 does not own this).

### 2. Type Consistency with 00-unified-types.md

**PASS with one observation.**

All types defined in plan 06 match 00-unified-types.md exactly:
- `TouchesSeverity`, `RequirementConflictSeverity` (named `RequirementConflictLevel` in plan 06 -- see observation below)
- `TouchesSeverityResult`, `RequirementConflictPair`, `OrderedChange`, `CycleError`, `StaleBaseEntry`, `OutOfOrderError`, `SequencingResult`, `SequencingSummary`

**OBSERVATION: Naming discrepancy.** Plan 06 uses `RequirementConflictLevel` (line 197) while 00-unified-types.md uses `RequirementConflictSeverity` (line 233). Both are `type = 'conflict_critical'`. The semantic meaning is identical, but the name mismatch will cause a TypeScript import error if one imports the other. This is trivial to fix during implementation but should be standardized now.

**PerChangeSequencingResult gap.** 00-unified-types.md defines `PerChangeSequencingResult` (line 243) as a per-change view used by consumers like retrieval and verify. Plan 06 does not produce this type -- it produces the aggregate `SequencingResult`. This is not a bug: consumers can derive per-change views from the aggregate. However, if plan 05 or plan 10 expects a function like `getSequencingForChange(changeId): PerChangeSequencingResult`, plan 06 does not currently provide one. The conversion from aggregate to per-change is straightforward but should either (a) be documented as a consumer responsibility, or (b) plan 06 should export a helper.

### 3. Implementability

**GOOD.** All six algorithms have clear pseudocode with explicit step numbering:
1. `computeTouchesSeverity` -- straightforward set intersection
2. `detectRequirementConflicts` -- map-based O(n*d) where d = delta entries
3. `computeDeterministicOrder` -- Kahn's with priority queue + DFS cycle finding
4. `checkBaseFingerprints` -- linear scan per change
5. `detectOutOfOrderErrors` -- linear scan with status rank comparison
6. `analyzeSequencing` -- orchestrator

File structure is clean with single-responsibility modules (lines 739-751).

**No remaining implementability concerns.** All v1/v2 issues (drainAll semantics, findCycles DFS, precedence documentation) are resolved.

### 4. OpenSpec Fidelity

**GOOD.** The plan correctly positions the sequencing engine as implementing OpenSpec's Phase 0 (fingerprint validation) in a more comprehensive form. The `provides`/`requires` capability markers are explicitly dropped for v1 with clear rationale (replaced by touches severity + requirement-level conflict). The `parent`/split model is deferred.

### 5. Cross-plan Consistency

**Plan 06 -> Plan 05 (retrieval)**: Clean. `summarizeForRetrieval()` produces `SequencingSummary` that embeds in `RetrievalResult`.

**Plan 06 -> Plan 07 (propose)**: Clean at the type level but see plan 07 NEW-1 below.

**Plan 06 -> Plan 09 (apply)**: Clean. `checkBaseFingerprints()` is exported for apply-time gating.

**Plan 06 -> Plan 10 (verify)**: Clean. `analyzeSequencing()` is exported for coherence checks.

### 6. Gaps

**GAP-06-1: `out_of_order_errors` not reflected in `SequencingResult.status` [MINOR, carried from v2 NEW-4].**

The overall `status` computation (lines 692-700) does not consider out-of-order errors. If the only problem is out-of-order (no touches overlap, no requirement conflict), status remains `parallel_safe`. This is carried from v2 review NEW-4 and was recommended to be "documented as intentional."

The plan's `reasons` array does include out-of-order messages (lines 717-718), so consumers can detect them. However, there is no documentation comment in the algorithm explaining why `out_of_order_errors` is excluded from status.

**Recommendation**: Add a code comment at the status computation block explaining: "out-of-order errors are workflow-progression diagnostics, not conflict severity levels. They are reported in `reasons` and `out_of_order_errors` but do not affect `status` because status represents pairwise conflict severity between active changes."

**GAP-06-2: No `PerChangeSequencingResult` producer [MINOR].**

As noted in type consistency above. Either export a helper or document as consumer responsibility.

### 7. Over-engineering Assessment

**PASS.** Appropriately scoped for v1. No unnecessary abstractions. The `ConflictOp = 'RENAMED_TO'` pseudo-op, priority queue, and DFS cycle finder are all genuinely needed.

---

## Plan 07: Workflow Propose

### 1. overview.md Compliance

**Preflight Requirement (8.2)**: PASS.
`propose()` runs `buildIndex()` -> `normalizeQuery()` -> `runPreflight()` before any post-classification action.

**Query Object Contract (10.4)**: PASS.
`QueryObject` has all required fields. The `intent` type extends overview.md's `'add' | 'modify' | 'remove' | 'query'` with `'fix'` and `'investigate'` as aliases, with documented mapping back to the canonical types. This is a clean extension.

**Classification Thresholds (10.5)**: PASS with documented extensions.
All four overview.md classifications implemented with correct thresholds. Rules 5-6 (45-70 gap filling) are explicitly flagged as "PLAN-LEVEL EXTENSION" (lines 495-500, 510-511).

**Post-Classification Actions (10.5.2)**: PASS.
Each classification maps to a specific workflow action matching overview.md:
- `existing_change` -> continue
- `existing_feature` -> create Change + link Feature
- `new_feature` -> create Feature + Change
- `needs_confirmation` -> stop and ask user

**Section-Completeness Contract (section 15)**: PASS.
Hard prerequisites (Why, Delta Summary, Tasks, Validation) and soft prerequisites (Design Approach, Decision link) correctly implemented in `checkPlannedPrerequisites()` (lines 615-643).

**Sequencing Severity Escalation (10.5.1)**: PASS.
`runPreflight()` escalates `conflict_candidate` and `conflict_critical` to `needs_confirmation` (lines 354-379). This satisfies overview.md's "사용자 확인 필요" requirement.

### 2. Type Consistency with 00-unified-types.md

**PASS.** `RetrievalResult`, `Classification`, `Confidence`, `ScoredCandidate`, `SequencingSummary` all match. Type ownership is correctly documented: `RetrievalResult` is owned by 00-unified-types.md, produced by plan 05, consumed by plan 07 (lines 239-243).

Non-Feature/non-Change type behavior in classification is documented (lines 226-229).

### 3. Implementability

**GOOD overall.** The flow is a clear sequential pipeline. `normalizeQuery()`, `classify()`, `executePostClassification()`, `checkPlannedPrerequisites()` are all well-specified.

`computeDependsOn()` and `computeTouches()` are now fully defined (lines 760-836) with corresponding test cases.

### 4. OpenSpec Fidelity

**GOOD.** The plan correctly frames open-wiki-spec's propose as "search-first" vs OpenSpec's "create-first." The comparison table (lines 950-969) is clear. The artifact DAG replacement with section-completeness is well-justified.

### 5. Unresolved Issues from v2

**UNRESOLVED: v2 NEW-1 -- Type mismatch: `SequencingSummary` passed where `SequencingResult` is needed [MUST FIX].**

At line 890:
```
result = executePostClassification(
  classification, query, retrieval.sequencing, index, options.vaultRoot
)
```

`retrieval` is a `RetrievalResult`, so `retrieval.sequencing` is `SequencingSummary` (containing only `status`, `related_changes`, `reasons`).

But `executePostClassification` at line 538 expects `sequencing: SequencingResult`, and the callee `createChangeNote()` at line 661 passes it to `computeDependsOn()` which accesses `sequencing.pairwise_severities` (line 771), `sequencing.ordering` (line 775), and `sequencing.requirement_conflicts` (line 786). These fields do not exist on `SequencingSummary`.

This is a runtime crash bug. The v2 review identified this and recommended option (b): "Change `runPreflight()` to return `{ retrieval: RetrievalResult, sequencingFull: SequencingResult }`." The fix was never applied.

**UNRESOLVED: v2 NEW-2 -- `ProposeResult.sequencing_warnings` declared but never populated [SHOULD FIX].**

`ProposeResult` at line 290 declares `sequencing_warnings: string[]`. None of the four `executePostClassification` return paths (lines 545-610) include this field. TypeScript will report a missing required field error.

**UNRESOLVED: v2 NEW-3 -- `computeDependsOn` adds dependency on *both* sides of a conflict_critical pair [SHOULD FIX].**

At lines 783-790, when two existing changes A and B have a `conflict_critical` on the target Feature, the new change C gets `depends_on: [A, B]`. But A and B are in conflict -- only one can be applied. This creates a guaranteed-stuck state for C.

**UNRESOLVED: v2 12-v1 -- Partial-state test description still says "no partial state" [MINOR].**

Line 1053: "Change creation fails (disk error) -> propagated as error, no partial state" is misleading for the `new_feature` path where a Feature note is written before the Change note.

### 6. New Issues Found in v3

**NEW-V3-1: `runPreflight()` returns `RetrievalResult` but its internal structure mixes concerns [SHOULD FIX].**

`runPreflight()` (lines 342-391) performs THREE distinct operations:
1. Retrieval: `candidates = retrievalEngine.search(query, index)`
2. Sequencing: `sequencingResult = sequencingEngine.analyzeSequencing(index)`
3. Classification: `classResult = classify(candidates, sequencingResult)`

Then it packs everything into a single `RetrievalResult` return value, discarding the full `SequencingResult` (only `SequencingSummary` survives). But `propose()` later needs the full `SequencingResult` for `executePostClassification()`.

This is the root cause of v2 NEW-1. The fix is not just about passing the right type -- it requires restructuring `runPreflight()` to either:
- (a) Return a richer type: `{ retrieval: RetrievalResult; sequencing: SequencingResult }`, or
- (b) Have `propose()` call `analyzeSequencing(index)` independently and not rely on `runPreflight()` for sequencing data.

Option (a) is cleaner because it avoids running sequencing twice.

**Concrete fix for (a):**
```typescript
interface PreflightResult {
  retrieval: RetrievalResult;
  sequencingFull: SequencingResult;
}

function runPreflight(query, index): PreflightResult {
  candidates = retrievalEngine.search(query, index)
  sequencingResult = sequencingEngine.analyzeSequencing(index)
  sequencingSummary = summarizeForRetrieval(sequencingResult)
  classResult = classify(candidates, sequencingResult)
  // ... escalation logic ...
  return {
    retrieval: { query, classification, confidence, sequencing: sequencingSummary, candidates, warnings },
    sequencingFull: sequencingResult
  }
}

// In propose():
{ retrieval, sequencingFull } = await runPreflight(query, index)
result = executePostClassification(classification, query, sequencingFull, index, vaultRoot)
```

**NEW-V3-2: `computeDependsOn` logic for overlapping changes is inconsistent with escalation [SHOULD FIX].**

When `runPreflight()` detects `conflict_candidate` or `conflict_critical`, it escalates classification to `needs_confirmation` (lines 354-379), meaning no Change note gets created. But `computeDependsOn()` (lines 760-793) only runs during Change note creation (inside `createChangeNote()`). This means:

- If sequencing has `conflict_critical` -> classification is `needs_confirmation` -> no Change created -> `computeDependsOn()` never runs.
- `computeDependsOn()`'s conflict-handling logic (the problematic "depend on both sides" at lines 783-790) is only reachable when sequencing status is `parallel_safe` or `needs_review` (i.e., when there are no conflict_candidate/conflict_critical pairs).
- But in `parallel_safe` or `needs_review`, there are no pairwise_severities with `overlapping_features` and no `requirement_conflicts` on the target Feature. So the entire body of `computeDependsOn()` returns an empty array in most practical cases.

The only scenario where `computeDependsOn()` produces non-empty results is when:
1. Sequencing status is `needs_review` or `parallel_safe` overall, AND
2. Some pairwise severity pair happens to overlap on the specific Feature targeted by the new Change (which means those pairs are `conflict_candidate` for that Feature, but the overall status might still be `needs_review` because of how precedence works -- actually no, if any pair is `conflict_candidate`, overall status is at least `conflict_candidate`, which triggers escalation).

This means: **`computeDependsOn()` is essentially dead code in the current flow.** The escalation logic in `runPreflight()` prevents the paths where `computeDependsOn()` would produce meaningful results from ever reaching Change creation.

This isn't a correctness bug (it doesn't produce wrong behavior), but it's a design clarity issue. Either:
- (a) Document that `computeDependsOn()` is currently defensive and rarely produces results due to escalation, or
- (b) Reconsider whether `needs_review` severity (same System, different Feature) should sometimes populate `depends_on` -- this would make `computeDependsOn()` useful for its intended purpose.

**NEW-V3-3: `classify()` Rule 1b is asymmetric and order-dependent [MINOR].**

Rule 1b (lines 427-438) triggers when `top.type == 'feature' && second.type == 'change'`. But it does NOT trigger when `top.type == 'change' && second.type == 'feature'`. If an active Change scores 78 and a Feature scores 65, Rule 2 (`existing_change` with score >= 75, gap >= 15: gap is 13, so gap < 15, so Rule 2 fails). Then we reach Rule 3 (`existing_feature` with score >= 70: top is Change, not Feature, so Rule 3 fails). Then Rule 4 (score < 45: top is 78, so fails). Then Rule 5 (Feature with score >= 45: top is Change, not Feature, so fails). Then Rule 6 (Change with score >= 45: top is 78, gap 13 -- medium confidence `existing_change`).

So a Feature at 65 with an active Change at 78 would classify as medium-confidence `existing_change`. But by Rule 1b's spirit (Feature and active Change both match strongly), this might warrant `needs_confirmation`. The asymmetry is because Rule 1b only fires when Feature is #1.

This is minor because Rule 6's medium confidence signals uncertainty, and the gap (13 < 15) means Rule 2 already flagged this as not-high-confidence. But the asymmetry should be documented.

**NEW-V3-4: `created_at` format enforcement [MINOR].**

`createChangeNote()` at line 687: `created_at: new Date().toISOString().slice(0, 10)` is correct for YYYY-MM-DD. The comment at lines 683-686 emphasizes ISO 8601 for deterministic tiebreaking. However, there is no validation that *existing* Change notes in the vault have ISO 8601 `created_at` values. If a user manually creates a Change note with `created_at: "April 6"`, the priority queue's lexicographic comparison will produce incorrect ordering. This should be a `verify` dimension (plan 10), not a propose concern, but worth noting.

### 7. Over-engineering Assessment

**PASS.** The plan is appropriately scoped. `dryRun` and `forceClassification` are practical testing aids. The medium-confidence classifications (Rules 5-6) add reasonable gap-filling. No unnecessary abstractions.

### 8. Cross-plan Consistency

**Plan 07 -> Plan 05 (retrieval)**: Clean. Plan 07 consumes `retrievalEngine.search()` which returns `ScoredCandidate[]`. Type ownership is clear (00-unified-types.md).

**Plan 07 -> Plan 06 (sequencing)**: **ISSUE** -- the data flow discards `SequencingResult` too early (see NEW-V3-1 above).

**Plan 07 -> Plan 08 (continue)**: The `continued_change` action is a clean handoff. Plan 08 reads the Change note independently. The v2 review noted this handoff should be documented with a comment; this was done partially via the `existing_change` code path return structure but not with an explicit comment. MINOR.

**Plan 07 -> Plan 04 (index)**: Clean. `buildIndex()` is called at propose start.

**Plan 07 -> Plan 03 (parser)**: Clean. `parseNote()` and `parseDeltaSummary()` are used for prerequisite checks.

### 9. overview.md Limitations

**LIMITATION-1: Multi-feature Changes (overview.md 13.2).**
Documented at lines 666-671 as a v1 limitation. ACCEPTABLE.

**LIMITATION-2: User-priority override (overview.md 10.5.1 rule 4).**
Handled by plan 06's explicit deferral. Plan 07 inherits this. ACCEPTABLE.

---

## Summary of Issues by Severity

### Must Fix (blocks correctness)

| # | Plan | Description | Source |
|---|------|-------------|--------|
| MF-1 | 07 | `propose()` passes `retrieval.sequencing` (SequencingSummary) to `executePostClassification()` which needs `SequencingResult`. Fields `pairwise_severities`, `ordering`, `requirement_conflicts` are missing at runtime. **Carried from v2 NEW-1, still unresolved.** | v2 NEW-1, v3 NEW-V3-1 |

### Should Fix (improves quality / prevents subtle bugs)

| # | Plan | Description | Source |
|---|------|-------------|--------|
| SF-1 | 07 | `ProposeResult.sequencing_warnings` declared but never populated. TypeScript type error. | v2 NEW-2 |
| SF-2 | 07 | `computeDependsOn` adds `depends_on` on *both* sides of a conflict_critical pair, creating guaranteed-stuck state. | v2 NEW-3 |
| SF-3 | 07 | `computeDependsOn()` is effectively dead code due to escalation logic in `runPreflight()`. Needs documentation or redesign. | v3 NEW-V3-2 |

### Minor (documentation, consistency, edge cases)

| # | Plan | Description | Source |
|---|------|-------------|--------|
| MI-1 | 06 | `RequirementConflictLevel` (plan 06) vs `RequirementConflictSeverity` (00-unified-types.md) naming mismatch. | v3 |
| MI-2 | 06 | `out_of_order_errors` not reflected in `SequencingResult.status` -- needs explicit documentation comment. | v2 NEW-4 |
| MI-3 | 06 | No `PerChangeSequencingResult` producer -- document as consumer responsibility or add helper. | v3 |
| MI-4 | 07 | `classify()` Rule 1b is asymmetric (only fires when Feature is #1, not when Change is #1). | v3 NEW-V3-3 |
| MI-5 | 07 | Partial-state test description (line 1053) still says "no partial state" for `new_feature` path. | v2 12-v1 |
| MI-6 | 07 | `existing_change` -> plan 08 handoff should have explicit documentation comment. | v2 NEW-5 |
| MI-7 | 07 | Non-ISO `created_at` values from user-created notes could break tiebreaking. Should be verify concern. | v3 NEW-V3-4 |

---

## Concrete Fix Recommendations

### MF-1 Fix (Must Fix)

Restructure `runPreflight()` and `propose()` data flow:

```typescript
// Add a new return type for runPreflight
interface PreflightResult {
  retrieval: RetrievalResult;
  sequencingFull: SequencingResult;
}

// runPreflight returns both
function runPreflight(query, index): PreflightResult {
  candidates = retrievalEngine.search(query, index)
  sequencingResult = sequencingEngine.analyzeSequencing(index)
  sequencingSummary = summarizeForRetrieval(sequencingResult)
  classResult = classify(candidates, sequencingResult)
  // ... escalation ...
  return {
    retrieval: { query, classification, confidence, sequencing: sequencingSummary, candidates, warnings },
    sequencingFull: sequencingResult
  }
}

// propose() uses sequencingFull for downstream
async function propose(userRequest, options):
  // ...
  { retrieval, sequencingFull } = await runPreflight(query, index)
  // ...
  result = executePostClassification(classification, query, sequencingFull, index, options.vaultRoot)
```

### SF-1 Fix

Either:
- (a) Make `sequencing_warnings` optional: `sequencing_warnings?: string[]`, or
- (b) Populate it in each `executePostClassification` return path:
  ```
  sequencing_warnings: sequencing.reasons.filter(r =>
    r.includes('needs_review') || r.includes('stale') || r.includes('out-of-order')
  )
  ```

### SF-2 Fix

Change `computeDependsOn()` conflict-handling to depend on whichever conflicting change comes first in deterministic order (not both):

```
for conflict in sequencing.requirement_conflicts:
  if conflict.feature_id == feature.id:
    // Depend on the earlier one only. The user must resolve A-vs-B
    // before C can proceed; depending on both creates a stuck state.
    posA = sequencing.ordering.find(o => o.id == conflict.change_a)?.position ?? Infinity
    posB = sequencing.ordering.find(o => o.id == conflict.change_b)?.position ?? Infinity
    earlierId = posA < posB ? conflict.change_a : conflict.change_b
    if !depends_on.includes(earlierId):
      depends_on.push(earlierId)
```

### SF-3 Documentation

Add a comment to `computeDependsOn()`:
```
// NOTE: Due to escalation logic in runPreflight(), when the overall sequencing
// status is conflict_candidate or conflict_critical, classification is escalated
// to needs_confirmation and no Change note is created. Therefore, this function
// primarily handles the parallel_safe and needs_review cases, where pairwise
// overlaps on the target Feature are unlikely. The conflict-handling branches
// below are defensive code for edge cases where individual pair severities
// differ from the overall status.
```

---

## Cross-plan Integration Risks

| Integration Point | Risk | Mitigation |
|---|---|---|
| Plan 06 `RequirementConflictLevel` vs 00-unified-types `RequirementConflictSeverity` | TypeScript import error | Standardize the name during implementation |
| Plan 07 `runPreflight()` discards full `SequencingResult` | Runtime crash in `computeDependsOn()` | Apply MF-1 fix: return `PreflightResult` |
| Plan 06's `PerChangeSequencingResult` not produced | Plan 05/10 may expect a per-change view | Add a helper or document derivation |
| Plan 07 `sequencing_warnings` never populated | TypeScript compilation error | Apply SF-1 fix |
| Plan 07 `computeDependsOn` depends on both conflict sides | New Change notes have unsatisfiable `depends_on` | Apply SF-2 fix |

---

## Overall Assessment

**Plan 06** is in excellent shape and ready for implementation. All v1 and v2 issues have been addressed. The algorithms are precise, the types match 00-unified-types.md (with one trivial naming mismatch), and the integration surface is clean. The only remaining items are minor documentation improvements (MI-1, MI-2, MI-3).

**Plan 07** is architecturally sound -- the search-first approach, classification pipeline, prerequisite gate, and sequencing escalation are all well-designed and faithful to overview.md. However, it has **one unresolved must-fix from v2** (SequencingSummary/SequencingResult type mismatch at the `propose()` -> `executePostClassification()` boundary) that will cause a runtime failure. Additionally, three should-fix issues need attention: the unpopulated `sequencing_warnings` field, the "depend on both conflict sides" logic, and the effectively-dead `computeDependsOn()` code. These are all fixable without architectural changes.

**Net result**: Plan 06 is ready. Plan 07 needs one more pass focused on the `runPreflight()` return type restructuring and the three should-fix items.
