# Review: Plans 08-09 (Continue & Apply Workflows)

**Reviewer:** Devil's Advocate Agent
**Date:** 2026-04-06
**Files Reviewed:**
- `plans/08-workflow-continue.md`
- `plans/09-workflow-apply.md`

**Cross-references checked:**
- `overview.md` sections 6.2C, 10.3, 10.5.1, 10.8, 14.2, 15
- OpenSpec sources: `continue-change.ts`, `apply-change.ts`, `specs-apply.ts`, `artifact-graph/graph.ts`
- Plans: 03 (vault-parser), 04 (index-engine), 06 (sequencing-engine)

---

## Plan 08: Continue Workflow

### Verdict: STRONG with notable issues

### Strengths

1. **Faithful next-action algorithm.** The pseudocode in Step 4 maps line-by-line to overview.md section 15's next-action pseudocode. All four status branches are covered with correct return types.

2. **Section-completeness contract is precise.** Hard prerequisites (Why, Delta Summary >= 1, Tasks >= 1, Validation) match overview.md section 15 exactly. Soft prerequisites are correctly non-blocking with conditional Decision link warning.

3. **Decision promotion is well-designed.** The four promotion criteria match overview.md section 14.2 verbatim. The "any one is sufficient" semantics and the existing-link short-circuit are correct. Critically, the plan explicitly prevents content duplication (step 5 of promotion execution).

4. **`depends_on` resolution is thorough.** The `checkDependsOn()` function implements the full sequencing error detection from overview.md section 10.5.1, including detecting when a change has advanced past its unresolved dependencies.

5. **Transition ownership is clearly delineated.** The table mapping which workflow executes each transition (continue for proposed->planned, planned->in_progress; continue+apply for in_progress->applied) prevents ambiguity.

### Issues

#### ISSUE-08-01: `planned` status with all tasks done -- ambiguous transition [MEDIUM]

**Location:** Step 4, lines 406-408

```
if status == "planned":
  ...
  if not firstTask:
    return { action: "transition", to: "in_progress", context }
```

If a Change enters `planned` status with all tasks already checked (edge case, but possible if someone manually edits), the algorithm transitions to `in_progress` immediately. But `in_progress` + all tasks done would then trigger `transition to applied` on the next `continue` invocation. This creates a two-step skip (`planned -> in_progress -> applied`) across two continue calls.

**Risk:** Overview.md section 15 pseudocode for `planned` says `return { action: "start_implementation", target: firstUncheckedTask(change) }` -- it does NOT have a fallback for "no unchecked tasks." The plan adds this fallback, which is reasonable, but it's an extension of the spec that should be explicitly documented as such.

**Recommendation:** Add an explicit comment that this is an extension of the overview.md pseudocode to handle edge cases. Consider whether this should warn the user rather than silently double-transition.

#### ISSUE-08-02: `NextAction` type has `promote_decision` in `formatContinueResult` but not in the union [LOW]

**Location:** Lines 169-179 vs line 780

The `NextAction` discriminated union (lines 169-179) explicitly states:
```
// NOTE: Decision promotion is NOT a nextAction() return type.
```

But `formatContinueResult` (line 780) has a case branch for `{ action: "promote_decision" }`. This is dead code in the formatter.

**Recommendation:** Remove the `promote_decision` case from `formatContinueResult`, or document how the orchestrator layer surfaces promotion suggestions to the user (it's handled as a post-processing step, so the formatter should not need this branch).

#### ISSUE-08-03: Overview.md pseudocode divergence in `planned` branch [MEDIUM]

**Location:** Step 4, lines 397-409

Overview.md section 15 says:
```
if status == "planned":
  if depends_on has unresolved targets:
    return { action: "blocked", reason: unresolved_targets }
  return { action: "start_implementation", target: firstUncheckedTask(change) }
```

The plan adds logic that the overview does not specify:
1. **A fallback when no tasks exist** (transition to `in_progress`)
2. The overview pseudocode returns `start_implementation` unconditionally after deps check, but the plan also handles "no first task" case.

These are reasonable extensions, but strictly speaking they deviate from the overview.md contract. The overview does not define what happens when `planned` + no unchecked tasks.

**Recommendation:** Flag this explicitly as an extension. Consider whether this case should instead be a `verify` error (a `planned` change MUST have tasks per the section-completeness contract, so having zero unchecked tasks at `planned` implies either all tasks are done or the check was bypassed).

#### ISSUE-08-04: Index type naming inconsistency [LOW]

**Location:** Throughout plan 08

Plan 08 uses `VaultIndex` consistently (matching plan 04). Plan 09 uses `IndexStore`. These MUST use the same name.

Plan 04 defines `VaultIndex` as the canonical name (interface at line 254, class at line 597).

**Recommendation:** Plan 09 should rename all `IndexStore` references to `VaultIndex` for consistency with plan 04.

#### ISSUE-08-05: Missing `Proposed Update` and `Impact` from fill_section guidance [LOW]

**Location:** Step 6, lines 496-537

The `buildSectionTarget` function provides guidance for Why, Delta Summary, Tasks, Validation, and Design Approach, but NOT for "Proposed Update" or "Impact." These are listed in the Change template (overview.md section 14.2) but are not hard prerequisites.

Since `nextAction` only returns `fill_section` for hard prerequisites, these sections would never be targeted. However, if someone extends the algorithm to also fill optional sections, the guidance map is incomplete.

**Recommendation:** Either add guidance entries for all Change sections, or document that only hard prerequisite sections have fill guidance.

#### ISSUE-08-06: `SectionAnalysis` maps section status but `NextAction` only fills hard prereqs [OBSERVATION]

The analysis infrastructure parses ALL sections (including Impact, Status Notes), but the next-action algorithm only ever targets the 4 hard prerequisites for fill. This is correct behavior per the overview, but the infrastructure may create an impression that all sections are tracked for filling.

---

## Plan 09: Apply Workflow

### Verdict: VERY STRONG -- the most detailed plan in the set

### Strengths

1. **Atomic apply order is exact.** RENAMED(1) -> REMOVED(2) -> MODIFIED(3) -> ADDED(4) matches overview.md section 14.2 and OpenSpec's `buildUpdatedSpec()` precisely.

2. **Stale detection is thorough.** The `detectStale()` function correctly compares `base_fingerprint` against current `content_hash` for MODIFIED/REMOVED/RENAMED entries, skips ADDED entries (no base), and blocks auto-apply when any stale entry is found. This matches overview.md section 10.8 exactly.

3. **Cross-section conflict validation is complete.** All six conflict pairs from OpenSpec are validated: MODIFIED+REMOVED, MODIFIED+ADDED, ADDED+REMOVED, RENAMED_FROM+MODIFIED, RENAMED_TO+ADDED, plus duplicate detection within each section.

4. **Operation validation matrix is faithfully implemented.** Both `preValidate()` and `postValidate()` match the matrix from overview.md section 10.8 exactly, including the content_hash-unchanged warning for MODIFIED no-ops.

5. **Hybrid lifecycle is correctly separated.** `applyChange()` sets status to `applied` and keeps the note in `04-changes/`. `archiveChange()` is a separate function that moves to `99-archive/` only for `applied` notes. This matches overview.md section 6.2C.

6. **Delta Summary parser regex is well-crafted.** Handles all four grammar forms from overview.md section 14.2, including the optional `[base: ...]` suffix and section-level operations.

7. **Agent-driven vs programmatic distinction is clearly articulated.** The critical architectural note (lines 851-855) correctly identifies that RENAMED and REMOVED are programmatic, while MODIFIED and ADDED are agent-driven because Delta Summary lacks full replacement content.

### Issues

#### ISSUE-09-01: `IndexStore` vs `VaultIndex` naming inconsistency [MEDIUM]

**Location:** Throughout plan 09 (lines 453, 632, 1115, 1334, 1426, 1533, 1596)

Plan 09 consistently uses `IndexStore` while plan 04 and plan 08 use `VaultIndex`. This is a cross-plan naming conflict that will cause compilation errors.

**Recommendation:** Rename all `IndexStore` to `VaultIndex` throughout plan 09.

#### ISSUE-09-02: `ADDED` entries -- `[base: n/a]` handling is inconsistent [MEDIUM]

**Location:** Regex pattern at line 443, parser at lines 641-649

The regex `REQUIREMENT_OP_RE` makes `[base: ...]` optional with the trailing `?`. This means ADDED entries match whether or not `[base: n/a]` is present. The parser then sets `baseFingerprint: null` for "n/a" values.

However, overview.md section 14.2 is itself inconsistent here:
- Line 1146: `- ADDED requirement "Passkey Authentication" to [[Feature: Auth Login]]` (NO base)
- Line 1148: `- ADDED requirement "Session Token Refresh" to [[Feature: Auth Login]] [base: n/a]` (WITH base: n/a)
- Line 1180: `ADDED`는 기존 대상이 없으므로 `[base: n/a]`다.

The plan's regex correctly handles both forms by making `[base:]` optional. But the `stale-detector.ts` skips ADDED entries entirely (lines 641-649), so the `[base: n/a]` is never validated.

**Recommendation:** This is correct behavior (ADDED has no base to check), but document the overview.md inconsistency explicitly so implementers don't get confused.

#### ISSUE-09-03: Section operations lack `[base:]` -- potential gap for stale detection [MEDIUM]

**Location:** Lines 449, 511 -- `baseFingerprint: null` for section ops

Section-level operations (ADDED/MODIFIED/REMOVED section) have `baseFingerprint: null` hardcoded. This means there is NO stale detection for section-level modifications.

Overview.md section 14.2 line 1180 says `[base: <content_hash>]` is for requirement operations specifically. Section operations are not mentioned in the stale detection contract (section 10.8).

**Risk:** If two Changes both MODIFY the same narrative section in the same Feature, there's no stale detection to catch the conflict. However, overview.md does not define `content_hash` for sections, so this is correct per spec.

**Recommendation:** Accept this as a v1 limitation but document it. Consider adding section content hashing in v2.

#### ISSUE-09-04: Rollback on partial apply failure is unaddressed [HIGH]

**Location:** Main orchestrator at lines 1092-1307

The `applyChange()` function processes operations per-Feature sequentially. If operations on Feature A succeed but operations on Feature B fail (pre-validation error, stale base, etc.), the function continues and returns a mixed result with `success: false` and partial `featureResults`.

But: **the Feature A content has already been prepared** (`applyDeltaToFeature` returns updated content). However, examining more carefully, the actual disk write is NOT shown in the code -- the orchestrator returns `updatedContent` but the actual `writeFile` call is not in the provided code.

**Critical question:** Who writes the updated content to disk? If the caller writes ALL feature results to disk after checking `success`, then partial failure is safe (nothing written). But if writing happens per-feature inside the loop, partial failure leaves the vault in an inconsistent state.

The plan says "actual write delegated to caller or performed here" (line 1290) which is ambiguous.

**Recommendation:** Explicitly define a two-phase commit pattern:
1. Phase 1: Validate and compute all updated content (no writes)
2. Phase 2: If ALL validations pass, write ALL files
This prevents partial application. Document this explicitly.

#### ISSUE-09-05: `in_progress -> applied` transition ownership contradiction [MEDIUM]

**Location:** Lines 1127-1134

The `applyChange()` function accepts changes with status `in_progress` OR `planned`:
```typescript
if (status !== 'in_progress' && status !== 'planned') {
  throw new Error(...);
}
```

But plan 08 (continue workflow) says that the transition to `applied` is executed by the continue workflow when all tasks are complete (line 651):
> `in_progress -> applied`: Executed by `continue` workflow when `nextAction` returns `transition -> applied`

Meanwhile, plan 09's `applyChange()` ALSO transitions to `applied` (line 1287).

**Question:** Who actually sets `status: applied`? If both workflows can do it, there's a race condition or double-transition risk.

**Recommendation:** Clarify ownership. The cleanest model: `continue` handles status transitions, `apply` handles canonical Feature updates. `apply` should NOT set status -- it should require status to already be `applied` or have `continue` set it just before calling `apply`. Alternatively, make `apply` the sole transition executor and remove this from `continue`.

#### ISSUE-09-06: Accepting `planned` status for apply is questionable [MEDIUM]

**Location:** Line 1129

The orchestrator accepts `status: "planned"` for apply, but:
- Overview.md section 15 says apply happens AFTER implementation (tasks are done)
- The status lifecycle is `proposed -> planned -> in_progress -> applied`
- Allowing `planned -> applied` (skipping `in_progress`) violates the linear lifecycle

The plan adds a warning for unchecked tasks but still proceeds.

**Recommendation:** Remove `planned` from the accepted statuses. Apply should only accept `in_progress` (with all tasks complete) or already-`applied` (for re-verification). If the user wants to fast-track, they should explicitly transition through `continue` first.

#### ISSUE-09-07: `computeRequirementHash()` normalization may not match plan 03's hashing [LOW]

**Location:** Lines 725-733

The hash computation normalizes by trimming and collapsing whitespace:
```typescript
const normalized = [
  requirement.normative,
  ...requirement.scenarios.map(s => s.trim()),
].join('\n').trim();
return `sha256:${computeContentHash(normalized)}`;
```

Plan 03 (vault-parser) defines requirement parsing and content_hash computation. The normalization algorithm MUST match between the two plans. If plan 03 uses a different normalization (e.g., strips scenario keywords like WHEN/THEN, or normalizes differently), the hashes will diverge and stale detection will produce false positives.

**Recommendation:** Extract the normalization algorithm to a shared utility (e.g., `util/requirement-hash.ts`) referenced by both plans 03 and 09. Do not duplicate normalization logic.

#### ISSUE-09-08: MODIFIED operation is a placeholder for agent action [OBSERVATION]

**Location:** Lines 826-835

`applySingleOperation()` for MODIFIED returns `{ success: true, contentChanged: true }` without actually changing any content. The comment says "The agent will read the Delta Summary description and apply the change."

This means:
- For RENAMED and REMOVED: the feature-updater does the actual mechanical work
- For MODIFIED and ADDED: the feature-updater only validates preconditions; the agent does the actual content work

This is architecturally sound for the agent-driven model, but it means `postValidate()` can never actually verify MODIFIED/ADDED postconditions programmatically at apply time -- the agent hasn't done the work yet when `postValidate()` runs.

**Recommendation:** Document the expected call sequence explicitly:
1. `applyChange()` validates and does mechanical ops (RENAMED, REMOVED)
2. Agent performs content ops (MODIFIED, ADDED) guided by the result
3. `postValidate()` is called AFTER the agent finishes writing
This three-phase model should be explicit in the architecture section.

#### ISSUE-09-09: `archiveChange()` does not update the index [LOW]

**Location:** Lines 1332-1377

After moving a file from `04-changes/` to `99-archive/`, the index is stale. The function doesn't trigger index invalidation or update.

**Recommendation:** Either return a signal that the index needs rebuilding, or call an index invalidation hook.

#### ISSUE-09-10: File path structure diverges between plans [LOW]

Plan 08 uses:
```
src/workflows/continue.ts
src/analysis/section-analysis.ts
src/transitions/status-transition.ts
```

Plan 09 uses:
```
src/core/workflow/apply.ts
src/core/workflow/delta-parser.ts
```

The `src/workflows/` vs `src/core/workflow/` inconsistency will confuse implementers. Plan 01 (project structure) should be the authority here.

**Recommendation:** Align both plans to whatever plan 01 defines. If plan 01 uses `src/core/workflow/`, then plan 08 should update its paths.

---

## Cross-Plan Consistency Summary

| Issue | Plans | Severity |
|-------|-------|----------|
| `VaultIndex` vs `IndexStore` naming | 08 vs 09 vs 04 | MEDIUM |
| File path structure (`src/workflows/` vs `src/core/workflow/`) | 08 vs 09 vs 01 | LOW |
| `in_progress -> applied` transition ownership | 08 vs 09 | MEDIUM |
| Requirement hash normalization must be shared | 09 vs 03 | LOW |
| `resolveWikilinkToId()` vs `resolveWikilink()` method name | 08 vs 04 vs 09 | LOW |

---

## Overview.md Limitation Notes

1. **Overview.md does not define what `planned` + no unchecked tasks means.** The next-action pseudocode assumes tasks exist at `planned` stage (since Tasks >= 1 is a hard prerequisite for planned). Plan 08 handles this gracefully but it's an undocumented extension.

2. **Overview.md does not specify section-level stale detection.** Plan 09 correctly omits it but this leaves a gap for concurrent section modifications.

3. **Overview.md does not define the apply execution model** (agent-driven vs programmatic). Plan 09 makes the right architectural call (hybrid) but this should be captured back into overview.md as a design decision.

4. **Overview.md's Delta Summary example is inconsistent** about whether ADDED entries include `[base: n/a]` or not (lines 1146 vs 1148).

---

## Summary

| Plan | Rating | Critical Issues | Blocking Issues |
|------|--------|----------------|-----------------|
| 08-workflow-continue | STRONG | 0 | 0 |
| 09-workflow-apply | VERY STRONG | 0 | 1 (ISSUE-09-04: rollback strategy) |

**Overall assessment:** Both plans are well-crafted and demonstrate thorough understanding of both OpenSpec's implementation and overview.md's contracts. Plan 09 is particularly impressive in its treatment of the atomic apply order, stale detection, and operation validation matrix.

**Top 3 items to address before implementation:**

1. **ISSUE-09-04:** Define an explicit two-phase commit pattern for apply to prevent partial vault corruption on multi-Feature changes.
2. **ISSUE-09-05:** Resolve the `in_progress -> applied` transition ownership between plans 08 and 09 -- exactly one module should own this transition.
3. **ISSUE-09-01/08-04:** Fix the `IndexStore` vs `VaultIndex` naming inconsistency before both plans hit implementation.
