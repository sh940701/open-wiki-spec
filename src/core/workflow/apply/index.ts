export { applyChange, archiveChange } from './apply.js';
export { parseDeltaSummary, validateDeltaConflicts } from './delta-parser.js';
export { detectStale, computeRequirementHash } from './stale-checker.js';
export { applyDeltaToFeature } from './feature-updater.js';
export { verifyApply } from './verify-apply.js';
export type {
  DeltaEntry,
  DeltaPlan,
  StaleReport,
  StaleCheckResult,
  FeatureApplyResult,
  ApplyOperationResult,
  PreValidation,
  PostValidation,
  SectionApplyResult,
  PendingAgentOp,
  ApplyOptions,
  ApplyResult,
  ArchiveOptions,
  ArchiveResult,
  ApplyDeps,
} from './types.js';
