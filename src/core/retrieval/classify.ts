import type { Classification, Confidence, ScoredCandidate, SequencingSummary } from '../../types/retrieval.js';
import type { VaultIndex } from '../../types/index-record.js';
import type { ClassificationThresholds } from './constants.js';
import { DEFAULT_THRESHOLDS } from './constants.js';
import { isActiveChangeStatus } from './helpers.js';

/**
 * Classify scored candidates using threshold rules (section 10.5).
 */
export function classify(
  candidates: ScoredCandidate[],
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
  index?: VaultIndex,
  sequencing?: SequencingSummary,
): { classification: Classification; confidence: Confidence } {
  // Rule 0: Index-quality escalation
  if (index) {
    const topN = candidates.slice(0, 3);
    const topCandidatePaths = new Set(
      topN.map((c) => index.records.get(c.id)?.path).filter(Boolean),
    );
    const hasIndexQualityIssue = index.warnings.some(
      (w) =>
        (w.type === 'duplicate_id' ||
          w.type === 'ambiguous_alias' ||
          w.type === 'missing_id' ||
          w.type === 'unresolved_wikilink') &&
        topCandidatePaths.has(w.note_path),
    );
    if (hasIndexQualityIssue) {
      return { classification: 'needs_confirmation', confidence: 'low' };
    }
  }

  // Rule 0b: Sequencing severity escalation
  if (
    sequencing &&
    (sequencing.status === 'conflict_candidate' || sequencing.status === 'conflict_critical')
  ) {
    return { classification: 'needs_confirmation', confidence: 'low' };
  }

  if (candidates.length === 0) {
    return { classification: 'new_feature', confidence: 'high' };
  }

  const top = candidates[0];
  const second = candidates.length > 1 ? candidates[1] : null;
  const gap = second ? top.score - second.score : Infinity;

  // Rule 1: existing_change
  if (
    top.type === 'change' &&
    isActiveChangeStatus(index?.records.get(top.id)?.status ?? '') &&
    top.score >= thresholds.existing_change.min_score &&
    gap >= thresholds.existing_change.min_gap_to_second
  ) {
    return { classification: 'existing_change', confidence: 'high' };
  }

  // Rule 2: needs_confirmation (check before existing_feature)
  // Top two candidates >= 60 and gap < 10
  if (
    second &&
    top.score >= thresholds.needs_confirmation.min_top_two_score &&
    second.score >= thresholds.needs_confirmation.min_top_two_score &&
    gap < thresholds.needs_confirmation.max_score_gap
  ) {
    return { classification: 'needs_confirmation', confidence: 'low' };
  }

  // Feature and active Change both match strongly and conflict
  if (
    top.type === 'feature' &&
    second &&
    second.type === 'change' &&
    isActiveChangeStatus(index?.records.get(second.id)?.status ?? '') &&
    top.score >= thresholds.existing_feature.min_score &&
    second.score >= top.score - thresholds.existing_feature.max_active_change_gap
  ) {
    return { classification: 'needs_confirmation', confidence: 'low' };
  }

  if (
    top.type === 'change' &&
    second &&
    second.type === 'feature' &&
    isActiveChangeStatus(index?.records.get(top.id)?.status ?? '') &&
    second.score >= thresholds.existing_feature.min_score &&
    top.score - second.score < thresholds.existing_feature.max_active_change_gap
  ) {
    return { classification: 'needs_confirmation', confidence: 'low' };
  }

  // Rule 3: existing_feature
  if (top.type === 'feature' && top.score >= thresholds.existing_feature.min_score) {
    const hasStrongActiveChange = candidates.some(
      (c) =>
        c.id !== top.id &&
        c.type === 'change' &&
        isActiveChangeStatus(index?.records.get(c.id)?.status ?? '') &&
        c.score >= top.score - thresholds.existing_feature.max_active_change_gap,
    );
    if (!hasStrongActiveChange) {
      const confidence: Confidence = top.score >= 85 ? 'high' : 'medium';
      return { classification: 'existing_feature', confidence };
    }
  }

  // Rule 4: new_feature
  // Per overview.md 10.5: "top Feature and Change candidates are both below 45"
  const topFeature = candidates.find((c) => c.type === 'feature');
  const topChange = candidates.find((c) => c.type === 'change');
  const topFeatureScore = topFeature?.score ?? 0;
  const topChangeScore = topChange?.score ?? 0;
  if (
    topFeatureScore < thresholds.new_feature.max_top_score &&
    topChangeScore < thresholds.new_feature.max_top_score
  ) {
    return { classification: 'new_feature', confidence: 'high' };
  }

  // Fallback: ambiguous middle ground
  if (
    top.score >= thresholds.new_feature.max_top_score &&
    top.score < thresholds.existing_feature.min_score
  ) {
    return { classification: 'needs_confirmation', confidence: 'low' };
  }

  // Final fallback
  return { classification: 'needs_confirmation', confidence: 'low' };
}
