// ── Runtime API ──
export { buildIndex } from './core/index/build.js';
export { retrieve } from './core/retrieval/retrieve.js';
export { verify } from './core/workflow/verify/verify.js';
export { analyzeSequencing } from './core/sequencing/analyze.js';
export { parseNote } from './core/parser/note-parser.js';
export { propose } from './core/workflow/propose/propose.js';
export { continueChange } from './core/workflow/continue/continue.js';

// ── Type exports ──
export type {
  NoteType,
  ChangeStatus,
  FeatureStatus,
  GeneralStatus,
} from './types/notes.js';

export type {
  BaseFrontmatter,
  FeatureFrontmatter,
  ChangeFrontmatter,
  SystemFrontmatter,
  DecisionFrontmatter,
  SourceFrontmatter,
  QueryFrontmatter,
  Frontmatter,
} from './types/frontmatter.js';

export type {
  Requirement,
  Scenario,
} from './types/requirement.js';

export type {
  DeltaOp,
  DeltaTargetType,
  DeltaSummaryEntry,
} from './types/delta.js';

export type { TaskItem } from './types/task.js';

export type {
  IndexRecord,
  VaultIndex,
  IndexWarning,
} from './types/index-record.js';

export type {
  RetrievalQuery,
  Classification,
  Confidence,
  ScoredCandidate,
  SequencingSummary,
  RetrievalResult,
} from './types/retrieval.js';

export type {
  NextActionType,
  NextAction,
} from './types/next-action.js';

export type {
  VerifyIssue,
  VerifyReport,
  IssueSeverity,
  VerifyDimension,
} from './types/verify.js';
