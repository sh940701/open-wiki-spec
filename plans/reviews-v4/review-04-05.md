# Review v4: Plans 04-05 (Index & Retrieval)

**Reviewer**: Devil's Advocate Agent (Round 4)
**Date**: 2026-04-06
**Plans Reviewed**:
- `plans/04-index-engine.md`
- `plans/05-retrieval-engine.md`

**Reference Documents**:
- `overview.md` (sections 8, 9, 10, 11)
- `plans/00-unified-types.md`
- OpenSpec source: `src/core/artifact-graph/graph.ts`, `types.ts`; `src/core/templates/workflows/propose.ts`
- `plans/03-vault-parser.md`, `plans/06-sequencing-engine.md`, `plans/07-workflow-propose.md`
- Previous reviews: `plans/reviews/review-04-05.md`, `plans/reviews-v2/review-04-05.md`, `plans/reviews-v3/review-04-05.md`

---

## Previous Issues Resolution Status

### From v3 review (11 fresh issues + 3 carried forward)

| Issue ID | Summary | Status in v4 | Notes |
|----------|---------|--------------|-------|
| FRESH-04-01 | `stripWikilinkSyntax` not in plan 03 exports | **RESOLVED** | Plan 03 now defines and exports `stripWikilinkSyntax()` (plan 03 line 642, exports at line 1411). Plan 04 correctly imports it (line 429). The `00-unified-types.md` Parser-Index API Boundary (line 404) also declares it. |
| FRESH-04-02 | `parseNote()` takes content string, plan 04 passes file path | **RESOLVED** | Plan 03's `parseNote()` now takes `filePath: string` (plan 03 line 1141: `export function parseNote(filePath: string): ParseResult`). Plan 04's call `parseNote(fileEntry.absolutePath)` (line 336) is now correct. |
| FRESH-04-03 | Composite key construction ownership unclear | **RESOLVED** | Plan 04 now explicitly computes composite keys in `resolveRecordLinks()` (lines 517-523): `key: rawRecord.id + '::' + req.name`. Comment at line 519 clarifies: "Plan 03's parser returns key as empty placeholder." Ownership is unambiguous. |
| FRESH-04-04 | `delta_summary[].target_note_id` not resolved to IDs | **RESOLVED** | Plan 04 now resolves `target_note_id` in `resolveRecordLinks()` (lines 505-515). Uses `resolveWikilink()` with fallback to raw value if resolution fails. Error is pushed to `linkErrors` on failure. |
| FRESH-05-01 | Plan 07 calls `search()` but plan 05 exports `retrieve()` | **RESOLVED** | Plan 07 now calls `retrievalEngine.retrieve(index, query, { sequencing: sequencingFull })` (line 364). Function name matches. Plan 07 explicitly states it does NOT re-classify (lines 378-382). |
| FRESH-05-02 | `IndexStore` vs `VaultIndex` naming divergence | **RESOLVED** | Plan 07 now uses `VaultIndex` consistently (line 356: `function runPreflight(query: QueryObject, index: VaultIndex)`). `IndexStore` no longer appears. |
| FRESH-05-03 | Duplicate `classify()` implementations | **RESOLVED** | Plan 07 no longer has its own `classify()`. Lines 378-382 explicitly state: "Classification is owned by plan 05 (retrieval-engine). Plan 07 does NOT have its own `classify()` function." Line 816 confirms: "classify() is NOT exported from plan 07." |
| FRESH-05-04 | `status_bias` defaults not applied in plan 05 | UNCHANGED | Still acceptable for v1. Plan 07's `normalizeQuery()` handles intent-specific defaults. Plan 05 documents no defaults. |
| FRESH-05-05 | `active_change_overlap` fires without content relevance | UNCHANGED | See STILL-OPEN-04. |
| FRESH-05-06 | Sequencing integration documented 3 different ways | **RESOLVED** | All three plans now agree on the same model: Plan 07 calls `analyzeSequencing()` from plan 06 (plan 07 line 358), passes the full `SequencingResult` into plan 05's `retrieve()` via `options.sequencing` (plan 07 line 364). Plan 05's `retrieve()` internally calls `summarizeForRetrieval()` (plan 05 line 866) and uses the summary for classification escalation (Rule 0b). Plan 06 documents `summarizeForRetrieval()` export (plan 06 line 813). However, plan 06's integration section (line 852) still says "After scoring candidates, call `analyzeSequencing(index)`" suggesting the retrieval engine calls it -- this conflicts with the resolved model. See FRESH-04-05-01. |
| FRESH-05-07 | Plan 06 takes `Map`, plan 07 passes `VaultIndex` | UNCHANGED | See STILL-OPEN-05. |
| STILL-OPEN-01 | `isTypedNote()` undefined, null-return ambiguity | **RESOLVED** | Plan 04 line 641 explicitly addresses this: "No separate isTypedNote() function is needed -- the null-frontmatter check in parseNoteToRawRecord handles non-typed files." The `parseNoteToRawRecord` function (lines 330-398) returns a discriminated result `{ raw, missingId, invalidFrontmatter }` and `buildIndex` (lines 642-657) handles all three cases explicitly. |
| STILL-OPEN-02 | Index-quality escalation scope too broad | **RESOLVED** | Plan 05's `classify()` Rule 0 (lines 670-675) now scopes to top 3 candidates only: `topN = candidates.slice(0, 3)` and matches via `topCandidatePaths`. Comments explain the rationale (lines 670-674). |
| STILL-OPEN-03 | Sequencing analysis scope not documented in plan 05 | UNCHANGED | Plan 05 still does not explicitly state that `analyzeSequencing()` operates on all active changes from the full index. Plan 06 line 641-643 clarifies this internally, and the resolved integration model (caller provides the result) makes this less critical. Acceptable for v1. |

**Resolution summary from v3**: 10 resolved, 4 unchanged (1 medium, 3 low).

---

## Fresh Issues (v4)

### FRESH-04-05-01: Plan 06 integration section still describes retrieval-internal composition (LOW)

Plan 06 line 852 states: "After scoring candidates, call `analyzeSequencing(index)` to get the full result." This describes the OLD model where the retrieval engine internally calls the sequencing engine.

The RESOLVED model (confirmed in plans 05 and 07) is: the **workflow layer** (plan 07) calls `analyzeSequencing()`, then passes the result into `retrieve()`. Plan 05's `retrieve()` receives it via `options.sequencing` and does NOT call `analyzeSequencing()` itself.

**Impact**: Minor. Plan 06's integration section has one stale sentence. The function signature and all other documentation are correct. An implementer reading plan 06 in isolation might be confused, but reading plan 05 or plan 07 would immediately clarify.

**Recommendation**: Update plan 06 line 852 to: "The caller (plan 07) calls `analyzeSequencing(index)`, then passes the result to plan 05's `retrieve()` via `options.sequencing`."

### FRESH-04-05-02: Plan 06 `analyzeSequencing()` parameter type mismatch with caller (MEDIUM)

Plan 06 defines:
```
function analyzeSequencing(index: Map<string, IndexRecord>): SequencingResult  // line 641
```

Plan 07 calls:
```
sequencingFull = sequencingEngine.analyzeSequencing(index)  // line 358
```

Where `index` is `VaultIndex` (line 356: `function runPreflight(query: QueryObject, index: VaultIndex)`).

`VaultIndex` is not `Map<string, IndexRecord>`. It wraps the map as `records: Map<string, IndexRecord>` along with `warnings`, `path_to_id`, `title_to_ids`, `alias_to_ids`, etc.

This will fail at compile time. Either:
- Plan 07 must pass `index.records` instead of `index`, or
- Plan 06 must accept `VaultIndex` and unwrap internally

This is the same issue as v3's FRESH-05-07 (renamed here for clarity since it affects the 04-05 scope through the integration chain).

**Impact**: Build failure at integration time. Plan 06 also uses `index.values()` (line 642) which works on `Map` but not `VaultIndex`.

**Recommendation**: Plan 06 should accept `VaultIndex` as its parameter type and unwrap `index.records` internally. This matches the type flow: plan 04 produces `VaultIndex`, plan 07 receives it, plan 06 should accept it. Alternatively, plan 07 can pass `index.records`, but this leaks the internal structure.

### FRESH-04-05-03: `active_change_overlap` signal fires unconditionally for graph-expanded active Changes (MEDIUM)

Carried from v3 FRESH-05-05 with expanded analysis.

The scoring pipeline (plan 05 lines 568-586) awards +25 to any active Change candidate, regardless of how it entered the candidate set. A Change that enters only via graph expansion (one hop from a lexical hit) and has no content-based signal still gets +25.

**Concrete scenario**:
1. Query: "add email notifications"
2. Lexical hit: Feature "User Profile" (alias match on "user")
3. Graph expansion: Change "Fix Profile Avatar Upload" is linked to Feature "User Profile" via `links_out`
4. "Fix Profile Avatar Upload" is `status: in_progress` -> gets +25 (active_change_overlap)
5. It also shares a link with another candidate -> gets +10 (backlink_proximity)
6. Total: 35. Below `new_feature` threshold (45), but adds noise.

In a vault with many active changes linked to popular Features, multiple unrelated active Changes could each score 25-35 via this path. If two such Changes score near 60, the `needs_confirmation` rule (top two >= 60, gap < 10) fires and blocks what should be a clean `new_feature` classification.

**Recommendation**: Gate `active_change_overlap` on content relevance. Only award the signal if the candidate also has at least one content-based signal (exact_title, alias_match, same_system, shared_source, shared_decision, or full_text_match). This prevents graph-only candidates from getting free active-change points.

### FRESH-04-05-04: `collectWarnings` in plan 05 accesses plan 04's internal fields directly (LOW)

Plan 05's `collectWarnings()` (lines 773-831) accesses `index.duplicate_ids` and `index.link_errors`. These are internal fields on `VaultIndex` (plan 04 lines 282-294: "Internal lookup maps (implementation convenience, not part of canonical shape)").

The canonical `VaultIndex` shape from `00-unified-types.md` (lines 179-192) only defines `schema_version`, `scanned_at`, `records`, and `warnings`. The `warnings: IndexWarning[]` field already contains all duplicate_id, unresolved_wikilink, ambiguous_alias, missing_id, and schema_mismatch warnings in canonical form (built by plan 04's `buildWarnings()` at lines 567-626).

Plan 05 could use `index.warnings` (canonical) instead of reaching into internal fields.

**Impact**: Coupling to internal implementation. If plan 04 changes the internal field names or structure, plan 05 breaks. The functional behavior is correct -- plan 05 just accesses the data through a less stable path.

**Recommendation**: Refactor `collectWarnings()` to filter `index.warnings` (canonical `IndexWarning[]`) by `type` instead of reading internal maps. The information is identical:
- `index.warnings.filter(w => w.type === 'duplicate_id')` replaces `index.duplicate_ids`
- `index.warnings.filter(w => w.type === 'unresolved_wikilink' || w.type === 'ambiguous_alias')` replaces `index.link_errors`

### FRESH-04-05-05: `feature:`/`features:` mutual exclusivity validation gap between test and code (LOW)

Plan 04 test case #13 (line 850) expects: "Note with both `feature:` and `features:` (invalid) -> error reported." However, plan 04's `resolveRecordLinks()` (lines 490-525) handles both fields independently without checking mutual exclusivity: it resolves `feature_raw` via `resolveSingle()` and `features_raw` via `resolveArray()` with no cross-check.

Plan 03 has a test expectation for this validation (line 1457: "Frontmatter validation: both feature and features fails for Change"), so the error should originate from plan 03's parsing. If plan 03 rejects the note at parse time, plan 04's `parseNoteToRawRecord()` would receive `frontmatter: null` and skip it.

**Impact**: Low -- the validation chain likely works end-to-end (plan 03 validates, plan 04 skips invalid notes). But plan 04's test case #13 is misleading because it implies plan 04 itself reports the error, when actually plan 03 would reject the note before plan 04 ever sees it.

**Recommendation**: Clarify test case #13 to specify that the error is reported as an `invalid_frontmatter` warning (from plan 03's rejection), not as a plan 04-level error. Or add a defensive check in plan 04's `parseNoteToRawRecord` that flags notes with both fields present.

### FRESH-04-05-06: Plan 05 `retrieve()` signature inconsistency between pseudocode and public API (LOW)

Plan 05's public API section (lines 958-962) declares:
```typescript
function retrieve(
  index: VaultIndex,
  query: RetrievalQuery,
  options?: RetrievalOptions
): RetrievalResult;
```

Parameter order: `index` first, `query` second.

Plan 05's `retrieve()` pseudocode (line 837-838) uses the same order:
```
function retrieve(
  index: VaultIndex,
  query: RetrievalQuery,
  options?: RetrievalOptions
): RetrievalResult
```

Plan 07's call (line 364) uses:
```
retrieval = retrievalEngine.retrieve(index, query, { sequencing: sequencingFull })
```

This is consistent. However, the `00-unified-types.md` Retrieval-Workflow API Boundary (line 427) declares:
```typescript
function retrieve(index: VaultIndex, query: RetrievalQuery, options?: { sequencing?: SequencingResult }): RetrievalResult;
```

This matches plan 05's full `RetrievalOptions` which is a superset (it includes `weights`, `thresholds`, `maxCandidates` in addition to `sequencing`). The `00-unified-types.md` signature shows the minimal shape. This is acceptable -- `00-unified-types.md` shows the canonical boundary contract, plan 05 extends it with implementation options.

**Impact**: None. Noted for completeness.

---

## Type Consistency with 00-unified-types.md

### Plan 04 -- Character-Level Verification

| Type | Plan 04 | 00-unified-types.md | Match? |
|------|---------|---------------------|--------|
| `NoteType` | `'feature' \| 'change' \| 'system' \| 'decision' \| 'source' \| 'query'` | Same | YES |
| `ChangeStatus` | `'proposed' \| 'planned' \| 'in_progress' \| 'applied'` | Same | YES |
| `FeatureStatus` | `'active' \| 'deprecated'` | Same | YES |
| `GeneralStatus` | `'active' \| 'draft' \| 'archived'` | Same | YES |
| `Requirement` | `{ name, key, normative, scenarios: Scenario[], content_hash }` | Same | YES |
| `Scenario` | `{ name, raw_text }` | Same | YES |
| `DeltaSummaryEntry` | `{ op, target_type, target_name, new_name?, target_note_id, base_fingerprint, description? }` | Same | YES |
| `DeltaOp` | `'ADDED' \| 'MODIFIED' \| 'REMOVED' \| 'RENAMED'` | Same | YES |
| `DeltaTargetType` | `'requirement' \| 'section'` | Same | YES |
| `TaskItem` | `{ text, done }` | Same | YES |
| `IndexRecord` | All fields present including `schema_version`, `created_at?`, `feature?`, `features?` | Same | YES |
| `VaultIndex` canonical fields | `{ schema_version, scanned_at, records, warnings }` | Same | YES |
| `VaultIndex` internal fields | `path_to_id, title_to_ids, alias_to_ids, link_errors, duplicate_ids, missing_ids` | Not in unified types | OK (extension) |
| `IndexWarning` | 6 type values | Same 6 values | YES |
| `IndexRecord.mtime`, `IndexRecord.file_size` | Present as cache fields | Not in unified types | OK (documented as "implementation-only, not part of canonical shape" at line 236) |

**Verdict**: Plan 04 types are fully consistent with `00-unified-types.md`. No conflicts.

### Plan 05 -- Character-Level Verification

| Type | Plan 05 | 00-unified-types.md | Match? |
|------|---------|---------------------|--------|
| `RetrievalQuery` | `{ intent, summary, feature_terms, system_terms, entity_terms, status_bias }` | Same | YES |
| `Classification` | `'existing_change' \| 'existing_feature' \| 'new_feature' \| 'needs_confirmation'` | Same | YES |
| `Confidence` | `'high' \| 'medium' \| 'low'` | Same | YES |
| `ScoredCandidate` | `{ id, type, title, score, reasons }` | Same | YES |
| `SequencingSummary` | `{ status, related_changes, reasons }` | Same | YES |
| `SequencingSummary.status` | 5 values: `parallel_safe \| needs_review \| conflict_candidate \| conflict_critical \| blocked` | Same | YES |
| `RetrievalResult` | `{ query, classification, confidence, sequencing, candidates, warnings }` | Same | YES |
| `ScoringSignal` / `SignalType` / `ScoringWeights` | Internal types | Not in unified types | OK (internal) |
| `ScoredCandidateInternal` | Extends `ScoredCandidate` with `signals` | Not in unified types | OK (internal) |
| `ClassificationThresholds` | Internal config type | Not in unified types | OK (internal) |
| `RetrievalWarning` / `RetrievalWarningType` | Internal types | Not in unified types | OK (internal, serialized to `string[]` in output) |

**Verdict**: Plan 05 types are fully consistent with `00-unified-types.md`. No conflicts.

---

## overview.md 10.1-10.7 Compliance

| Section | Requirement | Plan 04 | Plan 05 | Status |
|---------|-------------|---------|---------|--------|
| 10.1 | Vault is truth, index is disposable cache | YES -- stateless `buildIndex()`, fresh each call | N/A | PASS |
| 10.1.1 | Schema version from `wiki/00-meta/schema.md` | YES -- `readSchemaVersion()` using plan 03's `extractFrontmatter()` | N/A | PASS |
| 10.1.1 | Index records `schema_version` | YES -- field on `IndexRecord` | N/A | PASS |
| 10.1.1 | Verify detects schema mismatch | YES -- `schema_mismatch` warning when version is "unknown" | N/A | PASS |
| 10.2 | Fresh scan on propose/query/verify | YES -- fresh call each time | N/A | PASS |
| 10.2 | In-memory default, disk cache optional | YES -- `useCache` option in `BuildOptions` | N/A | PASS |
| 10.2 | Cache invalidation by mtime+size+hash | YES -- documented in `cache.ts` file spec | N/A | PASS |
| 10.3 | Index record shape | YES -- all fields present | N/A | PASS |
| 10.3 | Composite requirement key `feature_id::name` | YES -- computed in `resolveRecordLinks()` (line 522) | N/A | PASS |
| 10.3 | `content_hash` for requirements | YES -- `sha256:<hex>` format documented | N/A | PASS |
| 10.3 | `links_in` as reverse index | YES -- `computeReverseIndex()` | N/A | PASS |
| 10.3 | `delta_summary` on Change records | YES -- delegated from parser, `target_note_id` resolved | N/A | PASS |
| 10.4 | Query object contract | N/A | YES -- `RetrievalQuery` matches | PASS |
| 10.5 | Classification: `existing_change` (score >= 75, gap >= 15) | N/A | YES (lines 700-704) | PASS |
| 10.5 | Classification: `existing_feature` (score >= 70, no active Change within 10) | N/A | YES (lines 729-741) | PASS |
| 10.5 | Classification: `new_feature` (top < 45) | N/A | YES (line 745) | PASS |
| 10.5 | Classification: `needs_confirmation` (top two >= 60, gap < 10) | N/A | YES (lines 709-713) | PASS |
| 10.5 | Classification: `needs_confirmation` on index-quality issues | N/A | YES -- Rule 0, scoped to top 3 (lines 669-685) | PASS |
| 10.5 | Classification: `needs_confirmation` on sequencing severity | N/A | YES -- Rule 0b (lines 687-689) | PASS |
| 10.5 | Classification: `needs_confirmation` on Feature + active Change conflict | N/A | YES -- two sub-rules (lines 715-725) | PASS |
| 10.6 | Output contract fields | N/A | YES -- all 6 fields present in `RetrievalResult` | PASS |
| 10.6 | Warnings include specified types | N/A | YES -- 6 types produced | PASS |
| 10.7 | Wikilink normalization: title -> alias -> error | YES -- `resolveWikilink()` | N/A | PASS |
| 10.7 | Ambiguous alias raises error | YES (line 456-458) | N/A | PASS |
| 10.7 | Missing target raises no_match error | YES (line 461) | N/A | PASS |

**Verdict**: Both plans satisfy all overview.md 10.1-10.7 requirements. No contract violations.

---

## OpenSpec Fidelity

Both plans accurately characterize the OpenSpec baseline. Verified against source:

**Plan 04**: Correctly states OpenSpec uses a Map-based DAG of artifact types within a single change (confirmed: `graph.ts` line 9 `artifacts: Map<string, Artifact>`), Kahn's algorithm for topological sort, and file-existence for completion detection (`state.ts` `detectCompleted()`). Correctly notes OpenSpec has no frontmatter parsing, no wikilink resolution, no cross-note relationship tracking. The contrast table (lines 56-67) accurately maps each dimension.

**Plan 05**: Correctly states OpenSpec has no retrieval pipeline. Confirmed by `propose.ts` source: the workflow goes directly from user input to `openspec new change` with no preflight scan, no candidate scoring, no classification. The only "discovery" is an LLM prompt instruction to check if a change with the same name exists. The contrast table (lines 64-76) is accurate.

No inaccuracies in OpenSpec characterization.

---

## Cross-Plan Consistency

### Plan 03 <-> Plan 04

**Ownership boundary**: Clean. Plan 04 delegates all parsing to plan 03's `parseNote(filePath)` (line 328). `00-unified-types.md` ownership table (line 389) confirms: "Note parsing | vault-parser (03) | index-engine (04) -- must call, not reimplement."

**API alignment**: All three API dependencies are now consistent:
1. `parseNote(filePath: string): ParseResult` -- signature matches
2. `stripWikilinkSyntax(wikilink: string): string` -- now exported from plan 03
3. `extractFrontmatter(content: string)` -- used for lightweight schema version read

**Composite key ownership**: Explicit. Plan 04 computes it (lines 517-523). Plan 03 returns placeholder. Documented in both plans.

No issues remaining.

### Plan 04 <-> Plan 05

**Type alignment**: Consistent. Plan 05 accesses `index.records`, `index.warnings` (canonical fields). Also accesses `index.duplicate_ids`, `index.link_errors` (internal fields) -- see FRESH-04-05-04.

**Data flow**: Plan 05 receives `VaultIndex` as a read-only input. It never modifies the index. Clean consumer pattern.

One low-severity coupling issue (FRESH-04-05-04).

### Plan 04 <-> Plan 06

**Type mismatch**: Plan 06 `analyzeSequencing(index: Map<string, IndexRecord>)` does not accept `VaultIndex`. Plan 07 passes `VaultIndex`. See FRESH-04-05-02.

### Plan 05 <-> Plan 06

**Integration model**: Now mostly consistent. Plan 05 receives `SequencingResult` via `options.sequencing` (line 864), calls `summarizeForRetrieval()` from plan 06 (line 866). Plan 06 exports `summarizeForRetrieval()` (line 813). One stale sentence in plan 06 (FRESH-04-05-01).

### Plan 05 <-> Plan 07

**Function name**: Consistent. Plan 07 calls `retrievalEngine.retrieve()` (line 364), matching plan 05's export.

**Classification ownership**: Clean. Plan 07 explicitly defers to plan 05 (lines 378-382, 816). No duplicate `classify()`.

**Type naming**: Consistent. Both use `VaultIndex`, `RetrievalQuery`, `RetrievalResult`.

**Parameter passing**: Plan 07 passes `{ sequencing: sequencingFull }` where `sequencingFull` is `SequencingResult` (line 358-364). Plan 05's `RetrievalOptions.sequencing` expects `SequencingResult` (line 975). Match.

No issues remaining between plans 05 and 07.

### Naming Summary (Cross-Plan)

| Concept | 00-unified-types.md | Plan 04 | Plan 05 | Plan 06 | Plan 07 |
|---------|---------------------|---------|---------|---------|---------|
| Vault index | `VaultIndex` | `VaultIndex` | `VaultIndex` | `Map<string, IndexRecord>` | `VaultIndex` |
| Query object | `RetrievalQuery` | N/A | `RetrievalQuery` | N/A | `QueryObject` (alias) |
| Main retrieval function | `retrieve()` | N/A | `retrieve()` | N/A | `retrievalEngine.retrieve()` |
| Classification function | N/A | N/A | `classify()` | N/A | Defers to plan 05 |
| Sequencing analysis | N/A | N/A | (receives via options) | `analyzeSequencing()` | `sequencingEngine.analyzeSequencing()` |

The only remaining naming issue: Plan 06 takes `Map<string, IndexRecord>` while all others use `VaultIndex`. Plan 07's `QueryObject` is an alias for constructing the query before normalization to `RetrievalQuery` -- acceptable.

---

## Implementability Assessment

### Plan 04: Index Engine

**Implementable**: YES.

All blocking issues from v3 are resolved. The plan provides:
- Clear 9-step algorithm with pseudocode (lines 300-694)
- Clean file structure with single-responsibility modules (lines 697-708)
- Well-defined public API (lines 712-774)
- Explicit ownership boundaries with plan 03
- Comprehensive test strategy covering 16 test areas (lines 787-855)
- Build sequence with complexity estimates (lines 859-910)

No remaining blockers. The only implementation-time decision is whether to use the convenience accessor namespace (`VaultIndexUtils`) as standalone functions or as class methods.

### Plan 05: Retrieval Engine

**Implementable**: YES.

All blocking issues from v3 are resolved. The critical plan 07 integration conflict (duplicate `classify()`, `search()` vs `retrieve()`) is fully resolved. The plan provides:
- 6-step pipeline with detailed pseudocode for each step (lines 325-885)
- 9 scoring signals with exact weights (lines 192-202)
- 4 classification rules with specific thresholds (lines 263-279)
- Clean file structure (lines 928-941)
- 41 test cases across 5 categories (lines 1017-1078)
- Explicit classification ownership (lines 863, 952-953)

The one medium-severity issue (FRESH-04-05-03: `active_change_overlap` content relevance) is a tuning concern, not a blocker. The pipeline can be implemented as-is and the signal can be refined later.

---

## Gaps and Edge Cases

### Plan 04

1. **Self-referencing wikilinks in typed relationship fields**: Edge case test #14 covers self-referencing wikilinks in `links_out` but does not cover `systems: ["[[Self]]"]` or `touches: ["[[Self]]"]`. The pseudocode handles it correctly (no infinite loop, self-id appears in the resolved array), but a test case confirming this would be useful.

2. **Deterministic duplicate-id resolution by path**: Plan 04 keeps the first occurrence by alphabetical path order (line 670: `if raw.path !== paths.sort()[0]: continue`). This is documented and deterministic, but `paths.sort()` is called inside a loop for each raw record, meaning the sort runs N times for a duplicate with N occurrences. Minor inefficiency -- precompute the winner once.

3. **`extractFrontmatter` for schema version**: Plan 04 uses `extractFrontmatter(content)` (from plan 03) to read `schema.md` frontmatter (line 321). But `schema.md` may not follow the standard note frontmatter schema (it has `schema_version` and `note_types` instead of `type`, `id`, `status`). If plan 03's `extractFrontmatter()` only validates standard note frontmatter, it might reject `schema.md`. However, `extractFrontmatter()` is documented as "Parses YAML frontmatter from a markdown string without full note parsing" (00-unified-types.md line 407), suggesting it does raw YAML parsing without schema validation. This should work, but worth an explicit test.

### Plan 05

1. **Scoring interaction at threshold boundary**: A candidate with `full_text_match` (+15) + `active_change_overlap` (+25) + `status_bias` (+5) = 45. This is exactly at the `new_feature.max_top_score` threshold. The classification rule (line 745) uses `top.score < thresholds.new_feature.max_top_score`, so score 45 does NOT classify as `new_feature`. It falls through to the ambiguous middle ground (lines 750-752), resulting in `needs_confirmation`. This behavior is correct per the rules but surprising -- a candidate scoring only on non-content signals (graph-expanded active change + status bias + full-text coincidence) prevents `new_feature` classification. Test case should cover this boundary.

2. **Graph expansion can explode in densely-linked vaults**: If a popular System note has 50 notes linking to it, and one of those is a first-pass candidate, graph expansion adds all 50 (via `links_in`). Each of those 50 notes adds their own `links_out` and `links_in`. While the expansion is exactly one hop (not recursive), in a dense vault the expanded set could be 200+ candidates. The scoring step then runs 9 signal checks across all of them. This is O(candidates * records * signals) in the worst case. Not a v1 blocker, but worth noting for future optimization.

3. **`findSystemByTerm()` called once per query system_term per candidate**: In `scoreCandidates()` (line 525), `findSystemByTerm(t, index)` iterates all records for each `system_term`. This is called inside the per-candidate loop, so it runs `system_terms.length * candidates.length * records.length` times total. Should be precomputed once before the candidate loop. Not a correctness issue, just a performance concern for large vaults.

---

## Overview.md Limitations (Status Update)

### From v3

| Limitation | Status | Notes |
|------------|--------|-------|
| 10.5 `needs_confirmation` index-quality scope ambiguous | **RESOLVED in plans** | Plan 05 scoped to top 3 candidates. overview.md itself unchanged, but the plan's interpretation is reasonable and documented. |
| overview.md does not specify who owns classification | **RESOLVED in plans** | Plan 05 owns classification. Plan 07 defers. `00-unified-types.md` ownership table (line 392) now states: "Classification (scoring -> classification) | retrieval-engine (05) | workflow-propose (07) -- must consume, not reimplement." |
| 9.1 does not define "strong full-text match" | UNCHANGED | Plan 05 defines it as 2+ terms (or 1 if single-term query). Reasonable interpretation. overview.md remains unspecified. |
| 10.4 does not specify query normalization ownership | UNCHANGED | Plan 07 normalizes. Plan 05 does not validate. Acceptable division. |

### Newly Discovered

**None.** The plans have matured to the point where all overview.md requirements are satisfied, and the remaining overview.md ambiguities have reasonable plan-level interpretations that are well-documented.

---

## Over-Engineering Assessment

Both plans are appropriately scoped for v1:

1. **Plan 04**: The VaultIndexUtils namespace (lines 737-774) defines 11 convenience accessors. Some (`getBySystem`, `getLinkedFrom`, `getLinkedTo`, `hasWarningType`) are unlikely to be used by v1 consumers (plan 05 accesses `records` directly, plan 07 does not use these accessors). These are low-cost utility functions and do not add complexity to the core algorithm.

2. **Plan 05**: The `RetrievalOptions` with configurable `weights` and `thresholds` (lines 964-976) allows per-vault tuning via `conventions.md`. This is specified in overview.md 9.1 ("adjustable per vault via conventions.md") so it's required, not over-engineered.

3. **Plan 05**: The `ScoredCandidateInternal` type (lines 227-230) extends `ScoredCandidate` with a `signals` field for debugging. This is explicitly documented as "Internal-only: detailed signal breakdown for debugging" and "NOT part of canonical output contract." Appropriate.

No over-engineering concerns.

---

## Summary Verdict

**PASS** -- both plans are ready for implementation.

All 4 HIGH-severity issues from v3 have been fully resolved. The remaining issues are either low-severity or carry minimal implementation risk.

### Must Fix (blocks implementation)

None.

### Should Fix (reduces integration friction)

| Priority | Issue | Plans Affected |
|----------|-------|---------------|
| MEDIUM | FRESH-04-05-02: Plan 06 `analyzeSequencing()` takes `Map` but caller passes `VaultIndex` | 06, 07 |
| MEDIUM | FRESH-04-05-03: `active_change_overlap` fires without content relevance gate | 05 |

### Acceptable for v1

| Priority | Issue | Plans Affected |
|----------|-------|---------------|
| LOW | FRESH-04-05-01: Plan 06 integration section has one stale sentence | 06 |
| LOW | FRESH-04-05-04: `collectWarnings` accesses internal `VaultIndex` fields | 05, 04 |
| LOW | FRESH-04-05-05: `feature`/`features` mutual exclusivity test gap | 04 |
| LOW | FRESH-04-05-06: `retrieve()` signature noted for completeness | 05 |
| LOW | STILL-OPEN-03 (carried): Sequencing analysis scope not documented in plan 05 | 05 |
| LOW | FRESH-05-04 (carried): `status_bias` defaults not applied in plan 05 | 05 |

### Progress Across Review Cycles

| Cycle | Total Issues | HIGH | MEDIUM | LOW | Verdict |
|-------|-------------|------|--------|-----|---------|
| v1 | 17 | 5 | 7 | 5 | CONDITIONAL PASS |
| v2 | 8 new | 0 | 5 | 3 | CONDITIONAL PASS |
| v3 | 11 new + 3 carried | 4 | 5 | 5 | CONDITIONAL PASS |
| **v4** | **6 new + 2 carried** | **0** | **2** | **6** | **PASS** |
