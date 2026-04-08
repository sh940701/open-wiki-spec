# Review v2: Plans 06 (Sequencing Engine) and 07 (Workflow Propose)

**Reviewer**: Devil's Advocate Agent  
**Date**: 2026-04-06  
**Review type**: Post-fix second-round review  
**Verdict**: Most original issues are resolved. Two new issues introduced by fixes, one original issue partially fixed.

---

## Resolution Status of Original Issues

### Must Fix (from review v1)

**1. [RESOLVED] Plan 06: Missing detection of out-of-order status.**

Plan 06 now includes Algorithm 5 (`detectOutOfOrderErrors`) at line 589. The algorithm correctly:
- Defines `statusRank` progression: proposed(0) < planned(1) < in_progress(2) < applied(3)
- Only flags changes at rank >= 2 (in_progress or applied)
- Checks each dependency: if dep rank < change rank AND dep rank < 3, it is out-of-order
- The `OutOfOrderError` type is added to the data structures (line 247)
- `analyzeSequencing()` calls it at step 4b (line 664-667) on ALL changes (including applied)
- Results are included in `SequencingResult.out_of_order_errors` (line 275)
- Test cases added for `out-of-order.ts` (line 923-930)

The implementation faithfully matches overview.md 10.5.1: "depends_on target이 존재하지 않거나, 아직 완료되지 않은 선행 작업을 필요로 하는데 현재 Change가 in_progress 또는 applied로 앞서 나가 있으면 sequencing error로 보고해야 한다."

**2. [RESOLVED] Plan 07: Missing enforcement of sequencing severity in propose.**

Plan 07 now includes sequencing severity escalation in `runPreflight()` at lines 354-379. When `sequencingResult.status` is `conflict_critical` or `conflict_candidate`, the classification is escalated to `needs_confirmation` with `confidence: 'low'` and a reason string. This directly satisfies overview.md 10.5's fourth `needs_confirmation` condition: "sequencing severity is `conflict_candidate` or `conflict_critical` against an existing active Change."

### Should Fix (from review v1)

**3. [RESOLVED] Plan 06: User-assigned priority override silently dropped.**

Plan 06 now includes an explicit "Deferred v1 contract gap" documentation block at line 539. It acknowledges overview.md 10.5.1 rule 4 ("사용자가 명시적으로 priority를 부여하면 그것이 최우선이다"), explains that `priority` is not part of `ChangeFrontmatter` or `IndexRecord` in v1, and outlines how v2 would add `priority: number` to the comparator. The test strategy also notes this at line 909.

**4. [RESOLVED] Plan 06: `drainAll()` semantics clarified.**

Plan 06 now includes a detailed comment block at lines 457-462 explicitly defining snapshot semantics: "drainAll() uses SNAPSHOT SEMANTICS: it removes and returns all items currently in the queue at the time of the call. Items added to the queue during successor processing (in the loop below) are NOT included in this batch." This is sufficient for implementability.

**5. [RESOLVED] Plan 07: `computeDependsOn()` and `computeTouches()` defined.**

Plan 07 now includes full pseudocode for both functions:
- `computeDependsOn()` at lines 760-793: derives dependencies from sequencing `pairwise_severities` (overlapping features) and `requirement_conflicts` (same feature).
- `computeTouches()` at lines 800-836: includes target Feature, resolved system_terms, and the Feature's own `systems[]`.

Both have corresponding test cases (lines 1021-1031).

**6. [RESOLVED] Plan 07: Classification rules 45-70 gap explicitly flagged.**

Rules 5 and 6 in `classify()` now include explicit "PLAN-LEVEL EXTENSION" comments (lines 495-500 and 510-511) noting: "overview.md defines existing_feature >= 70 and new_feature < 45. The 45-70 range is not specified by overview.md. This plan fills the gap..."

**7. [RESOLVED] Plan 07: `RetrievalResult` type ownership clarified.**

Plan 07 now includes a clear ownership block at lines 239-243: "Type ownership: RetrievalResult is canonically defined in 00-unified-types.md. Plan 05 (retrieval-engine) produces this type; plan 07 consumes it. This plan imports RetrievalResult from the shared types module, NOT from plan 05 directly."

### Nice to Have (from review v1)

**8. [RESOLVED] Plan 06: `findCycles()` DFS algorithm specified.**

Full pseudocode added at lines 500-516: DFS with visited set, recursion stack, and path tracking. Back-edge detection extracts cycle paths.

**9. [RESOLVED] Plan 06: `conflict_critical` vs `blocked` precedence documented.**

Explicit precedence rationale at lines 678-691: "`conflict_critical` is ranked higher because it requires active human intervention, while `blocked` resolves through natural workflow progression."

**10. [RESOLVED] Plan 07: Non-Feature/Change type behavior documented.**

Comment at lines 226-229: "candidates of type 'system', 'decision', 'source', or 'query' can appear in the scored list but the classification rules (Rules 2-6) only check for 'feature' and 'change' types. If a non-Feature/non-Change type scores highest, it falls through to the fallback (new_feature). This is intentional."

**11. [RESOLVED] Plan 07: Multi-feature Change limitation stated.**

Comment at lines 666-671: "v1 limitation: propose always creates a single-feature Change using `feature:` (singular). Overview.md 13.2 allows cross-cutting changes with `features:` (plural), but this path is not supported in v1 propose."

**12. [NOT FIXED, downgraded] Plan 07: Rollback behavior for partial note creation failures.**

The plan still has no error handling for the `new_feature` path where `createFeatureNote()` succeeds but `createChangeNote()` fails. The test strategy mentions "propagated as error, no partial state" (line 1053) but this contradicts reality -- in the `new_feature` path, the Feature note IS written before `createChangeNote` is called. If `createChangeNote` fails, you have an orphan Feature note.

However, this is downgraded from "nice to have" because: (a) the orphan Feature is not harmful (it just has no linked Change), (b) v1 is single-agent with local filesystem writes that rarely fail, (c) fixing it requires transaction semantics that add complexity disproportionate to the risk.

**Recommendation**: Change the test description from "no partial state" to "Feature note may persist as orphan if Change creation fails" to avoid misleading implementors.

---

## New Issues Found in v2

### NEW-1: Type mismatch — `propose()` passes `SequencingSummary` where `SequencingResult` is needed [MUST FIX]

The `propose()` main entry point at line 889-891:
```
result = executePostClassification(
  classification, query, retrieval.sequencing, index, options.vaultRoot
)
```

`retrieval` is a `RetrievalResult`, so `retrieval.sequencing` is `SequencingSummary` (containing only `status`, `related_changes`, `reasons`).

But `executePostClassification` at line 538 declares `sequencing: SequencingResult`, and the callee `createChangeNote` at line 661 passes it to `computeDependsOn()` which accesses:
- `sequencing.pairwise_severities` (line 771)
- `sequencing.ordering` (line 775)
- `sequencing.requirement_conflicts` (line 786)

None of these fields exist on `SequencingSummary`. This will fail at runtime.

**Root cause**: `runPreflight()` computes the full `SequencingResult` internally (line 348: `sequencingResult = sequencingEngine.analyzeSequencing(index)`) but discards it when packing into `RetrievalResult` (only the summary is kept). The full result is needed downstream.

**Fix options**:
- (a) Have `propose()` call `analyzeSequencing(index)` separately and pass the full result to `executePostClassification`. This means sequencing runs twice (once in preflight, once in propose), which is wasteful but correct.
- (b) Change `runPreflight()` to return `{ retrieval: RetrievalResult, sequencingFull: SequencingResult }` so the caller has access to both. This is cleaner.
- (c) Store the full `SequencingResult` on a broader propose context that flows through all steps.

Recommendation: option (b).

### NEW-2: `ProposeResult.sequencing_warnings` declared but never populated [SHOULD FIX]

`ProposeResult` at line 289-290 declares:
```typescript
sequencing_warnings: string[];
```

This field was added to address the v1 review concern about surfacing sequencing warnings prominently. However, none of the four `executePostClassification` return objects (lines 550-609) include `sequencing_warnings`. The field is declared in the interface but never set, which means:
- TypeScript will report a type error (missing required field)
- Consumers expecting sequencing warnings will get `undefined`

**Fix**: Either populate `sequencing_warnings` from the sequencing result's reasons (e.g., filter for conflict-related reasons), or make it optional (`sequencing_warnings?: string[]`). Given that the escalation to `needs_confirmation` already handles the `conflict_candidate`/`conflict_critical` cases, the warnings field should capture the less-severe cases (`needs_review` items, stale bases, out-of-order errors) that don't trigger escalation but should still be visible.

### NEW-3: `computeDependsOn` adds dependency on *both* conflicting changes, creating unnecessary blocking [SHOULD FIX]

In `computeDependsOn()` at lines 783-790:
```
for conflict in sequencing.requirement_conflicts:
  if conflict.feature_id == feature.id:
    if !depends_on.includes(conflict.change_a):
      depends_on.push(conflict.change_a)
    if !depends_on.includes(conflict.change_b):
      depends_on.push(conflict.change_b)
```

When two existing changes A and B have a `conflict_critical` on the target Feature, the new change C gets `depends_on: [A, B]`. But A and B themselves are in conflict with each other -- they can't both be applied. The user must choose one. Making C depend on *both* means C is blocked until *both* resolve, including the one that gets rejected/cancelled.

**Better approach**: Depend on whichever is *earlier* in deterministic order (consistent with the overlap case), or depend on neither and instead flag this as a warning that the user must resolve A-vs-B before C can proceed. Depending on both creates a guaranteed-stuck state unless both somehow resolve.

### NEW-4: `out_of_order_errors` not reflected in `SequencingResult.status` [Minor]

`detectOutOfOrderErrors` runs at step 4b in `analyzeSequencing()`, and results are stored in `out_of_order_errors`. But the overall `status` computation at steps 6 (lines 692-700) does not consider out-of-order errors. If the only problem is an out-of-order error (no touches overlap, no requirement conflict), the status would still be `parallel_safe`.

This may be intentional (out-of-order is a diagnostic for verify, not a severity level), but it means the `SequencingSummary.status` embedded in retrieval output won't reflect out-of-order conditions. The `reasons` array does include out-of-order messages (line 717-718), so it's partially covered.

**Recommendation**: Document this as intentional. Out-of-order errors are informational diagnostics reported in `reasons` but do not affect `status`, because status represents the conflict severity between *active changes* while out-of-order is a workflow-progression issue.

### NEW-5: `existing_change` path skips prerequisite check [Minor]

When classification is `existing_change`, `executePostClassification` returns with `prerequisites: null` (line 556). The comment says "not checking prerequisites for continue." But `ProposeResult` consumers may want to know the current prerequisite state of the existing Change -- e.g., is it still `proposed` and missing sections, or is it already `planned`?

The `target_change.status` is included, which partially addresses this. But there's an asymmetry: for `existing_feature` and `new_feature` paths, the caller gets full prerequisite information and can transition to `planned`. For `existing_change`, the caller has no prerequisite data and must independently decide to invoke the continue workflow (plan 08).

This is more of a design observation than a bug. The v1 review noted this as "what does the caller DO with `continued_change`?" The answer is clearer now -- the caller invokes plan 08's continue workflow -- but the handoff is still implicit. Consider adding a comment documenting this: "The `continued_change` action signals the main agent to invoke the continue workflow (plan 08). Prerequisites are checked there, not here."

---

## Cross-plan Consistency Check

### Plan 06 <-> 00-unified-types.md

**PASS**: All types in plan 06 match 00-unified-types.md. `OutOfOrderError` is present in both. `SequencingResult` fields align exactly.

### Plan 07 <-> 00-unified-types.md

**PASS**: `RetrievalResult`, `Classification`, `Confidence`, `ScoredCandidate`, `SequencingSummary` all match.

### Plan 06 <-> Plan 07

**ISSUE** (NEW-1 above): The interface between plans works at the type level (both reference `SequencingResult` from 00-unified-types.md), but the actual data flow in `propose()` loses the full result during the `runPreflight()` -> `RetrievalResult` conversion.

### Plan 07 <-> Plan 08 (continue)

`ProposeResult.action = 'continued_change'` implies plan 08 is invoked next. Plan 08 should accept a Change note path/id as input and resume from there. This is a clean handoff point, assuming plan 08 reads the Change note independently rather than relying on `ProposeResult` fields.

---

## Summary of v2 Issues

| # | Plan | Severity | Description |
|---|------|----------|-------------|
| NEW-1 | 07 | **Must Fix** | Type mismatch: `propose()` passes `SequencingSummary` to `executePostClassification()` which expects `SequencingResult` |
| NEW-2 | 07 | Should Fix | `ProposeResult.sequencing_warnings` declared but never populated in any code path |
| NEW-3 | 07 | Should Fix | `computeDependsOn` depends on both sides of a conflict_critical pair, creating guaranteed-stuck state |
| NEW-4 | 06 | Minor | `out_of_order_errors` not reflected in `SequencingResult.status` -- document as intentional |
| NEW-5 | 07 | Minor | `existing_change` path skips prerequisite check with no documentation of handoff to plan 08 |
| 12-v1 | 07 | Minor | Partial-state test description still says "no partial state" -- should acknowledge orphan Feature |

---

## Overall Assessment

Plan 06 is now in excellent shape. All original issues were addressed thoroughly, including the out-of-order detection (full algorithm with status rank comparison), drainAll snapshot semantics, findCycles DFS pseudocode, and conflict_critical vs blocked precedence rationale. No new issues were introduced by the fixes. The only minor observation (NEW-4) is about documentation, not correctness.

Plan 07 addressed the majority of original concerns well -- sequencing escalation, computeDependsOn/computeTouches definitions, gap-filling documentation, and type ownership. However, the fixes introduced a new must-fix (NEW-1: SequencingSummary/SequencingResult type mismatch in the propose() -> executePostClassification data flow) and a should-fix (NEW-2: sequencing_warnings interface field declared but unpopulated). NEW-3 (depends_on both sides of a conflict) is a logic issue in the newly-added computeDependsOn that will cause unnecessary blocking.

**Net result**: Plan 06 is ready for implementation. Plan 07 needs one more pass to fix the SequencingSummary/SequencingResult data flow and populate sequencing_warnings.
