import type {
  ProposeDeps,
  ProposeOptions,
  ProposeResult,
  ClassificationResult,
  PreflightResult,
  QueryObject,
} from './types.js';
import { PROPOSE_RESULT_SCHEMA_VERSION } from './types.js';
import type { RetrievalResult } from '../../../types/retrieval.js';
import type { SequencingResult } from '../../../types/sequencing.js';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import { normalizeQuery, enrichSystemTerms } from './query-normalizer.js';
import { checkPlannedPrerequisites } from './prerequisites.js';
import { createFeatureNote, createChangeNote, computeDependsOn, computeTouches } from './note-creator.js';
import { computeSemanticRecall } from '../../embedding/semantic-recall.js';
import { createEmbedder, DEFAULT_MODEL, DEFAULT_MODEL_REVISION } from '../../embedding/embedder.js';
import { loadEmbeddingCache, createEmptyCache, saveEmbeddingCache, getCachedVector, setCachedVector } from '../../embedding/cache.js';
import * as path from 'node:path';
import { statSync } from 'node:fs';
import { assertInsideVault } from '../../../utils/path-safety.js';
import { readConventionsContent } from '../../../utils/conventions.js';

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

  // Wrap retrieve() in a try/catch so a single bad record or a
  // scoring bug cannot abort the whole propose flow. A retrieval
  // failure downgrades the run to a "no candidates" path which
  // classify() already handles (short-circuits to needs_confirmation
  // when terms are empty, or gets classified based on whatever the
  // caller passes). The stderr trace tells operators something is
  // wrong without corrupting stdout / --json consumers.
  let retrieval: RetrievalResult;
  try {
    retrieval = deps.retrieve(index, {
      intent: mapIntent(query.intent),
      summary: query.summary,
      feature_terms: query.feature_terms,
      system_terms: query.system_terms,
      entity_terms: query.entity_terms,
      status_bias: query.status_bias,
    }, { sequencing: sequencingFull, semanticScores });
  } catch (err) {
    process.stderr.write(
      `[ows] Warning: retrieval failed (${(err as Error).message}). ` +
        `Falling back to empty candidate set — classification will ask for confirmation.\n`,
    );
    retrieval = {
      query: query.summary,
      classification: 'needs_confirmation',
      confidence: 'low',
      sequencing: { status: 'parallel_safe', related_changes: [], reasons: [] },
      candidates: [],
      warnings: [
        `Retrieval error: ${(err as Error).message}. Rerun with OWS_VERBOSE=1 for details.`,
      ],
    };
  }

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
      const cache = loadEmbeddingCache(cachePath, DEFAULT_MODEL, DEFAULT_MODEL_REVISION) ?? createEmptyCache(DEFAULT_MODEL, DEFAULT_MODEL_REVISION);

      // Progress feedback for cold start (first propose downloads the model,
      // then computes embeddings for every note — can take 30s+ on slow machines)
      const verbose = process.env.OWS_VERBOSE === '1' || process.env.OWS_DEBUG === '1';
      const toEmbed: { id: string; record: typeof index.records extends Map<string, infer R> ? R : never }[] = [];
      for (const [id, record] of index.records) {
        if (!getCachedVector(cache, id, record.content_hash) && record.raw_text) {
          toEmbed.push({ id, record });
        }
      }
      // In dry-run we don't persist the cache, and we don't want to pollute
      // stderr either (stderr can interfere with --json consumers). Only emit
      // the progress message when we're actually going to write.
      if (verbose && toEmbed.length > 0 && !options.dryRun) {
        process.stderr.write(`[ows] Computing embeddings for ${toEmbed.length} note(s) (first run may take longer)...\n`);
      }

      // Prune cache entries for notes that no longer exist in the index
      let cacheUpdated = false;
      const staleIds: string[] = [];
      for (const id of Object.keys(cache.entries)) {
        if (!index.records.has(id)) {
          staleIds.push(id);
        }
      }
      for (const id of staleIds) {
        delete cache.entries[id];
        cacheUpdated = true;
      }

      // Refresh stale/missing embeddings before recall
      for (const { id, record } of toEmbed) {
        // Include title for better semantic matching (e.g., "회원가입" in title)
        const embeddingText = `${record.title}\n${record.raw_text}`.slice(0, 512);
        const vec = await embedder.embed(embeddingText);
        if (vec) {
          setCachedVector(cache, id, vec, record.content_hash);
          cacheUpdated = true;
        }
      }
      // Persist cache even in dry-run mode — cache is an auxiliary file, not
      // part of the vault's logical state, so saving it is safe. This lets
      // diagnostic commands like `ows retrieve` (which wraps propose dry-run)
      // heal a corrupted .ows-cache/embeddings.json file.
      if (cacheUpdated) {
        try {
          assertInsideVault(cachePath, options.vaultRoot);
          saveEmbeddingCache(cachePath, cache);
        } catch {
          // Best-effort cache save — don't fail propose if save fails
        }
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
    // Guardrail: `--force-target` is meaningless for `new_feature` — the
    // whole point of that classification is to CREATE a new Feature, so
    // pointing at an existing candidate id contradicts the intent. Reject
    // the combination with a clear message rather than silently honoring
    // whichever flag happened to be processed last (the current behavior
    // would spread a reordered candidate list onto classification
    // `new_feature`, which the post-classification executor then ignores).
    if (options.forceClassification === 'new_feature' && options.forceTargetId) {
      throw new Error(
        '--force-target cannot be combined with --force-classification new_feature. ' +
          'A new_feature classification creates a brand-new Feature skeleton, so ' +
          'there is no existing target to pin. Use --force-classification existing_feature ' +
          'with --force-target instead, or drop --force-target.',
      );
    }
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

  // 4. Engine guardrail: needs_confirmation blocks note creation unless confirmed.
  //
  // `--confirm` alone is NOT enough to force a note creation — it only
  // unlocks the guard. The actual classification is still needs_confirmation,
  // and the post-classification executor would fall into the
  // `needs_confirmation` case and return `asked_user` anyway. That left
  // `--confirm` as a silent no-op in previous versions. Reject the
  // combination explicitly so users know they must also specify
  // `--force-classification` to tell the engine which direction to go.
  if (
    effectiveRetrieval.classification === 'needs_confirmation' &&
    options.confirm &&
    !options.forceClassification
  ) {
    throw new Error(
      '`confirm: true` requires `forceClassification` when the engine returned `needs_confirmation`. ' +
        'Pick one of: `forceClassification: "existing_change" | "existing_feature" | "new_feature"`. ' +
        'CLI equivalent: pass `--force-classification <type>` alongside `--confirm`.',
    );
  }
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
  const result = executePostClassification(
    classification,
    query,
    sequencingFull,
    effectiveRetrieval,
    index,
    options.vaultRoot,
    sequencing_warnings,
    deps,
  );

  // 8. Attach schema version and project conventions
  result.schema_version = PROPOSE_RESULT_SCHEMA_VERSION;
  result.conventions = readConventionsContent(options.vaultRoot, deps);

  return result;
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
      updateFeatureChangesField(feature.path, changeTitle ?? changeId, vaultRoot, deps);

      const parsed = deps.parseNote(changePath);
      const prerequisites = checkPlannedPrerequisites(parsed);

      return {
        action: 'created_change',
        retrieval,
        classification,
        target_change: {
          id: changeId,
          path: changePath,
          status: 'proposed',
        },
        target_feature: { id: feature.id, path: feature.path },
        prerequisites,
        transitioned_to_planned: false,
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
      updateFeatureChangesField(featurePath, changeTitle ?? changeId, vaultRoot, deps);

      const parsed = deps.parseNote(changePath);
      const prerequisites = checkPlannedPrerequisites(parsed);

      return {
        action: 'created_feature_and_change',
        retrieval,
        classification,
        target_change: {
          id: changeId,
          path: changePath,
          status: 'proposed',
        },
        target_feature: { id: featureId, path: featurePath },
        prerequisites,
        transitioned_to_planned: false,
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
 * Uses compare-and-swap retry to handle concurrent writes safely.
 */
function updateFeatureChangesField(
  featurePath: string,
  changeTitle: string,
  vaultRoot: string,
  deps: Pick<ProposeDeps, 'readFile' | 'writeFile'>,
): void {
  // Resolve relative paths against vault root before validation
  const absPath = path.isAbsolute(featurePath) ? featurePath : path.resolve(vaultRoot, featurePath);

  // Defensive: ensure the feature path stays inside the vault (reject symlink escapes)
  try {
    assertInsideVault(absPath, vaultRoot);
  } catch {
    return; // refuse to touch paths outside the vault
  }

  const MAX_RETRIES = 3;
  const wikilink = `"[[${changeTitle}]]"`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let beforeMtime: number | undefined;
    try {
      // Snapshot mtime before read
      try {
        beforeMtime = statSync(absPath).mtimeMs;
      } catch {
        // File may not exist yet — skip CAS
      }

      const content = deps.readFile(absPath);
      // Check if already included (idempotent)
      if (content.includes(wikilink) || content.includes(`[[${changeTitle}]]`)) return;

      // Case 1: `changes: [...]` inline array → append inside brackets
      let updated = content.replace(
        /^(changes:\s*\[)(.*?)(\])/m,
        (_match, prefix, existing, suffix) => {
          const trimmed = existing.trim();
          if (!trimmed) return `${prefix}${wikilink}${suffix}`;
          return `${prefix}${trimmed}, ${wikilink}${suffix}`;
        },
      );

      // Case 2: `changes:` block form (no value or existing list) → append YAML item
      if (updated === content) {
        updated = content.replace(
          /^(changes:)(?:\s*$|\s*\n((?:[ \t]+-[^\n]*\n?)*))/m,
          (match, prefix: string, listItems: string | undefined) => {
            if (listItems) {
              // Existing YAML list — append a new item
              return `${prefix}\n${listItems}  - ${wikilink}\n`;
            }
            return `${prefix}\n  - ${wikilink}`;
          },
        );
      }

      // Case 3: `changes:` field is entirely absent → add it to frontmatter.
      // Only do this if we can clearly identify the frontmatter block bounds.
      if (updated === content) {
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (fmMatch && !fmMatch[1].match(/^changes:/m)) {
          const insertAt = fmMatch.index! + fmMatch[0].length - '---\n'.length;
          updated = content.slice(0, insertAt) + `changes:\n  - ${wikilink}\n` + content.slice(insertAt);
        }
      }

      if (updated === content) return; // no-op (frontmatter unparseable)

      // CAS: verify mtime hasn't changed since we read
      if (beforeMtime !== undefined) {
        const currentMtime = statSync(absPath).mtimeMs;
        if (currentMtime !== beforeMtime) {
          // Someone else wrote — retry
          continue;
        }
      }

      deps.writeFile(absPath, updated);
      return;
    } catch {
      // Best-effort — don't fail propose if Feature update fails
      return;
    }
  }
}
