// Workflow operations - plans 07-11

// Propose workflow (plan 07)
export { propose, normalizeQuery, checkPlannedPrerequisites as checkProposePrerequisites } from './propose/index.js';
export type { ProposeResult, ProposeOptions, ProposeDeps, QueryObject, ClassificationResult, PreflightResult } from './propose/index.js';

// Continue workflow (plan 08)
export { continueChange, analyzeChangeSections, nextAction, toPublicNextAction, checkDecisionPromotion } from './continue/index.js';
export type { ContinueResult, ContinueDeps, SectionAnalysis, GatheredContext, InternalNextAction } from './continue/index.js';

// Apply workflow (plan 09)
export { applyChange, archiveChange, parseDeltaSummary, validateDeltaConflicts, detectStale, applyDeltaToFeature, verifyApply } from './apply/index.js';
export type { ApplyResult, ApplyOptions, ApplyDeps, DeltaEntry, DeltaPlan, StaleReport, FeatureApplyResult, PendingAgentOp, ArchiveResult } from './apply/index.js';

// Verify workflow (plan 10)
export { verify } from './verify/index.js';
export type { VerifyOptions } from './verify/index.js';

// Query workflow (plan 11)
export { queryWorkflow, querySearch, constructQueryContext, assessNoteworthiness, createQueryNote } from './query/index.js';
export type { QueryRequest, QueryWorkflowResult, QuerySearchResult, NoteworthinessAssessment, QueryNoteInput } from './query/index.js';
