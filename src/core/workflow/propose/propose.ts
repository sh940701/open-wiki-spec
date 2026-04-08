import type {
  ProposeDeps,
  ProposeOptions,
  ProposeResult,
  ClassificationResult,
  PreflightResult,
  QueryObject,
} from './types.js';
import type { RetrievalResult } from '../../../types/retrieval.js';
import type { SequencingResult } from '../../../types/sequencing.js';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import { normalizeQuery, enrichSystemTerms } from './query-normalizer.js';
import { checkPlannedPrerequisites } from './prerequisites.js';
import { createFeatureNote, createChangeNote, computeDependsOn, computeTouches } from './note-creator.js';
import { computeSemanticRecall } from '../../embedding/semantic-recall.js';
import { createEmbedder, DEFAULT_MODEL } from '../../embedding/embedder.js';
import { loadEmbeddingCache, createEmptyCache, saveEmbeddingCache, getCachedVector, setCachedVector } from '../../embedding/cache.js';
import * as path from 'node:path';

/**
 * Map local intent aliases to RetrievalQuery intent.
 */
function mapIntent(intent: string): 'add' | 'modify' | 'remove' | 'query' {
  switch (intent) {
    case 'fix': return 'modify';
    case 'investigate': return 'query';
    default: return intent as 'add' | 'modify' | 'remove' | 'query';
  }
}

/**
 * Run preflight: sequencing analysis + retrieval with classification.
 * Classification is done inside retrieve() by plan 05. Plan 07 does NOT re-classify.
 */
function runPreflight(
  query: QueryObject,
  index: VaultIndex,
  deps: ProposeDeps,
  semanticScores?: ReadonlyMap<string, number>,
): PreflightResult {
  const sequencingFull = deps.analyzeSequencing(index.records);

  const retrieval = deps.retrieve(index, {
    intent: mapIntent(query.intent),
    summary: query.summary,
    feature_terms: query.feature_terms,
    system_terms: query.system_terms,
    entity_terms: query.entity_terms,
    status_bias: query.status_bias,
  }, { sequencing: sequencingFull, semanticScores });

  return { retrieval, sequencingFull };
}

/**
 * Wrap RetrievalResult into a ClassificationResult envelope.
 */
function buildClassificationResult(retrieval: RetrievalResult): ClassificationResult {
  return {
    classification: retrieval.classification,
    confidence: retrieval.confidence,
    primary_candidate: retrieval.candidates[0] ?? null,
    secondary_candidate: retrieval.candidates[1] ?? null,
    reasons: retrieval.candidates[0]?.reasons ?? [],
  };
}

/**
 * Resolve the Feature linked to a Change record.
 */
function resolveFeatureFromChange(
  change: IndexRecord,
  index: VaultIndex,
): IndexRecord | null {
  const featureId = change.feature ?? change.features?.[0];
  if (!featureId) return null;
  return index.records.get(featureId) ?? null;
}

/**
 * Extract sequencing warnings from reasons.
 * Include reasons that indicate actual problems: touch overlaps, conflicts, stale bases,
 * cycles, out-of-order errors, blocked dependencies, and needs_review.
 */
function extractSequencingWarnings(sequencingFull: SequencingResult): string[] {
  return sequencingFull.reasons.filter(
    (r) =>
      r.includes('needs_review') ||
      r.includes('conflict') ||
      r.includes('stale') ||
      r.includes('out-of-order') ||
      r.includes('cycle') ||
      r.includes('blocked') ||
      r.includes('both touch') ||
      r.includes('both changes operate') ||
      r.includes('jumped ahead'),
  );
}

/**
 * Main propose workflow.
 *
 * 1. Build index
 * 2. Normalize query
 * 3. Run preflight (sequencing + retrieval with classification)
 * 4. Route based on classification
 * 5. Check prerequisites
 * 6. Transition to planned if ready
 */
export async function propose(
  userRequest: string,
  options: ProposeOptions,
  deps: ProposeDeps,
): Promise<ProposeResult> {
  // 0. Build index
  const index = await deps.buildIndex(options.vaultRoot);

  // 1. Normalize query + enrich system_terms from index
  const rawQuery = normalizeQuery(userRequest, options.keywords);
  const query = enrichSystemTerms(rawQuery, index);

  // 1b. Compute semantic recall (graceful degradation if embedder unavailable)
  let semanticScores: ReadonlyMap<string, number> | undefined;
  try {
    const embedder = await createEmbedder();
    if (embedder.available) {
      const cachePath = path.join(options.vaultRoot, '.ows-cache', 'embeddings.json');
      const cache = loadEmbeddingCache(cachePath, DEFAULT_MODEL) ?? createEmptyCache(DEFAULT_MODEL);

      // Refresh stale/missing embeddings before recall
      let cacheUpdated = false;
      for (const [id, record] of index.records) {
        if (!getCachedVector(cache, id, record.content_hash) && record.raw_text) {
          // Include title for better semantic matching (e.g., "회원가입" in title)
          const embeddingText = `${record.title}\n${record.raw_text}`.slice(0, 512);
          const vec = await embedder.embed(embeddingText);
          if (vec) {
            setCachedVector(cache, id, vec, record.content_hash);
            cacheUpdated = true;
          }
        }
      }
      if (cacheUpdated && !options.dryRun) {
        saveEmbeddingCache(cachePath, cache);
      }

      const semanticInput = query.override_keywords && query.override_keywords.length > 0
        ? query.override_keywords.join(' ')
        : query.summary;
      const recall = await computeSemanticRecall(semanticInput, cache, embedder);
      if (recall.scores.size > 0) {
        semanticScores = recall.scores;
      }
    }
  } catch {
    // Embedding unavailable — proceed with lexical-only retrieval
  }

  // 2. Run preflight
  const { retrieval, sequencingFull } = runPreflight(query, index, deps, semanticScores);

  // 3. Allow force override (with candidate type validation)
  let effectiveRetrieval = retrieval;
  if (options.forceClassification) {
    // When forceTargetId is specified, reorder candidates so the target is first
    let reorderedCandidates = retrieval.candidates;
    if (options.forceTargetId) {
      const targetIdx = retrieval.candidates.findIndex((c) => c.id === options.forceTargetId);
      if (targetIdx === -1) {
        throw new Error(
          `--force-target id "${options.forceTargetId}" not found among retrieval candidates. ` +
          `Available: ${retrieval.candidates.map((c) => c.id).join(', ') || '(none)'}`,
        );
      }
      reorderedCandidates = [
        retrieval.candidates[targetIdx],
        ...retrieval.candidates.slice(0, targetIdx),
        ...retrieval.candidates.slice(targetIdx + 1),
      ];
    }

    const topCandidate = reorderedCandidates[0];
    if (topCandidate) {
      const expectedType = options.forceClassification === 'existing_change' ? 'change'
        : options.forceClassification === 'existing_feature' ? 'feature'
        : null;
      if (expectedType && topCandidate.type !== expectedType) {
        return {
          action: 'asked_user',
          retrieval,
          classification: buildClassificationResult(retrieval),
          target_change: null,
          target_feature: null,
          prerequisites: null,
          transitioned_to_planned: false,
          sequencing_warnings: extractSequencingWarnings(sequencingFull),
        };
      }
    }
    effectiveRetrieval = { ...retrieval, candidates: reorderedCandidates, classification: options.forceClassification };
  }

  // 4. Engine guardrail: needs_confirmation blocks note creation unless confirmed
  if (
    effectiveRetrieval.classification === 'needs_confirmation' &&
    !options.forceClassification &&
    !options.confirm
  ) {
    const guardedClassification = buildClassificationResult(effectiveRetrieval);
    return {
      action: 'asked_user',
      retrieval: effectiveRetrieval,
      classification: guardedClassification,
      target_change: null,
      target_feature: null,
      prerequisites: null,
      transitioned_to_planned: false,
      sequencing_warnings: extractSequencingWarnings(sequencingFull),
    };
  }

  // 5. Build classification result
  const classification = buildClassificationResult(effectiveRetrieval);
  const sequencing_warnings = extractSequencingWarnings(sequencingFull);

  // 6. Dry run
  if (options.dryRun) {
    return {
      action: classificationToAction(classification.classification),
      retrieval: effectiveRetrieval,
      classification,
      target_change: null,
      target_feature: null,
      prerequisites: null,
      transitioned_to_planned: false,
      sequencing_warnings,
    };
  }

  // 7. Execute post-classification action
  return executePostClassification(
    classification,
    query,
    sequencingFull,
    effectiveRetrieval,
    index,
    options.vaultRoot,
    sequencing_warnings,
    deps,
  );
}

function classificationToAction(classification: string): ProposeResult['action'] {
  switch (classification) {
    case 'existing_change': return 'continued_change';
    case 'existing_feature': return 'created_change';
    case 'new_feature': return 'created_feature_and_change';
    case 'needs_confirmation': return 'asked_user';
    default: return 'asked_user';
  }
}

function executePostClassification(
  classification: ClassificationResult,
  query: QueryObject,
  sequencingFull: SequencingResult,
  retrieval: RetrievalResult,
  index: VaultIndex,
  vaultRoot: string,
  sequencing_warnings: string[],
  deps: ProposeDeps,
): ProposeResult {
  switch (classification.classification) {
    case 'existing_change': {
      const candidate = classification.primary_candidate;
      if (!candidate) {
        return makeAskedUserResult(retrieval, classification, sequencing_warnings);
      }
      const change = index.records.get(candidate.id);
      if (!change) {
        return makeAskedUserResult(retrieval, classification, sequencing_warnings);
      }
      const feature = resolveFeatureFromChange(change, index);
      return {
        action: 'continued_change',
        retrieval,
        classification,
        target_change: { id: change.id, path: change.path, status: change.status },
        target_feature: feature ? { id: feature.id, path: feature.path } : null,
        prerequisites: null,
        transitioned_to_planned: false,
        sequencing_warnings,
      };
    }

    case 'existing_feature': {
      const candidate = classification.primary_candidate;
      if (!candidate) {
        return makeAskedUserResult(retrieval, classification, sequencing_warnings);
      }
      const feature = index.records.get(candidate.id);
      if (!feature) {
        return makeAskedUserResult(retrieval, classification, sequencing_warnings);
      }

      const { id: changeId, path: changePath, title: changeTitle } = createChangeNote(
        vaultRoot,
        { id: feature.id, title: feature.title },
        query,
        sequencingFull,
        index,
        deps,
      );

      // Update Feature's changes field to include the new Change
      updateFeatureChangesField(feature.path, changeTitle ?? changeId, deps);

      const parsed = deps.parseNote(changePath);
      const prerequisites = checkPlannedPrerequisites(parsed);

      return {
        action: 'created_change',
        retrieval,
        classification,
        target_change: {
          id: changeId,
          path: changePath,
          status: prerequisites.all_hard_met ? 'planned' : 'proposed',
        },
        target_feature: { id: feature.id, path: feature.path },
        prerequisites,
        transitioned_to_planned: prerequisites.all_hard_met,
        sequencing_warnings,
      };
    }

    case 'new_feature': {
      const { id: featureId, path: featurePath, title: featureTitle } = createFeatureNote(vaultRoot, query, index, deps);

      const { id: changeId, path: changePath, title: changeTitle } = createChangeNote(
        vaultRoot,
        { id: featureId, title: featureTitle },
        query,
        sequencingFull,
        index,
        deps,
      );

      // Update Feature's changes field
      updateFeatureChangesField(featurePath, changeTitle ?? changeId, deps);

      const parsed = deps.parseNote(changePath);
      const prerequisites = checkPlannedPrerequisites(parsed);

      return {
        action: 'created_feature_and_change',
        retrieval,
        classification,
        target_change: {
          id: changeId,
          path: changePath,
          status: prerequisites.all_hard_met ? 'planned' : 'proposed',
        },
        target_feature: { id: featureId, path: featurePath },
        prerequisites,
        transitioned_to_planned: prerequisites.all_hard_met,
        sequencing_warnings,
      };
    }

    case 'needs_confirmation':
    default:
      return makeAskedUserResult(retrieval, classification, sequencing_warnings);
  }
}

function makeAskedUserResult(
  retrieval: RetrievalResult,
  classification: ClassificationResult,
  sequencing_warnings: string[],
): ProposeResult {
  return {
    action: 'asked_user',
    retrieval,
    classification,
    target_change: null,
    target_feature: null,
    prerequisites: null,
    transitioned_to_planned: false,
    sequencing_warnings,
  };
}

/**
 * Update a Feature note's `changes` frontmatter field to include a new Change.
 */
function updateFeatureChangesField(
  featurePath: string,
  changeTitle: string,
  deps: Pick<ProposeDeps, 'readFile' | 'writeFile'>,
): void {
  try {
    const content = deps.readFile(featurePath);
    const wikilink = `"[[${changeTitle}]]"`;
    // Check if already included
    if (content.includes(wikilink) || content.includes(`[[${changeTitle}]]`)) return;
    // Find `changes:` field in frontmatter and append
    const updated = content.replace(
      /^(changes:\s*\[)(.*?)(\])/m,
      (_match, prefix, existing, suffix) => {
        const trimmed = existing.trim();
        if (!trimmed) return `${prefix}${wikilink}${suffix}`;
        return `${prefix}${trimmed}, ${wikilink}${suffix}`;
      },
    ).replace(
      /^(changes:)\s*$/m,
      `$1\n  - ${wikilink}`,
    );
    if (updated !== content) {
      deps.writeFile(featurePath, updated);
    }
  } catch {
    // Best-effort — don't fail propose if Feature update fails
  }
}
