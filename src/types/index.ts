// Note types
export type { NoteType, ChangeStatus, FeatureStatus, GeneralStatus } from './notes.js';

// Frontmatter
export type {
  BaseFrontmatter,
  FeatureFrontmatter,
  ChangeFrontmatter,
  SystemFrontmatter,
  DecisionFrontmatter,
  SourceFrontmatter,
  QueryFrontmatter,
  Frontmatter,
} from './frontmatter.js';

// Requirement
export type { Requirement, Scenario } from './requirement.js';

// Delta
export type { DeltaOp, DeltaTargetType, DeltaSummaryEntry } from './delta.js';

// Task
export type { TaskItem } from './task.js';

// Index
export type { IndexRecord, VaultIndex, IndexWarning, IndexWarningType } from './index-record.js';

// Retrieval
export type {
  RetrievalQuery,
  Classification,
  Confidence,
  ScoredCandidate,
  SequencingSummary,
  RetrievalResult,
} from './retrieval.js';

// Sequencing
export type {
  TouchesSeverity,
  RequirementConflictSeverity,
  ConflictOp,
  PerChangeSequencingResult,
  TouchesOverlap,
  RequirementConflict,
  TouchesSeverityResult,
  RequirementConflictPair,
  OrderedChange,
  CycleError,
  StaleBaseEntry,
  OutOfOrderError,
  SequencingResult,
} from './sequencing.js';

// Verify
export type { IssueSeverity, VerifyDimension, VerifyIssue, VerifyReport } from './verify.js';

// Next Action
export type { NextActionType, NextAction } from './next-action.js';
