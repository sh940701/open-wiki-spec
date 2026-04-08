import type { RetrievalQuery, ScoredCandidate } from '../../types/retrieval.js';
import type { VaultIndex } from '../../types/index-record.js';
import type { ScoringSignal, ScoringWeights } from './constants.js';
import { DEFAULT_WEIGHTS } from './constants.js';
import { findSystemByTerm, isActiveChangeStatus } from './helpers.js';

/**
 * Internal scored candidate with detailed signal breakdown for debugging.
 */
export interface ScoredCandidateInternal extends ScoredCandidate {
  signals: ScoringSignal[];
}

/**
 * Score all candidates using the additive signal model (section 9.1 + 9.2).
 * Optional embeddingScores map provides pre-computed cosine similarities for Signal 10.
 */
export function scoreCandidates(
  candidateIds: Set<string>,
  query: RetrievalQuery,
  index: VaultIndex,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  embeddingScores?: Map<string, number>,
): ScoredCandidate[] {
  const allTerms = [...query.feature_terms, ...query.system_terms, ...query.entity_terms];
  const searchTerms = allTerms.map((t) => t.toLowerCase());
  const summaryLower = query.summary.toLowerCase();

  const scored: ScoredCandidate[] = [];

  for (const id of candidateIds) {
    const record = index.records.get(id);
    if (!record) continue;

    const signals: ScoringSignal[] = [];

    // Signal 1: Title match (exact, prefix-stripped, or partial)
    const titleLower = record.title.toLowerCase();
    const titleWithoutPrefix = titleLower.replace(/^(feature|change|system|decision|source|query):\s*/i, '');
    if (titleLower === summaryLower || searchTerms.some((t) => titleLower === t)) {
      signals.push({
        signal: 'exact_title',
        points: weights.exact_title,
        reason: `exact title match: "${record.title}"`,
      });
    } else if (searchTerms.some((t) => titleWithoutPrefix === t)) {
      // Search term matches title minus type prefix (+30)
      signals.push({
        signal: 'exact_title',
        points: 30,
        reason: `prefix-stripped title match: "${record.title}"`,
      });
    } else if (searchTerms.some((t) => titleLower.includes(t) || titleWithoutPrefix.includes(t))) {
      // Title contains any search term (+20)
      signals.push({
        signal: 'title_partial',
        points: weights.title_partial,
        reason: `partial title match: "${record.title}"`,
      });
    }

    // Signal 2: Alias match (at most once)
    for (const alias of record.aliases) {
      const aliasLower = alias.toLowerCase();
      if (searchTerms.some((t) => aliasLower.includes(t))) {
        signals.push({
          signal: 'alias_match',
          points: weights.alias_match,
          reason: `alias match: ${alias}`,
        });
        break;
      }
    }

    // Signal 3: Same system match (at most once)
    const systemRecords = query.system_terms.flatMap((t) => findSystemByTerm(t, index));
    const systemIds = systemRecords.map((r) => r.id);
    for (const sysId of systemIds) {
      if (record.systems.includes(sysId)) {
        const sysRecord = index.records.get(sysId);
        signals.push({
          signal: 'same_system',
          points: weights.same_system,
          reason: `same system: ${sysRecord?.title ?? sysId}`,
        });
        break;
      }
    }

    // Signal 4: Same feature link match (bidirectional)
    if (record.type === 'change') {
      const featureTarget = record.feature ?? null;
      const featureTargets = record.features ?? [];
      const allTargets = featureTarget ? [featureTarget, ...featureTargets] : featureTargets;
      for (const fid of allTargets) {
        if (candidateIds.has(fid)) {
          signals.push({
            signal: 'same_feature_link',
            points: weights.same_feature_link,
            reason: `same feature link: ${index.records.get(fid)?.title ?? fid}`,
          });
          break;
        }
      }
    } else if (record.type === 'feature') {
      for (const otherId of candidateIds) {
        const otherRecord = index.records.get(otherId);
        if (!otherRecord || otherRecord.type !== 'change') continue;
        const otherTargets = otherRecord.feature
          ? [otherRecord.feature, ...(otherRecord.features ?? [])]
          : (otherRecord.features ?? []);
        if (otherTargets.includes(record.id)) {
          signals.push({
            signal: 'same_feature_link',
            points: weights.same_feature_link,
            reason: `same feature link: targeted by ${otherRecord.title ?? otherId}`,
          });
          break;
        }
      }
    }

    // Signal 5: Active change overlap
    if (record.type === 'feature') {
      const activeChanges = record.changes
        .map((cid) => index.records.get(cid))
        .filter((c) => c && isActiveChangeStatus(c.status));
      if (activeChanges.length > 0) {
        signals.push({
          signal: 'active_change_overlap',
          points: weights.active_change_overlap,
          reason: `active change overlap: ${activeChanges.map((c) => c!.title).join(', ')}`,
        });
      }
    } else if (record.type === 'change' && isActiveChangeStatus(record.status)) {
      signals.push({
        signal: 'active_change_overlap',
        points: weights.active_change_overlap,
        reason: `active change: ${record.title}`,
      });
    }

    // Signal 6: Shared source (at most once)
    for (const srcId of record.sources) {
      const srcRecord = index.records.get(srcId);
      if (srcRecord && searchTerms.some((t) => srcRecord.title.toLowerCase().includes(t))) {
        signals.push({
          signal: 'shared_source',
          points: weights.shared_source,
          reason: `shared source: ${srcRecord.title}`,
        });
        break;
      }
    }

    // Signal 7: Shared decision (at most once)
    for (const decId of record.decisions) {
      const decRecord = index.records.get(decId);
      if (decRecord && searchTerms.some((t) => decRecord.title.toLowerCase().includes(t))) {
        signals.push({
          signal: 'shared_decision',
          points: weights.shared_decision,
          reason: `shared decision: ${decRecord.title}`,
        });
        break;
      }
    }

    // Signal 8: Backlink / shared-link proximity
    const sharedLinks = record.links_out.filter((lid) => candidateIds.has(lid) && lid !== id);
    const sharedBacklinks = record.links_in.filter((lid) => candidateIds.has(lid) && lid !== id);
    if (sharedLinks.length + sharedBacklinks.length >= 2) {
      signals.push({
        signal: 'backlink_proximity',
        points: weights.backlink_proximity,
        reason: `backlink proximity: ${sharedLinks.length + sharedBacklinks.length} shared links`,
      });
    }

    // Signal 9: Full-text match
    const textLower = record.raw_text.toLowerCase();
    const matchedTerms = searchTerms.filter((t) => textLower.includes(t));
    if (matchedTerms.length >= 2 || (matchedTerms.length === 1 && searchTerms.length === 1)) {
      signals.push({
        signal: 'full_text_match',
        points: weights.full_text_match,
        reason: `strong full-text hit: ${matchedTerms.join(', ')}`,
      });
    } else if (matchedTerms.length === 1) {
      signals.push({
        signal: 'full_text_weak',
        points: weights.full_text_weak,
        reason: `weak full-text hit: ${matchedTerms.join(', ')}`,
      });
    }

    // Signal 10: Semantic similarity (embedding-based, section 9.2)
    if (embeddingScores && weights.semantic_similarity) {
      const similarity = embeddingScores.get(id);
      if (similarity !== undefined && similarity > 0.7) {
        const points = Math.round(similarity * weights.semantic_similarity);
        signals.push({
          signal: 'semantic_similarity',
          points,
          reason: `semantic match: ${similarity.toFixed(2)}`,
        });
      }
    }

    // Compute total score
    let totalScore = signals.reduce((sum, s) => sum + s.points, 0);

    // Status bias bonus (minor tiebreaker)
    if (query.status_bias.includes(record.status)) {
      totalScore += 5;
    }

    if (totalScore > 0) {
      scored.push({
        id: record.id,
        type: record.type,
        title: record.title,
        score: totalScore,
        reasons: signals.map((s) => s.reason),
        status: record.status,
        path: record.path,
      });
    }
  }

  // Sort by score descending, then by title ascending for determinism
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return scored;
}
