// Sequencing engine - plan 06

// Types are re-exported from src/types/sequencing.ts
export type {
  TouchesSeverity,
  RequirementConflictSeverity,
  ConflictOp,
  TouchesSeverityResult,
  RequirementConflictPair,
  OrderedChange,
  CycleError,
  StaleBaseEntry,
  OutOfOrderError,
  SequencingResult,
  PerChangeSequencingResult,
  TouchesOverlap,
  RequirementConflict,
} from '../../types/sequencing.js';

export { analyzeSequencing, summarizeForRetrieval } from './analyze.js';
export { computeTouchesSeverity } from './touches-analyzer.js';
export { checkBaseFingerprints } from './stale-detector.js';
export { detectRequirementConflicts } from './requirement-conflict-detector.js';
export { computeDeterministicOrder } from './ordering.js';
export { detectOutOfOrderErrors } from './out-of-order-detector.js';
