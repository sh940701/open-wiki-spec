/**
 * Query search engine.
 * Performs vault graph search for query context.
 *
 * Delegates scoring to the retrieval engine (plan 05) per the ownership
 * rules in 00-unified-types.md. Query does NOT reimplement scoring weights.
 */
import type { VaultIndex, IndexRecord } from '../../../types/index.js';
import type { QueryRequest, QuerySearchResult, QueryCandidate, GraphContextNode } from './types.js';
import { retrieve } from '../../retrieval/index.js';
import type { RetrievalQuery } from '../../../types/retrieval.js';
import type { RetrievalOptions } from '../../retrieval/retrieve.js';

const MAX_CANDIDATES = 20;
const MAX_GRAPH_CONTEXT = 30;
const TOP_CANDIDATES_FOR_GRAPH = 5;

/**
 * Search the vault index for notes relevant to a query question.
 * Returns candidates, graph context, existing queries, and warnings.
 */
export function querySearch(
  request: QueryRequest,
  index: VaultIndex,
  options?: { semanticScores?: ReadonlyMap<string, number> },
): QuerySearchResult {
  const warnings: string[] = [];

  // Normalize question into a RetrievalQuery for the retrieval engine
  const retrievalQuery = normalizeToRetrievalQuery(request.question);

  // Delegate scoring to retrieval engine (plan 05)
  const retrievalOpts: RetrievalOptions = { maxCandidates: MAX_CANDIDATES + 10 };
  if (options?.semanticScores) {
    retrievalOpts.semanticScores = options.semanticScores;
  }
  const retrievalResult = retrieve(index, retrievalQuery, retrievalOpts);

  // Map ScoredCandidate[] to QueryCandidate[]
  let allCandidates: QueryCandidate[] = retrievalResult.candidates.map((sc) => {
    const record = index.records.get(sc.id);
    // Populate relevantSections from record headings that match query terms
    const terms = extractTerms(request.question);
    const relevantSections = (record?.headings ?? []).filter((h) =>
      terms.some((t) => h.toLowerCase().includes(t)),
    );
    return {
      id: sc.id,
      type: sc.type,
      title: sc.title,
      path: record?.path ?? '',
      status: record?.status ?? '',
      matchReasons: sc.reasons,
      score: sc.score,
      relevantSections,
    };
  });

  // Apply scope restrictions
  if (request.noteTypes) {
    const allowed = new Set(request.noteTypes);
    // Always allow query type through for existingQueries separation
    allowed.add('query');
    allCandidates = allCandidates.filter((c) => allowed.has(c.type));
  }

  if (request.systemIds) {
    const allowedSystems = new Set(request.systemIds);
    allCandidates = allCandidates.filter((c) => {
      if (c.type === 'query') return true; // queries pass through
      const record = index.records.get(c.id);
      if (!record) return false;
      return record.systems.some((s) => allowedSystems.has(s));
    });
  }

  if (request.changeId) {
    // Boost the specific change and its linked notes
    for (const candidate of allCandidates) {
      if (candidate.id === request.changeId) {
        candidate.score += 20;
        candidate.matchReasons.push('change context boost');
      }
    }
  }

  // Re-sort by score descending after scope adjustments
  allCandidates.sort((a, b) => b.score - a.score);

  // Separate existing queries from other candidates
  const existingQueries = allCandidates.filter((c) => c.type === 'query');
  const nonQueryCandidates = allCandidates.filter((c) => c.type !== 'query').slice(0, MAX_CANDIDATES);

  // Expand graph context from top candidates
  const graphContext = expandGraphContext(nonQueryCandidates.slice(0, TOP_CANDIDATES_FOR_GRAPH), index);

  // Add retrieval warnings if any
  if (retrievalResult.warnings.length > 0) {
    warnings.push(...retrievalResult.warnings);
  }

  return {
    question: request.question,
    candidates: nonQueryCandidates,
    graphContext,
    existingQueries,
    warnings,
  };
}

/**
 * Build a structured context document for LLM consumption.
 */
export function constructQueryContext(searchResult: QuerySearchResult): string {
  const lines: string[] = [];
  lines.push('## Vault Search Results');
  lines.push('');

  if (searchResult.existingQueries.length > 0) {
    lines.push('### Existing Investigations');
    lines.push('The following Query notes may already cover this topic:');
    for (const q of searchResult.existingQueries) {
      lines.push(`- [[${q.title}]] (status: ${q.status}, score: ${q.score})`);
      lines.push(`  Match reasons: ${q.matchReasons.join(', ')}`);
    }
    lines.push('');
  }

  if (searchResult.candidates.length > 0) {
    lines.push('### Directly Relevant Notes');
    for (const c of searchResult.candidates.slice(0, 10)) {
      lines.push(`- [[${c.title}]] (${c.type}, score: ${c.score})`);
      lines.push(`  Match reasons: ${c.matchReasons.join(', ')}`);
      for (const section of c.relevantSections) {
        lines.push(`  > ${truncate(section, 200)}`);
      }
    }
    lines.push('');
  }

  if (searchResult.graphContext.length > 0) {
    lines.push('### Graph Context (1-hop)');
    for (const node of searchResult.graphContext) {
      lines.push(`- [[${node.title}]] (${node.type}) -- ${node.relationType} [[${node.relationTo}]]`);
    }
    lines.push('');
  }

  if (searchResult.warnings.length > 0) {
    lines.push('### Warnings');
    for (const warning of searchResult.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Internal helpers ─────────────────────────────────────

/**
 * Normalize a natural-language question into a RetrievalQuery
 * per overview.md section 10.4 contract.
 */
function normalizeToRetrievalQuery(question: string): RetrievalQuery {
  const terms = extractTerms(question);

  return {
    intent: 'query',
    summary: question,
    feature_terms: terms,
    system_terms: terms,
    entity_terms: terms,
    status_bias: ['active', 'proposed', 'planned', 'in_progress'],
  };
}

/** Extract meaningful search terms from a question */
function extractTerms(question: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must',
    'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by', 'about',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
    'how', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  ]);

  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));
}

/** Expand graph context one hop from top candidates */
function expandGraphContext(
  topCandidates: QueryCandidate[],
  index: VaultIndex,
): GraphContextNode[] {
  const graphContext: GraphContextNode[] = [];
  const seen = new Set<string>();

  for (const candidate of topCandidates) {
    if (graphContext.length >= MAX_GRAPH_CONTEXT) break;
    const record = index.records.get(candidate.id);
    if (!record) continue;

    // Links out
    for (const linkId of record.links_out) {
      if (graphContext.length >= MAX_GRAPH_CONTEXT) break;
      if (seen.has(linkId)) continue;
      seen.add(linkId);
      const target = index.records.get(linkId);
      if (target) {
        graphContext.push({
          id: target.id,
          type: target.type,
          title: target.title,
          relationTo: candidate.id,
          relationType: 'links_to',
        });
      }
    }

    // Links in
    for (const linkId of record.links_in) {
      if (graphContext.length >= MAX_GRAPH_CONTEXT) break;
      if (seen.has(linkId)) continue;
      seen.add(linkId);
      const source = index.records.get(linkId);
      if (source) {
        graphContext.push({
          id: source.id,
          type: source.type,
          title: source.title,
          relationTo: candidate.id,
          relationType: 'linked_from',
        });
      }
    }

    // Same-feature expansion: other notes sharing the same feature
    const featureId = record.feature ?? record.features?.[0];
    if (featureId) {
      for (const [otherId, otherRecord] of index.records) {
        if (graphContext.length >= MAX_GRAPH_CONTEXT) break;
        if (seen.has(otherId) || otherId === candidate.id) continue;
        const otherFeature = otherRecord.feature ?? otherRecord.features?.[0];
        if (otherFeature === featureId) {
          seen.add(otherId);
          graphContext.push({
            id: otherRecord.id,
            type: otherRecord.type,
            title: otherRecord.title,
            relationTo: candidate.id,
            relationType: 'same_feature',
          });
        }
      }
    }

    // Same-system expansion: other notes sharing any system
    for (const systemId of record.systems) {
      if (graphContext.length >= MAX_GRAPH_CONTEXT) break;
      for (const [otherId, otherRecord] of index.records) {
        if (graphContext.length >= MAX_GRAPH_CONTEXT) break;
        if (seen.has(otherId) || otherId === candidate.id) continue;
        if (otherRecord.systems.includes(systemId)) {
          seen.add(otherId);
          graphContext.push({
            id: otherRecord.id,
            type: otherRecord.type,
            title: otherRecord.title,
            relationTo: candidate.id,
            relationType: 'same_system',
          });
        }
      }
    }
  }

  return graphContext;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
