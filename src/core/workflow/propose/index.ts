export { propose } from './propose.js';
export { normalizeQuery } from './query-normalizer.js';
export { checkPlannedPrerequisites } from './prerequisites.js';
export { createFeatureNote, createChangeNote, computeDependsOn, computeTouches } from './note-creator.js';
export type {
  QueryObject,
  LocalIntent,
  ClassificationResult,
  PreflightResult,
  PlannedPrerequisites,
  ProposeResult,
  ProposeAction,
  ProposeDeps,
  ProposeOptions,
} from './types.js';
