# V2 Review: Plans 08-09 (Continue & Apply Workflows)

**Reviewer:** Devil's Advocate Agent (Round 2)
**Date:** 2026-04-06
**Files Reviewed:**
- `plans/08-workflow-continue.md`
- `plans/09-workflow-apply.md`

**Cross-references checked:**
- `plans/00-unified-types.md` (NextAction, Ownership Rules, DeltaSummaryEntry)
- `plans/reviews/review-08-09.md` (round 1 review)
- OpenSpec sources: `continue-change.ts`, `apply-change.ts`, `specs-apply.ts`
- `overview.md` sections 6.2C, 10.3, 10.5.1, 10.8, 14.2, 15

---

## Round 1 Issue Resolution Status

### ISSUE-08-01: `planned` + all tasks done edge case -- RESOLVED
Plan 08 line 412-422 now explicitly comments this as an `EXTENSION` of overview.md section 15, adds a user-visible warning, and transitions to `in_progress` rather than silently double-transitioning. The warning text is clear and actionable.

### ISSUE-08-02: Dead `promote_decision` case in `formatContinueResult` -- RESOLVED
The `promote_decision` case has been completely removed from `formatContinueResult`. The formatter now only covers the seven `NextAction` variants that can actually be returned. Clean removal with no residual references.

### ISSUE-08-03: Overview.md divergence in `planned` branch -- RESOLVED
Addressed as part of ISSUE-08-01 fix. The extension is now explicitly documented with a comment block.

### ISSUE-08-04: `IndexStore` vs `VaultIndex` naming -- RESOLVED
Plan 08 uses `VaultIndex` throughout. Plan 09 also now uses `VaultIndex` consistently (0 occurrences of `IndexStore` remain, 8 occurrences of `VaultIndex`).

### ISSUE-09-01: `IndexStore` naming in plan 09 -- RESOLVED
All `IndexStore` references have been renamed to `VaultIndex` throughout plan 09. Confirmed via grep.

### ISSUE-09-04: Rollback on partial apply -- RESOLVED
Plan 09 now explicitly implements a two-phase commit pattern (lines 1116-1285). Phase 1 validates and computes all updates with zero disk writes. Phase 2 writes ALL files only if Phase 1 passes completely. The architecture is clearly documented with a prominent comment block. Test strategy includes dedicated "Two-phase commit tests" (lines 1729-1733).

### ISSUE-09-05: `in_progress -> applied` transition ownership -- RESOLVED
This was the most critical fix. Plan 08 now explicitly states that continue does NOT own `in_progress -> applied` (lines 181-184, 628-631, 667-671). When all tasks are done, `nextAction()` returns `{ action: "ready_to_apply" }` instead of attempting the transition itself. Plan 09 is the sole owner. The `executeTransition()` in plan 08 has `in_progress: []` in its allowed transitions map (line 629). The unified types ownership table (00-unified-types.md line 382) confirms this split. Clean and consistent.

### ISSUE-09-06: Accepting `planned` status for apply -- RESOLVED
Plan 09 now only accepts `in_progress` (line 1163: `if (status !== 'in_progress')`). The `planned` acceptance has been removed. The error message explicitly tells the user to use `continue` first. Test strategy includes a test case for planned -> error (line 1726).

### ISSUE-09-08: Agent-driven execution model undocumented -- RESOLVED
The three-phase execution model (Phase A/B/C) is now explicitly documented in the main orchestrator comment block (lines 1135-1140). The `verifyApply()` function (lines 1464-1518) implements Phase C, providing post-validation after the agent completes content edits. This is a significant architectural improvement.

### ISSUE-09-09: `archiveChange()` doesn't signal index invalidation -- RESOLVED
The return type now includes `indexInvalidated: boolean` (line 1546). The function returns `indexInvalidated: true` on success (line 1592) with a comment that the caller MUST rebuild the index. Test strategy covers this (line 1736).

### ISSUE-09-10: File path structure divergence -- RESOLVED
Plan 08 now uses `src/core/workflow/` (lines 809-816), matching plan 09 and plan 01's canonical structure. Line 818 explicitly confirms alignment.

### ISSUE-08-05, ISSUE-08-06, ISSUE-09-02, ISSUE-09-03, ISSUE-09-07: LOW/OBSERVATION issues
These were accepted-as-documented in round 1 and remain unchanged. No action needed.

---

## New Issues Found in V2 Review

### ISSUE-V2-08-01: NextAction type mismatch between plan 08 and unified types [MEDIUM]

**Plan 08** defines `NextAction` as a rich discriminated union (lines 169-179):
```typescript
type NextAction =
  | { action: "fill_section"; target: SectionTarget; context: GatheredContext }
  | { action: "transition"; to: "planned"; context: GatheredContext }
  | { action: "blocked"; reason: string; unresolvedTargets: string[] }
  | { action: "start_implementation"; target: TaskTarget; context: GatheredContext }
  | { action: "continue_task"; target: TaskTarget; context: GatheredContext }
  | { action: "ready_to_apply"; context: GatheredContext }
  | { action: "verify_then_archive"; context: GatheredContext }
```

**Unified types (00-unified-types.md lines 367-373)** defines a simpler interface:
```typescript
interface NextAction {
  action: NextActionType;
  target?: string;
  to?: ChangeStatus;
  reason?: string;
  blockers?: string[];
}
```

The discrepancies:
1. Plan 08's `target` is `SectionTarget | TaskTarget` (objects); unified types uses `string`.
2. Plan 08's `blocked` variant has `unresolvedTargets: string[]`; unified types has `blockers: string[]`.
3. Plan 08 includes `context: GatheredContext` in every variant; unified types has no `context` field.
4. Plan 08's `transition` variant constrains `to: "planned"`; unified types allows any `ChangeStatus`.

**Risk:** If plan 10 (verify) or plan 12 (CLI) consume `NextAction` from unified types, they will expect a different shape than what plan 08 produces.

**Recommendation:** Either (a) update unified types to match plan 08's richer discriminated union, or (b) have plan 08 return the unified types interface and keep the richer types internal. Option (a) is better because it preserves type safety. The `context` field in particular is important for downstream consumers.

### ISSUE-V2-09-01: `verifyApply()` uses same note for both `updatedNote` and `originalNote` in `postValidate()` [MEDIUM]

**Location:** Plan 09, lines 1491

```typescript
const postResults = postValidate(entries, updatedNote, updatedNote);
```

`postValidate()` takes `(entries, updatedFeatureNote, originalFeatureNote)` (line 940-943). The comment at line 1489 says "use the stored base_fingerprint from the DeltaEntry instead" -- but `postValidate()` for MODIFIED checks `computeRequirementHash(original) !== computeRequirementHash(updated)`. If the same note is passed as both original and updated, the MODIFIED hash-change check will ALWAYS return `hashChanged: false`, because it compares the note against itself.

Then line 1501-1503 pushes an error for `hashChanged === false`:
```typescript
if (pv.entry.op === 'MODIFIED' && pv.hashChanged === false) {
  errors.push(`MODIFIED "${pv.entry.targetName}" content_hash unchanged (no-op)`);
}
```

This means EVERY `verifyApply()` call with MODIFIED ops will error, even when the agent correctly changed the content.

**Recommendation:** The original (pre-agent-edit) Feature content needs to be stored before Phase B starts. Either:
- Store original Feature snapshots in `PendingAgentOp` (add an `originalContent` or `originalHash` field)
- Use `base_fingerprint` from the DeltaEntry directly in `verifyApply()` instead of re-calling `postValidate()`
- Create a specialized `verifyAgentEdits()` that compares `content_hash` against `base_fingerprint` rather than using the generic `postValidate()`.

### ISSUE-V2-09-02: `applyDeltaToFeature()` receives only mechanical entries but `FeatureApplyResult` covers all [LOW]

**Location:** Plan 09, lines 1355-1363

The main orchestrator filters entries before passing them to `applyDeltaToFeature()`:
```typescript
const mechEntries = reqEntries.filter(e => (programmaticOps as readonly string[]).includes(e.op));
const result = applyDeltaToFeature(featureNote, mechEntries);
```

But `FeatureApplyResult` is later used to decide what to write:
```typescript
if (result.requiresWrite) {
  await writeFile(result.featurePath, result.updatedContent);
}
```

If a Feature has ONLY agent-driven ops (MODIFIED, ADDED) and no mechanical ops, `mechEntries` is empty, `applyDeltaToFeature()` returns `requiresWrite: false`, and no Feature write happens in Phase 2. This is correct for the mechanical phase.

However, agent-driven ops are collected as `pendingAgentOps`, and the agent writes directly. After the agent writes, `verifyApply()` runs. But `verifyApply()` does NOT re-run the mechanical ops pipeline. If a Feature had BOTH mechanical and agent-driven ops, the mechanical write happens in Phase 2, then the agent writes on top. This sequence is correct.

The subtle risk: if the agent's write clobbers the mechanical changes (e.g., the agent reads the Feature after Phase 2's write, applies MODIFIED, but accidentally overwrites the RENAMED/REMOVED changes). This depends on the agent tool's behavior.

**Recommendation:** Add a note or test case explicitly covering the interleaving scenario: Feature with both mechanical (RENAMED) and agent-driven (MODIFIED) ops. Verify the agent reads the post-Phase-2 content (with renames already applied), not the original.

### ISSUE-V2-08-02: `in_progress` transition to `in_progress` is implicit but undocumented [LOW]

**Location:** Plan 08, lines 424

```
if status == "planned":
    ...
    return { action: "start_implementation", target: firstTask, context }
```

The `start_implementation` action signals the transition from `planned` to `in_progress` and the start of the first task. But the transition table (line 664) says the trigger is "Agent or user starts implementation work." Looking at the formatter (line 783), it says:

```
"Starting implementation will transition status to 'in_progress'."
```

The question is: who actually calls `executeTransition()` for `planned -> in_progress`? The `nextAction()` function returns the action but doesn't execute the transition itself. The orchestrator must detect `start_implementation` and call `executeTransition()` before giving the task to the agent. But this orchestrator logic is not shown in the plan -- only `formatContinueResult()` is shown.

**Recommendation:** Add explicit orchestrator pseudocode showing the `nextAction() -> execute transition -> present to agent` flow. Currently the plan shows `nextAction()` and `formatContinueResult()` but not the glue between them.

---

## Cross-Plan Consistency Check (V2)

| Check | Status |
|-------|--------|
| `VaultIndex` naming consistency (08, 09, 04) | PASS -- all use `VaultIndex` |
| File path structure (`src/core/workflow/`) | PASS -- both plans aligned |
| `in_progress -> applied` sole ownership by 09 | PASS -- 08 explicitly defers |
| `ready_to_apply` type exists in unified types | PASS -- present in `NextActionType` union |
| `promote_decision` dead code removed | PASS -- no references remain |
| `planned` status rejected by apply | PASS -- only `in_progress` accepted |
| Two-phase commit defined for multi-Feature | PASS -- explicit Phase 1/2 pattern |
| `archiveChange()` signals index invalidation | PASS -- `indexInvalidated` in return type |
| `NextAction` shape: plan 08 vs unified types | FAIL -- structural mismatch (V2-08-01) |
| `verifyApply()` post-validation correctness | FAIL -- same note passed twice (V2-09-01) |

---

## Summary

| Plan | Rating | Issues (V1) | Resolved | New (V2) | Remaining |
|------|--------|-------------|----------|----------|-----------|
| 08-workflow-continue | STRONG | 6 | 6/6 | 2 (1 MEDIUM, 1 LOW) | 2 |
| 09-workflow-apply | VERY STRONG | 10 | 10/10 | 2 (1 MEDIUM, 1 LOW) | 2 |

**V1 resolution rate: 16/16 (100%)** -- All original issues addressed.

**Top items to address before implementation:**

1. **ISSUE-V2-09-01 (MEDIUM):** Fix `verifyApply()` passing the same note as both original and updated to `postValidate()`. MODIFIED ops will always false-alarm as no-ops. Store original hashes before agent edits begin.

2. **ISSUE-V2-08-01 (MEDIUM):** Reconcile the `NextAction` type between plan 08's discriminated union and unified types' simpler interface. Downstream consumers (plans 10, 12) need a consistent contract.

3. **ISSUE-V2-09-02 (LOW):** Add explicit test coverage for the mechanical+agent-driven interleaving scenario on the same Feature.

4. **ISSUE-V2-08-02 (LOW):** Add orchestrator pseudocode showing how `start_implementation` triggers the `planned -> in_progress` transition.

**Overall assessment:** Excellent round-1 fix execution. All 16 original issues were resolved cleanly. The `in_progress -> applied` ownership split and the two-phase commit pattern are particularly well done. The two remaining MEDIUM issues (verifyApply bug and NextAction type mismatch) are straightforward to fix and do not require architectural changes.
