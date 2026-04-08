# Retrieval Engine Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec does **not** have a dedicated retrieval or similarity-scan engine. Instead, it relies on LLM free-form reasoning to find related specs and changes. The search behavior is embedded in prompt instructions within workflow templates.

Key observations from the source code:

- **`propose.ts`**: The propose workflow instructs the LLM to "ask what they want to build," create a change directory with `openspec new change`, then generate artifacts in dependency order. There is no preflight similarity scan. No structured candidate list. No scoring. The LLM decides everything based on its current context window.

- **`explore.ts`**: The explore workflow lets the LLM freely investigate the codebase. It checks `openspec list --json` for active changes but does not perform any structured search or scoring against existing specs. Candidate discovery is entirely ad-hoc.

- **`new-change.ts`**: Creates a new change directory and shows artifact instructions. Again, no similarity detection. If a change with the same name exists, it suggests continuing that change, but there is no content-based or metadata-based deduplication.

- **`instruction-loader.ts`**: Loads schema, resolves templates, and generates artifact instructions. It reads project config for context/rules and injects them into the instruction payload. This is the closest thing to "retrieval" in OpenSpec, but it only retrieves schema metadata and templates -- not related existing work.

In summary: OpenSpec's search for related work is **entirely delegated to the LLM's judgment** via prompt instructions. There is no deterministic retrieval pipeline, no scoring algorithm, no structured candidate output, and no classification contract.

### Key Source Files

| File | Description |
|------|-------------|
| `src/core/templates/workflows/propose.ts` | Propose workflow: creates change, generates artifacts in sequence. No similarity scan. |
| `src/core/templates/workflows/explore.ts` | Explore mode: free-form thinking partner. Lists changes but no structured search. |
| `src/core/templates/workflows/new-change.ts` | New change scaffold. Name-based collision check only. |
| `src/core/artifact-graph/instruction-loader.ts` | Template/instruction loading. Reads config context but not vault content. |

### Core Algorithm / Flow

OpenSpec's implicit "retrieval" flow:

1. User describes what they want to build.
2. LLM reads the filesystem structure (`openspec/changes/`, `openspec/specs/`).
3. LLM uses its own reasoning to decide if something similar exists.
4. If the change name already exists as a directory, suggest continuing it.
5. Otherwise, create a new change.
6. No scoring, no structured candidates, no classification.

This means:
- Results vary by session depending on which files the LLM happens to read.
- Similarity detection quality depends entirely on prompt quality and model capability.
- There is no way to debug why a candidate was or was not surfaced.
- There is no threshold contract for deciding between "continue existing" vs "create new."

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

The retrieval engine is governed by **sections 8, 9, and 10** of overview.md:

- **8.2**: `propose` must run a preflight similarity scan before creating anything. The scan searches for related Feature, Change, System, Decision, and Source candidates, scores them, and decides between `existing_change`, `existing_feature`, `new_feature`, and `needs_confirmation`.
- **9.1**: v1 uses deterministic signals: exact title match (+40), alias match (+35), same system (+20), same feature link (+20), active change overlap (+25), shared source (+10), shared decision (+10), backlink/shared-link proximity (+10), strong full-text match (+15).
- **9.3**: The retrieval subagent handles search and scoring. The main agent handles final interpretation and workflow decisions.
- **10.4**: Query object contract: `{ intent, summary, feature_terms, system_terms, entity_terms, status_bias }`.
- **10.5**: Classification/threshold contract with specific numeric rules.
- **10.6**: Retrieval subagent output contract: `{ query, classification, confidence, sequencing, candidates[], warnings[] }`.
- **10.7**: Wikilink-to-id normalization (handled by index engine, consumed by retrieval).

### Differences from OpenSpec

| Dimension | OpenSpec | open-wiki-spec |
|-----------|----------|----------------|
| Search method | LLM free-form reasoning from filesystem | Deterministic lexical retrieval + graph expansion + scoring |
| Candidate output | None (implicit in LLM response) | Structured JSON: `{ id, type, title, score, reasons[] }` |
| Classification | LLM decides ad-hoc | Four explicit categories with threshold rules |
| Scoring | None | Additive signal-based scoring (exact title +40, alias +35, etc.) |
| Explainability | None (opaque model judgment) | Every candidate has machine-readable reasons |
| Graph awareness | None (filesystem only) | One-hop graph expansion from initial candidates |
| Query contract | Natural language only | Structured query object with separated terms |
| Reproducibility | Varies by session | Deterministic for the same vault state |
| Separation of concerns | Search and authoring mixed in one prompt | Retrieval subagent (search only) separate from main agent (decisions) |

### Why This Is Better

1. **Deterministic**: Same vault state + same query = same candidates and classification. No session-to-session variance.
2. **Explainable**: Every candidate carries reasons. Failures are debuggable. Scoring rules are tunable.
3. **Independent of LLM quality**: The retrieval pipeline is pure code. It does not depend on prompt engineering or model capability for finding candidates.
4. **Prevents duplicates**: Structured scoring makes it much harder to accidentally create a new Feature when a matching one already exists.
5. **Separation of concerns**: The retrieval subagent only searches. The main agent only decides. This reduces prompt drift and makes both parts more reliable.
6. **Testable**: The entire pipeline can be tested with fixture vaults and expected outputs, without an LLM.

### Contracts to Satisfy

1. Query object follows the format from section 10.4.
2. Scoring uses the exact signal weights from section 9.1.
3. Classification follows the threshold rules from section 10.5.
4. Output follows the subagent output contract from section 10.6.
5. Graph expansion is exactly one hop from first-pass candidates.
6. Lexical retrieval covers title, alias, system, feature, source, and decision matching.
7. The retrieval engine operates on a `VaultIndex` and does not touch the filesystem directly.

---

## 3. Implementation Plan

### Architecture Overview

```
  Main Agent                    Retrieval Engine
  +-----------+                 +----------------------------------+
  |  User     |  query object   |                                  |
  |  Request  +---------------->|  1. Lexical Retrieval            |
  |           |                 |     (title, alias, system,       |
  |           |                 |      source, decision, feature)  |
  |           |                 |                                  |
  |           |                 |  2. Graph Expansion              |
  |           |                 |     (one-hop from candidates)    |
  |           |                 |                                  |
  |           |                 |  3. Scoring                      |
  |           |                 |     (additive signal weights)    |
  |           |                 |                                  |
  |           |                 |  4. Classification               |
  |           |                 |     (threshold rules)            |
  |           |  structured     |                                  |
  |           |<----------------+  5. Output Assembly              |
  |           |  result         |     (candidates + reasons +      |
  |           |                 |      classification + warnings)  |
  +-----------+                 +----------------------------------+
                                        |
                                        | reads
                                        v
                               +------------------+
                               |   VaultIndex     |
                               |   (plan 04)      |
                               +------------------+
```

### Data Structures

```typescript
// ---- Query Object (section 10.4) ----

type QueryIntent = 'add' | 'modify' | 'remove' | 'query';

interface RetrievalQuery {
  /** What the user wants to do */
  intent: QueryIntent;
  /** Free-form summary of the request */
  summary: string;
  /** Terms likely to match Feature titles/aliases */
  feature_terms: string[];
  /** Terms likely to match System names */
  system_terms: string[];
  /** Terms likely to match specific entities (e.g., "webauthn", "redis") */
  entity_terms: string[];
  /** Which statuses to prefer when scoring. Default: ["active", "proposed", "planned", "in_progress"] */
  status_bias: string[];
}
```

```typescript
// ---- Scoring ----

/** Individual scoring signal applied to a candidate */
interface ScoringSignal {
  /** Which signal fired */
  signal: SignalType;
  /** Points added */
  points: number;
  /** Human-readable reason */
  reason: string;
}

type SignalType =
  | 'exact_title'
  | 'alias_match'
  | 'same_system'
  | 'same_feature_link'
  | 'active_change_overlap'
  | 'shared_source'
  | 'shared_decision'
  | 'backlink_proximity'
  | 'full_text_match';

/** Scoring weight configuration (section 9.1) */
interface ScoringWeights {
  exact_title: number;        // +40
  alias_match: number;        // +35
  same_system: number;        // +20
  same_feature_link: number;  // +20 (bidirectional: Change→Feature and Feature←Change)
  active_change_overlap: number; // +25
  shared_source: number;      // +10
  shared_decision: number;    // +10
  backlink_proximity: number; // +10
  full_text_match: number;    // +15
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  exact_title: 40,
  alias_match: 35,
  same_system: 20,
  same_feature_link: 20,
  active_change_overlap: 25,
  shared_source: 10,
  shared_decision: 10,
  backlink_proximity: 10,
  full_text_match: 15,
};
```

```typescript
// ---- Candidate ----

// Canonical ScoredCandidate shape from 00-unified-types.md:
//   { id, type, title, score, reasons: string[] }
// The `signals` field is an internal implementation detail for debugging
// and is NOT part of the canonical output contract.

interface ScoredCandidate {
  /** Note id */
  id: string;
  /** Note type */
  type: NoteType;
  /** Note title */
  title: string;
  /** Total score (sum of all signals) */
  score: number;
  /** Human-readable reasons (canonical output field) */
  reasons: string[];
}

/** Internal-only: detailed signal breakdown for debugging */
interface ScoredCandidateInternal extends ScoredCandidate {
  /** All scoring signals that fired (not part of canonical output) */
  signals: ScoringSignal[];
}
```

```typescript
// ---- Classification (section 10.5) ----

type Classification =
  | 'existing_change'
  | 'existing_feature'
  | 'new_feature'
  | 'needs_confirmation';

type Confidence = 'high' | 'medium' | 'low';

/** Threshold configuration (section 10.5) */
interface ClassificationThresholds {
  existing_change: {
    min_score: number;          // >= 75
    min_gap_to_second: number;  // >= 15
  };
  existing_feature: {
    min_score: number;          // >= 70
    max_active_change_gap: number; // no active Change within 10 points
  };
  new_feature: {
    max_top_score: number;      // < 45
  };
  needs_confirmation: {
    min_top_two_score: number;  // >= 60
    max_score_gap: number;      // < 10
  };
}

const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  existing_change: {
    min_score: 75,
    min_gap_to_second: 15,
  },
  existing_feature: {
    min_score: 70,
    max_active_change_gap: 10,
  },
  new_feature: {
    max_top_score: 45,
  },
  needs_confirmation: {
    min_top_two_score: 60,
    max_score_gap: 10,
  },
};
```

```typescript
// ---- Retrieval Output (section 10.6) ----

// Canonical RetrievalResult shape from 00-unified-types.md:
//   { query, classification, confidence, sequencing, candidates, warnings: string[] }

interface RetrievalResult {
  /** Original query summary */
  query: string;
  /** Computed classification */
  classification: Classification;
  /** Confidence level */
  confidence: Confidence;
  /** Sequencing info from sequencing engine (plan 06); see integration contract in Dependencies */
  sequencing: SequencingSummary;
  /** Scored candidates ordered by score descending */
  candidates: ScoredCandidate[];
  /** Warnings as human-readable strings (canonical output shape) */
  warnings: string[];
}

interface SequencingSummary {
  status: 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'conflict_critical' | 'blocked';
  related_changes: string[];
  reasons: string[];
}

type RetrievalWarningType =
  | 'duplicate_id'
  | 'unresolved_wikilink'
  | 'ambiguous_alias'
  | 'stale_cache'
  | 'schema_mismatch'
  | 'active_change_touch_collision';

interface RetrievalWarning {
  type: RetrievalWarningType;
  message: string;
  details?: Record<string, unknown>;
}
```

### Core Algorithm

#### Pipeline Overview

```
retrieve(index: VaultIndex, query: RetrievalQuery, options?: RetrievalOptions): RetrievalResult

  Step 1: Lexical Retrieval
    -> firstPassCandidates: Set<string>  (note ids)

  Step 2: Graph Expansion (one hop)
    -> expandedCandidates: Set<string>

  Step 3: Scoring
    -> scoredCandidates: ScoredCandidate[]  (sorted by score desc)

  Step 4: Classification
    -> classification, confidence

  Step 5: Warning Collection
    -> warnings from index + retrieval-specific

  Step 6: Output Assembly
    -> RetrievalResult
```

#### Step 1: Lexical Retrieval

The first pass finds initial candidates by matching query terms against structured index fields. Each match type contributes candidates to the first-pass set.

```
function lexicalRetrieval(
  query: RetrievalQuery,
  index: VaultIndex
): Set<string>

  candidates = new Set<string>()
  allTerms = [...query.feature_terms, ...query.system_terms, ...query.entity_terms]
  searchTerms = allTerms.map(t => t.toLowerCase())

  // 1. Title match
  //    For each term, check if any note title contains that term
  for record in index.records.values():
    titleLower = record.title.toLowerCase()
    for term in searchTerms:
      if titleLower.includes(term):
        candidates.add(record.id)
        break

  // 2. Alias match
  //    For each term, check aliases
  for record in index.records.values():
    for alias in record.aliases:
      aliasLower = alias.toLowerCase()
      for term in searchTerms:
        if aliasLower.includes(term):
          candidates.add(record.id)
          break

  // 3. System match
  //    For each system_term, find System notes whose title/alias matches,
  //    then include all notes that reference that system
  for term in query.system_terms:
    termLower = term.toLowerCase()
    for record in index.records.values():
      if record.type === "system":
        if record.title.toLowerCase().includes(termLower)
           or record.aliases.some(a => a.toLowerCase().includes(termLower)):
          // Found a matching system. Add the system itself.
          candidates.add(record.id)
          // Add all notes that list this system in their systems field
          for other in index.records.values():
            if other.systems.includes(record.id):
              candidates.add(other.id)

  // 4. Feature link match
  //    Find Changes that link to Features already in candidates
  featureCandidates = [...candidates].filter(id =>
    index.records.get(id)?.type === "feature"
  )
  for record in index.records.values():
    if record.type === "change":
      targetFeature = record.feature ?? null
      targetFeatures = record.features ?? []
      allTargets = targetFeature ? [targetFeature, ...targetFeatures] : targetFeatures
      for fid in featureCandidates:
        if allTargets.includes(fid):
          candidates.add(record.id)

  // 5. Source / Decision match
  //    For each entity_term, find Source/Decision notes whose title matches
  for term in query.entity_terms:
    termLower = term.toLowerCase()
    for record in index.records.values():
      if record.type in ["source", "decision"]:
        if record.title.toLowerCase().includes(termLower)
           or record.aliases.some(a => a.toLowerCase().includes(termLower)):
          candidates.add(record.id)
          // Also include notes that reference this source/decision
          for other in index.records.values():
            if other.sources.includes(record.id) or other.decisions.includes(record.id):
              candidates.add(other.id)

  // 6. Full-text match
  //    Search raw_text for all terms. Only add notes not already candidates
  //    if they have strong multi-term overlap.
  for record in index.records.values():
    if candidates.has(record.id): continue
    textLower = record.raw_text.toLowerCase()
    matchCount = 0
    for term in searchTerms:
      if textLower.includes(term):
        matchCount++
    // Require at least 2 terms to match, or 1 term if it's a multi-word phrase
    if matchCount >= 2 or (matchCount >= 1 and searchTerms.length === 1):
      candidates.add(record.id)

  // 7. Status bias filter
  //    If status_bias is provided, prefer candidates matching those statuses.
  //    Do NOT remove non-matching candidates; just note for scoring.

  return candidates
```

#### Step 2: Graph Expansion (One Hop)

From each first-pass candidate, follow one hop through `links_out` and `links_in` to find adjacent notes that may be relevant.

```
function graphExpand(
  firstPass: Set<string>,
  index: VaultIndex
): Set<string>

  expanded = new Set<string>(firstPass)

  for id in firstPass:
    record = index.records.get(id)
    if not record: continue

    // Follow links_out
    for linkedId in record.links_out:
      expanded.add(linkedId)

    // Follow links_in
    for linkedId in record.links_in:
      expanded.add(linkedId)

  return expanded
```

#### Step 3: Scoring

Each candidate is scored by checking which signals apply. Signals are additive and each contributes a fixed weight.

```
function scoreCandidates(
  candidateIds: Set<string>,
  query: RetrievalQuery,
  index: VaultIndex,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): ScoredCandidate[]

  allTerms = [...query.feature_terms, ...query.system_terms, ...query.entity_terms]
  searchTerms = allTerms.map(t => t.toLowerCase())
  summaryLower = query.summary.toLowerCase()

  scored: ScoredCandidate[] = []

  for id in candidateIds:
    record = index.records.get(id)
    if not record: continue

    signals: ScoringSignal[] = []

    // ---- Signal 1: Exact title match ----
    //      Truly exact: title equals summary or equals a search term (case-insensitive).
    //      The fuzzy titleMatchesSummaryWords (80% word overlap) is NOT included here;
    //      it was renamed to title_similarity and folded into alias_match weighting instead.
    titleLower = record.title.toLowerCase()
    if titleLower === summaryLower
       or searchTerms.some(t => titleLower === t):
      signals.push({
        signal: "exact_title",
        points: weights.exact_title,
        reason: "exact title match: \"" + record.title + "\""
      })

    // ---- Signal 2: Alias match ----
    for alias in record.aliases:
      aliasLower = alias.toLowerCase()
      if searchTerms.some(t => aliasLower.includes(t)):
        signals.push({
          signal: "alias_match",
          points: weights.alias_match,
          reason: "alias match: " + alias
        })
        break  // count alias signal at most once per candidate

    // ---- Signal 3: Same system match ----
    //      Check if candidate shares a system with any system_term
    systemRecords = query.system_terms.map(t => findSystemByTerm(t, index)).flat()
    systemIds = systemRecords.map(r => r.id)
    for sysId in systemIds:
      if record.systems.includes(sysId):
        sysRecord = index.records.get(sysId)
        signals.push({
          signal: "same_system",
          points: weights.same_system,
          reason: "same system: " + (sysRecord?.title ?? sysId)
        })
        break  // count system signal at most once per candidate

    // ---- Signal 4: Same feature link match (bidirectional per overview.md 9.1) ----
    //      Direction A: If this is a Change, check if its target Feature is also a candidate.
    //      Direction B: If this is a Feature, check if any Change candidate targets this Feature.
    if record.type === "change":
      featureTarget = record.feature ?? null
      featureTargets = record.features ?? []
      allTargets = featureTarget ? [featureTarget, ...featureTargets] : featureTargets
      for fid in allTargets:
        if candidateIds.has(fid):
          signals.push({
            signal: "same_feature_link",
            points: weights.same_feature_link,
            reason: "same feature link: " + (index.records.get(fid)?.title ?? fid)
          })
          break
    elif record.type === "feature":
      // Check if any Change candidate in the set targets this Feature
      for otherId in candidateIds:
        otherRecord = index.records.get(otherId)
        if not otherRecord or otherRecord.type !== "change": continue
        otherTargets = otherRecord.feature
          ? [otherRecord.feature, ...(otherRecord.features ?? [])]
          : (otherRecord.features ?? [])
        if otherTargets.includes(record.id):
          signals.push({
            signal: "same_feature_link",
            points: weights.same_feature_link,
            reason: "same feature link: targeted by " + (otherRecord.title ?? otherId)
          })
          break

    // ---- Signal 5: Active change overlap ----
    //      If candidate is a Feature, check if it has active Changes
    //      If candidate is a Change, check if it is active
    if record.type === "feature":
      activeChanges = record.changes
        .map(cid => index.records.get(cid))
        .filter(c => c && isActiveChangeStatus(c.status))
      if activeChanges.length > 0:
        signals.push({
          signal: "active_change_overlap",
          points: weights.active_change_overlap,
          reason: "active change overlap: " + activeChanges.map(c => c!.title).join(", ")
        })
    elif record.type === "change" and isActiveChangeStatus(record.status):
      signals.push({
        signal: "active_change_overlap",
        points: weights.active_change_overlap,
        reason: "active change: " + record.title
      })

    // ---- Signal 6: Shared source ----
    for srcId in record.sources:
      srcRecord = index.records.get(srcId)
      if srcRecord and searchTerms.some(t => srcRecord.title.toLowerCase().includes(t)):
        signals.push({
          signal: "shared_source",
          points: weights.shared_source,
          reason: "shared source: " + srcRecord.title
        })
        break

    // ---- Signal 7: Shared decision ----
    for decId in record.decisions:
      decRecord = index.records.get(decId)
      if decRecord and searchTerms.some(t => decRecord.title.toLowerCase().includes(t)):
        signals.push({
          signal: "shared_decision",
          points: weights.shared_decision,
          reason: "shared decision: " + decRecord.title
        })
        break

    // ---- Signal 8: Backlink / shared-link proximity ----
    //      Check if candidate shares links with other candidates
    sharedLinks = record.links_out.filter(lid => candidateIds.has(lid) and lid !== id)
    sharedBacklinks = record.links_in.filter(lid => candidateIds.has(lid) and lid !== id)
    if sharedLinks.length + sharedBacklinks.length >= 2:
      signals.push({
        signal: "backlink_proximity",
        points: weights.backlink_proximity,
        reason: "backlink proximity: " + (sharedLinks.length + sharedBacklinks.length) + " shared links"
      })

    // ---- Signal 9: Full-text match ----
    textLower = record.raw_text.toLowerCase()
    matchedTerms = searchTerms.filter(t => textLower.includes(t))
    if matchedTerms.length >= 2 or (matchedTerms.length === 1 and searchTerms.length === 1):
      signals.push({
        signal: "full_text_match",
        points: weights.full_text_match,
        reason: "strong full-text hit: " + matchedTerms.join(", ")
      })

    // ---- Compute total score ----
    totalScore = signals.reduce((sum, s) => sum + s.points, 0)

    // ---- Status bias bonus ----
    //      If the record's status matches status_bias, small bonus
    //      (not a named signal, just a tiebreaker)
    if query.status_bias.includes(record.status):
      totalScore += 5  // minor tiebreaker, not a formal signal

    if totalScore > 0:
      scored.push({
        id: record.id,
        type: record.type,
        title: record.title,
        score: totalScore,
        reasons: signals.map(s => s.reason),
        // signals array kept internally for debugging (ScoredCandidateInternal)
      })

  // Sort by score descending, then by title ascending for determinism
  scored.sort((a, b) =>
    b.score - a.score || a.title.localeCompare(b.title)
  )

  return scored
```

#### Step 4: Classification

```
function classify(
  candidates: ScoredCandidate[],
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
  index: VaultIndex,
  sequencing?: SequencingSummary
): { classification: Classification; confidence: Confidence }

  // ---- Rule 0: Index-quality escalation (overview.md 10.5) ----
  //      If index-quality issues (duplicate IDs, ambiguous wikilinks, missing targets)
  //      affect any TOP candidate (top 3 by score), escalate to needs_confirmation.
  //      We scope to top candidates only — index warnings on low-scoring candidates
  //      that won't influence classification should not force escalation.
  //      We match warnings to candidates via note_path, since IndexWarning
  //      carries note_path (not note id) per 00-unified-types.md.
  topN = candidates.slice(0, 3)  // only check top candidates
  topCandidatePaths = new Set(
    topN.map(c => index.records.get(c.id)?.path).filter(Boolean)
  )
  hasIndexQualityIssue = index.warnings.some(w =>
    (w.type === "duplicate_id" or w.type === "ambiguous_alias"
     or w.type === "missing_id" or w.type === "unresolved_wikilink")
    and topCandidatePaths.has(w.note_path)
  )
  if hasIndexQualityIssue:
    return { classification: "needs_confirmation", confidence: "low" }

  // ---- Rule 0b: Sequencing severity escalation (overview.md 10.5) ----
  //      If sequencing severity is conflict_candidate or conflict_critical, escalate.
  if sequencing and (sequencing.status === "conflict_candidate" or sequencing.status === "conflict_critical"):
    return { classification: "needs_confirmation", confidence: "low" }

  if candidates.length === 0:
    return { classification: "new_feature", confidence: "high" }

  top = candidates[0]
  second = candidates.length > 1 ? candidates[1] : null
  gap = second ? top.score - second.score : Infinity

  // ---- Rule 1: existing_change ----
  //      Top candidate is an active Change with score >= 75 and gap >= 15
  if top.type === "change"
     and isActiveChangeStatus(index.records.get(top.id)?.status ?? "")
     and top.score >= thresholds.existing_change.min_score
     and gap >= thresholds.existing_change.min_gap_to_second:
    return { classification: "existing_change", confidence: "high" }

  // ---- Rule 2: needs_confirmation (check before existing_feature) ----
  //      Top two candidates >= 60 and gap < 10
  if second
     and top.score >= thresholds.needs_confirmation.min_top_two_score
     and second.score >= thresholds.needs_confirmation.min_top_two_score
     and gap < thresholds.needs_confirmation.max_score_gap:
    return { classification: "needs_confirmation", confidence: "low" }

  //      Feature and active Change both match strongly and conflict
  if top.type === "feature" and second and second.type === "change"
     and isActiveChangeStatus(index.records.get(second.id)?.status ?? "")
     and top.score >= thresholds.existing_feature.min_score
     and second.score >= top.score - thresholds.existing_feature.max_active_change_gap:
    return { classification: "needs_confirmation", confidence: "low" }

  if top.type === "change" and second and second.type === "feature"
     and isActiveChangeStatus(index.records.get(top.id)?.status ?? "")
     and second.score >= thresholds.existing_feature.min_score
     and top.score - second.score < thresholds.existing_feature.max_active_change_gap:
    return { classification: "needs_confirmation", confidence: "low" }

  // ---- Rule 3: existing_feature ----
  //      Top candidate is a Feature with score >= 70
  //      No strong active Change within 10 points
  if top.type === "feature"
     and top.score >= thresholds.existing_feature.min_score:
    hasStrongActiveChange = candidates.some(c =>
      c.id !== top.id
      and c.type === "change"
      and isActiveChangeStatus(index.records.get(c.id)?.status ?? "")
      and c.score >= top.score - thresholds.existing_feature.max_active_change_gap
    )
    if not hasStrongActiveChange:
      confidence = top.score >= 85 ? "high" : "medium"
      return { classification: "existing_feature", confidence }

  // ---- Rule 4: new_feature ----
  //      Top candidates below threshold
  if top.score < thresholds.new_feature.max_top_score:
    return { classification: "new_feature", confidence: "high" }

  // ---- Fallback: ambiguous middle ground ----
  //      Score is above new_feature threshold but below clear existing thresholds
  if top.score >= thresholds.new_feature.max_top_score
     and top.score < thresholds.existing_feature.min_score:
    return { classification: "needs_confirmation", confidence: "low" }

  // ---- Final fallback ----
  return { classification: "needs_confirmation", confidence: "low" }


function isActiveChangeStatus(status: string): boolean
  return status in ["proposed", "planned", "in_progress"]
```

#### Step 5: Warning Collection

```
// collectWarnings builds internal RetrievalWarning objects, then the pipeline
// serializes them to string[] for the canonical RetrievalResult output.
function collectWarnings(
  index: VaultIndex,
  candidates: ScoredCandidate[]
): RetrievalWarning[]

  warnings: RetrievalWarning[] = []

  // Duplicate IDs from index
  for [id, paths] in index.duplicate_ids:
    warnings.push({
      type: "duplicate_id",
      message: "Duplicate id \"" + id + "\" found in: " + paths.join(", "),
      details: { id, paths }
    })

  // Unresolved wikilinks from index (only those involving candidates)
  candidateIds = new Set(candidates.map(c => c.id))
  for error in index.link_errors:
    if candidateIds.has(error.source_id):
      if error.error === "no_match":
        warnings.push({
          type: "unresolved_wikilink",
          message: "Unresolved wikilink \"" + error.raw_link + "\" in " + error.source_path,
          details: { source_id: error.source_id, raw_link: error.raw_link }
        })
      elif error.error === "ambiguous_alias":
        warnings.push({
          type: "ambiguous_alias",
          message: "Ambiguous alias \"" + error.raw_link + "\" in " + error.source_path,
          details: { source_id: error.source_id, candidates: error.candidates }
        })

  // Schema mismatch
  if index.schema_version === "unknown":
    warnings.push({
      type: "schema_mismatch",
      message: "No schema.md found or schema_version is missing",
    })

  // Active change touch-surface collision (overview.md 10.6)
  //   Detect when two active Changes in the candidate set touch the same Feature/System
  //   without an explicit depends_on edge between them.
  activeChangeCandidates = candidates
    .filter(c => c.type === "change" and isActiveChangeStatus(index.records.get(c.id)?.status ?? ""))
  for i in range(0, activeChangeCandidates.length):
    for j in range(i + 1, activeChangeCandidates.length):
      recA = index.records.get(activeChangeCandidates[i].id)
      recB = index.records.get(activeChangeCandidates[j].id)
      if not recA or not recB: continue
      sharedTouches = recA.touches.filter(t => recB.touches.includes(t))
      if sharedTouches.length > 0:
        // Check if there is an explicit depends_on between them
        hasDependency = recA.depends_on.includes(recB.id) or recB.depends_on.includes(recA.id)
        if not hasDependency:
          warnings.push({
            type: "active_change_touch_collision",
            message: "Active changes \"" + recA.id + "\" and \"" + recB.id + "\" touch the same surface (" + sharedTouches.join(", ") + ") without explicit dependency",
            details: {
              change_a: recA.id,
              change_b: recB.id,
              shared_surfaces: sharedTouches,
            }
          })

  return warnings
```

#### Step 6: Full Pipeline

```
function retrieve(
  index: VaultIndex,
  query: RetrievalQuery,
  options?: RetrievalOptions
): RetrievalResult

  weights = mergeWeights(DEFAULT_WEIGHTS, options?.weights)
  thresholds = mergeThresholds(DEFAULT_THRESHOLDS, options?.thresholds)
  maxCandidates = options?.maxCandidates ?? 10

  // Step 1: Lexical retrieval
  firstPass = lexicalRetrieval(query, index)

  // Step 2: Graph expansion
  expanded = graphExpand(firstPass, index)

  // Step 3: Score all expanded candidates
  scored = scoreCandidates(expanded, query, index, weights)

  // Trim to max candidates
  topCandidates = scored.slice(0, maxCandidates)

  // Step 4: Classify
  //   The caller (plan 07) may provide a full SequencingResult from plan 06.
  //   retrieve() derives a SequencingSummary (subset) for the output, and passes
  //   the summary to classify() for escalation on conflict_candidate/conflict_critical.
  //   Classification ownership lives HERE in plan 05 — the caller must NOT re-classify.
  sequencingFull = options?.sequencing ?? null
  sequencingSummary = sequencingFull
    ? summarizeForRetrieval(sequencingFull)
    : { status: "parallel_safe", related_changes: [], reasons: [] }
  { classification, confidence } = classify(topCandidates, thresholds, index, sequencingSummary)

  // Step 5: Warnings (internal RetrievalWarning[] -> canonical string[])
  internalWarnings = collectWarnings(index, topCandidates)
  warnings = internalWarnings.map(w => w.message)

  // Step 6: Assemble (matches 00-unified-types.md RetrievalResult)
  //   RetrievalResult.sequencing is SequencingSummary (subset), not the full SequencingResult.
  //   The caller retains the full SequencingResult separately for post-classification use.
  return {
    query: query.summary,
    classification,
    confidence,
    sequencing: sequencingSummary,
    candidates: topCandidates,
    warnings,
  }
```

### Helper Functions

#### findSystemByTerm

```
function findSystemByTerm(term: string, index: VaultIndex): IndexRecord[]
  termLower = term.toLowerCase()
  results: IndexRecord[] = []
  for record in index.records.values():
    if record.type === "system":
      if record.title.toLowerCase().includes(termLower)
         or record.aliases.some(a => a.toLowerCase().includes(termLower)):
        results.push(record)
  return results
```

#### titleSimilarity (renamed from titleMatchesSummaryWords)

This function detects fuzzy title similarity via word overlap. It is NOT used for the `exact_title` signal (which requires truly exact match). Instead, it is available as a utility for future use or for enhanced alias matching if needed.

```
function titleSimilarity(titleLower: string, summaryLower: string): boolean
  // Remove common prefixes like "feature:", "change:", "system:"
  cleanTitle = titleLower.replace(/^(feature|change|system|decision|source|query):\s*/, "")
  cleanSummary = summaryLower

  // Check if all significant words in the title appear in the summary
  titleWords = cleanTitle.split(/\s+/).filter(w => w.length > 2)
  if titleWords.length === 0: return false

  matchCount = titleWords.filter(w => cleanSummary.includes(w)).length
  return matchCount / titleWords.length >= 0.8  // 80% word overlap
```

#### isActiveChangeStatus

```
function isActiveChangeStatus(status: string): boolean
  return ["proposed", "planned", "in_progress"].includes(status)
```

### File Structure

| File | Responsibility |
|------|---------------|
| `src/core/retrieval-engine/types.ts` | All TypeScript interfaces: `RetrievalQuery`, `ScoredCandidate`, `ScoredCandidateInternal`, `ScoringSignal`, `SignalType`, `ScoringWeights`, `Classification`, `Confidence`, `ClassificationThresholds`, `SequencingSummary`, `RetrievalResult`, `RetrievalWarning`. All canonical types must match `00-unified-types.md`. |
| `src/core/retrieval-engine/constants.ts` | `DEFAULT_WEIGHTS`, `DEFAULT_THRESHOLDS` |
| `src/core/retrieval-engine/lexical.ts` | `lexicalRetrieval()` - first-pass candidate collection |
| `src/core/retrieval-engine/graph-expand.ts` | `graphExpand()` - one-hop expansion |
| `src/core/retrieval-engine/scoring.ts` | `scoreCandidates()` - signal-based additive scoring |
| `src/core/retrieval-engine/classify.ts` | `classify()` - threshold-based classification |
| `src/core/retrieval-engine/warnings.ts` | `collectWarnings()` - warning aggregation |
| `src/core/retrieval-engine/retrieve.ts` | `retrieve()` - full pipeline orchestration |
| `src/core/retrieval-engine/helpers.ts` | `findSystemByTerm()`, `titleSimilarity()`, `isActiveChangeStatus()` |
| `src/core/retrieval-engine/index.ts` | Barrel re-exports |

### Public API / Interface

```typescript
/**
 * Run the full retrieval pipeline against a VaultIndex.
 * Classification ownership lives here — callers must NOT re-classify.
 *
 * @param query - Structured query object (section 10.4)
 * @param index - In-memory vault index (from buildIndex)
 * @param options - Optional overrides. Pass options.sequencing (full SequencingResult
 *                  from plan 06) to enable sequencing-aware classification escalation.
 *                  retrieve() derives SequencingSummary internally for the output.
 * @returns Structured retrieval result (section 10.6) with classification and
 *          SequencingSummary embedded in result.sequencing.
 */
function retrieve(
  index: VaultIndex,
  query: RetrievalQuery,
  options?: RetrievalOptions
): RetrievalResult;

interface RetrievalOptions {
  /** Override default scoring weights */
  weights?: Partial<ScoringWeights>;
  /** Override default classification thresholds */
  thresholds?: Partial<ClassificationThresholds>;
  /** Maximum number of candidates to return. Default: 10 */
  maxCandidates?: number;
  /** Full SequencingResult from sequencing engine (plan 06). If provided, retrieve()
   *  derives SequencingSummary internally and uses it for classification escalation.
   *  The caller passes the full result; retrieve() embeds only the summary subset
   *  into RetrievalResult.sequencing. */
  sequencing?: SequencingResult;
}

/**
 * Run only the lexical retrieval step (useful for debugging).
 */
function lexicalRetrieval(
  query: RetrievalQuery,
  index: VaultIndex
): Set<string>;

/**
 * Run only the scoring step (useful for debugging).
 */
function scoreCandidates(
  candidateIds: Set<string>,
  query: RetrievalQuery,
  index: VaultIndex,
  weights?: ScoringWeights
): ScoredCandidate[];

/**
 * Run only the classification step (useful for debugging).
 */
function classify(
  candidates: ScoredCandidate[],
  thresholds?: ClassificationThresholds,
  index?: VaultIndex,
  sequencing?: SequencingSummary
): { classification: Classification; confidence: Confidence };
```

### Dependencies on Other Modules

| Module | What is needed |
|--------|---------------|
| **04-index-engine** | `VaultIndex`, `IndexRecord`, `NoteType` - the retrieval engine reads the index but never modifies it |
| **06-sequencing-engine** | Provides `SequencingResult` (full) and `summarizeForRetrieval()` which converts it to `SequencingSummary`. **Integration mechanism**: the caller (plan 07 workflow-propose) calls `analyzeSequencing()` from plan 06 first, then passes the full `SequencingResult` into `retrieve()` via `options.sequencing`. `retrieve()` internally calls `summarizeForRetrieval()` to derive the `SequencingSummary` subset, uses it for classification escalation (Rule 0b), and embeds it in `RetrievalResult.sequencing`. The caller retains the full `SequencingResult` separately for post-classification use (e.g., `computeDependsOn()` in plan 07). **Classification ownership**: `classify()` lives in plan 05. Plan 07 must NOT re-implement classification — it consumes the `RetrievalResult.classification` returned by `retrieve()`. |
| **07-workflow-propose** | Calls `retrieve()` as the first step of the propose workflow |
| **11-workflow-query** | Calls `retrieve()` for vault graph search |

---

## 4. Test Strategy

### Unit Tests: Lexical Retrieval

1. **Title match**: Query with `feature_terms: ["auth"]` finds `Feature: Auth Login`
2. **Alias match**: Query with `feature_terms: ["login"]` finds a note with alias `"login auth"`
3. **System match**: Query with `system_terms: ["authentication"]` finds System note and all notes that reference it
4. **Feature link match**: Change targeting a Feature candidate is also surfaced
5. **Source/Decision match**: Query with `entity_terms: ["webauthn"]` finds Source/Decision with that title and referencing notes
6. **Full-text match**: Note containing 2+ query terms in body is surfaced even without title/alias/system match
7. **Status bias**: Notes matching status_bias get a small scoring boost
8. **Empty query**: Returns empty candidate set
9. **No matching notes**: Returns empty candidate set

### Unit Tests: Graph Expansion

10. **One hop out**: Candidate A links to B (not in first pass) -> B is added
11. **One hop in**: C links to candidate A (C not in first pass) -> C is added
12. **No two-hop**: A -> B -> C, only A is first-pass. B is added but C is not.
13. **Self-links**: Candidate links to itself -> no duplicate
14. **Empty first pass**: Returns empty

### Unit Tests: Scoring

15. **Exact title match**: Note titled "Auth Login" for query "auth login" -> +40
16. **Alias match fires once**: Note with 3 matching aliases still only gets +35 once
17. **Same system**: Note in system "authentication" and query has `system_terms: ["authentication"]` -> +20
18. **Active change overlap**: Feature with an active Change gets +25
19. **Multiple signals stack**: A note matching title + system + source gets 40+20+10 = 70
20. **Full-text match**: Note with 2 query terms in body but no title/alias match -> +15
21. **Score determinism**: Same inputs always produce same scores and same ordering
22. **Zero-score candidates excluded**: Candidates with no matching signals are filtered out

### Unit Tests: Classification

23. **existing_change**: Active Change with score 80, next candidate at 60 (gap 20 >= 15) -> `existing_change`, high confidence
24. **existing_feature**: Feature with score 75, no active Change within 10 points -> `existing_feature`
25. **new_feature**: Top score is 40 (< 45) -> `new_feature`, high confidence
26. **needs_confirmation (close scores)**: Top two both >= 60, gap < 10 -> `needs_confirmation`
27. **needs_confirmation (feature + active change)**: Feature at 75, active Change at 70 (within 10) -> `needs_confirmation`
28. **No candidates**: -> `new_feature`, high confidence
29. **Ambiguous middle ground**: Top score 55 (>= 45 but < 70) and no clear winner -> `needs_confirmation`

### Integration Tests

30. **Full pipeline with sample vault**: Create a vault with 2 Features, 3 Changes, 1 System, 1 Decision, 1 Source. Run queries that should hit each classification.
31. **Warning propagation**: Index with duplicate ids and unresolved links -> warnings appear in result
32. **Graph expansion improves recall**: A note that would be missed by lexical-only is found through one-hop expansion from a lexical hit
33. **Scoring weight override**: Custom weights change candidate ordering
34. **Threshold override**: Lowered thresholds change classification result

### Edge Cases

35. **Single note vault**: Only one Feature -> always `existing_feature` if it matches
36. **All notes same system**: System signal does not dominate (capped at +20)
37. **Change with `features:` (plural)**: Both target Features are linked correctly
38. **Query with no system_terms**: System signal never fires, other signals still work
39. **Archived Change (status: applied)**: Not counted as "active" in active_change_overlap signal
40. **Very long raw_text**: Full-text search still works within reasonable time
41. **Unicode titles and aliases**: Matching works correctly with non-ASCII characters

---

## 5. Implementation Order

### Prerequisites

- **04-index-engine** must be implemented first. The retrieval engine is a pure consumer of `VaultIndex`.
- **02-note-templates** must define note types and status values so the retrieval engine knows what `isActiveChangeStatus` means.

### Build Sequence

```
Step 1: types.ts + constants.ts
  Define all interfaces and default weight/threshold constants.
  No dependencies.

Step 2: helpers.ts
  Implement isActiveChangeStatus(), findSystemByTerm(),
  titleSimilarity().
  Write unit tests for these helpers.

Step 3: lexical.ts
  Implement lexicalRetrieval().
  Requires VaultIndex from plan 04.
  Write unit tests with mock VaultIndex.

Step 4: graph-expand.ts
  Implement graphExpand().
  Write unit tests.

Step 5: scoring.ts
  Implement scoreCandidates() with all 9 signal types.
  Write comprehensive unit tests for each signal.
  Write tests for signal stacking and deterministic ordering.

Step 6: classify.ts
  Implement classify() with all threshold rules.
  Write unit tests for each classification path.
  Write edge case tests for boundary scores.

Step 7: warnings.ts
  Implement collectWarnings().
  Write unit tests.

Step 8: retrieve.ts
  Wire everything together in retrieve().
  Write integration tests with sample vault fixtures.

Step 9: index.ts
  Barrel re-exports.
```

### Estimated Complexity

- **Types + constants**: ~180 lines
- **Helpers**: ~50 lines
- **Lexical retrieval**: ~120 lines
- **Graph expansion**: ~25 lines
- **Scoring**: ~200 lines (most complex: 9 signal implementations)
- **Classification**: ~80 lines
- **Warnings**: ~50 lines
- **Retrieve (pipeline)**: ~40 lines
- **Tests**: ~600-800 lines
