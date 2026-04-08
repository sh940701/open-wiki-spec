# Review: Plans 06 (Sequencing Engine) and 07 (Workflow Propose)

**Reviewer**: Devil's Advocate Agent  
**Date**: 2026-04-06  
**Verdict**: Both plans are strong and faithful to the overview.md contract. Issues found are mostly edge-case gaps and minor specification inconsistencies rather than architectural flaws.

---

## Plan 06: Sequencing Engine

### 1. overview.md Compliance

**Touches Severity Model (10.5.1)**: PASS. The four severity levels (`parallel_safe`, `needs_review`, `conflict_candidate`, `blocked`) are correctly implemented. The algorithm in `computeTouchesSeverity()` follows the exact precedence order: blocked > conflict_candidate > needs_review > parallel_safe. The conditions match the overview.md table.

**Requirement-Level Conflict Model (10.5.1)**: PASS. All four `conflict_critical` pairs from overview.md are covered:
- MODIFY vs MODIFY: covered
- MODIFY vs REMOVE: covered
- RENAME vs MODIFY (old name): covered
- ADD vs ADD (same name): covered

The plan also adds additional conflict pairs not explicitly in overview.md (RENAMED vs REMOVED, RENAMED_TO vs ADDED) which are defensible extensions.

**Deterministic Ordering (10.5.1)**: PASS. Topological sort on `depends_on` with `(created_at, change_id)` tiebreak, matching overview.md exactly. The difference from OpenSpec's lexicographic-only tiebreak is explicitly noted and justified.

**Base Fingerprint / Stale Detection (10.8)**: PASS. `checkBaseFingerprints()` compares `base_fingerprint` against `content_hash`, matches overview.md's stale-change detection contract. ADDED entries are correctly skipped.

**Sequencing in Retrieval Output (10.6)**: PASS. `SequencingSummary` with `status`, `related_changes`, and `reasons` matches the retrieval subagent output contract.

### 2. Implementability

**GOOD**: Algorithms are expressed in clear pseudocode with explicit step numbering. Data structures are fully typed in TypeScript. File structure is modular with single-responsibility files.

**CONCERN: Kahn's algorithm depth tracking is incorrect.** The pseudocode processes `currentBatch = queue.drainAll()` at each depth, but this drains ALL zero-in-degree nodes at once regardless of actual topological depth. Consider:
- A depends on nothing (depth 0)
- B depends on nothing (depth 0)  
- C depends on A (depth 1)

After draining {A, B} at depth 0, C becomes available. This works. But the depth counter increments per "batch drain" which conflates "batch" with "depth." If A finishes processing and makes C available before B is even processed, the algorithm still correctly groups them because it drains all zero-in-degree first. So functionally correct, but the implementation must be careful: `drainAll()` must snapshot the current queue contents before processing any successors.

**CONCERN: Priority queue with `drainAll()`**. This is not a standard priority queue operation. The plan should specify whether `drainAll()` means "drain all items currently in the queue" (snapshot semantics) or "drain until empty after processing successors" (which would collapse everything into one batch). The pseudocode implies snapshot semantics but doesn't state it.

### 3. OpenSpec Fidelity

**GOOD**: The plan correctly identifies OpenSpec's critical gap (no fingerprint validation in `buildUpdatedSpec()`) and positions the sequencing engine as implementing what OpenSpec's Phase 0 planned but never shipped.

**GOOD**: The `provides`/`requires` capability markers from OpenSpec are explicitly noted as "not adopted in v1" with clear rationale (replaced by `touches` severity + requirement-level conflict). This is a defensible simplification.

**CONCERN: OpenSpec's `parent`/split decomposition model is dropped.** The plan notes this as "not in v1 scope" but doesn't explain whether the data structures need to be extensible for it. If a v2 adds `parent`, the `IndexRecord` and conflict detection would need to understand hierarchical changes. Low risk for v1 but worth flagging.

### 4. overview.md Limitations / Contradictions

**ISSUE: User-assigned priority override.** Overview.md section 10.5.1 says: "사용자가 명시적으로 priority를 부여하면 그것이 최우선이다." The plan's `computeDeterministicOrder()` ignores this entirely, noting in the test strategy: "User priority: not implemented in v1 (manual override is a user-facing workflow concern, not engine logic)." This is pragmatically reasonable but technically violates the overview.md contract. The plan should explicitly state this as a deferred contract item and note that the overview.md's fourth ordering rule is not satisfied in v1.

**ISSUE: `conflict_critical` vs `blocked` precedence in `SequencingResult.status`.** The `analyzeSequencing()` algorithm computes overall status by checking `conflict_critical` first, then `blocked`, then `conflict_candidate`, then `needs_review`. But overview.md doesn't define a severity ordering between `conflict_critical` (from requirement-level conflicts) and `blocked` (from depends_on). Is `conflict_critical` worse than `blocked`? `blocked` means you literally cannot proceed; `conflict_critical` means you need user resolution. These are qualitatively different. The current precedence (`conflict_critical` > `blocked`) is arguable -- a blocked change with no conflicts is arguably in a worse state than an unblocked change with a conflict. The plan should document this precedence decision explicitly.

### 5. Missing Elements

**MISSING: Sequencing error for out-of-order status.** Overview.md 10.5.1 says: "depends_on target이 존재하지 않거나, 아직 완료되지 않은 선행 작업을 필요로 하는데 현재 Change가 in_progress 또는 applied로 앞서 나가 있으면 sequencing error로 보고해야 한다." The plan's `computeTouchesSeverity()` checks `blocked` when depends_on target is not `applied`, but it doesn't detect the reverse case: when Change X depends on Change Y, but X is already `in_progress`/`applied` while Y is still `proposed`. This is a sequencing error (X jumped ahead of its dependency) and should be reported separately from `blocked`.

**MISSING: How `findCycles()` works.** The pseudocode references `findCycles(unvisited, graph)` but never defines the DFS-based cycle finding algorithm. For implementability, this should at least specify: standard Tarjan's / DFS with back-edge detection.

**MISSING: Cross-change same-op deduplication in conflict detection.** If Change A has two Delta Summary entries that both MODIFY the same requirement (a malformed note), `detectRequirementConflicts()` would not detect this as an intra-change error. It only checks inter-change pairs. This is arguably verify's job, but the plan should clarify.

### 6. Over-engineering Assessment

**GOOD**: The plan is appropriately scoped for v1. No unnecessary abstractions. The `ConflictOp = 'RENAMED_TO'` pseudo-op is a clean solution for handling the dual-key nature of RENAMED. The priority queue is the only custom data structure, and it's genuinely needed.

**MINOR**: The `StaleBaseEntry.requirement_key` field uses a composite key format `feature_id::requirement_name`. This is fine, but the plan should confirm this is the same format used in plan 04's index engine to avoid integration mismatches.

### 7. Cross-plan Consistency

**GOOD**: Dependencies are clearly stated (04, 03 as inputs; 05, 10, 09 as consumers). The `IndexRecord` shape assumed by the sequencing engine matches what plan 04 should produce.

**CONCERN**: The plan assumes `IndexRecord` has a `requirements` field with individual `content_hash` values. Plan 03 (vault-parser) must parse this from Feature notes. Plan 04 (index-engine) must include it in `IndexRecord`. If either plan doesn't produce this, `checkBaseFingerprints()` breaks silently. The plan should note this as a hard integration prerequisite.

**CONCERN**: The `SequencingResult.status` type is `TouchesSeverity | 'conflict_critical'`, making `conflict_critical` a fifth possible status outside the four-level `TouchesSeverity` enum. This is clean from a type perspective, but consumers (plan 05 retrieval, plan 10 verify) need to handle this union correctly. The retrieval output contract in overview.md 10.6 shows `status: "parallel_safe"` -- it's not obvious that `conflict_critical` can also appear there. Plan 05 should handle this.

---

## Plan 07: Workflow Propose

### 1. overview.md Compliance

**Preflight Requirement (8.2)**: PASS. The plan enforces mandatory similarity scan before any note creation. The `propose()` function runs `buildIndex()` -> `normalizeQuery()` -> `runPreflight()` before any post-classification action.

**Query Object Contract (10.4)**: PASS. `QueryObject` has all required fields: `intent`, `summary`, `feature_terms`, `system_terms`, `entity_terms`, `status_bias`.

**Classification Thresholds (10.5)**: PASS. All four classifications implemented with correct thresholds:
- `existing_change`: score >= 75, gap >= 15
- `existing_feature`: score >= 70, no strong active Change within 10 points
- `new_feature`: top below 45
- `needs_confirmation`: top two >= 60 and gap < 10

**Post-Classification Actions (10.5.2)**: PASS. Each classification maps to a specific workflow action. The action router matches overview.md exactly.

**Section-Completeness Contract (section 15)**: PASS. Hard prerequisites (Why, Delta Summary, Tasks, Validation) and soft prerequisites (Design Approach, Decision link) correctly implemented.

**Sequencing Integration (10.5.1)**: PASS. `runPreflight()` calls `sequencingEngine.analyzeSequencing(index)` and includes results in the retrieval output.

### 2. Implementability

**GOOD**: The flow is clearly expressed as a sequential pipeline. Each step has a well-defined input/output contract. The classification logic is deterministic and testable.

**CONCERN: `normalizeQuery()` mixes deterministic heuristics with LLM dependency.** The function uses regex-based intent detection (deterministic) but the note at the end says "The main agent (Claude Code) has the context to do reasonable term extraction." This means `extractFeatureTerms()`, `extractSystemTerms()`, and `extractEntityTerms()` are not fully specified. For v1 implementability, these functions need at minimum:
- `extractSystemTerms()`: must take `knownSystems` from the index as input (plan mentions this), but the algorithm for matching user words to known systems is unspecified.
- `extractFeatureTerms()` and `extractEntityTerms()`: no heuristic is given. Are they NLP-based? Regex-based? Or is the main agent expected to fill these fields?

The plan should clarify: is `normalizeQuery()` called by the TypeScript engine (fully deterministic) or by the main agent via LLM (semi-deterministic)? If the latter, it should be marked as an LLM-dependent step with a fallback contract.

**CONCERN: `computeDependsOn()` and `computeTouches()` in `createChangeNote()` are undefined.** These functions derive `depends_on` and `touches` for a newly created Change from the sequencing result and query terms, but no algorithm is given. How does the system know what a new (not-yet-existing) change will touch? The query's `system_terms` and `feature_terms` could be used, but the mapping from terms to IDs requires index lookups that aren't specified.

### 3. OpenSpec Fidelity

**GOOD**: The plan correctly identifies that OpenSpec's propose is "create-first" while open-wiki-spec's is "search-first." The comparison table in section 2 and the side-by-side flow in the file structure section are excellent documentation.

**GOOD**: The plan acknowledges OpenSpec's lack of pre-creation similarity checking as the core limitation being addressed.

**MINOR**: OpenSpec's `ff-change` and `propose` are noted as "identical in execution." The plan doesn't carry over any artifact pipeline concept, which is correct since open-wiki-spec replaces the artifact DAG with section-completeness. This is a clean break.

### 4. overview.md Limitations / Contradictions

**ISSUE: Classification gap between 45 and 70 for Features.** Overview.md defines `existing_feature` as score >= 70 and `new_feature` as score < 45. What happens when a Feature candidate scores 55? The plan addresses this with Rule 5 (medium-confidence `existing_feature` for 45-70 range) and Rule 6 (medium-confidence `existing_change` for 45-75 range). These are reasonable gap-filling rules, but they are plan-level decisions NOT specified in overview.md. The plan should explicitly call these out as "plan-level extensions beyond overview.md thresholds" so they can be validated or overridden.

**ISSUE: `needs_confirmation` for index quality issues.** Overview.md 10.5 says `needs_confirmation` applies when "index-quality issues exist, such as duplicate IDs, ambiguous wikilinks, or missing targets." The plan checks this via `retrieval.warnings` in the main `propose()` function (line 711-713), but this is a post-retrieval override, not part of the `classify()` function. The plan's comment at Rule 1c says "This is checked separately by the caller" -- this is architecturally fine but should be more explicit about the division of responsibility.

**ISSUE: Multi-feature changes.** Overview.md 13.2 allows cross-cutting changes with `features:` (plural). The plan's `createChangeNote()` always writes `feature:` (singular) linking to a single Feature. There's no path for creating a cross-cutting Change via propose. This may be intentional for v1 simplicity, but it should be stated explicitly as a limitation.

### 5. Missing Elements

**MISSING: Sequencing severity warning in propose output.** Overview.md 10.5.1 says preflight should evaluate sequencing severity. The plan's `runPreflight()` includes `sequencingSummary` in the return value, but the `ProposeResult` doesn't surface sequencing warnings prominently. When `sequencing.status` is `conflict_candidate` or worse, the plan should specify whether propose should:
- (a) Block creation and force `needs_confirmation`, or
- (b) Proceed with creation but include prominent warnings, or
- (c) Leave it entirely to the main agent's judgment.

Currently the plan appears to take option (c), which is the weakest enforcement. Overview.md says `conflict_candidate` requires "사용자 확인 필요" (user confirmation required). If the newly proposed change would create a `conflict_candidate` against existing changes, should propose force `needs_confirmation`?

**MISSING: How `existing_change` handles continue.** When classification is `existing_change`, the plan returns `action: 'continued_change'` with the existing Change as `target_change`. But what does the caller DO with this? It doesn't invoke plan 08's continue workflow. It doesn't check prerequisites. It doesn't update the existing change's content. The plan should specify whether `propose()` returns early and expects the caller to invoke `continue`, or whether it should delegate to the continue workflow internally.

**MISSING: Error handling for note creation failures.** The test strategy mentions "Change creation fails (disk error) -> propagated as error, no partial state" but the pseudocode has no error handling. If `createFeatureNote()` succeeds but `createChangeNote()` fails in the `new_feature` path, you have an orphan Feature note. The plan should specify rollback behavior or at minimum document that partial state is acceptable.

**MISSING: `created_at` field on Change notes.** The `createChangeNote()` function sets `created_at` in frontmatter, but this field is critical for the sequencing engine's tiebreaking (plan 06). The plan should emphasize that `created_at` MUST be an ISO 8601 date to ensure deterministic comparison.

### 6. Over-engineering Assessment

**GOOD**: The plan is appropriately scoped. No unnecessary abstractions. The `dryRun` and `forceClassification` options are practical for testing without adding complexity.

**CONCERN: The medium-confidence classifications (Rules 5 and 6) add complexity to the 45-70 score gap.** Given that overview.md doesn't specify behavior in this range, the plan could simplify by treating 45-70 as `needs_confirmation` rather than guessing confidence levels. This would be more conservative but less useful. Current approach is reasonable but adds test surface.

### 7. Cross-plan Consistency

**GOOD**: Dependencies are clearly listed. The plan correctly consumes plan 05 (retrieval), plan 06 (sequencing), plan 04 (index), and plan 03 (parser).

**CONCERN: `RetrievalResult` is defined in both plan 07 (as an interface) and presumably plan 05 (as the retrieval engine's output contract).** The plan should clarify whether this type is owned by plan 05 or plan 07. If plan 05 defines a different shape, there will be an integration mismatch. Recommendation: plan 05 owns `RetrievalResult` and plan 07 imports it.

**CONCERN: `ScoredCandidate` includes `type: 'query'` in its union but overview.md 10.5 classification rules only reference Feature and Change types for scoring.** Candidates of type `system`, `decision`, `source`, or `query` can appear in the candidate list but the classification logic doesn't handle them (Rules 2-6 only check `top.type == 'feature'` or `top.type == 'change'`). What happens if a System note scores 80? It falls through all rules to the fallback `new_feature` at the bottom. This is probably fine but the behavior should be documented.

---

## Summary of Issues by Severity

### Must Fix (blocks correctness)

1. **Plan 06**: Missing detection of out-of-order status (Change jumped ahead of its dependency). Overview.md explicitly requires this as a "sequencing error."

2. **Plan 07**: Missing enforcement of sequencing severity in propose. When a new Change would create `conflict_candidate` against existing changes, overview.md says user confirmation is required, but the plan doesn't gate on this.

### Should Fix (improves quality)

3. **Plan 06**: User-assigned priority override is silently dropped. Should be documented as a deferred v1 contract gap.

4. **Plan 06**: `drainAll()` semantics on priority queue need clarification (snapshot vs. live drain).

5. **Plan 07**: `computeDependsOn()` and `computeTouches()` functions are undefined. These are called during note creation but no algorithm is provided.

6. **Plan 07**: Classification rules for scores 45-70 are plan-level extensions beyond overview.md. Should be explicitly flagged.

7. **Plan 07**: `RetrievalResult` type ownership ambiguity between plan 05 and plan 07.

### Nice to Have (minor improvements)

8. **Plan 06**: `findCycles()` DFS algorithm not specified.

9. **Plan 06**: `conflict_critical` vs `blocked` precedence in overall status should be documented.

10. **Plan 07**: Behavior when non-Feature/Change types score highest should be documented.

11. **Plan 07**: Multi-feature Change creation not supported in v1; should be stated as limitation.

12. **Plan 07**: Rollback behavior for partial note creation failures.

---

## Cross-plan Integration Risks

| Integration Point | Risk | Mitigation |
|---|---|---|
| Plan 06 reads `IndexRecord.requirements[].content_hash` | Plan 03/04 must produce this | Add to 04's output contract as hard requirement |
| Plan 07 calls `retrievalEngine.search()` | Plan 05 output shape must match `RetrievalResult` | Single type owner (plan 05) |
| Plan 07 calls `sequencingEngine.analyzeSequencing()` | Plan 06 output shape must match `SequencingResult` | Already well-defined in plan 06 |
| Plan 07's `ProposeResult` consumed by plan 08 (continue) | Plan 08 must understand `action: 'continued_change'` | Verify in plan 08 review |
| Plan 06's `SequencingResult.status` can be `conflict_critical` | Plan 05/10 consumers must handle this fifth status value | Document in plan 06's public API |

---

## Overall Assessment

**Plan 06** is the stronger of the two. Its algorithms are precise, the data structures are complete, and the OpenSpec comparison is thorough. The main gaps are edge cases (out-of-order status detection, user priority override) rather than architectural flaws.

**Plan 07** is architecturally sound -- the search-first approach is well-justified and the classification logic is deterministic. The main weakness is incomplete specification of helper functions (`computeDependsOn`, `computeTouches`, `extractFeatureTerms`) and insufficient enforcement of sequencing severity during propose. These gaps are fillable without architectural changes.

Both plans together form a coherent pipeline: plan 06 provides the analytical engine, plan 07 consumes it during the propose workflow. The interface between them (`SequencingResult` -> `SequencingSummary`) is clean and well-defined.
