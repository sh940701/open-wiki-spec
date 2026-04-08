# V4 Review: Plans 08-09 (Continue & Apply Workflows)

**Reviewer:** Devil's Advocate Agent (Round 4)
**Date:** 2026-04-06
**Files Reviewed:**
- `plans/08-workflow-continue.md`
- `plans/09-workflow-apply.md`

**Cross-references checked:**
- `overview.md` sections 6.2C, 10.3, 10.5.1, 10.8, 14.2, 15
- `plans/00-unified-types.md` (NextAction, Ownership Rules, DeltaSummaryEntry, SequencingResult, Parser/Index API Boundary)
- `plans/06-sequencing-engine.md` (dependency resolution, stale detection, touches severity)
- `plans/10-workflow-verify.md` (post-apply verification, operation validation matrix delegation)
- OpenSpec sources: `continue-change.ts`, `apply-change.ts`, `specs-apply.ts`, `sync-specs.ts`, `requirement-blocks.ts`
- Previous reviews: `reviews/review-08-09.md`, `reviews-v2/review-08-09.md`, `reviews-v3/review-08-09.md`

---

## V3 Issue Resolution Status

### ISSUE-V3-08-01: Unified `NextAction` consumed but never produced -- RESOLVED

Plan 08 now includes an explicit `toPublicNextAction(internal: NextAction): PublicNextAction` conversion function (lines 252-295). The function maps each discriminated union variant to the flat unified type shape. The naming convention (`PublicNextAction` alias) avoids collision with the internal type. The `ContinueResult.nextAction` field (line 307) is typed as `PublicNextAction`, confirming cross-plan consumers receive the correct shape.

### ISSUE-V3-08-02: Orchestrator logic implicit -- RESOLVED

Plan 08 now includes full orchestrator pseudocode in the `continueChange()` function (lines 884-949). This explicitly shows:
- When `executeTransition()` is called for `"transition"` results (line 900)
- The implicit `planned -> in_progress` transition on `"start_implementation"` (lines 905-912)
- That `"ready_to_apply"` does NOT trigger a transition (lines 914-917)
- Decision promotion as a post-processing step (lines 926-933)
- Conversion to public NextAction and result assembly (lines 935-949)

The `start_implementation` transition is now documented with a comment explaining the intentional adaptation from overview.md section 15.

### ISSUE-V3-08-03: `checkDependsOn()` reimplements plan 06 -- RESOLVED

Plan 08 now delegates to `sequencingEngine.analyzeSequencing()` (lines 737-793). The function calls `analyzeSequencing(vaultIndex, [changeNote])` per the unified types API boundary (00-unified-types.md line 440), extracts the per-change result from `sequencingResult.ordering`, and checks `blocked_by`, `out_of_order_errors`, and `cycles`. The implementation is a thin wrapper, not a reimplementation.

The ownership table in unified types (line 394) is referenced: "checkDependsOn in continue | sequencing-engine (06) | workflow-continue (08) -- must call, not reimplement."

### ISSUE-V3-09-01: `verifyApply()` MODIFIED hash check fundamentally flawed -- RESOLVED

Plan 09 now implements a dedicated verification approach (lines 1501-1615) that does NOT use the generic `postValidate()` for agent-driven ops. Key changes:

1. **Pre-edit snapshot** (lines 1412-1429): Before returning `pendingAgentOps`, the orchestrator snapshots each Feature's requirement content_hashes into `preEditSnapshots: Map<string, Map<string, string>>`.

2. **Snapshot-based comparison** in `verifyApply()` (lines 1566-1573): For MODIFIED ops, the function compares the current hash against the snapshot hash (taken before the agent edited), not against the note itself. It also performs a secondary check against `base_fingerprint`.

3. The `ApplyResult` type now includes `preEditSnapshots` (lines 428-429) so the caller can pass them to `verifyApply()`.

4. Extensive documentation (lines 1507-1521) explains why the generic `postValidate()` cannot be used and how the snapshot approach works.

This is a correct fix. The snapshot captures pre-agent-edit state, and the comparison detects whether the agent actually changed the content.

### ISSUE-V3-09-02: Agent-phase failure recovery -- RESOLVED

Plan 09 now includes a full "Agent-Phase (Phase B) Failure Recovery" section (lines 1618-1644). Key points:

1. **Detection**: Change remains `in_progress` with pending ops; re-running apply detects this.
2. **Re-run strategy**: RENAMED/REMOVED are idempotent (already-applied state passes pre-validation). MODIFIED/ADDED agent ops get fresh `pendingAgentOps`.
3. **Manual recovery**: User can `git checkout` to restore Feature files.
4. **Design rationale**: v1 relies on git as the recovery mechanism; v2 may add explicit backup/restore.

This is pragmatic and sufficient for v1. The idempotency analysis for RENAMED/REMOVED is correct.

### ISSUE-V3-09-03: Delta Summary regex description handling -- RESOLVED

Plan 09's REQUIREMENT_OP_RE (line 484) now correctly handles the grammar. Looking at the regex:
```
/^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/
```

**Wait -- this is actually NOT fully resolved.** The regex still does not handle a description between `]]` and `[base:]`. The overview.md example at line 1176 shows:
```
- MODIFIED requirement "Password Login" in [[Feature: Auth Login]]: added recovery scenario [base: sha256:def456...]
```
The `: added recovery scenario` between `]]` and `[base:]` will cause the regex to fail to capture `[base:]`. See ISSUE-V4-09-01 below.

### ISSUE-V3-09-04: `DeltaEntry` vs `DeltaSummaryEntry` type divergence -- RESOLVED

Plan 09 now includes an explicit `toDeltaSummaryEntry()` mapping function documented in the `DeltaEntry` JSDoc comment (lines 266-278). The comment explains the naming convention difference (camelCase for TypeScript internals vs snake_case for unified types/YAML) and shows the exact mapping. Plan 04 (index-engine) stores `DeltaSummaryEntry`; plan 09 parses `DeltaEntry` internally; the mapping runs at the boundary.

### ISSUE-V3-09-05: Section operations lack atomicity ordering -- ACCEPTED

Plan 09 does not add atomic ordering for section ops. This was accepted as a v1 limitation in V3. No change needed.

### ISSUE-V3-08-04: Decision promotion regex heuristics fragile -- ACCEPTED

No changes from V3. Accepted as v1 limitation.

---

## New Issues Found in V4 Review

### ISSUE-V4-09-01: REQUIREMENT_OP_RE regex still fails on description-bearing MODIFIED entries [MEDIUM]

**Location:** Plan 09, line 484

The V3 review flagged this (V3-09-03) but it is NOT fully resolved. The regex:

```
/^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?/
```

The overview.md canonical example (line 1176) uses:
```
- MODIFIED requirement "Password Login" in [[Feature: Auth Login]]: added recovery scenario [base: sha256:def456...]
```

The `: added recovery scenario` text between `]]` and `[base:]` is not handled. The regex expects `[base:]` to immediately follow `]]` (with only optional whitespace). When the description text is present, the `[base:]` group will not match, and `baseFingerprint` will be `null` even though the entry has one.

This is not a parsing crash -- the entry will still be parsed (op, targetName, targetNote are captured) -- but the `baseFingerprint` will be silently lost. At apply time, stale detection will skip this entry (since `baseFingerprint` is null), defeating the safety mechanism for the most common operation type.

**Impact:** MODIFIED entries with descriptions will bypass stale detection silently.

**Recommendation:** Update the regex to capture an optional description between `]]` and `[base:]`:

```
/^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?::\s*([^[]*?))?(?:\s*\[base:\s*((?:sha256:[a-f0-9]+)|n\/a)\])?$/
```

Add the captured description to `DeltaEntry.description` for requirement ops too, not just section ops.

### ISSUE-V4-09-02: `verifyApply()` snapshot-based MODIFIED check has an AND-logic flaw [MEDIUM]

**Location:** Plan 09, lines 1571-1573

The current logic:
```typescript
const changedFromSnapshot = snapshotHash ? currentHash !== snapshotHash : true;
const changedFromBase = entry.baseFingerprint ? currentHash !== entry.baseFingerprint : true;
const hashChanged = changedFromSnapshot && changedFromBase;
```

This uses AND logic: the hash must differ from BOTH the snapshot AND the base_fingerprint. Consider this scenario:

1. Requirement starts with hash A (= base_fingerprint).
2. Another change modifies it to hash B before this apply runs.
3. The snapshot captures hash B (pre-agent-edit).
4. The agent modifies it to hash C.

Result: `changedFromSnapshot = (C !== B) = true`, `changedFromBase = (C !== A) = true`, `hashChanged = true`. Correct.

But consider a legitimate edge case:

1. Requirement starts with hash A (= base_fingerprint).
2. No other change touches it, so snapshot also captures hash A.
3. The agent modifies it to hash C.

Result: `changedFromSnapshot = (C !== A) = true`, `changedFromBase = (C !== A) = true`, `hashChanged = true`. Correct.

Now the problematic case:

1. Requirement starts with hash A (= base_fingerprint).
2. Stale detection was forced (`forceStale`). Another change modified to hash B. base_fingerprint = A, snapshot = B.
3. The agent "modifies" by setting content back to the original (hash A) -- effectively reverting the other change's work.

Result: `changedFromSnapshot = (A !== B) = true`, `changedFromBase = (A !== A) = false`, `hashChanged = false`. The agent DID change the content (from B to A), but verification reports it as a no-op.

**Impact:** When `forceStale` is used and the agent's edit happens to restore the original base content, `verifyApply()` incorrectly reports a no-op failure. This is an edge case that only occurs with forced stale applies, but the AND-logic is semantically wrong.

**Recommendation:** Use OR logic instead:
```typescript
const hashChanged = changedFromSnapshot || changedFromBase;
```
Wait -- that's wrong too (always true if base differs from snapshot). The correct approach: `verifyApply()` should ONLY compare against the snapshot, since the snapshot is the definitive pre-agent-edit state. The `base_fingerprint` check is for stale detection (already done in Phase A), not for post-edit verification:

```typescript
const hashChanged = snapshotHash ? currentHash !== snapshotHash : true;
// base_fingerprint comparison is irrelevant here -- stale detection already ran
```

### ISSUE-V4-08-01: `continueChange()` orchestrator has a self-reference in result construction [LOW]

**Location:** Plan 08, line 946

```
result = {
  ...
  summary: formatContinueResult(result),  // <-- self-reference!
}
```

`formatContinueResult(result)` references `result` which is being constructed in the same expression. In JavaScript/TypeScript this would be a `ReferenceError` because `result` is not yet defined when the right-hand side evaluates.

**Recommendation:** Build the result first without `summary`, then assign summary:

```
result = { changeName, changeId, currentStatus, nextAction: publicAction, context, summary: "" }
result.summary = formatContinueResult(result)
```

Or call `formatContinueResult()` with the individual fields rather than the assembled result object.

### ISSUE-V4-08-02: `gatherContext()` reads sources but plan 08 does not use them in any decision logic [INFO]

**Location:** Plan 08, lines 556-564

`gatherContext()` reads linked Source notes and adds them to `GatheredContext.sources`. However, no part of the continue workflow (nextAction, prerequisites, decision promotion, transition logic) uses Source note content for any decision. Sources are gathered and returned to the agent but never inspected programmatically.

This is not a bug -- passing Sources to the agent for context is useful. But it means Source-related information is pure pass-through, adding parsing cost without programmatic value.

**Assessment:** Acceptable for v1. The agent benefits from having source context even if the workflow logic doesn't inspect it.

### ISSUE-V4-09-03: `applyDeltaToFeature()` re-parses requirements after each operation -- inefficient for large Features [LOW]

**Location:** Plan 09, lines 804-813

```typescript
for (const entry of sorted) {
  const result = applySingleOperation(requirements, entry);
  if (result.success) {
    content = rebuildFeatureContent(featureNote, requirements);
    requirements = parseRequirementsSection(content);
  }
}
```

After each successful operation, the entire Feature content is rebuilt from the requirements map and then re-parsed. For a Feature with N requirements and M operations, this is O(N*M) parsing work. OpenSpec's `buildUpdatedSpec()` avoids this by operating on the `nameToBlock` map throughout and only rebuilding content once at the end.

**Impact:** For typical vault sizes (Features with 5-20 requirements, 1-5 operations per change), this is negligible. But the design doesn't match OpenSpec's more efficient single-rebuild approach.

**Recommendation:** Accept for v1. If performance becomes an issue with large Features, refactor to operate on the map and rebuild once at the end (matching OpenSpec's approach).

### ISSUE-V4-09-04: `applySingleOperation()` MODIFIED case returns `success: true` but does no actual work [INFO]

**Location:** Plan 09, lines 868-877

For MODIFIED operations, `applySingleOperation()` validates the requirement exists and returns `{ entry, success: true, contentChanged: true }` but does not modify the requirements map. The comment says "The agent will read the Delta Summary description and apply the change."

This is architecturally intentional -- MODIFIED is agent-driven. But `success: true` is misleading because nothing was actually done. The function validates the precondition (requirement exists) but the term "success" implies the operation completed.

Similarly, ADDED (lines 880-887) returns `success: true` without adding anything to the map.

**Risk:** A future implementer might check `operations.some(o => o.success)` (line 821) and conclude all operations are done, when MODIFIED/ADDED still need agent work.

**Assessment:** The `pendingAgentOps` mechanism correctly handles this separation (lines 1382-1409). The naming is slightly misleading but functionally safe because the orchestrator distinguishes programmatic and agent-driven ops. No action needed, but consider renaming to `preconditionMet: true` for clarity.

### ISSUE-V4-09-05: Section operations not checked for stale state [LOW]

**Location:** Plan 09, stale-detector.ts (lines 679-681)

```typescript
if (entry.targetType !== 'requirement') continue;
```

Stale detection skips all section operations. Overview.md section 14.2 states that section operations do not carry `[base:]` fingerprints, so there's nothing to compare. But this means section-level edits have NO conflict detection -- if two Changes both MODIFY the same section in the same Feature, neither the stale detector nor the requirement-level conflict model catches it.

**Assessment:** overview.md does not define `base_fingerprint` for section operations, so this is by-spec. But it's a design limitation worth documenting. Section-level conflicts could silently overwrite each other.

**Recommendation:** Accept for v1. Document as a known limitation. Consider adding section-level fingerprints in v2 if section conflicts emerge in practice.

### ISSUE-V4-08-03: `selectChange()` sorts by `lastModified` but `IndexRecord` has no `lastModified` field [MEDIUM]

**Location:** Plan 08, line 337

```
activeChanges = vaultIndex.getNotesByType("change")
  .filter(c => c.status in ["proposed", "planned", "in_progress"])
  .sort(byLastModified DESC)
```

The unified types `IndexRecord` (00-unified-types.md lines 140-173) has no `lastModified` field. It has `created_at` (line 149, only for Change notes) but not a modification timestamp.

Plan 08's `ChangeSelectionCandidate` (line 324) includes `lastModified: string` as an ISO date, but the plan does not explain how to derive this from `IndexRecord`.

Options:
1. Use filesystem `mtime` of the note file (fragile -- Obsidian auto-saves can update mtime without meaningful changes)
2. Use git log for the file
3. Use `created_at` as a fallback sort key
4. Add `modified_at` to `IndexRecord` in plan 04

**Recommendation:** Use `created_at` as the primary sort key (already available in `IndexRecord`), with `id` as tiebreak. If `lastModified` is needed, document that it comes from filesystem `mtime` via the vault parser (plan 03), or add it to the index record spec in plan 04. Currently, neither plan 03 nor plan 04 defines this field.

---

## Cross-Plan Consistency Check (V4)

| Check | Status | Detail |
|-------|--------|--------|
| `toPublicNextAction()` conversion (08 -> unified types) | PASS | Explicit function at lines 252-284 |
| `ContinueResult.nextAction` uses public shape | PASS | Line 307: `PublicNextAction` |
| `checkDependsOn()` delegates to plan 06 | PASS | Lines 737-793 call `sequencingEngine.analyzeSequencing()` |
| `DeltaEntry` -> `DeltaSummaryEntry` mapping documented | PASS | Lines 266-278 in DeltaEntry JSDoc |
| `verifyApply()` no longer uses generic `postValidate()` for agent ops | PASS | Lines 1501-1615 use snapshot comparison |
| `preEditSnapshots` in `ApplyResult` for caller handoff | PASS | Lines 428-429 |
| Agent-phase recovery documented | PASS | Lines 1618-1644 |
| Orchestrator pseudocode shows transition trigger points | PASS | Lines 884-949 |
| `in_progress -> applied` sole owner = plan 09 | PASS | Plan 08 line 688: `in_progress: []`; plan 09 line 1188 |
| `proposed -> planned` can be 07 or 08 | PASS | Unified types line 380 |
| `planned -> in_progress` owned by 08 | PASS | Lines 905-912 in orchestrator |
| Plan 09 depends on plan 08's `getUncheckedTasks()` | PASS | Line 1200 uses `getUncheckedTasks(change)` |
| REQUIREMENT_OP_RE handles description before `[base:]` | FAIL | Regex does not capture description; `base_fingerprint` silently lost (V4-09-01) |
| `verifyApply()` MODIFIED hash-changed logic correct | PARTIAL | AND-logic is semantically questionable for forced-stale edge case (V4-09-02) |
| `selectChange()` sort field available in IndexRecord | FAIL | `lastModified` not in `IndexRecord` (V4-08-03) |
| Stale detection covers section operations | N/A | Not specified by overview.md; documented as v1 limitation (V4-09-05) |
| Content hash normalization aligned between plans 03, 09 | UNCLEAR | Both reference `computeContentHash` from `util/hash` but normalization details (trim, collapse whitespace, lowercase) in plan 09 line 768 not confirmed against plan 03 |
| `archiveChange()` runs verify first (overview.md section 15) | MISSING | overview.md says "Before archiving, verify should run to confirm the Change is cleanly applied." Plan 09's `archiveChange()` does NOT call verify before archiving. |

---

## Overview.md Compliance Check (V4)

### Section 15: Next-Action Algorithm

| Requirement | Plan 08 Status | Detail |
|-------------|---------------|--------|
| `proposed` -> check prerequisites -> fill_section or transition | PASS | Lines 449-459, exact match |
| `planned` -> check depends_on -> blocked or start_implementation | PASS | Lines 461-483, delegates to plan 06 |
| `in_progress` -> unchecked tasks -> continue_task or ready_to_apply | PASS | Lines 485-492; deliberate adaptation documented |
| `applied` -> verify_then_archive | PASS | Lines 494-495 |
| Adaptation from overview.md documented | PASS | Lines 489-492 comment block explains ownership split |

### Section 15: Section-Completeness Contract

| Requirement | Status | Detail |
|-------------|--------|--------|
| Why non-empty | PASS | Line 405 |
| Delta Summary >= 1 entry | PASS | Line 406 |
| Tasks >= 1 item | PASS | Line 407 |
| Validation non-empty | PASS | Line 408 |
| Design Approach soft prereq with N/A handling | PASS | Lines 412-414 |
| Decision link conditional soft prereq | PASS | Lines 431-437, keyword detection for significance |

### Section 15: continue workflow

| Requirement | Status | Detail |
|-------------|--------|--------|
| Read current Change state, linked Feature, related Decision, existing Tasks | PASS | `gatherContext()` at lines 503-566 |
| Run nextAction() | PASS | Step 4 in orchestrator |
| Promote major design reasoning into Decision | PASS | `checkDecisionPromotion()` at lines 622-665, with 4 criteria from overview.md 14.2 |
| Do not duplicate content between Design Approach and Decision | PASS | Lines 670-674 explicitly enforce this |
| Maintain depends_on and touches | PASS | Contract 7 at line 84 |
| Move to in_progress when implementation starts | PASS | Orchestrator lines 905-912 |

### Section 15: apply workflow

| Requirement | Status | Detail |
|-------------|--------|--------|
| Check base_fingerprint against content_hash | PASS | `detectStale()` at lines 655-760 |
| Block auto-apply on mismatch | PASS | Lines 1275-1293, with `forceStale` escape |
| Atomic apply order RENAMED->REMOVED->MODIFIED->ADDED | PASS | `getAtomicPriority()` at lines 828-837 |
| Reflect change into canonical Feature | PASS | `applyDeltaToFeature()` + agent-driven ops |
| Update Requirements and narrative sections | PASS | Feature updater + section updater |
| Keep Delta Summary aligned with canonical edits | IMPLICIT | The plan applies Delta Summary AS the canonical edits, so alignment is inherent |
| Update Decision and System notes | PARTIAL | Section updater handles section ops on any note type, but the orchestrator only loads Feature notes into `featureNotes` map (line 1253). Non-Feature targets would fail to load. See ISSUE-V4-09-06. |
| Change status to applied | PASS | Lines 1479-1482 (no agent ops) or 1609 (after verify) |
| Keep in 04-changes/ first | PASS | Only `archiveChange()` moves files |
| Archive preserving id | PASS | `archiveChange()` at lines 1668-1719 |

### Section 10.8: Operation Validation Matrix

All four operations (ADDED, MODIFIED, REMOVED, RENAMED) have correct pre- and post-validation checks. Pre-validation in `apply-validator.ts` (lines 907-959) and post-validation (lines 965-1034) match the matrix exactly.

### Section 10.8: Stale-Change Detection

Implemented correctly in `stale-detector.ts` (lines 655-760). ADDED entries correctly skip (no base to check). MODIFIED/REMOVED/RENAMED compare `base_fingerprint` against current `content_hash`. Missing requirements are flagged as stale.

### Section 6.2C: Hybrid Lifecycle

Applied Change stays in `04-changes/` (status change only). Archive is a separate explicit action via `archiveChange()`. The `id` is preserved. Collision check before move.

---

## OpenSpec Fidelity Check (V4)

### `buildUpdatedSpec()` Adaptation

The fundamental architectural difference is correctly identified and handled:
- OpenSpec: full requirement blocks in delta spec files -> programmatic merge by `buildUpdatedSpec()`
- open-wiki-spec: one-line Delta Summary entries -> Phase A (mechanical: RENAMED, REMOVED) + Phase B (agent-driven: MODIFIED, ADDED)

The three-phase model (A: validate+mechanical, B: agent edits, C: verify+status) is a sound adaptation of OpenSpec's single-pass programmatic approach.

### Cross-Section Conflict Validation

Plan 09's `validateDeltaConflicts()` (lines 590-642) mirrors OpenSpec's pre-validation in `buildUpdatedSpec()`:
- Duplicate detection within same operation type
- MODIFIED + REMOVED, MODIFIED + ADDED, ADDED + REMOVED conflicts
- RENAMED FROM + MODIFIED old name, RENAMED TO + ADDED collision

This is a faithful port of OpenSpec's validation logic.

### `parseDeltaSpec()` Grammar Adaptation

OpenSpec parses heading-based sections (`## ADDED Requirements`). Plan 09 parses inline list items (`- ADDED requirement "name" to [[Feature]]`). The grammar transformation is correct for the Delta Summary format, with the regex issue noted in V4-09-01.

---

## New Issue: Cross-Note Target Loading

### ISSUE-V4-09-06: Orchestrator only loads Feature notes, but Delta Summary can target any note type [MEDIUM]

**Location:** Plan 09, lines 1244-1254

```typescript
for (const [noteKey, entries] of deltaPlan.byTargetNote) {
  const noteRecord = index.getById(noteKey);
  if (!noteRecord) {
    errors.push(`Target note "${noteKey}" not found in index`);
    continue;
  }
  const note = await parseNoteFromPath(noteRecord.path);
  featureNotes.set(noteKey, note);  // variable named "featureNotes" but could be any note type
}
```

The variable is named `featureNotes` but the code loads any note referenced in the Delta Summary. This is functionally correct (the code doesn't filter by type). However, the `applyDeltaToFeature()` function (line 1387) is specifically designed for Feature notes with `## Requirements` sections. If a Delta Summary targets a System or Decision note with section operations, `applyDeltaToFeature()` would be called on a non-Feature note.

Looking more carefully at lines 1379-1387:
```typescript
const mechEntries = reqEntries.filter(e => (programmaticOps as readonly string[]).includes(e.op));
```

Only requirement entries go through `applyDeltaToFeature()`. Section entries go through `applySectionOps()` (lines 1433-1445). So the separation is correct for section ops on non-Feature notes.

**Revised assessment:** The code is functionally correct but the naming (`featureNotes`) is misleading since it stores any note type. Minor naming issue, not a bug.

---

## Summary

| Plan | Rating | V3 Issues | Resolved | New V4 Issues | Severity Breakdown |
|------|--------|-----------|----------|---------------|-------------------|
| 08-workflow-continue | VERY STRONG | 4 | 4/4 | 2 | 1 MEDIUM (V4-08-03), 1 LOW (V4-08-01) |
| 09-workflow-apply | STRONG | 5 | 4.5/5 (V3-09-03 not fully fixed) | 4 | 2 MEDIUM (V4-09-01, V4-09-02), 2 LOW/INFO (V4-09-03, V4-09-05) |

**Upgrade explanation for plan 08:** All V3 issues resolved. The orchestrator pseudocode, `toPublicNextAction()` conversion, and delegation to plan 06 for `checkDependsOn()` close the major gaps. The remaining issues are minor (self-reference in result construction, missing `lastModified` field).

**Plan 09 remains STRONG:** The V3-09-01 verifyApply bug is fixed via the snapshot approach. Agent-phase recovery is documented. But the regex issue (V4-09-01) means MODIFIED entries with descriptions will silently lose their `base_fingerprint`, and the AND-logic in hash comparison (V4-09-02) has a subtle edge case.

### Items to Address Before Implementation (Priority Order)

1. **ISSUE-V4-09-01 (MEDIUM):** Fix REQUIREMENT_OP_RE to capture optional description text between `]]` and `[base:]`. Without this fix, MODIFIED entries with descriptions (which is the format shown in overview.md's own example) will silently bypass stale detection.

2. **ISSUE-V4-09-02 (MEDIUM):** Simplify `verifyApply()` MODIFIED hash comparison to only use the snapshot. The `base_fingerprint` comparison is redundant here (stale detection already ran in Phase A) and creates edge-case failures with `forceStale`.

3. **ISSUE-V4-08-03 (MEDIUM):** Resolve the `lastModified` field gap. Either add it to `IndexRecord` (requires plan 04 update), use `created_at` as the sort key, or document that filesystem `mtime` is used.

4. **ISSUE-V4-08-01 (LOW):** Fix the self-reference in `continueChange()` result construction (line 946).

5. **ISSUE-V4-09-03 (LOW):** Accept for v1. Note the O(N*M) re-parsing in `applyDeltaToFeature()`.

6. **ISSUE-V4-09-05 (LOW):** Document that section operations have no conflict detection as a known v1 limitation.

7. **Cross-plan: archiveChange verify gate** (noted in cross-plan table): overview.md section 15 says verify should run before archiving. Plan 09's `archiveChange()` only checks `status === 'applied'` but does not invoke verify. Consider adding a verify check or documenting that the caller is responsible.

8. **Cross-plan: content hash normalization alignment:** Plan 09's `computeRequirementHash()` (line 768) normalizes with trim + collapse whitespace + lowercase. Confirm plan 03's parser and plan 04's indexer use the same normalization, or hash mismatches will cause false stale-base detections.

### Overall Assessment

Both plans have matured significantly from V3. The critical `verifyApply()` bug is fixed with a well-designed snapshot approach. The continue workflow now has explicit orchestration, proper delegation to the sequencing engine, and a clean public/internal type boundary. The remaining issues are localized: a regex that needs a description capture group, a hash comparison that should be simplified, and a missing sort field. None of these are architectural risks -- they are implementable fixes that can be addressed during coding without plan restructuring.
