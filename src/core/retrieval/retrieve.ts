import type { RetrievalQuery, RetrievalResult, SequencingSummary } from '../../types/retrieval.js';
import type { VaultIndex } from '../../types/index-record.js';
import type { SequencingResult } from '../../types/sequencing.js';
import type { ScoringWeights, ClassificationThresholds } from './constants.js';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './constants.js';
import { lexicalRetrieval } from './lexical.js';
import { graphExpand } from './graph-expand.js';
import { scoreCandidates } from './scoring.js';
import { classify } from './classify.js';
import { collectWarnings } from './warnings.js';
import { summarizeForRetrieval } from '../sequencing/analyze.js';

export interface RetrievalOptions {
  weights?: Partial<ScoringWeights>;
  thresholds?: Partial<ClassificationThresholds>;
  maxCandidates?: number;
  sequencing?: SequencingResult;
  /**
   * Pre-computed semantic similarity scores per note id.
   * Keys are used as additional candidates (merged before graph expansion).
   * Values are cosine similarities passed to scoreCandidates for Signal 10.
   */
  semanticScores?: ReadonlyMap<string, number>;
}

function mergeWeights(
  defaults: ScoringWeights,
  overrides?: Partial<ScoringWeights>,
): ScoringWeights {
  if (!overrides) return defaults;
  return { ...defaults, ...overrides };
}

function mergeThresholds(
  defaults: ClassificationThresholds,
  overrides?: Partial<ClassificationThresholds>,
): ClassificationThresholds {
  if (!overrides) return defaults;
  return {
    existing_change: { ...defaults.existing_change, ...overrides.existing_change },
    existing_feature: { ...defaults.existing_feature, ...overrides.existing_feature },
    new_feature: { ...defaults.new_feature, ...overrides.new_feature },
    needs_confirmation: { ...defaults.needs_confirmation, ...overrides.needs_confirmation },
  };
}

/**
 * Run the full retrieval pipeline against a VaultIndex.
 * Classification ownership lives here -- callers must NOT re-classify.
 */
export function retrieve(
  index: VaultIndex,
  query: RetrievalQuery,
  options?: RetrievalOptions,
): RetrievalResult {
  const weights = mergeWeights(DEFAULT_WEIGHTS, options?.weights);
  const thresholds = mergeThresholds(DEFAULT_THRESHOLDS, options?.thresholds);
  const maxCandidates = options?.maxCandidates ?? 10;

  // Step 1: Lexical retrieval
  const lexicalCandidates = lexicalRetrieval(query, index);

  // Step 1b: Merge semantic candidates (if available) before graph expansion
  const semanticScores = options?.semanticScores;
  const semanticUsed = semanticScores !== undefined && semanticScores.size > 0;
  const firstPass = new Set(lexicalCandidates);
  if (semanticScores) {
    for (const id of semanticScores.keys()) {
      if (index.records.has(id)) {
        firstPass.add(id);
      }
    }
  }

  // Step 2: Graph expansion (semantic candidates get graph neighbors too)
  const expanded = graphExpand(firstPass, index);

  // Step 3: Score all expanded candidates (with embedding scores for Signal 10)
  const embeddingScores = semanticScores
    ? new Map(semanticScores)
    : undefined;
  const scored = scoreCandidates(expanded, query, index, weights, embeddingScores);

  // Step 3b: Filter out Query notes for non-query intents. Query notes
  // store investigation history — they share terms with whatever
  // feature they were written about, so lexical retrieval happily
  // surfaces them as top candidates when a user later proposes a
  // related change. That pollutes classification (a past Query note
  // shouldn't win against the actual Feature it investigated). Keep
  // them only when the caller explicitly asked for them via
  // intent='query' (the `ows query` workflow path).
  const filteredScored = query.intent === 'query'
    ? scored
    : scored.filter((c) => c.type !== 'query');

  // Trim to max candidates
  const topCandidates = filteredScored.slice(0, maxCandidates);

  // Step 4: Classify
  const sequencingFull = options?.sequencing ?? null;
  const sequencingSummary: SequencingSummary = sequencingFull
    ? summarizeForRetrieval(sequencingFull)
    : { status: 'parallel_safe', related_changes: [], reasons: [] };

  // Step 4a: Guard against under-specified queries.
  // If normalization dropped every token (e.g., the user typed only stop
  // words like "the and is", or pasted punctuation), both term arrays and
  // the candidate set will be empty. The default classify() rule then
  // returns `new_feature / high` — which causes `propose` to confidently
  // create a brand-new Feature/Change pair from essentially no signal.
  // That is the worst possible default: silent, irreversible, and
  // high-confidence wrong. Short-circuit to `needs_confirmation` with a
  // clear warning so the user is prompted to rephrase.
  const hasAnyTerms =
    query.feature_terms.length > 0 ||
    query.system_terms.length > 0 ||
    query.entity_terms.length > 0;
  const internalWarnings = collectWarnings(index, topCandidates);
  const warnings = internalWarnings.map((w) => w.message);

  if (!hasAnyTerms && topCandidates.length === 0) {
    const underSpecifiedReason =
      'Query is under-specified: no meaningful search terms were extracted. ' +
      'Rephrase with concrete nouns or verbs.';
    warnings.unshift(underSpecifiedReason);
    return {
      query: query.summary,
      classification: 'needs_confirmation',
      confidence: 'low',
      sequencing: sequencingSummary,
      candidates: topCandidates,
      warnings,
      classification_reason: underSpecifiedReason,
      semantic_used: semanticUsed,
    };
  }

  const decision = classify(topCandidates, thresholds, index, sequencingSummary);

  // Step 6: Assemble
  return {
    query: query.summary,
    classification: decision.classification,
    confidence: decision.confidence,
    sequencing: sequencingSummary,
    candidates: topCandidates,
    warnings,
    classification_reason: decision.reason,
    semantic_used: semanticUsed,
  };
}
