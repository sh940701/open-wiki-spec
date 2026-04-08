# V3 Review: Plans 08-09 (Continue & Apply Workflows)

**Reviewer:** Devil's Advocate Agent (Round 3)
**Date:** 2026-04-06
**Files Reviewed:**
- `plans/08-workflow-continue.md`
- `plans/09-workflow-apply.md`

**Cross-references checked:**
- `overview.md` sections 6.2C, 10.3, 10.5.1, 10.8, 14.2, 15
- `plans/00-unified-types.md` (NextAction, Ownership Rules, DeltaSummaryEntry, SequencingResult)
- `plans/06-sequencing-engine.md` (dependency resolution, stale detection, touches severity)
- `plans/10-workflow-verify.md` (post-apply verification)
- OpenSpec sources: `continue-change.ts`, `apply-change.ts`, `specs-apply.ts`, `requirement-blocks.ts`
- Previous reviews: `plans/reviews/review-08-09.md`, `plans/reviews-v2/review-08-09.md`

---

## V2 Issue Resolution Status

### ISSUE-V2-08-01: NextAction type mismatch between plan 08 and unified types -- RESOLVED

Plan 08's discriminated union (lines 169-179) uses rich types (`SectionTarget`, `TaskTarget`, `GatheredContext`), while unified types (00-unified-types.md lines 358-374) uses a simpler interface with `target?: string`. The plans now coexist by treating:
- **Unified types**: the cross-plan public contract (what plans 10, 12 consume)
- **Plan 08 internal types**: the rich internal implementation types

However, the resolution is implicit rather than explicit -- see ISSUE-V3-08-01 below for the remaining gap.

### ISSUE-V2-09-01: `verifyApply()` passes same note as both original and updated -- RESOLVED

Plan 09 now documents that `verifyApply()` uses `base_fingerprint` from the `DeltaEntry` for MODIFIED hash comparison (lines 1489-1503). The `postValidate()` call at line 1491 still passes `updatedNote` for both parameters, but the MODIFIED no-op check at lines 1499-1503 is the actual enforcement mechanism, comparing the current hash against `base_fingerprint`. This is architecturally correct: the agent should have changed the requirement body, so its hash should differ from the pre-change `base_fingerprint`.

**Remaining concern:** See ISSUE-V3-09-01 for a subtle problem with this approach.

### ISSUE-V2-09-02: Mechanical + agent-driven interleaving on same Feature -- RESOLVED

The two-phase commit pattern (lines 1116-1140) now explicitly documents the Phase A/B/C model. Mechanical ops (RENAMED, REMOVED) are written in Phase 2. Agent-driven ops occur in Phase B (after Phase 2). The agent reads the already-updated Feature content after Phase 2 writes. Test strategy covers this at lines 1729-1733.

### ISSUE-V2-08-02: `start_implementation` -> `planned -> in_progress` transition trigger -- PARTIALLY RESOLVED

The transition table at line 664-665 documents when the transition happens, and `executeTransition()` at lines 620-658 has the gate logic. But the **orchestrator glue** -- the code that calls `nextAction()`, inspects the result, calls `executeTransition()` when needed, and then presents to the agent -- is still only implied by `formatContinueResult()`. See ISSUE-V3-08-02 for why this still matters.

---

## New Issues Found in V3 Review

### ISSUE-V3-08-01: Unified `NextAction` is consumed but never produced by plan 08 [MEDIUM]

**Location:** Plan 08 lines 169-184 vs 00-unified-types.md lines 358-374

The unified types define:
```typescript
interface NextAction {
  action: NextActionType;
  target?: string;
  to?: ChangeStatus;
  reason?: string;
  blockers?: string[];
}
```

Plan 08 defines an entirely different shape:
```typescript
type NextAction =
  | { action: "fill_section"; target: SectionTarget; context: GatheredContext }
  | { action: "transition"; to: "planned"; context: GatheredContext }
  | ...
```

The V2 review flagged this and the resolution was "the unified type is the public contract." But **plan 08 never shows a conversion function** from its internal rich `NextAction` to the unified `NextAction`. If plan 10 (verify) or plan 12 (CLI) imports `NextAction` from unified types and plan 08 returns its own shape, TypeScript compilation fails.

**Recommendation:** Add an explicit `toPublicNextAction(internal: InternalNextAction): NextAction` function in plan 08's public API. This makes the boundary explicit and prevents downstream consumers from accidentally depending on internal types. Alternatively, update unified types to use the discriminated union (but this forces all consumers to handle the rich shape).

### ISSUE-V3-08-02: Continue workflow orchestrator logic is implicit [MEDIUM]

**Location:** Plan 08 does not have an explicit orchestrator pseudocode

The plan shows:
1. `selectChange()` -- Step 1
2. `analyzeChangeSections()` -- Step 2
3. `nextAction()` -- Step 4
4. `executeTransition()` -- Step 8
5. `formatContinueResult()` -- Step 9

But the `continueChange()` entry point (line 830) only declares the signature. The critical orchestration logic is missing:

```
// What SHOULD be documented but isn't:
function continueChange(vaultIndex, options):
  change = selectChange(vaultIndex, options.changeName)
  analysis = analyzeChangeSections(change)
  action = nextAction(change, analysis, vaultIndex)

  // CRITICAL: when does executeTransition() get called?
  if action.action == "transition":
    executeTransition(change, action.to, vaultIndex)
  if action.action == "start_implementation":
    executeTransition(change, "in_progress", vaultIndex)  // implicit!

  // Decision promotion -- when?
  promotion = checkDecisionPromotion(change, analysis)
  if promotion:
    // ... create Decision note, update links ...

  return formatContinueResult(result)
```

The most dangerous gap: **`start_implementation` implies a `planned -> in_progress` transition**, but nowhere does the plan show that `continueChange()` calls `executeTransition("in_progress")` when it receives `start_implementation`. The formatter (line 783) says "Starting implementation will transition status to 'in_progress'" -- but that's a message to the user, not executable code.

**Risk:** An implementer could miss the implicit transition and leave the Change at `planned` status even as the agent starts working on tasks.

**Recommendation:** Add explicit orchestrator pseudocode for `continueChange()` showing the full flow including when transitions are triggered and when decision promotion runs.

### ISSUE-V3-09-01: `verifyApply()` MODIFIED hash check is fundamentally flawed [HIGH]

**Location:** Plan 09, lines 1489-1503

The `verifyApply()` function calls:
```typescript
const postResults = postValidate(entries, updatedNote, updatedNote);
```

Then checks MODIFIED no-ops:
```typescript
if (pv.entry.op === 'MODIFIED' && pv.hashChanged === false) {
  errors.push(`MODIFIED ... content_hash unchanged (no-op)`);
}
```

But look at `postValidate()` (lines 940-943, 971-982): for MODIFIED entries, it computes:
```typescript
const original = originalReqs.get(entry.targetName);
const updated = currentReqs.get(entry.targetName);
const hashChanged = original && updated
  ? computeRequirementHash(original) !== computeRequirementHash(updated)
  : true;
```

Since `updatedNote` is passed as both `updatedFeatureNote` AND `originalFeatureNote`, `original` and `updated` are the SAME requirement object from the SAME parsed note. Therefore `computeRequirementHash(original) !== computeRequirementHash(updated)` is ALWAYS `false`, and `hashChanged` is ALWAYS `false`.

This means every MODIFIED operation verified through `verifyApply()` will ALWAYS fail with a "content_hash unchanged" error, even when the agent correctly modified the requirement.

The V2 review said this was "resolved" by using `base_fingerprint` from `DeltaEntry`, but the actual code at lines 1499-1503 does NOT use `base_fingerprint` -- it relies on `postValidate()`'s `hashChanged` field, which compares the note against itself.

**Recommendation:** `verifyApply()` must NOT use the generic `postValidate()` for agent-driven ops. Instead, implement a dedicated check:

```typescript
function verifyAgentEdits(entries: DeltaEntry[], updatedNote: ParsedNote): PostValidation[] {
  const currentReqs = parseRequirementsSection(updatedNote.rawContent);

  for (const entry of entries) {
    if (entry.op === 'MODIFIED') {
      const req = currentReqs.get(entry.targetName);
      if (!req) { /* error: requirement missing */ }
      const currentHash = computeRequirementHash(req);
      // Compare against base_fingerprint, NOT against the same note
      const hashChanged = currentHash !== entry.baseFingerprint;
      if (!hashChanged) { /* warning: no-op */ }
    }
    if (entry.op === 'ADDED') {
      const exists = currentReqs.has(entry.targetName);
      if (!exists) { /* error: requirement not created */ }
    }
  }
}
```

This is a **correctness bug** that will block every apply workflow that includes MODIFIED operations.

### ISSUE-V3-09-02: Two-phase commit does not protect against agent-phase failures [MEDIUM]

**Location:** Plan 09, lines 1116-1140, 1420-1453

The two-phase commit pattern protects Phase 1 (validate) and Phase 2 (write mechanical ops). But the overall workflow has THREE phases:

```
Phase A: applyChange() validates + writes RENAMED/REMOVED -> Feature on disk
Phase B: Agent performs MODIFIED/ADDED content edits -> Feature on disk
Phase C: verifyApply() checks postconditions -> status transition
```

If Phase B fails (agent crashes, writes incorrect content, partial edit), the vault is in an inconsistent state:
- RENAMED/REMOVED ops are already written to disk (Phase A completed)
- MODIFIED/ADDED ops are incomplete or incorrect
- Status is NOT `applied` (Phase C hasn't run)

The Feature is now in a half-modified state: some requirements are renamed/removed but the modifications and additions haven't happened.

**Risk:** There is no rollback mechanism. The plan does not store the original Feature content to enable recovery.

**Recommendation:**
1. Store original Feature content (or a copy of the file) before Phase A writes.
2. Document the recovery procedure: if Phase B fails, the user can restore from the stored original.
3. Alternatively, defer ALL disk writes (including mechanical ops) until Phase C, but this means the agent would need to work against computed content rather than the actual file on disk.

For v1, option 1 (store + document recovery) is pragmatic. Option 3 is architecturally cleaner but more complex.

### ISSUE-V3-09-03: Delta Summary regex does not handle multi-line descriptions or trailing content [LOW]

**Location:** Plan 09, lines 458-465

The REQUIREMENT_OP_RE regex:
```
/^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/
```

And SECTION_OP_RE:
```
/^-\s+(ADDED|MODIFIED|REMOVED)\s+section\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?::\s*(.+))?/
```

Issues:
1. `([^\]]+)` for wikilink content -- this fails if the wikilink contains `]` (rare but possible with aliases: `[[Feature: Auth Login|Auth]]` would not be parsed correctly since `|Auth]]` contains `]`).
2. The MODIFIED requirement regex does not capture a description suffix. Overview.md section 14.2 shows: `MODIFIED requirement "Password Login" in [[Feature: Auth Login]]: added recovery scenario [base: sha256:def456...]`. The colon-description comes BEFORE `[base:]`, but the regex expects `[base:]` immediately after `]]`.
3. The SECTION_OP_RE captures the description `(.+)` after `:` but the REQUIREMENT_OP_RE has no description field at all.

Looking at the overview.md example at line 1174:
```
- MODIFIED requirement "Password Login" in [[Feature: Auth Login]]: added recovery scenario [base: sha256:def456...]
```

The regex will fail here because `: added recovery scenario` appears between `]]` and `[base:`.

**Recommendation:** Update REQUIREMENT_OP_RE to handle an optional description between the wikilink and the base fingerprint:
```
/^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?::\s*([^[]+?))?(?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/
```

And use `\[\[([^\]|\]]+(?:\|[^\]]+)?)\]\]` for wikilink parsing to handle display aliases.

### ISSUE-V3-08-03: `checkDependsOn()` in plan 08 duplicates plan 06's sequencing engine [MEDIUM]

**Location:** Plan 08, lines 676-729

Plan 08 implements a full `checkDependsOn()` function with:
- Wikilink resolution
- Status checking
- Sequencing error detection

But plan 06 (sequencing engine) already implements the canonical dependency resolution and produces `OrderedChange[]` with `blocked_by` fields, `OutOfOrderError[]` for sequencing errors, and per-change `PerChangeSequencingResult`. Plan 08's dependency table (line 884) says it depends on plan 06 for `checkDependsOn()`, but then implements its own version.

The ownership table in unified types (line 383-384) says:
```
| Status transition (planned->in_progress) | workflow-continue (08) | workflow-apply (09) |
```

But it does NOT grant plan 08 ownership of dependency resolution. Plan 06 owns conflict detection and ordering.

**Risk:** Two implementations of `depends_on` resolution logic diverge over time. Plan 06's version has richer semantics (topological depth, cycle detection, stale base integration). Plan 08's version is simpler but misses edge cases like cycle detection.

**Recommendation:** Plan 08 should call plan 06's sequencing engine to get `PerChangeSequencingResult` for the target change, then inspect `blocked_by` from that result. The `checkDependsOn()` in plan 08 should be a thin wrapper that delegates to plan 06, not a reimplementation.

### ISSUE-V3-09-04: `DeltaEntry` vs unified `DeltaSummaryEntry` type divergence [LOW]

**Location:** Plan 09 lines 260-281 vs 00-unified-types.md lines 104-120

Plan 09 defines:
```typescript
interface DeltaEntry {
  op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  targetType: 'requirement' | 'section';
  targetName: string;
  newName?: string;
  targetNote: string;
  targetNoteId?: string;
  baseFingerprint: string | null;
  description?: string;
  rawLine: string;
}
```

Unified types define:
```typescript
interface DeltaSummaryEntry {
  op: DeltaOp;
  target_type: DeltaTargetType;
  target_name: string;
  new_name?: string;
  target_note_id: string;
  base_fingerprint: string | null;
  description?: string;
}
```

Naming differences:
- `targetType` vs `target_type` (camelCase vs snake_case)
- `targetName` vs `target_name`
- `newName` vs `new_name`
- `targetNote` (raw wikilink) not in unified types
- `targetNoteId?` (optional) vs `target_note_id` (required)
- `rawLine` not in unified types
- `baseFingerprint` vs `base_fingerprint`

**Risk:** This is the same conceptual type defined twice with different naming conventions. If the index engine (plan 04) stores `DeltaSummaryEntry` and plan 09 parses `DeltaEntry`, a mapping function is needed but not defined.

**Recommendation:** Choose one naming convention. The unified types use snake_case (consistent with frontmatter YAML keys), while plan 09 uses camelCase (TypeScript convention). Either is fine, but the mapping must be explicit. Add a `toDeltaSummaryEntry(entry: DeltaEntry): DeltaSummaryEntry` utility.

### ISSUE-V3-09-05: Section operations lack atomicity ordering [LOW]

**Location:** Plan 09, lines 1014-1105

The `applySectionOps()` function processes section entries in the order they appear in the Delta Summary. But there is no atomic ordering defined for section operations equivalent to the RENAMED -> REMOVED -> MODIFIED -> ADDED order for requirements.

Consider: a Change that both REMOVES section "Old Behavior" and ADDS section "Current Behavior" in the same Feature. If processed in document order and ADDED comes first, the section count grows before REMOVED shrinks it. This is functionally harmless in this case but the lack of ordering contract means behavior depends on how the user wrote the Delta Summary.

Overview.md section 14.2 defines atomic apply order only for requirement operations. Section operations are not mentioned in the ordering contract.

**Recommendation:** Accept this as a v1 limitation. Document that section operations are processed in document order (top-to-bottom in Delta Summary). Consider adding atomic ordering for section ops in v2 if conflicts emerge in practice.

### ISSUE-V3-08-04: Decision promotion regex heuristics are fragile [LOW]

**Location:** Plan 08, lines 573-606

The promotion criteria use keyword regex matching:
```typescript
hardToReverse: /\b(migration|irreversible|cannot revert|breaking change|data loss|schema change|backward compatibility)\b/i.test(content),
durableRationale: /\b(chose|decided|rationale|trade-?off|alternative considered|versus|vs\.?|long-term|future-proof)\b/i.test(content),
```

False positives: a Design Approach that says "this is NOT a migration" or "unlike the alternative considered for Y, we kept the simple approach" would trigger promotion. The regex has no negation awareness.

False negatives: the word "picked" (synonym of "chose") or "reversing this would require" (semantically irreversible but not matching any keyword) would miss promotion.

**Risk:** This is a known limitation of keyword-based heuristics. In v1, false positives are safer than false negatives (suggesting unnecessary promotion is less harmful than missing a needed one). But the user may get annoyed by frequent false-positive suggestions.

**Recommendation:** Accept for v1 but add a "dismiss" mechanism so the user can mark a Design Approach as "promotion checked, not needed." This could be a simple comment convention like `<!-- no-promotion -->` in the Design Approach section.

---

## Cross-Plan Consistency Check (V3)

| Check | Status | Detail |
|-------|--------|--------|
| `VaultIndex` naming (08, 09, 04) | PASS | All consistent |
| File path structure `src/core/workflow/` | PASS | Both plans aligned |
| `in_progress -> applied` sole owner = plan 09 | PASS | Plan 08 line 629: `in_progress: []`, plan 09 line 1163: sole gate |
| `proposed -> planned` can be 07 or 08 | PASS | Unified types line 380 allows both |
| `planned -> in_progress` owned by 08 | PASS | Unified types line 381 |
| NextAction shape: plan 08 vs unified types | FAIL | Structural mismatch; no conversion shown (V3-08-01) |
| `checkDependsOn()` owner: 08 vs 06 | FAIL | Plan 08 reimplements instead of calling plan 06 (V3-08-03) |
| `DeltaEntry` vs `DeltaSummaryEntry` | FAIL | Naming divergence without mapping (V3-09-04) |
| `verifyApply()` MODIFIED correctness | FAIL | Same-note comparison bug (V3-09-01) |
| Two-phase commit for mechanical ops | PASS | Explicit Phase 1/2 in plan 09 |
| Agent-phase failure recovery | FAIL | No rollback for partial Phase B failure (V3-09-02) |
| `archiveChange()` index invalidation | PASS | Returns `indexInvalidated: true` |
| Stale detection uses same hash as plan 03 | UNCLEAR | Both reference `computeContentHash` from `util/hash` but normalization alignment is not verified |
| Section op ordering contract | NOT DEFINED | Acceptable for v1 (V3-09-05) |

---

## Overview.md Compliance Check (V3)

### Section 15: Next-Action Algorithm

| Requirement | Plan 08 Status | Detail |
|-------------|---------------|--------|
| `proposed` -> check prerequisites -> fill_section or transition | PASS | Lines 390-400, exact match |
| `planned` -> check depends_on -> blocked or start_implementation | PASS | Lines 403-424, with documented extension for edge case |
| `in_progress` -> unchecked tasks -> continue_task or transition to applied | MODIFIED | Lines 426-433; plan 08 returns `ready_to_apply` instead of `transition to applied`, correctly deferring to plan 09 |
| `applied` -> verify_then_archive | PASS | Lines 435-436 |

The `in_progress` branch divergence is deliberate and correct: overview.md says `return { action: "transition", to: "applied" }` but the ownership model requires plan 09 to execute this transition. Plan 08's `ready_to_apply` is the appropriate adaptation. However, **this divergence from overview.md's pseudocode is not explicitly documented as an adaptation** in plan 08.

**Recommendation:** Add a comment at the `ready_to_apply` return site explaining this is an intentional deviation from overview.md section 15's pseudocode, driven by the ownership split documented in unified types.

### Section 15: Section-Completeness Contract

| Requirement | Status | Detail |
|-------------|--------|--------|
| Why non-empty | PASS | Line 346 |
| Delta Summary >= 1 entry | PASS | Line 347 |
| Tasks >= 1 item | PASS | Line 348 |
| Validation non-empty | PASS | Line 349 |
| Design Approach soft prereq | PASS | Lines 353-355, with N/A handling |
| Decision link soft prereq (conditional) | PASS | Lines 370-378, with keyword detection |

### Section 14.2: Atomic Apply Order

| Requirement | Plan 09 Status | Detail |
|-------------|---------------|--------|
| RENAMED first | PASS | Priority 1 (line 807) |
| REMOVED second | PASS | Priority 2 (line 808) |
| MODIFIED third | PASS | Priority 3 (line 809) |
| ADDED fourth | PASS | Priority 4 (line 810) |

### Section 10.8: Stale Detection

| Requirement | Plan 09 Status | Detail |
|-------------|---------------|--------|
| Compare base_fingerprint vs current content_hash | PASS | Lines 654-727 |
| ADDED has no base to check | PASS | Lines 657-663 |
| Mismatch blocks auto-apply | PASS | Lines 1250-1269 |
| User can force with confirmation | PASS | `forceStale` option, line 1250 |

### Section 10.8: Operation Validation Matrix

| Operation | Before Apply | After Apply | Plan 09 Status |
|-----------|-------------|-------------|---------------|
| ADDED | MUST NOT exist | MUST exist | PASS (pre: 894, post: 953) |
| MODIFIED | MUST exist | MUST exist + hash changed | PASS (pre: 903, post: 964) |
| REMOVED | MUST exist | MUST NOT exist | PASS (pre: 911, post: 987) |
| RENAMED | old MUST exist, new MUST NOT | old MUST NOT, new MUST | PASS (pre: 920, post: 996) |

### Section 6.2C: Hybrid Lifecycle

| Requirement | Plan 09 Status | Detail |
|-------------|---------------|--------|
| Applied Change stays in 04-changes/ | PASS | Lines 1432-1438 |
| Archive is separate action | PASS | `archiveChange()` at lines 1543-1594 |
| id preserved after move | PASS | Line 1535 comment |
| Collision check before move | PASS | Lines 1571-1578 |

---

## OpenSpec Fidelity Check (V3)

### `buildUpdatedSpec()` Adaptation

OpenSpec's `buildUpdatedSpec()` is a fully programmatic delta merger that reads complete requirement blocks from delta spec files and performs mechanical substitution. Plan 09 correctly identifies the architectural difference:

- OpenSpec: full requirement blocks in delta files -> programmatic merge
- open-wiki-spec: one-line Delta Summary entries -> agent-driven content editing

Plan 09's adaptation is sound: RENAMED and REMOVED are programmatic (mechanical), MODIFIED and ADDED are agent-driven (require content that the Delta Summary doesn't contain). This is the correct architectural choice given that Delta Summary entries are compact descriptions, not full replacement content.

### `parseDeltaSpec()` Grammar Adaptation

OpenSpec parses sections like `## ADDED Requirements`, `## MODIFIED Requirements`, etc. Plan 09 parses individual list items like `- ADDED requirement "name" to [[Feature]]`. The grammar transformation is correct for the inline Delta Summary format.

### `extractRequirementsSection()` Adaptation

OpenSpec's `extractRequirementsSection()` (from `requirement-blocks.ts`) splits a spec into before/headerLine/preamble/bodyBlocks/after. Plan 09's `parseRequirementsSection()` function is referenced but not shown in detail. It should produce an equivalent structure. The `RequirementsMap` type (line 815) implies a Map keyed by requirement name, which matches OpenSpec's `nameToBlock` pattern.

### Archive Adaptation

OpenSpec's `archive-change.ts` does immediate directory move. Plan 09's `archiveChange()` correctly implements the hybrid lifecycle: status-first (keep in `04-changes/` with `applied`), then explicit archive move to `99-archive/`. This is a deliberate divergence from OpenSpec, correctly specified in overview.md section 6.2C.

---

## Summary

| Plan | Rating | V2 Issues | Resolved | New V3 Issues | Severity Breakdown |
|------|--------|-----------|----------|---------------|-------------------|
| 08-workflow-continue | STRONG | 2 | 1.5/2 | 4 | 2 MEDIUM, 2 LOW |
| 09-workflow-apply | STRONG (was VERY STRONG) | 2 | 1/2 | 4 | 1 HIGH, 1 MEDIUM, 2 LOW |

**Downgrade explanation for plan 09:** The `verifyApply()` MODIFIED hash comparison bug (V3-09-01) is a correctness issue that will cause every apply workflow with MODIFIED operations to fail. This is not an edge case -- MODIFIED is likely the most common Delta Summary operation.

### Top Items to Address Before Implementation (Priority Order)

1. **ISSUE-V3-09-01 (HIGH):** Fix `verifyApply()` MODIFIED hash comparison. The current code compares the updated note against itself, guaranteeing `hashChanged: false` for every MODIFIED operation. Replace `postValidate()` in `verifyApply()` with a dedicated function that compares the current requirement hash against `base_fingerprint` from the `DeltaEntry`.

2. **ISSUE-V3-09-02 (MEDIUM):** Address agent-phase failure recovery. If the agent crashes or writes incorrect content during Phase B, RENAMED/REMOVED ops are already on disk with no way to rollback. At minimum, store original Feature content before Phase A writes and document the recovery procedure.

3. **ISSUE-V3-08-03 (MEDIUM):** `checkDependsOn()` in plan 08 should delegate to plan 06's sequencing engine, not reimplement dependency resolution. This prevents divergence and gains plan 06's richer semantics (cycle detection, topological depth).

4. **ISSUE-V3-08-01 (MEDIUM):** Add an explicit conversion function from plan 08's rich internal `NextAction` to the unified types `NextAction`. Without this, TypeScript compilation will fail when downstream plans import the unified type.

5. **ISSUE-V3-08-02 (MEDIUM):** Add explicit orchestrator pseudocode for `continueChange()` showing when `executeTransition()` is called relative to `nextAction()` results. The `start_implementation -> planned -> in_progress` transition is currently implicit.

6. **ISSUE-V3-09-03 (LOW):** Fix Delta Summary regex to handle description text between wikilink and `[base:]` suffix, per overview.md section 14.2's own example.

7. **ISSUE-V3-09-04 (LOW):** Add explicit mapping between plan 09's `DeltaEntry` (camelCase) and unified types' `DeltaSummaryEntry` (snake_case).

8. **ISSUE-V3-09-05 (LOW):** Document that section operations are processed in document order (no atomic ordering contract for v1).

9. **ISSUE-V3-08-04 (LOW):** Accept keyword regex heuristics for decision promotion in v1, but consider adding a `<!-- no-promotion -->` dismissal mechanism to reduce false-positive friction.

### Overall Assessment

Both plans demonstrate strong understanding of the OpenSpec source, overview.md contracts, and the architectural adaptations needed for the Obsidian-native model. The two-phase commit pattern, ownership split, and hybrid lifecycle are all well-designed.

The critical remaining issue is ISSUE-V3-09-01: the `verifyApply()` bug will block the most common apply scenario (MODIFIED operations). This must be fixed before implementation. After that fix, the `checkDependsOn()` delegation to plan 06 (V3-08-03) and the agent-phase failure recovery (V3-09-02) are the highest-leverage improvements.

The LOW-severity items are all acceptable for v1 and can be deferred to a polish pass.
