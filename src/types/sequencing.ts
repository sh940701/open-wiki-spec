import type { DeltaOp, DeltaSummaryEntry } from './delta.js';

export type TouchesSeverity = 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'blocked';
export type RequirementConflictSeverity = 'conflict_critical';

/**
 * ConflictOp extends DeltaOp with a pseudo-op for the new-name side of RENAMED.
 * Only used in conflict detection; does NOT appear in DeltaSummaryEntry.op.
 */
export type ConflictOp = DeltaOp | 'RENAMED_TO';

// ── Per-change view (used by consumers like retrieval, verify) ──

export interface PerChangeSequencingResult {
  change_id: string;
  overall_severity: TouchesSeverity | RequirementConflictSeverity;
  touches_overlaps: TouchesOverlap[];
  requirement_conflicts: RequirementConflict[];
  blocked_by: string[];
  ordering_position?: number;
}

export interface TouchesOverlap {
  other_change_id: string;
  shared_surface: string;
  severity: TouchesSeverity;
}

export interface RequirementConflict {
  other_change_id: string;
  feature_id: string;
  requirement_name: string;
  this_op: ConflictOp;
  other_op: ConflictOp;
}

// ── Aggregate analysis (produced by sequencing engine, plan 06) ──

export interface TouchesSeverityResult {
  severity: TouchesSeverity;
  change_a: string;
  change_b: string;
  overlapping_features: string[];
  overlapping_systems: string[];
  reasons: string[];
}

export interface RequirementConflictPair {
  change_a: string;
  change_b: string;
  feature_id: string;
  requirement_name: string;
  this_op: ConflictOp;
  other_op: ConflictOp;
  reason: string;
}

export interface OrderedChange {
  id: string;
  depth: number;
  position: number;
  blocked_by: string[];
  conflicts_with: string[];
}

export interface CycleError {
  cycle: string[];
  message: string;
}

export interface StaleBaseEntry {
  change_id: string;
  delta_entry: DeltaSummaryEntry;
  expected_hash: string;
  actual_hash: string;
  feature_id: string;
  requirement_key: string;
}

export interface OutOfOrderError {
  change_id: string;
  change_status: string;
  dependency_id: string;
  dependency_status: string;
  message: string;
}

export interface SequencingResult {
  status: TouchesSeverity | RequirementConflictSeverity;
  pairwise_severities: TouchesSeverityResult[];
  requirement_conflicts: RequirementConflictPair[];
  ordering: OrderedChange[];
  cycles: CycleError[];
  stale_bases: StaleBaseEntry[];
  out_of_order_errors: OutOfOrderError[];
  reasons: string[];
  related_changes: string[];
}
