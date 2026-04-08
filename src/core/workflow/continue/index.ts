export { continueChange } from './continue.js';
export { analyzeChangeSections, checkPlannedPrerequisites, buildSectionTarget } from './section-checker.js';
export { nextAction, toPublicNextAction } from './next-action.js';
export { checkDecisionPromotion } from './decision-promoter.js';
export type {
  SectionAnalysis,
  SectionStatus,
  SectionTarget,
  TaskTarget,
  InternalNextAction,
  GatheredContext,
  ChangeContext,
  LinkedNoteContext,
  ContinueResult,
  ChangeSelectionCandidate,
  ContinueDeps,
} from './types.js';
