# Review v2: Plans 04-05 (Index & Retrieval)

**Reviewer**: Devil's Advocate Agent (Round 2)
**Date**: 2026-04-06
**Plans Reviewed**:
- `plans/04-index-engine.md`
- `plans/05-retrieval-engine.md`

**Reference Documents**:
- `plans/00-unified-types.md`
- `overview.md`
- Round 1 review: `plans/reviews/review-04-05.md`

---

## Previous Issues Resolution Status

| Issue ID | Summary | Status | Notes |
|----------|---------|--------|-------|
| ISSUE-04-01 | `content_hash` format mismatch with plan 03 | RESOLVED | Plan 04 now explicitly specifies `sha256:<hex>` format (line 137, 241). `content_hash` in IndexRecord comment says "format: `sha256:<hex>`". Plan 04 also delegates `content_hash` to plan 03's `parseNote()` output (line 376: `content_hash: parseResult.content_hash`), making the format consistent by construction. |
| ISSUE-04-02 | Missing `toArray()` helper specification | RESOLVED | Plan 04 eliminated `toArray()` entirely. The new `parseNoteToRawRecord` (line 331-381) delegates all parsing to plan 03's `parseNote()` and reads structured fields from `ParseResult` rather than coercing raw frontmatter values itself. |
| ISSUE-04-03 | `extractTitle()` and `extractAllWikilinks()` not in plan 03 public API | RESOLVED | Plan 04 now depends on a single `parseNote(filePath): ParseResult` entry point from plan 03 (line 328-329, line 722). Individual sub-parser functions are no longer listed as dependencies. The "Dependencies on Other Modules" table (line 720-724) correctly specifies `parseNote`, `extractFrontmatter` (for schema version read), and `stripWikilinkSyntax`. |
| ISSUE-04-04 | `VaultIndex` class vs interface ambiguity | RESOLVED | Plan 04 now defines `VaultIndex` as an `interface` (line 272) in data structures and provides `VaultIndexUtils` as a standalone utility namespace (line 679-715) in the public API section. The API section explicitly states "VaultIndex is constructed as a plain data object by buildIndex()" (line 675-676). |
| ISSUE-04-05 | Missing `features` (plural) field handling in `DeltaSummaryEntry` | RESOLVED | Plan 04 added `feature?: string` and `features?: string[]` directly to `IndexRecord` (lines 224-226). `DeltaSummaryEntry` now uses `target_note_id: string` (line 159) instead of `feature: string`, correctly targeting a single resolved note per delta entry rather than trying to embed multiple feature targets. |
| ISSUE-04-06 | No `filenameToTitle()` definition | RESOLVED | Plan 04 now delegates title extraction to `parseResult.title` from plan 03 (line 352), so the index engine no longer needs its own `filenameToTitle()`. |
| ISSUE-04-07 | Duplicate ID handling is lossy | PARTIALLY RESOLVED | Plan 04 now emits `duplicate_id` warnings via `buildWarnings()` (lines 536-542). However, the "first by alphabetical path order" selection (line 610-611) is still arbitrary and undocumented as a design decision. The `IndexWarning` carries the information, but there is no guarantee that downstream consumers (especially verify) check `hasWarningType("duplicate_id")` before trusting the winning record. See NEW-ISSUE-04-01. |
| ISSUE-04-08 | `isTypedNote()` predicate undefined | PARTIALLY RESOLVED | The `buildIndex` pseudocode (line 594) still references `isTypedNote(file)` without definition. Plan 04 added the delegation to `parseNote()` which returns the parsed frontmatter, so `type` is available after parsing. But the current flow calls `parseNoteToRawRecord` first, which returns `null` for both "not a typed note" and "typed but no id" cases. The `isTypedNote` check on line 594 happens AFTER `parseNoteToRawRecord` returns null, but at that point the caller has lost the reason for the null return. See NEW-ISSUE-04-02. |
| ISSUE-04-09 | Schema version "unknown" silently accepted | RESOLVED | Plan 04 now generates a `schema_mismatch` warning in `buildWarnings()` when `schemaVersion === "unknown"` (lines 568-573). |
| ISSUE-04-10 | Cache invalidation spec too vague | ACCEPTABLE | Cache remains optional and deferred. The plan notes `mtime + size + hash` and defers to `cache.ts`. Acceptable for v1. |
| ISSUE-05-01 | `confidence` field not in overview.md | RETRACTED in round 1 | Was already in the contract. No action needed. |
| ISSUE-05-02 | Status bias +5 undocumented | UNCHANGED | The +5 tiebreaker is still present (line 638) with the same comment "not a formal signal, just a tiebreaker." Still not documented in overview.md 9.1. Low severity; acceptable for v1 but should be documented. |
| ISSUE-05-03 | `exact_title` signal too loose (80% word overlap) | RESOLVED | Plan 05 tightened `exact_title` to truly exact matches only: `titleLower === summaryLower` or `searchTerms.some(t => titleLower === t)` (lines 503-505). The old fuzzy `titleMatchesSummaryWords` was renamed to `titleSimilarity` and explicitly excluded from the +40 signal (lines 500-502, 894-896). |
| ISSUE-05-04 | `same_feature_link` only fires for Change candidates | RESOLVED | Plan 05 now implements bidirectional matching. Direction A: Change checks if its target Feature is in the candidate set (lines 540-551). Direction B: Feature checks if any Change candidate targets it (lines 552-566). The comment on line 537 says "bidirectional per overview.md 9.1". |
| ISSUE-05-05 | `active_change_overlap` double-counts for Change candidates | UNCHANGED | The signal still fires unconditionally for any active Change candidate (line 581-586) regardless of content relevance. The plan acknowledges this is by design: an active Change IS the overlap. Low severity; acceptable for v1. |
| ISSUE-05-06 | Graph expansion may cause score inflation | UNCHANGED | No cap on expansion candidates per first-pass hit. Acceptable for v1 vault sizes. |
| ISSUE-05-07 | `needs_confirmation` doesn't check index-quality issues | RESOLVED | Plan 05 now includes "Rule 0: Index-quality escalation" in `classify()` (lines 669-683). It checks `index.warnings` for `duplicate_id`, `ambiguous_alias`, `missing_id`, and `unresolved_wikilink` affecting candidate paths, and escalates to `needs_confirmation` with `confidence: "low"`. |
| ISSUE-05-08 | Lexical retrieval O(n*m) | UNCHANGED | Known complexity, acceptable for v1. |
| ISSUE-05-09 | `full_text_match` threshold permissive for single-term queries | UNCHANGED | Still fires for single-term matches when `searchTerms.length === 1`. Acceptable for v1. |
| ISSUE-05-10 | No candidate deduplication | RETRACTED in round 1 | Handled correctly. |
| ISSUE-05-11 | Missing `query_id` trace identifier | UNCHANGED | Not in the contract, optional enhancement. |
| ISSUE-05-12 | `active_change_touch_collision` warning never produced | RESOLVED | Plan 05 now produces this warning in `collectWarnings()` (lines 804-827). It detects when two active Changes in the candidate set share `touches` surfaces without an explicit `depends_on` edge between them. |

**Resolution Summary**: 12/17 resolved, 2 partially resolved, 3 unchanged (all low severity or acceptable for v1).

---

## New Issues from Fixes

### NEW-ISSUE-04-01: `parseNoteToRawRecord` return ambiguity (MEDIUM)

Plan 04's `parseNoteToRawRecord` (lines 331-381) returns `null` for two distinct reasons:
1. The note's type is not in `VALID_NOTE_TYPES` (line 339) -- this is a non-typed note, should be silently skipped.
2. The note has a valid type but no `id` field (line 344) -- this should be recorded in `missing_ids`.

But the caller in `buildIndex` (lines 592-596) uses a separate `isTypedNote(file)` check AFTER getting null, which is still undefined. The fix introduced proper delegation to `parseNote()`, but the ambiguous null return was not resolved. 

**Recommendation**: Return a discriminated result instead of bare null:
```typescript
type ParseOutcome =
  | { status: 'ok'; record: RawRecord }
  | { status: 'skipped'; reason: 'not_typed' }
  | { status: 'skipped'; reason: 'missing_id'; path: string };
```
This eliminates `isTypedNote()` entirely and makes the caller's logic unambiguous.

### NEW-ISSUE-04-02: `Requirement.name` vs overview.md `Requirement.title` (MEDIUM)

A field name inconsistency exists between documents:
- `00-unified-types.md` line 82: `name: string` with comment "Stable name from `### Requirement: <name>` header"
- `04-index-engine.md` line 129-130: `name: string` (matches unified types)
- **overview.md 10.3** example JSON: `"title": "Passkey Authentication"` (NOT `"name"`)

The overview.md uses `title` where the plans and unified types use `name`. Since `00-unified-types.md` is declared as the canonical type reference that wins over conflicts, the plans are correct. But overview.md should be updated to use `name` instead of `title` for requirements, or this discrepancy will confuse implementers reading the overview.

### NEW-ISSUE-04-03: DeltaSummaryEntry field name divergence from overview.md (MEDIUM)

Another field name inconsistency:
- `00-unified-types.md` line 115: `target_note_id: string` (wikilink-resolved feature/note id)
- `04-index-engine.md` line 159: `target_note_id: string` (matches unified types)
- **overview.md 10.3** example JSON: `"feature": "feature-auth-login"` (NOT `"target_note_id"`)

The overview.md delta_summary example uses `"feature"` as the field name for the resolved note id, while the unified types and plans use `"target_note_id"`. The unified types name is better (more general -- supports targeting non-Feature notes), but the overview.md divergence will be a source of confusion.

### NEW-ISSUE-04-04: `Requirement.scenarios` type divergence from overview.md (LOW)

- `00-unified-types.md` lines 92-98: `scenarios: Scenario[]` where `Scenario = { name: string; raw_text: string }`
- `04-index-engine.md` lines 133-137: Same as unified types.
- **overview.md 10.3** example JSON: `"scenarios": ["WHEN a registered user selects passkey login THEN ..."]` -- a plain `string[]`.

Overview.md models scenarios as flat strings, while the plans model them as objects with `name` and `raw_text`. This is a structural mismatch. The plans' approach is richer and better for machine processing, but implementers reading overview.md first will expect `string[]`.

### NEW-ISSUE-05-01: Index-quality escalation scope may be too broad (MEDIUM)

The fix for ISSUE-05-07 (Rule 0 in `classify()`, lines 669-683) escalates to `needs_confirmation` whenever ANY candidate's path matches an index warning. This includes warnings on low-scoring candidates that would otherwise be irrelevant.

Consider this scenario: 10 candidates are scored. The top candidate (score 90, clear `existing_feature`) is clean. But candidate #8 (score 15, irrelevant) has a `duplicate_id` warning. Under the current Rule 0, the entire classification is overridden to `needs_confirmation` because of an issue on an irrelevant candidate.

**Recommendation**: Limit index-quality escalation to warnings affecting the TOP candidate (or top 2-3 candidates used for classification), not all candidates in the set.

### NEW-ISSUE-05-02: Sequencing severity escalation creates a circular dependency (MEDIUM)

Plan 05's `classify()` accepts an optional `SequencingSummary` (line 664) and escalates to `needs_confirmation` if the sequencing status is `conflict_candidate` or `conflict_critical` (lines 685-688). The integration contract (line 996) says the caller (plan 07) calls `analyzeSequencing()` from plan 06 first, then passes the result into `retrieve()`.

But plan 06 (sequencing engine) depends on the `VaultIndex` from plan 04, and sequencing analysis requires knowing which changes are relevant -- which is determined by retrieval. This creates a design question:

- Plan 07 calls `analyzeSequencing()` BEFORE `retrieve()`. But how does plan 06 know which changes to analyze without retrieval results?
- If plan 06 analyzes ALL active changes (not just retrieval candidates), the sequencing result may be overly broad, escalating `needs_confirmation` for conflicts between unrelated changes.
- If plan 06 needs the candidate set from retrieval, then retrieval must run first, creating a chicken-and-egg problem.

**Recommendation**: Explicitly document that `analyzeSequencing()` operates on ALL active changes from the index (not candidate-specific), and that the caller may optionally filter the sequencing result to only include changes relevant to the retrieval candidates before passing it to `classify()`. The current plan implicitly assumes this but doesn't state it.

### NEW-ISSUE-05-03: `SequencingSummary` in plan 05 does not match `00-unified-types.md` (LOW)

Plan 05 defines `SequencingSummary` (lines 303-307) as:
```typescript
interface SequencingSummary {
  status: 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'conflict_critical' | 'blocked';
  related_changes: string[];
  reasons: string[];
}
```

`00-unified-types.md` defines the same type (lines 213-218) identically. These match. However, `00-unified-types.md` also defines a much richer `SequencingResult` (lines 317-327) with fields like `pairwise_severities`, `requirement_conflicts`, `ordering`, `cycles`, etc. The plan 05 `SequencingSummary` is a summary of this richer result.

The relationship between `SequencingSummary` (consumed by plan 05) and `SequencingResult` (produced by plan 06) is implicit. Plan 05 should document how the caller (plan 07) derives a `SequencingSummary` from a `SequencingResult` -- specifically, how `status` is computed from the aggregate of `pairwise_severities` and `requirement_conflicts`.

### NEW-ISSUE-05-04: `warnings` field type mismatch between `RetrievalResult` and internal types (LOW)

Plan 05 defines two warning types:
1. `RetrievalWarning` (lines 309-321): structured object with `type`, `message`, `details`.
2. `RetrievalResult.warnings` (line 300): `string[]` (canonical output shape).

The pipeline serializes `RetrievalWarning[]` to `string[]` via `w.message` (line 865). This is correct for the canonical output contract. However, the `RetrievalWarningType` union is defined but only used internally, never exposed in the canonical output. This means consumers lose the structured `type` and `details` fields.

If the main agent (plan 07) needs to programmatically react to specific warning types (e.g., escalate on `active_change_touch_collision`), it would need to parse the warning message string. This is fragile.

**Recommendation**: Either (a) expose `RetrievalWarning[]` as an additional field on `RetrievalResult` for machine consumers, keeping `warnings: string[]` for the human-readable canonical output, or (b) ensure the canonical output contract is sufficient and document that consumers should not parse warning strings programmatically.

---

## Type Consistency with 00-unified-types.md (Character-Level)

### Plan 04

| Type | Plan 04 | 00-unified-types.md | Match? |
|------|---------|---------------------|--------|
| `NoteType` | `'feature' \| 'change' \| 'system' \| 'decision' \| 'source' \| 'query'` | Same | YES |
| `ChangeStatus` | `'proposed' \| 'planned' \| 'in_progress' \| 'applied'` | Same | YES |
| `FeatureStatus` | `'active' \| 'deprecated'` | Same | YES |
| `GeneralStatus` | `'active' \| 'draft' \| 'archived'` | Same | YES |
| `Requirement.name` | `name: string` | `name: string` | YES |
| `Requirement.content_hash` | `string` (comment says `sha256:<hex>`) | `string` (comment says "SHA-256 hash") | YES (plan is more specific in format, which is good) |
| `DeltaSummaryEntry.target_note_id` | `target_note_id: string` | `target_note_id: string` | YES |
| `DeltaSummaryEntry.op` | `DeltaOp` | `DeltaOp` | YES |
| `IndexRecord` | All fields present | All fields present | YES |
| `VaultIndex` | Has `records`, `warnings`, `schema_version`, `scanned_at` plus internal lookup maps | Has `records`, `warnings`, `schema_version`, `scanned_at` only | YES (plan adds internal fields, canonical shape matches) |
| `IndexWarning.type` | 6 values: `duplicate_id`, `unresolved_wikilink`, `ambiguous_alias`, `missing_id`, `schema_mismatch`, `invalid_frontmatter` | Same 6 values | YES |
| `TaskItem` | `{ text: string; done: boolean }` | Same | YES |

**Verdict**: Plan 04 types are fully consistent with `00-unified-types.md`.

### Plan 05

| Type | Plan 05 | 00-unified-types.md | Match? |
|------|---------|---------------------|--------|
| `RetrievalQuery` | All 6 fields matching | Same | YES |
| `Classification` | 4 values matching | Same | YES |
| `Confidence` | `'high' \| 'medium' \| 'low'` | Same | YES |
| `ScoredCandidate` | `{ id, type, title, score, reasons }` | Same | YES |
| `SequencingSummary` | `{ status, related_changes, reasons }` | Same | YES |
| `RetrievalResult.query` | `string` | `string` | YES |
| `RetrievalResult.warnings` | `string[]` | `string[]` | YES |

**Verdict**: Plan 05 types are fully consistent with `00-unified-types.md`.

---

## overview.md Sections 10.1-10.7 Compliance

| Section | Requirement | Plan 04 | Plan 05 |
|---------|-------------|---------|---------|
| 10.1 | Vault is truth, index is disposable cache | YES - `buildIndex` is stateless, fresh each call | N/A |
| 10.1.1 | Schema version from `wiki/00-meta/schema.md` | YES - `readSchemaVersion()` reads it | N/A |
| 10.2 | Fresh scan on propose/query/verify | YES - design assumes fresh call | N/A |
| 10.2 | Disk cache invalidation by mtime+size+hash | YES - documented in `cache.ts` spec | N/A |
| 10.3 | Index record shape | YES - all fields present | N/A |
| 10.3 | Composite requirement key `feature_id::name` | YES - `key: string` with format documented | N/A |
| 10.3 | `links_in` as reverse index | YES - `computeReverseIndex()` | N/A |
| 10.4 | Query object format | N/A | YES - `RetrievalQuery` matches exactly |
| 10.5 | Classification thresholds | N/A | YES - all 4 categories with correct numeric thresholds |
| 10.5 | `needs_confirmation` for index-quality issues | N/A | YES - Rule 0 in `classify()` |
| 10.5 | `needs_confirmation` for sequencing severity | N/A | YES - Rule 0b in `classify()` |
| 10.6 | Output contract | N/A | YES - `RetrievalResult` matches |
| 10.6 | Warnings list | N/A | YES - includes all 6 warning types from spec |
| 10.7 | Wikilink normalization: title -> alias -> error | YES - `resolveWikilink()` implements exact order | N/A |

**Verdict**: Both plans satisfy all overview.md 10.1-10.7 requirements.

---

## Cross-Plan Consistency

### Plan 04 <-> Plan 03 (Vault Parser)

Round 1 raised a critical concern about overlap between plan 03's `toIndexRecord()` and plan 04's `parseNoteToRawRecord()`. This is RESOLVED. Plan 04 now explicitly delegates all parsing to plan 03's `parseNote()` and only performs:
- Wikilink resolution to IDs
- Lookup map construction
- Reverse index computation
- VaultIndex assembly

The ownership rule is documented in both `00-unified-types.md` (line 385-386) and plan 04 (line 120, 328-329).

### Plan 04 <-> Plan 05 (Retrieval Engine)

Plan 05 correctly consumes `VaultIndex` from plan 04. The types are aligned. Plan 05 accesses `index.records`, `index.warnings`, `index.duplicate_ids`, `index.link_errors` -- all of which exist on plan 04's `VaultIndex` interface.

One minor issue: Plan 05's `collectWarnings()` (line 773) accesses `index.duplicate_ids` which is an internal lookup map field on `VaultIndex` (line 292), not part of the canonical `VaultIndex` shape from `00-unified-types.md` (lines 175-179 only have `records`, `warnings`, `schema_version`, `scanned_at`). This means plan 05 depends on plan 04's internal implementation details, not just the canonical contract.

**Recommendation**: Plan 05 should either (a) rely only on `index.warnings` (which already contains duplicate_id warnings) for its warning aggregation, or (b) `00-unified-types.md` should expand the canonical `VaultIndex` to include these lookup maps. Option (a) is cleaner.

### Plan 05 <-> Plan 06 (Sequencing Engine)

The sequencing integration mechanism is now documented in plan 05's "Dependencies on Other Modules" section (line 996). It explicitly states: "the caller (plan 07 workflow-propose) calls `analyzeSequencing()` from plan 06 first, then passes the resulting `SequencingSummary` into `retrieve()` via `options.sequencing`." This is caller-side composition.

This resolves the round 1 cross-cutting concern about unspecified integration. However, see NEW-ISSUE-05-02 about the potential ordering problem.

### Plan 05 <-> Plan 07 (Workflow Propose)

Plan 05 correctly documents plan 07 as a caller (line 997). The API is clean: `retrieve(query, index, options)`.

### Naming Consistency

Round 1 flagged `VaultIndex` vs `IndexStore` and `RetrievalQuery` vs `QueryObject`. Checking plan 04 and 05:
- Plan 04: `VaultIndex` -- consistent with `00-unified-types.md`
- Plan 05: `RetrievalQuery` -- consistent with `00-unified-types.md`

The naming is now unified within these two plans. The divergence with plans 07+ should be checked by those reviews.

---

## Implementability Assessment

### Plan 04: Index Engine

**Implementable as-is**: YES, with minor caveats.

The plan is well-structured with clear step-by-step pseudocode, a clean file structure, and explicit dependencies. The main concern is the `parseNoteToRawRecord` null-return ambiguity (NEW-ISSUE-04-01), which is a local fix that doesn't block implementation.

### Plan 05: Retrieval Engine

**Implementable as-is**: YES, with one design question to resolve.

The plan has complete pseudocode for all 9 scoring signals, clear classification rules, and a well-defined pipeline. The main concern is the index-quality escalation scope (NEW-ISSUE-05-01) and the sequencing ordering question (NEW-ISSUE-05-02), both of which are design refinements rather than blockers.

---

## OpenSpec Fidelity

Both plans correctly identify where open-wiki-spec diverges from OpenSpec:

- **Plan 04**: Correctly states that OpenSpec has no index of note content, no frontmatter parsing, no wikilink resolution, and no cross-note relationship tracking. The comparison table (lines 56-67) is accurate and matches the OpenSpec source in `src/core/artifact-graph/types.ts` and `src/core/artifact-graph/graph.ts`.

- **Plan 05**: Correctly states that OpenSpec delegates all search to LLM free-form reasoning. The analysis of `propose.ts` (no preflight similarity scan), `explore.ts` (ad-hoc investigation), and `new-change.ts` (name-based collision check only) is accurate per the OpenSpec source.

---

## Summary Verdict

**PASS** -- Both plans are ready for implementation after addressing minor issues.

### Must Fix (before implementation)

1. **NEW-ISSUE-04-01**: Eliminate `isTypedNote()` ambiguity by using a discriminated return type from `parseNoteToRawRecord`. This prevents a bug where missing-id notes are silently dropped instead of recorded.

2. **NEW-ISSUE-05-01**: Narrow index-quality escalation scope to top candidates only. The current implementation is too aggressive and will cause false `needs_confirmation` escalations.

### Should Fix (important but not blocking)

3. **NEW-ISSUE-04-02**: Update overview.md `Requirement.title` to `Requirement.name` for consistency with unified types. (Or note the divergence explicitly in the plan.)

4. **NEW-ISSUE-04-03**: Update overview.md `DeltaSummaryEntry.feature` to `DeltaSummaryEntry.target_note_id` for consistency.

5. **NEW-ISSUE-04-04**: Update overview.md `Requirement.scenarios` from `string[]` to `Scenario[]` for consistency.

6. **NEW-ISSUE-05-02**: Document the sequencing analysis scope (all active changes vs candidate-specific) to prevent the ordering ambiguity.

7. **NEW-ISSUE-05-03**: Document how `SequencingSummary` is derived from `SequencingResult` by the caller.

8. **Plan 05 accessing plan 04 internal fields**: `collectWarnings()` should use `index.warnings` (canonical) instead of `index.duplicate_ids` (internal).

### Nice to Have

9. **NEW-ISSUE-05-04**: Consider exposing structured warnings alongside `string[]` for machine consumers.

10. **ISSUE-05-02** (unchanged from round 1): Document the +5 status bias tiebreaker in overview.md or remove it.
