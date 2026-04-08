# Review v3: Plans 04-05 (Index & Retrieval)

**Reviewer**: Devil's Advocate Agent (Round 3)
**Date**: 2026-04-06
**Plans Reviewed**:
- `plans/04-index-engine.md`
- `plans/05-retrieval-engine.md`

**Reference Documents**:
- `overview.md` (sections 8, 9, 10, 11)
- `plans/00-unified-types.md`
- OpenSpec source: `src/core/artifact-graph/graph.ts`, `types.ts`, `state.ts`, `schema.ts`; `src/core/templates/workflows/propose.ts`, `explore.ts`
- `plans/03-vault-parser.md`, `plans/06-sequencing-engine.md`, `plans/07-workflow-propose.md`
- Previous reviews: `plans/reviews/review-04-05.md`, `plans/reviews-v2/review-04-05.md`

---

## Previous Issues Resolution Status

### From v1 review (17 issues)

All 17 original issues were addressed in the v2 cycle: 12 resolved, 2 partially resolved, 3 unchanged (low severity, acceptable for v1). No regression.

### From v2 review (8 new issues)

| Issue ID | Summary | Status in v3 | Notes |
|----------|---------|--------------|-------|
| NEW-ISSUE-04-01 | `parseNoteToRawRecord` null-return ambiguity + undefined `isTypedNote()` | UNCHANGED | Plan 04 buildIndex (line 594) still calls `isTypedNote(file)` after `parseNoteToRawRecord` returns null, but `isTypedNote()` is never defined. The v2 recommendation of a discriminated return type was not adopted. See STILL-OPEN-01. |
| NEW-ISSUE-04-02 | `Requirement.name` vs overview.md `Requirement.title` | UNCHANGED | overview.md 10.3 still uses `"title": "Passkey Authentication"` while plans and unified types use `name`. Cosmetic divergence; plans are correct per 00-unified-types.md authority. |
| NEW-ISSUE-04-03 | `DeltaSummaryEntry.feature` vs `target_note_id` | UNCHANGED | overview.md 10.3 still uses `"feature"` where plans use `"target_note_id"`. Same resolution path as 04-02. |
| NEW-ISSUE-04-04 | `Requirement.scenarios` type: `string[]` vs `Scenario[]` | UNCHANGED | overview.md uses flat `string[]`, plans use `Scenario[]` objects. Plans are richer and correct per unified types. |
| NEW-ISSUE-05-01 | Index-quality escalation scope too broad | UNCHANGED | `classify()` Rule 0 (lines 669-683) still checks ALL candidate paths against warnings, not just top candidates. See STILL-OPEN-02. |
| NEW-ISSUE-05-02 | Sequencing ordering: chicken-and-egg with retrieval | UNCHANGED | Plan 05 dependencies (line 996) documents caller-side composition, but does not clarify that `analyzeSequencing()` operates on ALL active changes from the full index regardless of retrieval candidates. See STILL-OPEN-03. |
| NEW-ISSUE-05-03 | `SequencingSummary` derivation from `SequencingResult` undocumented in plan 05 | PARTIALLY RESOLVED | Plan 06 (line 813-819) now defines `summarizeForRetrieval()` which extracts `{ status, related_changes, reasons }` from `SequencingResult`. Plan 05 does not reference this function but the integration is documented in plan 06's "Integration with Retrieval Engine" section (line 832-858). |
| NEW-ISSUE-05-04 | `warnings` field type mismatch (structured internally, `string[]` externally) | UNCHANGED | Acceptable for v1. Machine consumers would need to parse message strings to react to specific warning types. |

**Resolution summary from v2**: 0 fully resolved, 1 partially resolved, 7 unchanged. Most are cosmetic or acceptable for v1, but STILL-OPEN-01, 02, and 03 carry real implementation risk.

---

## Fresh Issues (v3)

### FRESH-04-01: `stripWikilinkSyntax` dependency does not exist in plan 03 (HIGH)

Plan 04's "Dependencies on Other Modules" section (line 722) lists `stripWikilinkSyntax(raw)` as a dependency from plan 03. This function is referenced in the `resolveWikilink` algorithm (line 417).

**Problem**: Plan 03 does NOT export or define `stripWikilinkSyntax`. Searching plan 03 for `stripWikilink` or `strip.*link` yields zero matches. Plan 03 exports `extractWikilinks()` and `uniqueWikilinkTargets()`, which extract wikilinks from markdown content, but there is no standalone function for stripping wikilink syntax (`[[...]]` brackets, display text after `|`).

**Impact**: The wikilink resolution algorithm in plan 04 (step 5) cannot be implemented without this function. It must either:
- Be added to plan 03's public API, or
- Be implemented locally in plan 04 (which would violate the ownership rule that all parsing belongs to plan 03).

**Recommendation**: Add `stripWikilinkSyntax(raw: string): string` to plan 03's exports. The logic is trivial (strip `[[` and `]]`, drop `|display_text`), but the ownership boundary requires it to live in plan 03.

### FRESH-04-02: Plan 04 `parseNote()` takes a file path, but plan 03's `parseNote()` takes content string (HIGH)

Plan 04 step 3 (line 331) calls:
```
parseResult = parseNote(fileEntry.absolutePath)
```
But plan 03's `parseNote()` (line 1077) is defined as:
```typescript
export function parseNote(content: string): ParseResult
```
It takes a **string of markdown content**, not a file path.

This means plan 04 must read the file contents first, then pass them to `parseNote(content)`. The plan's pseudocode passes the path directly, which will fail at implementation time.

**Recommendation**: Fix plan 04's step 3 pseudocode to read the file first:
```
content = readFile(fileEntry.absolutePath)
parseResult = parseNote(content)
```

### FRESH-04-03: Plan 04 does not pass `feature_id` for requirement composite key construction (MEDIUM)

Plan 04's `parseNoteToRawRecord` (line 369) assumes `parseResult.requirements` already contains fully constructed `Requirement` objects with `key: feature_id::name`. But for plan 03's `parseNote()` to compute the composite key, it needs the note's `id` -- which it only knows from parsing the same note's frontmatter.

Looking at plan 03 (line 1077), `parseNote(content)` returns `ParseResult` which includes `frontmatter.id`. The requirement parser (line 646) would need access to this id to generate the composite key.

**Verification**: Plan 03's requirement parser (lines 646-858) parses requirements from the `## Requirements` section. The composite key generation depends on:
1. The feature note's `id` (from frontmatter)
2. The requirement's `name` (from `### Requirement: <name>` header)

Plan 03's `parseNote()` handles both frontmatter extraction and requirement parsing in sequence (line 1077-1155), so it CAN construct the composite key internally. However, the requirement parser is documented as a standalone function `parseRequirements(section)` which receives a section, not the note id.

**Impact**: Either `parseRequirements()` must receive the `feature_id` as a parameter, or the composite key must be assembled by the caller (plan 04). If plan 04 assembles it, requirements from the parser will lack the `key` field until plan 04 enriches them -- which blurs the ownership boundary.

**Recommendation**: Clarify in plan 04 that `parseNote()` internally passes the frontmatter id to the requirement parser, and the returned `ParseResult.requirements[]` already has the `key` field populated. If plan 03 does not do this, document that plan 04 must enrich the `key` field after receiving the ParseResult.

### FRESH-04-04: `DeltaSummaryEntry.target_note_id` is stored as raw wikilink but plan 04 never resolves it (MEDIUM)

`DeltaSummaryEntry` (from 00-unified-types.md, line 115) has `target_note_id: string` described as "Wikilink-resolved feature/note id". Plan 04's `resolveRecordLinks()` (lines 446-485) resolves `systems_raw`, `sources_raw`, `decisions_raw`, `changes_raw`, `depends_on_raw`, `touches_raw`, `feature_raw`, `features_raw`, and `links_out_raw`.

**But it never resolves `delta_summary[].target_note_id`.**

The delta summary entries come from plan 03's parser and likely contain raw wikilink text (e.g., `"[[Feature: Auth Login]]"`). Plan 04 must resolve each `target_note_id` in the delta summary entries to actual note IDs, just like it resolves the frontmatter relationship fields.

**Recommendation**: Add delta_summary target resolution to `resolveRecordLinks()`:
```
record.delta_summary = rawRecord.delta_summary.map(entry => ({
  ...entry,
  target_note_id: resolveSingle(entry.target_note_id_raw) ?? entry.target_note_id_raw
}))
```

### FRESH-05-01: Plan 07 calls `retrievalEngine.search()` but plan 05 exports `retrieve()` (HIGH)

Plan 07's `runPreflight()` (line 344) calls:
```
candidates = retrievalEngine.search(query, index)
```
But plan 05's public API (lines 936-949) exports:
```typescript
function retrieve(query: RetrievalQuery, index: VaultIndex, options?: RetrievalOptions): RetrievalResult;
```

The function name is `retrieve`, not `search`. Furthermore, `retrieve()` returns a full `RetrievalResult` (with classification, confidence, sequencing, warnings), not just `ScoredCandidate[]`.

Plan 07 then separately calls `classify()` and builds its own `RetrievalResult` -- duplicating logic that `retrieve()` already performs.

**This means plan 07 is bypassing plan 05's classification entirely and re-implementing it.**

Looking closer at plan 07 (lines 342-392), it:
1. Calls `retrievalEngine.search(query, index)` -- gets candidates only
2. Calls `sequencingEngine.analyzeSequencing(index)` separately
3. Calls its own `classify(candidates, sequencingResult)` -- re-implements classification
4. Assembles `RetrievalResult` manually

But plan 05's `retrieve()` already does steps 1-4 internally (lexical retrieval -> graph expansion -> scoring -> classification -> output assembly).

**Impact**: This is a design coherence problem, not a bug per se. But it means:
- Plan 05's `classify()` will never be called by the primary consumer (plan 07)
- Plan 07 will have its own classification rules that may drift from plan 05's
- The boundary between "retrieval engine" and "workflow propose" is blurred

**Root cause**: Plan 05 and plan 07 were designed with different integration models. Plan 05 assumes it owns the full pipeline. Plan 07 assumes it owns classification and only uses plan 05 for search/scoring.

**Recommendation**: One of these two approaches must win:
- **Option A**: Plan 07 calls `retrieve()` and gets a complete `RetrievalResult`. Plan 07 only adds sequencing severity escalation on top (which it already does at lines 359-379). This means passing `sequencingSummary` via `options.sequencing` to `retrieve()`.
- **Option B**: Plan 05 exports individual pipeline steps (`lexicalRetrieval`, `scoreCandidates`) for plan 07 to compose. Plan 05's `retrieve()` becomes a convenience wrapper, not the required API.

Option A is cleaner and matches plan 05's documented public API. Plan 07's `runPreflight()` should be:
```
sequencingResult = analyzeSequencing(index)
sequencingSummary = summarizeForRetrieval(sequencingResult)
result = retrieve(query, index, { sequencing: sequencingSummary })
```

### FRESH-05-02: Plan 07 uses `IndexStore` while plan 04/05 use `VaultIndex` (MEDIUM)

This was flagged in v1 review (Cross-Cutting #1) and noted as "check with plan 07 reviews." Plan 07 consistently uses `IndexStore` (lines 342, 539, 764, 803, 827, 941) while plan 04 defines and plan 05 consumes `VaultIndex`. These are the same concept.

The v2 review confirmed plan 04 and plan 05 naming is unified and consistent with `00-unified-types.md`. But plan 07 still diverges.

**Impact**: At implementation time, this will either cause a type error (if the import is literal) or confusion (if it's just a pseudocode alias). Since plan 07 is the primary consumer of both plan 04 and plan 05, this naming divergence will surface immediately.

**Recommendation**: Plan 07 should use `VaultIndex` everywhere, matching `00-unified-types.md` and plans 04/05. `IndexStore` should be removed.

### FRESH-05-03: Plan 07 has its own `classify()` that conflicts with plan 05's `classify()` (HIGH)

Related to FRESH-05-01. Plan 07 defines its own `classify()` function (line 397-538) with its own threshold rules, which differ from plan 05's `classify()` (lines 660-757) in several ways:

1. **Rule evaluation order differs**: Plan 07 checks `existing_change` (Rule 2), then `needs_confirmation: close scores` (Rule 3), then `existing_feature` (Rule 4), then `needs_confirmation: feature + active change` (Rule 5), then `new_feature` (Rule 6). Plan 05 checks `index-quality escalation` (Rule 0), `sequencing escalation` (Rule 0b), `existing_change` (Rule 1), `needs_confirmation: close scores` (Rule 2), `needs_confirmation: feature + active change` (two sub-rules), `existing_feature` (Rule 3), `new_feature` (Rule 4), then fallback.

2. **Plan 07 does NOT have index-quality escalation (Rule 0)**: The fix for ISSUE-05-07 (overview.md 10.5 compliance) was applied to plan 05 but plan 07's duplicate `classify()` does not include it. If plan 07 is the one actually called at runtime, the overview.md 10.5 contract for index-quality escalation is violated.

3. **Plan 07 adds `SequencingResult` as a parameter**: Its classify takes `(candidates, sequencingResult)` where plan 05 takes `(candidates, thresholds, index, sequencing?)`. Different parameter shapes.

4. **Plan 07 returns `ClassificationResult` with `primary_candidate` and `secondary_candidate` fields**: Plan 05 returns `{ classification, confidence }`. Different return types.

**Impact**: Two competing classify implementations will cause either:
- A build error if both export `classify` and a consumer imports the wrong one
- Divergent behavior if they evolve independently
- Contract violation if plan 07's version is used (missing index-quality escalation)

**Recommendation**: This is the most significant cross-plan inconsistency. Either:
- Plan 07 uses plan 05's `classify()` and wraps it with the `ClassificationResult` envelope, or
- Plan 05 adopts plan 07's richer `ClassificationResult` return type and plan 07 delegates

### FRESH-05-04: `status_bias` default values per intent are not implemented in plan 05 (LOW)

overview.md 10.4 specifies intent-specific defaults:
- `add`/`modify` -> `["active", "proposed", "planned", "in_progress"]`
- `remove` -> `["active", "applied"]`
- `query` -> all statuses

Plan 05's `retrieve()` does not compute intent-specific defaults. It expects the caller to provide `status_bias` in the query object. Plan 07's `normalizeQuery()` (lines 278-337) does apply intent-specific defaults.

This is acceptable because the contract is that the caller normalizes the query, but plan 05 should document that it does NOT apply intent-specific defaults and expects `status_bias` to be pre-populated by the caller.

### FRESH-05-05: `active_change_overlap` signal fires for active Changes found via graph expansion with no content relevance (MEDIUM)

This was noted in v1 (ISSUE-05-05) and marked "unchanged, acceptable for v1." However, on closer analysis the impact is larger than acknowledged.

Consider: Query is "add email notifications." A Feature "Auth Login" is a lexical hit (title contains "login" which is unrelated, but "add" is an entity_term). Via graph expansion, an active Change "Fix Auth Session Bug" (linked from Auth Login) enters the candidate set. This Change gets:
- `active_change_overlap`: +25 (it's active, unconditionally)
- `backlink_proximity`: +10 (shares links with Auth Login, another candidate)

Total: 35. Under `new_feature` threshold of 45, so it won't dominate classification. But in a vault with many active changes, multiple unrelated active changes could accumulate and push classification toward `needs_confirmation` via the "close scores" rule (top two >= 60, gap < 10).

**Recommendation**: Gate the `active_change_overlap` signal on content relevance: only fire if the Change also has at least one other content-based signal (title, alias, system, source, decision, or full-text match). This prevents graph-expanded active changes from getting free points.

### FRESH-05-06: Sequencing integration is documented differently across plans 05, 06, and 07 (MEDIUM)

Three plans describe the sequencing integration, and they don't fully agree:

**Plan 05** (line 996): "the caller (plan 07 workflow-propose) calls `analyzeSequencing()` from plan 06 first, then passes the resulting `SequencingSummary` into `retrieve()` via `options.sequencing`."

**Plan 06** (line 851-853): "The retrieval engine should: 1. After scoring candidates, call `analyzeSequencing(index)` to get the full result. 2. Call `summarizeForRetrieval(result)` to produce the compact `SequencingSummary`."

**Plan 07** (line 347-349): Calls `analyzeSequencing(index)` and `summarizeForRetrieval(result)` directly in `runPreflight()`, not inside `retrieve()`.

So:
- Plan 05 says the caller passes sequencing in via options (caller-side composition)
- Plan 06 says the retrieval engine itself calls sequencing (internal composition)
- Plan 07 calls sequencing separately and builds the result manually (bypassing plan 05)

These three descriptions are mutually contradictory. At implementation time, only one can be true.

**Recommendation**: Standardize on one model. Given FRESH-05-01's analysis, the cleanest approach is:
1. Plan 07 calls `analyzeSequencing(index)` and `summarizeForRetrieval(result)` (plan 07 owns the orchestration)
2. Plan 07 passes the `SequencingSummary` into `retrieve(query, index, { sequencing })` (plan 05 receives it)
3. Plan 05's `retrieve()` uses the passed sequencing for classification escalation (plan 05 owns classification)
4. Plan 06 documents that its `analyzeSequencing` is called by the workflow layer, not by the retrieval engine

### FRESH-05-07: Plan 06's `analyzeSequencing()` takes `Map<string, IndexRecord>` but plan 04's `VaultIndex.records` is `Map<string, IndexRecord>` -- caller must unwrap (LOW)

Plan 06 defines `analyzeSequencing(index: Map<string, IndexRecord>)` (line 641). Plan 04's `VaultIndex` wraps this as `records: Map<string, IndexRecord>`. The caller (plan 07) must pass `index.records` rather than `index` directly.

Plan 07 passes `index` (the full `IndexStore`/`VaultIndex`) to `analyzeSequencing(index)` without unwrapping. This will fail at implementation unless plan 06 is updated to accept `VaultIndex` or plan 07 is updated to pass `index.records`.

**Recommendation**: Plan 06 should accept `VaultIndex` (the canonical type) rather than a raw `Map`, to maintain type consistency across the chain.

---

## Carried Forward (Still Open from v2)

### STILL-OPEN-01: `parseNoteToRawRecord` null-return ambiguity (MEDIUM)

Plan 04's `buildIndex` (line 594) still uses `isTypedNote(file)` which is undefined. The v2 recommendation of a discriminated `ParseOutcome` return type was not adopted. This will cause a bug at implementation: notes with a valid `type` but missing `id` will be silently dropped instead of recorded in `missing_ids`.

### STILL-OPEN-02: Index-quality escalation scope too broad (MEDIUM)

Plan 05's `classify()` Rule 0 escalates `needs_confirmation` when ANY candidate path matches a warning, including low-scoring irrelevant candidates. A clear `existing_feature` (score 90) can be overridden by a `duplicate_id` warning on an unrelated candidate #8 (score 15).

### STILL-OPEN-03: Sequencing analysis scope ambiguity (LOW)

Plan 05 does not explicitly state that `analyzeSequencing()` operates on ALL active changes from the full index, not just retrieval candidates. The v2 recommendation to document this was not adopted. Plan 06 (line 641-643) clarifies that it filters to active changes from the full index, but plan 05 should also note this to prevent misunderstanding.

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
| `TaskItem` | `{ text, done }` | Same | YES |
| `IndexRecord` | All 20+ fields | All fields present | YES |
| `VaultIndex` canonical fields | `{ schema_version, scanned_at, records, warnings }` | Same | YES |
| `VaultIndex` internal fields | `path_to_id, title_to_ids, alias_to_ids, link_errors, duplicate_ids, missing_ids` | Not in unified types (internal) | OK (extension, not conflict) |
| `IndexWarning` | 6 type values | Same 6 values | YES |

**Verdict**: Plan 04 types are fully consistent with `00-unified-types.md`.

### Plan 05 -- Character-Level Verification

| Type | Plan 05 | 00-unified-types.md | Match? |
|------|---------|---------------------|--------|
| `RetrievalQuery` | `{ intent, summary, feature_terms, system_terms, entity_terms, status_bias }` | Same | YES |
| `Classification` | 4 values | Same | YES |
| `Confidence` | 3 values | Same | YES |
| `ScoredCandidate` | `{ id, type, title, score, reasons }` | Same | YES |
| `SequencingSummary` | `{ status, related_changes, reasons }` | Same | YES |
| `RetrievalResult` | `{ query, classification, confidence, sequencing, candidates, warnings }` | Same | YES |
| `ScoringSignal` / `SignalType` / `ScoringWeights` | Internal types | Not in unified types | OK (not canonical) |
| `ScoredCandidateInternal` | Extends `ScoredCandidate` with `signals` | Not in unified types | OK (internal extension) |

**Verdict**: Plan 05 types are fully consistent with `00-unified-types.md`.

---

## overview.md 10.1-10.7 Compliance

| Section | Requirement | Plan 04 | Plan 05 | Status |
|---------|-------------|---------|---------|--------|
| 10.1 | Vault is truth, index is disposable cache | YES -- stateless `buildIndex()` | N/A | PASS |
| 10.1.1 | Schema version from `wiki/00-meta/schema.md` | YES -- `readSchemaVersion()` | N/A | PASS |
| 10.1.1 | Index records `schema_version` | YES -- field on `IndexRecord` | N/A | PASS |
| 10.1.1 | Verify detects schema mismatch | YES -- `schema_mismatch` warning | N/A | PASS |
| 10.2 | Fresh scan on propose/query/verify | YES -- fresh call each time | N/A | PASS |
| 10.2 | In-memory default, disk cache optional | YES -- `useCache` option | N/A | PASS |
| 10.2 | Cache invalidation by mtime+size+hash | YES -- documented in cache.ts spec | N/A | PASS |
| 10.3 | Index record shape | YES -- all fields present | N/A | PASS |
| 10.3 | Composite requirement key `feature_id::name` | YES -- `key: string` | N/A | PASS |
| 10.3 | `content_hash` for requirements | YES -- `sha256:<hex>` format | N/A | PASS |
| 10.3 | `links_in` as reverse index | YES -- `computeReverseIndex()` | N/A | PASS |
| 10.3 | `delta_summary` on Change records | YES -- delegated from parser | N/A | PASS |
| 10.4 | Query object contract | N/A | YES -- `RetrievalQuery` matches | PASS |
| 10.5 | Classification thresholds | N/A | YES -- all 4 categories correct | PASS |
| 10.5 | `existing_change`: score >= 75, gap >= 15 | N/A | YES (line 701-702) | PASS |
| 10.5 | `existing_feature`: score >= 70, no active Change within 10 | N/A | YES (lines 726-739) | PASS |
| 10.5 | `new_feature`: top < 45 | N/A | YES (line 743) | PASS |
| 10.5 | `needs_confirmation`: top two >= 60, gap < 10 | N/A | YES (lines 707-711) | PASS |
| 10.5 | `needs_confirmation`: index-quality issues | N/A | YES -- Rule 0 (lines 669-683) | PASS (scope issue, see STILL-OPEN-02) |
| 10.5 | `needs_confirmation`: sequencing severity escalation | N/A | YES -- Rule 0b (lines 685-688) | PASS |
| 10.6 | Output contract: all fields | N/A | YES -- `RetrievalResult` complete | PASS |
| 10.6 | Warnings include 6 specified types | N/A | YES -- all 6 produced | PASS |
| 10.7 | Wikilink normalization: title -> alias -> error | YES -- `resolveWikilink()` | N/A | PASS |
| 10.7 | Ambiguous alias raises error | YES (line 432) | N/A | PASS |
| 10.7 | Missing id raises error | YES (line 344) | N/A | PASS |

**Verdict**: Both plans satisfy all overview.md 10.1-10.7 requirements. No contract violations.

---

## OpenSpec Fidelity

Both plans accurately characterize the OpenSpec baseline:

**Plan 04** correctly identifies that OpenSpec's `ArtifactGraph` is a DAG of artifact types within a single change, using Kahn's algorithm for topological sort and file-existence for completion detection. This maps well to the verified source in `graph.ts` (Map-based DAG, `getBuildOrder()` with Kahn's algorithm, alphabetical tie-breaking) and `types.ts` (Zod schemas, `CompletedSet = Set<string>`).

**Plan 05** correctly states that OpenSpec has no retrieval pipeline. The `propose.ts` source confirms: no preflight scan, no candidate scoring, no classification. The LLM is given a prompt to "ask what they want to build" and then creates artifacts in sequence. The `explore.ts` workflow reads `openspec list --json` but performs no structured search.

No inaccuracies in OpenSpec characterization.

---

## Cross-Plan Consistency

### Plan 03 <-> Plan 04

**Ownership boundary**: Clean. Plan 04 correctly delegates all parsing to plan 03's `parseNote()` (line 328-329). Documented in both `00-unified-types.md` (line 385-386) and plan 04.

**API mismatch**: Two issues:
1. `stripWikilinkSyntax` dependency does not exist in plan 03 (FRESH-04-01, HIGH)
2. `parseNote()` signature mismatch: plan 04 passes file path, plan 03 takes content string (FRESH-04-02, HIGH)

### Plan 04 <-> Plan 05

**Type alignment**: Consistent. Plan 05 accesses `index.records`, `index.warnings`, `index.duplicate_ids`, `index.link_errors` -- all present on plan 04's `VaultIndex`.

**Cross-boundary dependency on internal fields**: Plan 05's `collectWarnings()` (line 773) and `classify()` Rule 0 both access internal fields (`index.duplicate_ids`, `index.link_errors`, `index.missing_ids`) that are not in the canonical `VaultIndex` shape from `00-unified-types.md`. As noted in v2, plan 05 should rely on `index.warnings` (canonical) for warning aggregation, which already contains all the information in structured `IndexWarning[]` form.

### Plan 04 <-> Plan 06

**Type alignment**: Plan 06 takes `Map<string, IndexRecord>` but plan 04's VaultIndex wraps records in `records: Map<string, IndexRecord>`. Minor unwrapping needed (FRESH-05-07).

### Plan 05 <-> Plan 06

**Integration model inconsistency**: Plan 05 says caller passes sequencing via options. Plan 06 says retrieval engine calls sequencing internally. See FRESH-05-06.

### Plan 05 <-> Plan 07

**Function name mismatch**: `retrieve()` vs `search()` (FRESH-05-01, HIGH).
**Type name mismatch**: `VaultIndex` vs `IndexStore` (FRESH-05-02, MEDIUM).
**Duplicate classification logic**: Both plans implement `classify()` with different rules (FRESH-05-03, HIGH).

### Naming Summary

| Concept | 00-unified-types.md | Plan 04 | Plan 05 | Plan 06 | Plan 07 |
|---------|---------------------|---------|---------|---------|---------|
| Vault index | `VaultIndex` | `VaultIndex` | `VaultIndex` | (takes `Map` directly) | `IndexStore` |
| Query object | `RetrievalQuery` | N/A | `RetrievalQuery` | N/A | `QueryObject` |
| Main retrieval function | N/A | N/A | `retrieve()` | N/A | `retrievalEngine.search()` |
| Classification function | N/A | N/A | `classify()` | N/A | `classify()` (different impl) |

---

## Implementability Assessment

### Plan 04: Index Engine

**Implementable**: YES, after fixing two HIGH issues.

The plan is well-structured with clear pseudocode and a clean file layout. The core algorithm (scan -> parse -> resolve links -> reverse index -> assemble) is straightforward. Main blockers:

1. FRESH-04-01: `stripWikilinkSyntax` must be added to plan 03 or locally defined
2. FRESH-04-02: `parseNote()` call must pass content, not file path

Both are trivial fixes. The remaining issues (STILL-OPEN-01 null-return ambiguity, FRESH-04-03 composite key construction, FRESH-04-04 delta summary resolution) are implementation-time decisions with clear solutions.

### Plan 05: Retrieval Engine

**Implementable**: YES, but the integration model with plan 07 must be resolved first.

The scoring pipeline (lexical retrieval -> graph expansion -> 9 signal scoring -> classification) is complete and well-tested. The main risk is not internal but external:

1. FRESH-05-01/03: Plan 07 bypasses `retrieve()` and re-implements classification. This must be resolved before implementation to avoid building two competing classification engines.
2. FRESH-05-06: Sequencing integration model is documented three different ways across three plans. One model must be chosen.

The retrieval engine itself can be implemented and tested in isolation using fixture vaults. The integration question is a design decision for the team lead.

---

## Gaps and Edge Cases

### Plan 04

1. **No handling of circular wikilinks in link resolution**: If note A's frontmatter contains `systems: ["[[Note A]]"]` (self-reference), `resolveWikilink` will resolve it to its own id. This is handled correctly in `computeReverseIndex` (self-link doesn't cause infinite loop), but the self-link will appear in `links_out` and `systems`. Edge case test #14 covers self-referencing wikilinks in `links_out` but not in typed relationship fields like `systems`.

2. **No validation of `feature:` and `features:` mutual exclusivity**: Test case #13 mentions "Note with both `feature:` and `features:` (invalid) -> error reported" but the pseudocode (lines 474-480) handles both fields without checking mutual exclusivity. The error is expected but no code produces it.

3. **Archive handling**: Test case #15 says archived notes in `99-archive/` are still indexed. This is correct, but the plan does not document whether applied Changes (status: `applied`) in the archive should affect the reverse index. They should, and the plan's algorithm handles this correctly (no status filter in reverse index computation), but this is worth an explicit note.

### Plan 05

1. **Feature candidate without any Changes can still get `active_change_overlap`**: If a Feature note has `changes: ["change-x"]` in its frontmatter and `change-x` is active, the Feature gets +25. But if `change-x` was pulled in by graph expansion from a completely different query, this creates a misleading signal. The Feature's score inflates because of an unrelated active change.

2. **No cap on number of reasons per candidate**: If a candidate matches on all 9 signals, `reasons[]` will have 9+ entries. For large vaults, this could produce verbose output. Minor.

3. **`full_text_match` + graph expansion interaction**: A note enters the candidate set via graph expansion (one hop). It has no title/alias/system match but contains 2 query terms in its body. It gets +15 (full_text_match). If it's also an active Change, it gets +25 (active_change_overlap). Total: 40. Close to the new_feature threshold of 45, and with the +5 status bias bonus, it reaches 45 -- exactly at the threshold. This edge case should be tested.

---

## Overview.md Limitations (Newly Discovered)

### 1. overview.md 10.5 `needs_confirmation` index-quality scope is still ambiguous

The v1 review flagged this (overview.md Limitation #3). Overview.md says `needs_confirmation` fires when "index-quality issues exist, such as duplicate IDs, ambiguous wikilinks, or missing targets." It does not specify:
- Whether the issues must affect top candidates specifically, or any note in the vault
- Whether the issues must affect candidate notes or any notes referenced by candidates
- What severity level the issues must have

Plan 05's current implementation (check all candidate paths) is the most conservative reading, but probably over-aggressive. The spec should clarify.

### 2. overview.md does not specify who owns classification

Overview.md 10.5 defines classification rules. Both plan 05 (retrieval engine) and plan 07 (workflow propose) implement them independently. The spec says the "retrieval subagent" returns "classification hints" (10.5: "the retrieval subagent should return classification hints that the main agent can immediately use"). But "hints" is ambiguous -- does the subagent compute classification or just provide data for the main agent to classify?

This ambiguity directly causes the FRESH-05-01/03 conflict between plans 05 and 07.

### 3. overview.md 9.1 does not define "strong full-text match"

The signal is described as "strong full-text match: +15" but "strong" is not quantified. Plan 05 defines it as "2+ query terms found in raw_text" or "1 term if single-term query." This is a reasonable interpretation but is plan-invented, not spec-derived.

### 4. overview.md 10.4 does not specify query normalization ownership

The spec says "the main agent should first normalize the request into a query object" (10.4). Plan 07 implements this in `normalizeQuery()`. But should the retrieval engine (plan 05) also validate or re-normalize the query? Plan 05 does not validate query structure. If `feature_terms` is empty and `summary` is the only populated field, the retrieval pipeline will produce poor results because it primarily matches on search terms, not summary text.

---

## Summary Verdict

**CONDITIONAL PASS** -- plans 04 and 05 are individually well-designed and consistent with overview.md contracts, but three HIGH-severity cross-plan integration issues must be resolved before implementation begins.

### Must Fix (blocks implementation)

| Priority | Issue | Plans Affected |
|----------|-------|---------------|
| HIGH | FRESH-04-01: `stripWikilinkSyntax` not in plan 03 exports | 04, 03 |
| HIGH | FRESH-04-02: `parseNote()` takes content, not file path | 04 |
| HIGH | FRESH-05-01: Plan 07 calls `search()` but plan 05 exports `retrieve()` | 05, 07 |
| HIGH | FRESH-05-03: Duplicate `classify()` implementations with different rules | 05, 07 |

### Should Fix (important, risk of bugs)

| Priority | Issue | Plans Affected |
|----------|-------|---------------|
| MEDIUM | FRESH-04-03: Composite key construction ownership unclear | 04, 03 |
| MEDIUM | FRESH-04-04: `delta_summary[].target_note_id` not resolved to IDs | 04 |
| MEDIUM | FRESH-05-02: `IndexStore` vs `VaultIndex` naming divergence | 05, 07 |
| MEDIUM | FRESH-05-05: `active_change_overlap` fires without content relevance | 05 |
| MEDIUM | FRESH-05-06: Sequencing integration documented 3 different ways | 05, 06, 07 |
| MEDIUM | STILL-OPEN-01: `isTypedNote()` undefined, null-return ambiguity | 04 |
| MEDIUM | STILL-OPEN-02: Index-quality escalation too broad | 05 |

### Acceptable for v1

| Priority | Issue | Plans Affected |
|----------|-------|---------------|
| LOW | FRESH-05-04: `status_bias` defaults not applied in plan 05 | 05 |
| LOW | FRESH-05-07: Plan 06 takes `Map`, plan 04 wraps in `VaultIndex` | 04, 06 |
| LOW | STILL-OPEN-03: Sequencing analysis scope not documented in plan 05 | 05 |
| LOW | overview.md divergences on `Requirement.title` vs `name`, `scenarios` shape | 04, overview |
| LOW | +5 status bias tiebreaker undocumented in overview.md | 05 |
