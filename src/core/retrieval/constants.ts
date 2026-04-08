/**
 * Scoring signal types (section 9.1 of overview.md)
 */
export type SignalType =
  | 'exact_title'
  | 'title_partial'
  | 'alias_match'
  | 'same_system'
  | 'same_feature_link'
  | 'active_change_overlap'
  | 'shared_source'
  | 'shared_decision'
  | 'backlink_proximity'
  | 'full_text_match'
  | 'full_text_weak'
  | 'semantic_similarity';

/**
 * Individual scoring signal applied to a candidate
 */
export interface ScoringSignal {
  signal: SignalType;
  points: number;
  reason: string;
}

/**
 * Scoring weight configuration (section 9.1)
 */
export interface ScoringWeights {
  exact_title: number;
  title_partial: number;
  alias_match: number;
  same_system: number;
  same_feature_link: number;
  active_change_overlap: number;
  shared_source: number;
  shared_decision: number;
  backlink_proximity: number;
  full_text_match: number;
  full_text_weak: number;
  semantic_similarity?: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  exact_title: 40,
  title_partial: 20,
  alias_match: 35,
  same_system: 20,
  same_feature_link: 20,
  active_change_overlap: 25,
  shared_source: 10,
  shared_decision: 10,
  backlink_proximity: 10,
  full_text_match: 15,
  full_text_weak: 8,
  semantic_similarity: 30,
};

/**
 * Classification threshold configuration (section 10.5)
 */
export interface ClassificationThresholds {
  existing_change: {
    min_score: number;
    min_gap_to_second: number;
  };
  existing_feature: {
    min_score: number;
    max_active_change_gap: number;
  };
  new_feature: {
    max_top_score: number;
  };
  needs_confirmation: {
    min_top_two_score: number;
    max_score_gap: number;
  };
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
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
