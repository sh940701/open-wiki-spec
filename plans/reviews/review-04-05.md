# Review: Plans 04-05 (Index & Retrieval)

**Reviewer**: Devil's Advocate Agent
**Date**: 2026-04-06
**Plans Reviewed**:
- `plans/04-index-engine.md`
- `plans/05-retrieval-engine.md`

---

## Summary Verdict

Both plans are well-structured and generally faithful to the overview.md contracts. The index engine (04) is thorough and implementable. The retrieval engine (05) correctly codifies the scoring/classification pipeline. However, there are several contract gaps, cross-plan naming inconsistencies, and design ambiguities that must be resolved before implementation.

**Overall: CONDITIONAL PASS** -- implementable after the issues below are addressed.

---

## File-by-File Review

### 04-index-engine.md

#### Strengths

1. **overview.md 10.3 compliance is strong.** The `IndexRecord` interface covers all fields shown in the overview.md JSON example: `schema_version`, `id`, `type`, `title`, `aliases`, `path`, `status`, `tags`, `systems`, `sources`, `decisions`, `changes`, `depends_on`, `touches`, `links_out`, `links_in`, `headings`, `requirements`, `delta_summary`, `tasks`, `raw_text`, `content_hash`.

2. **Wikilink normalization (10.7) is correctly implemented.** The three-step resolution order (title match -> alias match -> error) matches the overview.md contract exactly. The `WikilinkError` type correctly distinguishes `no_match`, `ambiguous_alias`, and `missing_id`.

3. **Reverse index computation is correct.** `links_in` as a reverse of `links_out` is explicitly documented in overview.md 10.3 ("computed afterward as a reverse index"). The plan implements this as a separate pass after all records are resolved.

4. **Fresh scan contract (10.2) is satisfied.** `buildIndex()` is designed as a stateless builder producing a fresh `VaultIndex` each call.

5. **Requirement composite key (10.3) is correct.** Uses `feature_id::requirement_name` as specified.

6. **Good test coverage.** 16 test areas covering unit, integration, and edge cases.

#### Issues

**ISSUE-04-01: `content_hash` format mismatch with plan 03 (MEDIUM)**

Plan 03 (vault-parser) uses `sha256:<hex>` format for content hashes (line 762-763: `return \`sha256:${hash}\``). Plan 04 says `sha256(content)` without specifying the format. The overview.md 10.3 example shows `"content_hash": "sha256:abc123..."` with the `sha256:` prefix. The plan must explicitly state it uses the same `sha256:<hex>` prefixed format as plan 03.

**ISSUE-04-02: Missing `toArray()` helper specification (LOW)**

The `parseNoteToRawRecord` pseudocode uses `toArray(frontmatter.systems)` etc., but this helper is never defined. What does it do with a string value vs. array value vs. wikilink syntax like `"[[System: Auth]]"`? This is critical because frontmatter relationship fields may be stored as wikilink strings (per overview.md 10.7: "Relationship fields in raw notes may be stored as human-readable wikilinks"). The plan should specify how raw frontmatter values are coerced to string arrays before wikilink resolution.

**ISSUE-04-03: `extractTitle()` and `extractAllWikilinks()` not in plan 03 public API (MEDIUM)**

Plan 04 lists these as dependencies from plan 03 (section "Dependencies on Other Modules"):
- `extractTitle(content)`
- `extractAllWikilinks(content)`
- `stripWikilinkSyntax(raw)`

But plan 03's public API exports (line 1256-1261) show:
- `extractFrontmatter` / `validateFrontmatter` (not `parseFrontmatter`)
- `extractWikilinks` / `uniqueWikilinkTargets` (not `extractAllWikilinks`)
- No `extractTitle` -- title extraction is buried inside `parseNote()`
- No `stripWikilinkSyntax` export

The function names are misaligned. Plan 04 either needs to update its dependency list to match plan 03's actual API, or plan 03 needs to add these exports. Most critically, plan 03 exports `parseNote()` and `toIndexRecord()` which might already do most of what plan 04's `parseNoteToRawRecord()` does -- this is a potential duplication.

**ISSUE-04-04: `VaultIndex` is a class in the API but an interface in the data structures (LOW)**

In section "Data Structures", `VaultIndex` is defined as an `interface`. In the "Public API / Interface" section, it's defined as a `class` with convenience methods (`getById`, `getByPath`, `getByType`, etc.). The plan should clarify whether `VaultIndex` is a plain data object returned by `buildIndex()` or a class with methods. If it's a class, the class definition should be shown in the data structures section. If it's an interface, the convenience methods should be standalone functions.

**ISSUE-04-05: Missing `features` (plural) field handling in `DeltaSummaryEntry` (LOW)**

The `DeltaSummaryEntry` interface has `feature: string` (singular), but a Change note can target multiple features via `features:` (plural). The delta summary parser should either support entries targeting multiple features or validate that each entry targets exactly one feature. The plan acknowledges this edge case in test case 12 ("Note with `features:` (plural) field") but the `DeltaSummaryEntry` type does not reflect it.

**ISSUE-04-06: No mention of `filenameToTitle()` implementation (LOW)**

The `parseNoteToRawRecord` pseudocode falls back to `filenameToTitle(fileEntry.path)` when no H1 heading exists. This utility is not defined anywhere and its behavior is unspecified (does it strip `.md`? Convert kebab-case? Handle directory prefixes?).

**ISSUE-04-07: Duplicate ID handling is lossy (MEDIUM)**

When duplicate IDs are found, the plan keeps only "first occurrence by path sort order" and silently drops the others from the index. This means a `resolveWikilink` call for that ID will succeed but point to an arbitrary (alphabetically first) note. The plan should explicitly warn about this in the `VaultIndex` and ensure consumers (especially verify) are aware that the "winning" record is an arbitrary choice.

**ISSUE-04-08: `isTypedNote()` predicate undefined (LOW)**

In step 9 (buildIndex pseudocode), the comment says `if isTypedNote(file)` to detect notes that have a `type` but no `id`. This function is never defined. How does it distinguish a typed note without reading its frontmatter? If it requires reading frontmatter, then this check belongs inside `parseNoteToRawRecord()`.

**ISSUE-04-09: Schema version "unknown" is silently accepted (LOW)**

If `schema.md` does not exist or has no `schema_version`, the plan returns `"unknown"`. Per overview.md 10.1.1, verify should detect schema mismatch. But the index engine itself does not emit any warning when schema version is "unknown". The retrieval engine (plan 05) adds a warning for this, but the index engine should also flag it in its own error/warning list.

**ISSUE-04-10: Cache invalidation spec is too vague (LOW)**

Section 10.2 specifies `mtime + file size + content hash` for cache invalidation. The plan mentions `cache.ts` as optional and defers it, but does not specify the cache key format or storage location. This is acceptable for v1 since cache is optional, but the plan should at least specify the invalidation algorithm so that future implementation is deterministic.

---

### 05-retrieval-engine.md

#### Strengths

1. **overview.md 10.4 query contract is fully satisfied.** `RetrievalQuery` matches the exact fields: `intent`, `summary`, `feature_terms`, `system_terms`, `entity_terms`, `status_bias`.

2. **Scoring signals (9.1) are all implemented with correct weights.** All 9 signals are present with the exact point values from overview.md.

3. **Classification thresholds (10.5) are faithfully codified.** All four categories (`existing_change`, `existing_feature`, `new_feature`, `needs_confirmation`) with correct numeric thresholds.

4. **Output contract (10.6) is complete.** The `RetrievalResult` interface includes all fields: `query`, `classification`, `confidence`, `sequencing`, `candidates`, `warnings`.

5. **Deterministic behavior.** Explicit sort tie-breaking (score descending, title ascending) and deterministic signal application.

6. **Excellent test coverage.** 41 test areas covering each signal, classification path, edge case, and integration scenario.

7. **Clean separation of concerns.** Each pipeline step is a separate function with clear inputs/outputs.

#### Issues

**ISSUE-05-01: `confidence` field is not specified in overview.md 10.5 or 10.6 (MEDIUM)**

The overview.md classification contract (10.5) does not mention a `confidence` field. The output contract (10.6) also does not include it. The plan introduces `confidence: 'high' | 'medium' | 'low'` as an addition. While useful, this is an extension beyond the contract. The plan should explicitly note this as an addition and justify it, or the overview.md should be updated to include it.

Wait -- re-reading 10.6: the example JSON shows `"confidence": "high"`. So this IS in the contract. The plan correctly implements it. **RETRACTED**.

**ISSUE-05-02: Status bias bonus of +5 is undocumented in overview.md (LOW)**

The scoring step adds a +5 tiebreaker for records matching `status_bias`. This is not one of the 9 documented signals from section 9.1. The plan acknowledges it's "not a formal signal, just a tiebreaker" but it still affects scoring and can change classification outcomes near threshold boundaries (e.g., a candidate at 44 could become 49, exceeding the `new_feature` threshold of 45). Either document this as a 10th signal or remove it.

**ISSUE-05-03: `exact_title` signal definition is too loose (MEDIUM)**

The scoring logic for `exact_title` (+40) fires if:
- `titleLower === summaryLower` (exact match against full summary), OR
- `searchTerms.some(t => titleLower === t)` (exact match against any single search term), OR
- `titleMatchesSummaryWords(titleLower, summaryLower)` (80% word overlap)

The overview.md says "exact title match: +40". The plan's third condition (`titleMatchesSummaryWords` with 80% word overlap) is decidedly not an "exact" match. A note titled "Auth Login System" would match a summary "improve auth login performance" at 2/3 = 66% overlap -- below the 80% threshold. But "Auth Login" would match "auth login improvements" at 2/2 = 100%. This fuzzy matching inflates the +40 signal beyond what "exact title match" suggests. Consider either renaming the signal or tightening the matching criteria.

**ISSUE-05-04: `same_feature_link` signal only fires for Change candidates (MEDIUM)**

Signal 4 (`same_feature_link`, +20) checks `if record.type === "change"` and then looks at its `feature`/`features` targets. But a Feature note could also be a candidate that should get this signal if another Change in the candidate set targets it. The current logic is asymmetric: a Change gets +20 for linking to a Feature candidate, but the Feature itself gets no +20 for being linked from a Change candidate. This could systematically under-score Feature candidates relative to Change candidates.

**ISSUE-05-05: `active_change_overlap` signal double-counts for Change candidates (LOW)**

For a Change candidate with `isActiveChangeStatus`, the signal fires unconditionally (+25) even if the Change is unrelated to the query. If the Change was pulled in via graph expansion (one hop from a lexical hit) and happens to be active, it gets a free +25 without any content relevance check. This could cause active-but-unrelated Changes to score surprisingly high.

**ISSUE-05-06: Graph expansion may cause score inflation (MEDIUM)**

Graph expansion adds all one-hop neighbors to the candidate pool. A Feature note with 50 outgoing links would add 50 candidates. Many of these may be unrelated but share backlink proximity (+10) or other weak signals. In a large vault, this could flood the candidate list with noise, pushing the top-10 cutoff to exclude genuinely relevant candidates. The plan should consider:
- Capping the number of expansion candidates per first-pass hit
- Only expanding from candidates above a minimum first-pass relevance

**ISSUE-05-07: `needs_confirmation` does not check index-quality issues (MEDIUM)**

Overview.md 10.5 states `needs_confirmation` should also trigger when "index-quality issues exist, such as duplicate IDs, ambiguous wikilinks, or missing targets." The plan's `classify()` function only checks score-based rules. Index quality issues are collected in `collectWarnings()` but never influence the classification. The plan should add a rule: if warnings contain `duplicate_id` or `ambiguous_alias` affecting top candidates, escalate to `needs_confirmation`.

**ISSUE-05-08: Lexical retrieval is O(n * m) without optimization (LOW)**

Every step in `lexicalRetrieval()` iterates over all records in the index for each search term. For a vault with 1000 notes and 10 search terms, this is 10,000 iterations per step, across 6 steps = 60,000 iterations. While acceptable for v1 vault sizes, the plan should note this as a known O(n*m) complexity and flag it for optimization if vaults grow large.

**ISSUE-05-09: `full_text_match` threshold may be too permissive (LOW)**

The full-text signal fires with `matchedTerms.length >= 1 and searchTerms.length === 1`. If the user provides a single common term like "login", every note containing "login" in its body gets +15. Combined with graph expansion, this could add many irrelevant candidates. Consider requiring the single term to match in a title/heading rather than raw body text.

**ISSUE-05-10: No candidate deduplication after graph expansion (LOW)**

`graphExpand` returns a `Set<string>`, so IDs are deduplicated. But the same logical "match" could be counted multiple times in scoring. For instance, a note might be a first-pass candidate AND a graph-expansion neighbor of another first-pass candidate. The scoring correctly handles this (it scores each candidate once), so this is actually fine. **RETRACTED**.

**ISSUE-05-11: `RetrievalQuery` missing `query_id` or trace identifier (LOW)**

For debugging and logging, it would be helpful for the query object to carry a unique identifier. This is not in the overview.md contract, so it's optional, but worth noting for observability.

**ISSUE-05-12: Warning type `active_change_touch_collision` is never produced (MEDIUM)**

The `RetrievalWarningType` union includes `'active_change_touch_collision'` but `collectWarnings()` never generates this type. Per overview.md 10.6, warnings should include "active change touch-surface collision without explicit dependency." This is presumably the sequencing engine's responsibility (plan 06), but the warning type is defined here without a producer. Either remove it from the type or add the logic to produce it (likely delegated to the sequencing engine integration point).

---

## Cross-Cutting Concerns

### 1. Naming Inconsistency Between Plans

**Plan 04** calls it `VaultIndex`. **Plan 07** calls it `IndexStore`. These refer to the same object. Plan 05 correctly uses `VaultIndex` from plan 04.

**Plan 04** calls the parse function `parseFrontmatter`. **Plan 03** exports `extractFrontmatter`.

**Plan 05** uses `RetrievalQuery`. **Plan 07** uses `QueryObject`. These map to the same overview.md 10.4 contract.

These naming divergences will cause confusion during implementation. A naming convention document or a shared types file should be agreed upon before implementation begins.

### 2. Plan 04 vs Plan 03 Overlap

Plan 03 exports `toIndexRecord()` which converts a parsed note to an index record. Plan 04 defines `parseNoteToRawRecord()` which also converts file content to a record. The boundary between "parsing" (plan 03) and "indexing" (plan 04) is blurry. The recommendation is:
- Plan 03 should own all parsing: frontmatter, sections, wikilinks, requirements, delta summary, tasks, and raw record creation.
- Plan 04 should only own: wikilink resolution to IDs, lookup map construction, reverse index computation, and `VaultIndex` assembly.
- `parseNoteToRawRecord()` in plan 04 should delegate ALL parsing to plan 03's `parseNote()` / `toIndexRecord()` rather than reimplementing it.

### 3. Sequencing Integration Point

Plan 05 returns `sequencing: null` and expects plan 06 to enrich it. But the integration mechanism is unspecified. Does the caller (plan 07) call `retrieve()` first and then `analyzeSequencing()` separately and merge the results? Or does plan 06 wrap `retrieve()`? This should be explicitly documented in the interface contract.

### 4. `VaultIndex` Thread Safety and Immutability

`computeReverseIndex()` mutates records in-place. If `VaultIndex` is ever accessed concurrently (e.g., by multiple subagents), this mutation could cause issues. Since v1 is single-threaded, this is acceptable, but the plan should document that `VaultIndex` is mutable during construction and read-only after `buildIndex()` returns.

---

## overview.md Limitations Discovered

### 1. `confidence` field semantics are underspecified (10.6)

The output contract shows `"confidence": "high"` but never defines what high/medium/low mean, or how they should be computed. Plan 05 invents rules (e.g., `top.score >= 85 ? "high" : "medium"` for `existing_feature`), but these thresholds have no basis in overview.md.

### 2. Scoring weights are "examples" vs "contracts" (9.1)

Overview.md 9.1 says "Example scoring signals" with the weights. The word "example" creates ambiguity: are these the mandatory weights, or just suggestions? Plan 05 treats them as mandatory defaults. Overview.md should clarify whether these are the exact v1 weights or tunable recommendations.

### 3. `needs_confirmation` trigger for index quality issues is vague (10.5)

Overview.md says `needs_confirmation` should fire when "index-quality issues exist, such as duplicate IDs, ambiguous wikilinks, or missing targets." But it does not specify how this interacts with the score-based classification. If a candidate clearly qualifies as `existing_feature` (score 90, no competition) but the index has a duplicate ID on an unrelated note, should the classification be overridden to `needs_confirmation`? The scope of index-quality escalation is ambiguous.

### 4. No specification for Query notes in retrieval (10.4)

The `NoteType` union includes `'query'` but overview.md never specifies how Query notes should be handled in retrieval. Should they be searchable candidates? Should they be excluded from scoring? Plan 05 silently includes them but no signal specifically addresses Query-type notes.

### 5. Missing "same_feature_link" signal definition asymmetry (9.1)

Overview.md lists "same feature link match: +20" but does not clarify whether this applies to the Feature being linked or the Change doing the linking. Plan 05 only applies it to Changes. This asymmetry should be resolved in the spec.

### 6. `status_bias` default values are unspecified for different intents (10.4)

Overview.md shows `"status_bias": ["active", "proposed", "planned", "in_progress"]` as an example. But should the default bias change based on `intent`? For `intent: "remove"`, biasing toward `"active"` makes sense, but biasing toward `"proposed"` might surface draft features the user does not intend to remove. The spec does not address intent-specific defaults.

---

## Recommendations

### Critical (must fix before implementation)

1. **Resolve plan 03 / plan 04 API boundary.** Determine whether plan 04's `parseNoteToRawRecord()` should exist at all, or whether it should be replaced by calling plan 03's `parseNote()` + `toIndexRecord()`. Eliminate the function name mismatches.

2. **Unify naming across plans.** `VaultIndex` vs `IndexStore`, `RetrievalQuery` vs `QueryObject`, `parseFrontmatter` vs `extractFrontmatter`. Create a shared naming table or canonical types file that all plans reference.

3. **Add `needs_confirmation` escalation for index-quality issues** (ISSUE-05-07). The overview.md contract explicitly requires this.

### Important (should fix)

4. **Tighten `exact_title` signal** (ISSUE-05-03). Either rename it to `title_match` or remove the `titleMatchesSummaryWords` fuzzy condition from the +40 signal and make it a separate lower-weighted signal.

5. **Fix `same_feature_link` asymmetry** (ISSUE-05-04). Add the signal for Feature candidates that are targeted by Change candidates in the set.

6. **Specify `content_hash` format** (ISSUE-04-01). Explicitly use `sha256:<hex>` to match plan 03.

7. **Document the sequencing integration mechanism** (Cross-Cutting #3). Specify whether it is caller-side merge or wrapper-based enrichment.

8. **Wire up `active_change_touch_collision` warning** (ISSUE-05-12). Either remove the type or document which module produces it.

### Nice to Have (v1 acceptable as-is)

9. Consider capping graph expansion candidates per first-pass hit (ISSUE-05-06).

10. Document `VaultIndex` immutability contract after construction (Cross-Cutting #4).

11. Remove or document the +5 status bias tiebreaker (ISSUE-05-02).

12. Define `filenameToTitle()` behavior (ISSUE-04-06).

13. Clarify `VaultIndex` class vs interface decision (ISSUE-04-04).
