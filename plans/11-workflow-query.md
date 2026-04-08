# Query Workflow Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec's closest equivalent to `query` is the `explore` workflow, implemented as a skill template (`getExploreSkillTemplate()`) in `src/core/templates/workflows/explore.ts`. It defines a conversational "stance" rather than a deterministic pipeline:

1. **Explore is for thinking, not implementing.** The agent may read files and search code but must never write application code. It may create OpenSpec artifacts (proposals, designs, specs) if asked.
2. **No fixed steps.** There is no required sequence, no mandatory outputs. The agent acts as a "thinking partner."
3. **Codebase-aware.** The agent checks for active changes (`openspec list --json`), reads change artifacts if relevant, and explores actual code.
4. **Capture-on-offer.** When insights crystallize, the agent offers to save them into specific artifacts (proposal, design, specs, tasks) but never auto-captures without user consent.
5. **Exit flexibility.** Discovery can flow into a proposal, result in artifact updates, provide clarity without artifacts, or continue later.

Key behaviors in explore:
- ASCII diagrams used liberally for visualization.
- Multiple approaches compared with tradeoff tables.
- References existing change artifacts naturally in conversation.
- Offers to capture insights by artifact type (new requirement -> `specs/`, design decision -> `design.md`, scope change -> `proposal.md`, etc.).

There is no concept in OpenSpec of saving the exploration output itself as a persistent note. Insights either flow into OpenSpec artifacts or remain in the conversation and are lost.

### Key Source Files

| File | Role |
|------|------|
| `src/core/templates/workflows/explore.ts` | Skill template defining explore mode as a thinking-partner stance. Contains `getExploreSkillTemplate()` and `getOpsxExploreCommandTemplate()`. |

### Core Algorithm / Flow

OpenSpec explore has no algorithm -- it is entirely prompt-driven. The agent:

1. Checks for active changes via `openspec list --json`.
2. If a change exists and is relevant, reads its artifacts for context.
3. Engages in free-form exploration: diagramming, comparing, questioning assumptions.
4. When decisions are made, offers to capture into the appropriate artifact.
5. Optionally summarizes at the end (problem, approach, open questions, next steps).

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

**Section 13.2 (Note Types):**
- `Query` is one of the six recommended note types.
- Role: "analysis notes and captured investigation outputs."

**Section 15 (Recommended Workflow - query):**
> - Search related notes in the vault graph
> - Do not end with an answer only; store the output as a `Query` note when appropriate
>
> That is how investigation output also becomes accumulated knowledge.

**Section 11.1 (Canonical Identity):**
- Every Query has an `id` (immutable after creation).

**Section 10.2 (Index Refresh):**
- Fresh vault scan at the start of `query` (along with `propose` and `verify`).

**Section 10.3 (Index Record):**
- Query notes are parsed into the same index record shape as other note types.

### Differences from OpenSpec

| Aspect | OpenSpec (explore) | open-wiki-spec (query) |
|--------|-------------------|------------------------|
| Purpose | Free-form thinking partner | Structured investigation that creates persistent notes |
| Output | Ephemeral (stays in conversation) or flows into change artifacts | Creates a `Query` note in the vault -- accumulated knowledge |
| Knowledge persistence | Investigation output is lost between sessions | Query notes persist, are linkable, and searchable |
| Graph awareness | Checks for active changes only | Searches full vault graph (Feature, Change, System, Decision, Source, Query) |
| Scope | Tied to change exploration | Independent of changes -- can investigate any topic |
| Relationship to explore | N/A | Explore is thinking mode; Query creates notes. They are complementary, not equivalent |
| Note creation | Never creates an explore note | Creates Query notes when investigation is worth preserving |

**Key distinction from overview.md section 15:** `explore = thinking mode, query = creates notes`. OpenSpec's explore maps conceptually to a thinking stance that open-wiki-spec preserves separately. The `query` workflow specifically addresses the gap that exploration results are not persisted.

### Contracts to Satisfy

1. Query workflow performs vault graph search before answering.
2. When the investigation produces reusable knowledge, a `Query` note is created in `wiki/06-queries/`.
3. Query notes follow the minimum template contract (type, id, frontmatter, sections).
4. The decision of when to create a note vs. just answer is guided by heuristics but confirmed with the user.
5. Fresh vault scan at start of query (section 10.2).
6. Query notes are indexed and searchable by future retrieval operations.
7. Query notes link back to related Features, Systems, Decisions, Sources as appropriate.

---

## 3. Implementation Plan

### Architecture Overview

```
src/
  workflow/
    query.ts              -- Main query workflow orchestrator
  query/
    query-engine.ts       -- Vault graph search for query context
    query-note-builder.ts -- Constructs Query note markdown from investigation
    query-heuristics.ts   -- Decides whether investigation warrants a persistent note
    types.ts              -- Query-specific types
```

The query workflow has two distinct phases:
1. **Search phase** -- Use the vault index to find related notes and build context for answering the user's question.
2. **Capture phase** -- If the investigation produces reusable knowledge, create a Query note.

The engine provides the deterministic parts (search, classification, scaffolding) while the agent handles the creative parts (analysis, synthesis, recommendations). The engine never hallucinates findings.

### Data Structures

```typescript
// ─── Query Input ────────────────────────────────────────

interface QueryRequest {
  /** The user's question or investigation topic */
  question: string;
  /** Optional: restrict search to specific note types */
  noteTypes?: NoteType[];
  /** Optional: restrict search to specific systems */
  systemIds?: string[];
  /** Optional: link to a specific change context */
  changeId?: string;
}

// ─── Query Search Result ────────────────────────────────

interface QuerySearchResult {
  /** Original question */
  question: string;
  /** Notes found that are relevant to the question */
  candidates: QueryCandidate[];
  /** Graph context: notes reachable within 1-2 hops from candidates */
  graphContext: GraphContextNode[];
  /** Existing Query notes that may already answer this question */
  existingQueries: QueryCandidate[];
  /** Warnings (e.g., stale index, ambiguous matches) */
  warnings: string[];
}

interface QueryCandidate {
  id: string;
  type: NoteType;
  title: string;
  path: string;
  status: string;
  /** Why this note was returned */
  matchReasons: string[];
  /** Relevance score (same scoring as retrieval engine) */
  score: number;
  /** Key sections or content snippets relevant to the question */
  relevantSections: string[];
}

interface GraphContextNode {
  id: string;
  type: NoteType;
  title: string;
  /** How this node relates to a candidate */
  relationTo: string;    // id of the candidate it connects to
  relationType: 'links_to' | 'linked_from' | 'same_system' | 'same_feature';
}

// ─── Query Note Frontmatter ─────────────────────────────

// QueryNoteFrontmatter extends the QueryFrontmatter from 00-unified-types.md.
//
// The unified types (lines 63-70) now define QueryFrontmatter with the core
// query-specific extension fields:
//   interface QueryFrontmatter extends BaseFrontmatter {
//     type: 'query';
//     status: GeneralStatus;
//     question?: string;            // the original question or investigation prompt
//     consulted?: string[];         // wikilinks to notes consulted during investigation
//     features?: string[];          // wikilinks to related Feature notes
//     systems?: string[];           // wikilinks to related System notes
//   }
//
// Plan 11's QueryNoteFrontmatter extends this further with additional
// relationship fields that are specific to the query note creation workflow.
// These additional fields (changes, decisions, sources, related_queries) are
// stored in IndexRecord.raw_text and extracted on demand, not indexed separately.
// The core fields (question, consulted, features, systems) ARE indexed via
// the unified QueryFrontmatter type, so vault-parser (plan 03) can extract them.
//
// GeneralStatus = 'active' | 'draft' | 'archived'.
// For query notes, the practical mapping is:
//   'active' = open investigation, 'archived' = resolved investigation, 'draft' = WIP
interface QueryNoteFrontmatter extends QueryFrontmatter {
  // Fields from QueryFrontmatter (unified types -- already indexed):
  //   type: 'query'
  //   id: string
  //   status: GeneralStatus
  //   question?: string
  //   consulted?: string[]
  //   features?: string[]
  //   systems?: string[]
  //   tags: string[]

  // Additional fields (plan 11 extensions -- stored in raw_text, not indexed):
  changes?: string[];              // wikilinks
  decisions?: string[];            // wikilinks
  sources?: string[];              // wikilinks
  related_queries?: string[];      // wikilinks to other Query notes
  created_at: string;              // ISO date
}

// ─── Query Note Input (from agent) ──────────────────────

interface QueryNoteInput {
  /** The original question */
  question: string;
  /** Title for the query note (derived from question) */
  title: string;
  /** Investigation context -- what was already known */
  context: string;
  /** Investigation findings (main body, written by agent) */
  findings: string;
  /** Conclusion or answer summary */
  conclusion: string;
  /** Notes that were consulted during investigation */
  consultedNotes: string[];    // ids
  /** Related notes by type (discovered during search) */
  relatedFeatures?: string[];  // wikilinks
  relatedSystems?: string[];   // wikilinks
  relatedChanges?: string[];   // wikilinks
  relatedDecisions?: string[]; // wikilinks
  relatedSources?: string[];   // wikilinks
  relatedQueries?: string[];   // wikilinks
  /** Additional tags */
  tags?: string[];
  /** Recommendation (optional) */
  recommendation?: string;
  /** Open questions (optional) */
  openQuestions?: string;
}

// ─── Noteworthiness Assessment ──────────────────────────

interface NoteworthinessAssessment {
  /** Whether the investigation should be saved as a Query note */
  shouldCreate: boolean;
  /** Confidence in the assessment */
  confidence: 'high' | 'medium' | 'low';
  /** Reasons for the decision */
  reasons: string[];
}
```

### Query Object Normalization

Per overview.md section 10.4, the retrieval layer must not receive raw natural language. Before searching, the question must be normalized into a structured query object. The `query` workflow reuses the same `QueryObject` contract defined for the retrieval engine:

```typescript
// Query reuses the RetrievalQuery contract from 00-unified-types.md.
// The `intent` field uses query-specific values that map to RetrievalQuery.intent:
//   'investigate' -> 'query', 'compare' -> 'query', 'trace' -> 'query', 'lookup' -> 'query'
// This mapping is intentional: the retrieval engine uses a broader intent set,
// while the query workflow classifies at a finer grain for status_bias derivation.
interface QueryObject {
  intent: 'investigate' | 'compare' | 'trace' | 'lookup';
  summary: string;
  feature_terms: string[];
  system_terms: string[];
  entity_terms: string[];
  status_bias: string[];       // e.g., ["active", "proposed", "in_progress"]
}
```

The normalization step (`normalizeToQueryObject`) extracts structured terms from the natural-language question before passing to the search engine. This ensures search consistency and separates retrieval from LLM interpretation, matching the contract in overview.md 10.4.

```
function normalizeToQueryObject(question: string): QueryObject
  intent = classifyIntent(question)
    // "how does X work" -> 'investigate'
    // "compare X and Y" -> 'compare'
    // "what changed in X" -> 'trace'
    // "what is the status of X" -> 'lookup'

  featureTerms = extractTermsForType(question, 'feature')
  systemTerms = extractTermsForType(question, 'system')
  entityTerms = extractRemainingTechnicalTerms(question)

  statusBias = deriveStatusBias(intent)
    // 'investigate' -> ["active", "proposed", "planned", "in_progress"]
    // 'trace' -> ["applied", "in_progress", "active"]
    // 'lookup' -> ["active"]

  return {
    intent,
    summary: question,
    feature_terms: featureTerms,
    system_terms: systemTerms,
    entity_terms: entityTerms,
    status_bias: statusBias,
  }
```

### Core Algorithm

#### Phase 1: Vault Graph Search

```
function querySearch(request: QueryRequest, index: VaultIndex): QuerySearchResult
  0. Normalize the question into a QueryObject (section 10.4 contract):
     queryObj = normalizeToQueryObject(request.question)

  1. Convert queryObj to a RetrievalQuery for the retrieval engine (plan 05):
     retrievalQuery = {
       intent: 'query',  // all query intents map to 'query' for retrieval
       summary: queryObj.summary,
       feature_terms: queryObj.feature_terms,
       system_terms: queryObj.system_terms,
       entity_terms: queryObj.entity_terms,
       status_bias: queryObj.status_bias,
     }

  2. Call retrieval-engine retrieve (plan 05) to get scored candidates:
     // retrievalEngine.retrieve(index, retrievalQuery) -> RetrievalResult
     // Per the unified types API boundary (00-unified-types.md), the signature is:
     //   retrieve(index: VaultIndex, query: RetrievalQuery, options?) -> RetrievalResult
     // This reuses the canonical scoring logic (title +40, alias +35, etc.)
     // The query workflow does NOT reimplement scoring weights.
     retrievalResult = retrievalEngine.retrieve(index, retrievalQuery)
     allCandidates = retrievalResult.candidates

  3. Apply scope restrictions if provided:
     - Filter by request.noteTypes
     - Filter by request.systemIds
     - If request.changeId, boost that change and linked notes

  4. Map ScoredCandidate[] to QueryCandidate[] (add relevantSections, matchReasons):
     candidates = allCandidates.map(sc => ({
       id: sc.id, type: sc.type, title: sc.title, path: index.records.get(sc.id).path,
       status: index.records.get(sc.id).status, matchReasons: sc.reasons,
       score: sc.score, relevantSections: []  // filled in step 7
     }))

  5. Separate existing Query notes from other candidates:
     existingQueries = candidates.filter(c => c.type == 'query')

  6. Expand graph context one hop from top 5 non-Query candidates:
     // Cap: maximum 30 graphContext nodes total to prevent explosion in large vaults.
     MAX_GRAPH_CONTEXT = 30
     graphContext = []
     for each candidate in top 5:
       if graphContext.length >= MAX_GRAPH_CONTEXT: break
       for each link in candidate.links_out:
         if graphContext.length >= MAX_GRAPH_CONTEXT: break
         add to graphContext with relationType = "links_to"
       for each link in candidate.links_in:
         if graphContext.length >= MAX_GRAPH_CONTEXT: break
         add to graphContext with relationType = "linked_from"
       // same_system and same_feature expansion are limited to 5 nodes each
       // to avoid large fan-out in vaults with many notes per system
       for each note sharing same system (limit 5 per candidate):
         if graphContext.length >= MAX_GRAPH_CONTEXT: break
         add to graphContext with relationType = "same_system"
       for each note sharing same feature (limit 5 per candidate):
         if graphContext.length >= MAX_GRAPH_CONTEXT: break
         add to graphContext with relationType = "same_feature"

  7. Extract relevant sections from top candidates:
     for each candidate:
       find sections whose headings or content match search terms
       attach as candidate.relevantSections (excerpted, not full body)

  8. Return QuerySearchResult with candidates, graphContext, existingQueries, warnings
```

#### Phase 2: Context Construction for Agent

```
function constructQueryContext(searchResult: QuerySearchResult): string
  // Build a structured context document for the LLM to use when answering

  context = "## Vault Search Results\n\n"

  // Surface existing queries first
  if searchResult.existingQueries.length > 0:
    context += "### Existing Investigations\n"
    context += "The following Query notes may already cover this topic:\n"
    for query in searchResult.existingQueries:
      context += `- [[${query.title}]] (status: ${query.status}, score: ${query.score})\n`
      context += `  Match reasons: ${query.matchReasons.join(', ')}\n`
    context += "\n"

  context += "### Directly Relevant Notes\n"
  for candidate in searchResult.candidates (top 10, excluding queries):
    context += `- [[${candidate.title}]] (${candidate.type}, score: ${candidate.score})\n`
    context += `  Match reasons: ${candidate.matchReasons.join(', ')}\n`
    for section in candidate.relevantSections:
      context += `  > ${truncate(section, 200)}\n`

  context += "\n### Graph Context (1-hop)\n"
  for node in searchResult.graphContext:
    context += `- [[${node.title}]] (${node.type}) -- ${node.relationType} [[${node.relationTo}]]\n`

  if searchResult.warnings.length > 0:
    context += "\n### Warnings\n"
    for warning in searchResult.warnings:
      context += `- ${warning}\n`

  return context
```

#### Phase 3: Note Creation Decision

```
function assessNoteworthiness(
  question: string,
  searchResult: QuerySearchResult
): NoteworthinessAssessment

  // v1 simplified heuristics: use simple boolean rules instead of score thresholds.
  // The final decision is ALWAYS confirmed with the user. These rules only determine
  // the default recommendation and confidence level.

  reasons = []
  shouldCreate = false

  // Rule 1: Multi-note synthesis
  // If 3+ candidates appear in the search results (regardless of exact score),
  // the answer requires synthesis across multiple notes -- worth preserving.
  relevantCount = searchResult.candidates.length
  if relevantCount >= 3:
    shouldCreate = true
    reasons.push(`Investigation spans ${relevantCount} relevant notes -- synthesis needed`)

  // Rule 2: No existing coverage
  // If no existing Query note already covers this topic, preservation is more valuable.
  if searchResult.existingQueries.length == 0:
    reasons.push("No existing Query note covers this topic")
  else if searchResult.existingQueries[0].status == 'archived':
    shouldCreate = false
    reasons.push(`Existing resolved Query "${searchResult.existingQueries[0].title}" may already cover this`)

  // Rule 3: Simple lookup detection (negative signal)
  // Status checks, list queries, and count queries don't warrant notes.
  simpleLookupPatterns = [
    /^(what is|what's) the status of/i,
    /^(list|show) (all|the)/i,
    /^how many/i,
  ]
  if simpleLookupPatterns.some(p => p.test(question)):
    shouldCreate = false
    reasons.push("Simple lookup query -- direct answer likely sufficient")

  // Rule 4: Active change context boosts recommendation
  activeChangeMatches = searchResult.candidates.filter(
    c => c.type == 'change' and ['proposed', 'planned', 'in_progress'].includes(c.status)
  )
  if activeChangeMatches.length > 0:
    shouldCreate = true
    reasons.push(`Related to ${activeChangeMatches.length} active change(s)`)

  // Determine confidence based on signal clarity
  confidence = 'medium'
  if shouldCreate and relevantCount >= 3:  // many candidates = clearer signal
    confidence = 'high'
  if not shouldCreate and simpleLookupPatterns.some(p => p.test(question)):
    confidence = 'high'

  return { shouldCreate, confidence, reasons }
```

**Important:** The heuristics produce a recommendation, but the final decision to create a note is always confirmed with the user. The system never auto-creates Query notes without asking.

**Language limitation (v1):** The simple lookup detection patterns assume English input. Non-English questions will not match the negative-signal rules and may receive a slightly higher recommendation to create notes. This is acceptable for v1 because the default is to confirm with the user, so false positives are harmless. Future versions may use intent classification from the retrieval query object instead of regex patterns.

#### Phase 4: Query Note Creation

```
function createQueryNote(input: QueryNoteInput): { path: string; content: string }
  // Generate unique id
  slug = slugify(input.title, { maxLength: 40 })
  dateStr = formatDate(new Date(), 'yyyy-MM-dd')
  id = `query-${slug}-${dateStr}`

  // Build frontmatter
  frontmatter = {
    type: 'query',
    id,
    status: 'active',  // GeneralStatus: 'active' = open investigation
    question: input.question,
    features: input.relatedFeatures || [],
    systems: input.relatedSystems || [],
    changes: input.relatedChanges || [],
    decisions: input.relatedDecisions || [],
    sources: input.relatedSources || [],
    related_queries: input.relatedQueries || [],
    consulted: input.consultedNotes.map(id => wikilink(resolveTitleById(id))),
    tags: ['query', ...(input.tags || [])],
    created_at: new Date().toISOString(),
  }

  // Build markdown body (minimum section contract)
  body = `
# Query: ${input.title}

## Question

${input.question}

## Context

${input.context}

## Findings

${input.findings}

## Conclusion

${input.conclusion}

## Consulted Notes
${input.consultedNotes.map(id => `- [[${resolveTitleById(id)}]]`).join('\n')}

## Related Notes
${formatRelatedNotesByType(input)}
`

  // Optional sections
  if input.recommendation:
    body += `\n## Recommendation\n\n${input.recommendation}\n`

  if input.openQuestions:
    body += `\n## Open Questions\n\n${input.openQuestions}\n`

  // File path
  path = `wiki/06-queries/${dateStr}-${slug}.md`

  return { path, content: serializeFrontmatter(frontmatter) + body }


function formatRelatedNotesByType(input: QueryNoteInput): string
  sections = []
  if input.relatedFeatures?.length:
    sections.push('### Features\n' + input.relatedFeatures.map(f => `- ${f}`).join('\n'))
  if input.relatedSystems?.length:
    sections.push('### Systems\n' + input.relatedSystems.map(s => `- ${s}`).join('\n'))
  if input.relatedChanges?.length:
    sections.push('### Changes\n' + input.relatedChanges.map(c => `- ${c}`).join('\n'))
  if input.relatedDecisions?.length:
    sections.push('### Decisions\n' + input.relatedDecisions.map(d => `- ${d}`).join('\n'))
  if input.relatedSources?.length:
    sections.push('### Sources\n' + input.relatedSources.map(s => `- ${s}`).join('\n'))
  if input.relatedQueries?.length:
    sections.push('### Related Queries\n' + input.relatedQueries.map(q => `- ${q}`).join('\n'))
  return sections.join('\n\n')
```

### Query Note Minimum Template

The canonical Query note minimum template contract is defined in `02-note-templates`. The example below demonstrates how that contract is realized in practice. If there is a conflict between this example and `02-note-templates`, `02-note-templates` is the source of truth.

```markdown
---
type: query
id: query-auth-session-behavior-2026-04-06
status: active
question: "How does session management interact with passkey login?"
features:
  - "[[Feature: Auth Login]]"
systems:
  - "[[System: Authentication]]"
changes: []
decisions:
  - "[[Decision: Session Strategy]]"
sources: []
related_queries: []
consulted:
  - "[[Feature: Auth Login]]"
  - "[[Decision: Session Strategy]]"
  - "[[System: Authentication]]"
tags:
  - query
created_at: "2026-04-06T12:00:00Z"
---

# Query: How does session management interact with passkey login?

## Question

What happens to existing sessions when a user switches from password login to passkey login? Are sessions invalidated? Is there a migration path?

## Context

This question arose while investigating the scope of [[Change: Add Passkey Login]]. The current session lifecycle is documented in [[Decision: Session Strategy]], but it does not explicitly address authentication method switching.

## Findings

Based on investigation of [[Feature: Auth Login]] and [[Decision: Session Strategy]]:

1. Current session tokens are independent of authentication method (per [[Decision: Session Strategy]]).
2. Switching auth method does not invalidate existing sessions.
3. However, [[Feature: Auth Login]] Requirements section does not explicitly address the migration scenario.

This represents a gap in the current spec coverage.

## Conclusion

The system tolerates mixed auth methods within the same session lifecycle. A new requirement should be added to [[Feature: Auth Login]] to formalize this behavior.

## Consulted Notes
- [[Feature: Auth Login]]
- [[Decision: Session Strategy]]
- [[System: Authentication]]

## Related Notes
### Features
- [[Feature: Auth Login]]

### Systems
- [[System: Authentication]]

### Decisions
- [[Decision: Session Strategy]]

## Recommendation

Add a new requirement "Authentication Method Switching" to [[Feature: Auth Login]] that explicitly specifies session behavior when switching between password and passkey authentication.

## Open Questions

- Should switching from passkey to password require re-authentication?
- Does the session token need to encode the authentication method used?
```

### Interaction Model with the Agent

The query workflow is designed as a **two-phase interaction**:

**Phase 1: Engine provides structure** (deterministic)
1. The CLI/engine receives the user's question via `ows query "<question>"`.
2. The engine builds a fresh vault index.
3. The engine runs vault graph search via the retrieval engine.
4. The engine classifies whether a Query note should be created.
5. The engine returns structured `QueryResult` to the agent.

**Phase 2: Agent fills in analysis** (LLM-driven)
1. The agent reads the context document with search results.
2. The agent reads relevant vault notes identified in the search results.
3. The agent synthesizes findings from multiple sources.
4. The agent writes Findings, Conclusion, Recommendation, and Open Questions.
5. If the heuristics recommended note creation and the user confirms, the agent calls `createQueryNote()` to save.

This separation means the engine handles the deterministic parts (search, classification, scaffolding) while the agent handles the creative parts (analysis, synthesis, recommendations). The engine never hallucinates findings.

### File Structure

| File | Responsibility |
|------|----------------|
| `src/workflow/query.ts` | Main `queryWorkflow()` function. Orchestrates search, context construction, note creation decision, and note writing. |
| `src/query/query-engine.ts` | `querySearch()` -- delegates scoring to retrieval-engine (plan 05), performs graph expansion, scope filtering, and section extraction. |
| `src/query/query-note-builder.ts` | `createQueryNote()` -- builds Query note markdown from investigation inputs. |
| `src/query/query-heuristics.ts` | `assessNoteworthiness()` -- heuristic scoring for whether to create a note. |
| `src/query/types.ts` | All query-specific TypeScript interfaces. |

### Public API / Interface

```typescript
// ─── Main Workflow ──────────────────────────────────────

/**
 * Run the query workflow.
 * 1. Build fresh vault index.
 * 2. Search vault for related notes.
 * 3. Construct context for LLM.
 * 4. (LLM answers the question using provided context.)
 * 5. Assess whether findings warrant a Query note.
 * 6. If yes and user confirms, create the note.
 */
async function queryWorkflow(
  request: QueryRequest,
  vaultPath: string,
): Promise<QueryWorkflowResult>;

interface QueryWorkflowResult {
  /** Structured search results */
  searchResult: QuerySearchResult;
  /** Context document for LLM consumption */
  contextDocument: string;
  /** Noteworthiness assessment */
  assessment: NoteworthinessAssessment;
  /** Path of created query note (if created) */
  createdNotePath?: string;
}

// ─── Search Engine ──────────────────────────────────────

function querySearch(
  request: QueryRequest,
  index: VaultIndex,
): QuerySearchResult;

function constructQueryContext(
  searchResult: QuerySearchResult,
): string;

// ─── Note Builder ───────────────────────────────────────

function createQueryNote(
  input: QueryNoteInput,
): { path: string; content: string };

// ─── Heuristics ─────────────────────────────────────────

function assessNoteworthiness(
  question: string,
  searchResult: QuerySearchResult,
): NoteworthinessAssessment;

// ─── Note Lifecycle ─────────────────────────────────────

/**
 * Mark an existing query as resolved.
 * Updates frontmatter status from 'active' to 'archived' (per GeneralStatus).
 * Uses the shared frontmatter-writing utility from vault-parser (plan 03).
 */
function resolveQueryNote(queryId: string, vaultPath: string): void;
```

### Dependencies on Other Modules

| Module | What query needs from it |
|--------|--------------------------|
| `04-index-engine` | `VaultIndex` with `records` Map (iterable via `records.values()`, lookup via `records.get(id)`) for vault graph search |
| `05-retrieval-engine` | `retrievalEngine.retrieve()` is CALLED directly for scoring and candidate ranking per the unified types API boundary (00-unified-types.md). Query does NOT reimplement scoring weights. The function signature is `retrieve(index, query, options?)` -- index is the first parameter. |
| `03-vault-parser` | Implicitly through the index -- section content extraction for `relevantSections` |
| `02-note-templates` | Query note minimum template contract, frontmatter field set |
| `01-project-structure` | File path conventions (`wiki/06-queries/`) |

---

## 4. Test Strategy

### Unit Tests

**Query search (`query-engine.ts`):**
- Question mentioning a Feature title -> that Feature is top candidate.
- Question mentioning a System name -> System note + linked Features appear.
- Question with no vault matches -> empty candidates, no crash.
- Graph expansion adds linked notes from top candidates.
- Relevant section extraction returns sections matching search terms.
- Candidates are scored and sorted by relevance.
- Scope restriction by noteTypes filters correctly.
- Scope restriction by systemIds filters correctly.
- Existing Query notes separated into `existingQueries` field.

**Noteworthiness heuristics (`query-heuristics.ts`):**
- Simple lookup "what is the status of X" -> `shouldCreate: false`, confidence `high`.
- Complex analytical question connecting 3+ notes -> `shouldCreate: true`, confidence `high`.
- Question related to active change -> score boost applied.
- Question where existing resolved Query note covers topic -> `shouldCreate: false` with reference.
- Question where existing open Query note covers topic -> `shouldCreate: true` (update suggestion).
- Medium-complexity question -> `shouldCreate: true`, confidence `medium` (user decides).
- Empty vault question -> `shouldCreate: false`, confidence `high`.

**Query note builder (`query-note-builder.ts`):**
- Creates valid frontmatter with all required fields.
- Generates deterministic id from slug + date.
- Places file in `wiki/06-queries/` with date prefix.
- Generated markdown includes all minimum sections (Question, Context, Findings, Conclusion, Consulted Notes, Related Notes).
- Handles empty optional fields (no systems, no features) without errors.
- Optional sections (Recommendation, Open Questions) included only when provided.
- Consulted notes rendered as wikilinks.
- Related notes grouped by type.
- Special characters in question text properly handled in slug and title.

**Context construction:**
- Context document includes existing queries section when they exist.
- Context document includes candidates with scores and match reasons.
- Context document includes graph context with relation types.
- Context document includes warnings section when warnings exist.
- Context document omits empty sections.
- Long section content is truncated in context to avoid overwhelming the agent.

### Integration Tests

- Full query workflow on a vault with 5 Features, 2 Systems, 3 Decisions: question about auth -> returns relevant auth notes, context document is well-formed.
- Query workflow with note creation: creates valid Query note file, note is parseable by vault-parser, index rebuild finds the new note.
- Query workflow without note creation: no file written, workflow result has no `createdNotePath`.
- Query on empty vault (only 00-meta): returns empty candidates, no crash, `shouldCreate: false`.
- Sequential queries: second query finds first via `existingQueries`, correctly references it.
- Query note resolving: `resolveQueryNote()` changes status from 'active' to 'archived'.

### Edge Cases

- Question that matches only Query notes (recursive query) -> works correctly, no infinite loop.
- Very broad question matching 50+ notes -> candidates capped at top N, performance acceptable.
- Question in a vault with broken wikilinks -> warnings surface in search result, query still functions.
- Note creation when `wiki/06-queries/` directory doesn't exist -> directory created automatically.
- Slug collision (two queries with same title on same date) -> handled by appending counter or timestamp.
- Question with only whitespace -> rejected with validation error.
- Very long question text -> truncated in slug, full text preserved in Question section.
- Vault with all notes archived -> search includes archived notes with reduced score.

---

## 5. Implementation Order

### Prerequisites
- `04-index-engine` must be complete (provides VaultIndex for graph search).
- `05-retrieval-engine` should be complete (scoring logic to reuse).
- `02-note-templates` must define the Query note minimum template.

### Build Sequence

1. **types.ts** -- Define `QueryRequest`, `QuerySearchResult`, `QueryCandidate`, `GraphContextNode`, `QueryNoteFrontmatter`, `QueryNoteInput`, `NoteworthinessAssessment`. No dependencies.
2. **query-heuristics.ts** -- `assessNoteworthiness()`. Depends on types only. Pure logic with regex patterns, can be developed and tested in isolation.
3. **query-note-builder.ts** -- `createQueryNote()`, `formatRelatedNotesByType()`. Depends on types and note-templates for the minimum contract. Can be developed in parallel with query-engine.
4. **query-engine.ts** -- `querySearch()` and `constructQueryContext()`. Depends on index-engine for search, retrieval-engine for scoring logic. This is the core search infrastructure.
5. **query.ts (workflow orchestrator)** -- `queryWorkflow()`. Wires together search, context construction, heuristics, and note creation. Depends on all of the above.
