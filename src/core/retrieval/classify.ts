import type { Classification, Confidence, ScoredCandidate, SequencingSummary } from '../../types/retrieval.js';
import type { VaultIndex } from '../../types/index-record.js';
import type { ClassificationThresholds } from './constants.js';
import { DEFAULT_THRESHOLDS } from './constants.js';
import { isActiveChangeStatus } from './helpers.js';

export interface ClassifyDecision {
  classification: Classification;
  confidence: Confidence;
  /** Human-readable justification — always present so downstream can display it. */
  reason: string;
}

/**
 * Classify scored candidates using threshold rules (section 10.5).
 * Every return path records a human-readable `reason` explaining which
 * rule fired — this is what agents and `--json` consumers surface when
 * the classification is `needs_confirmation` (so users know what to
 * clarify) or when a `new_feature` default is picked silently.
 */
export function classify(
  rawCandidates: ScoredCandidate[],
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
  index?: VaultIndex,
  sequencing?: SequencingSummary,
): ClassifyDecision {
  // Dedupe by id up front. A scoring bug or an overly-enthusiastic graph
  // expansion step could produce the same note twice in the candidate
  // list; without dedup, `top`/`second` gap math gets confused (the gap
  // is 0, incorrectly triggering `needs_confirmation`). Keep the first
  // occurrence — scoring already sorts by score descending, so the
  // first entry for any id is the highest-scored one.
  const seen = new Set<string>();
  const candidates: ScoredCandidate[] = [];
  for (const c of rawCandidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    candidates.push(c);
  }
  // Rule 0: Index-quality escalation
  if (index) {
    const topN = candidates.slice(0, 3);
    const topCandidatePaths = new Set(
      topN.map((c) => index.records.get(c.id)?.path).filter(Boolean),
    );
    const qualityWarning = index.warnings.find(
      (w) =>
        (w.type === 'duplicate_id' ||
          w.type === 'ambiguous_alias' ||
          w.type === 'missing_id' ||
          w.type === 'unresolved_wikilink') &&
        topCandidatePaths.has(w.note_path),
    );
    if (qualityWarning) {
      return {
        classification: 'needs_confirmation',
        confidence: 'low',
        reason: `Top candidate note has an index-quality issue (${qualityWarning.type}): ${qualityWarning.message}`,
      };
    }
  }

  // Rule 0b: Sequencing severity escalation
  if (
    sequencing &&
    (sequencing.status === 'conflict_candidate' || sequencing.status === 'conflict_critical')
  ) {
    return {
      classification: 'needs_confirmation',
      confidence: 'low',
      reason: `Sequencing engine flagged status=${sequencing.status}: ${sequencing.reasons.join('; ') || 'active changes conflict with each other'}`,
    };
  }

  if (candidates.length === 0) {
    return {
      classification: 'new_feature',
      confidence: 'high',
      reason: 'No matching notes in the vault — defaulting to new_feature.',
    };
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
    return {
      classification: 'existing_change',
      confidence: 'high',
      reason: `Top candidate is an active Change "${top.title}" with score ${top.score} (gap to second = ${gap}).`,
    };
  }

  // Rule 2: needs_confirmation (check before existing_feature)
  // Top two candidates >= 60 and gap < 10
  if (
    second &&
    top.score >= thresholds.needs_confirmation.min_top_two_score &&
    second.score >= thresholds.needs_confirmation.min_top_two_score &&
    gap < thresholds.needs_confirmation.max_score_gap
  ) {
    return {
      classification: 'needs_confirmation',
      confidence: 'low',
      reason: `Top two candidates both score high ("${top.title}"=${top.score}, "${second.title}"=${second.score}) with a small gap (${gap}); manual disambiguation needed.`,
    };
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
    return {
      classification: 'needs_confirmation',
      confidence: 'low',
      reason: `Top candidate is Feature "${top.title}" (${top.score}) but active Change "${second.title}" (${second.score}) is close — should this change join the active one or target the Feature directly?`,
    };
  }

  if (
    top.type === 'change' &&
    second &&
    second.type === 'feature' &&
    isActiveChangeStatus(index?.records.get(top.id)?.status ?? '') &&
    second.score >= thresholds.existing_feature.min_score &&
    top.score - second.score < thresholds.existing_feature.max_active_change_gap
  ) {
    return {
      classification: 'needs_confirmation',
      confidence: 'low',
      reason: `Top candidate is active Change "${top.title}" (${top.score}) but Feature "${second.title}" (${second.score}) is close — same ambiguity as above.`,
    };
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
      return {
        classification: 'existing_feature',
        confidence,
        reason: `Top candidate is Feature "${top.title}" (${top.score}) with no competing active Change nearby.`,
      };
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
    return {
      classification: 'new_feature',
      confidence: 'high',
      reason: `Top Feature (${topFeatureScore}) and top Change (${topChangeScore}) are both below the new_feature threshold (${thresholds.new_feature.max_top_score}); nothing close enough to reuse.`,
    };
  }

  // Fallback: ambiguous middle ground
  if (
    top.score >= thresholds.new_feature.max_top_score &&
    top.score < thresholds.existing_feature.min_score
  ) {
    return {
      classification: 'needs_confirmation',
      confidence: 'low',
      reason: `Top candidate "${top.title}" scores ${top.score}, in the ambiguous middle band (${thresholds.new_feature.max_top_score}-${thresholds.existing_feature.min_score}).`,
    };
  }

  // Final fallback
  return {
    classification: 'needs_confirmation',
    confidence: 'low',
    reason: 'No rule fired — retrieval produced candidates but none matched any clear classification branch.',
  };
}
