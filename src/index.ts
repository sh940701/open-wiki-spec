// ── Runtime API ──
export { buildIndex } from './core/index/build.js';
export { retrieve } from './core/retrieval/retrieve.js';
export { verify } from './core/workflow/verify/verify.js';
export { analyzeSequencing } from './core/sequencing/analyze.js';
export { parseNote } from './core/parser/note-parser.js';
export { propose } from './core/workflow/propose/propose.js';
export { continueChange } from './core/workflow/continue/continue.js';
export { applyChange } from './core/workflow/apply/apply.js';
export { queryWorkflow } from './core/workflow/query/query.js';
export { revertChange } from './cli/commands/revert.js';
export type { RevertResult } from './cli/commands/revert.js';
export { executeMigration } from './core/migrate/migrate.js';
export { scanOpenSpec } from './core/migrate/scanner.js';
export {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  isSchemaVersionSupported,
  readSchemaVersion,
} from './core/index/schema-version.js';
export { VERIFY_CODES, VERIFY_REPORT_SCHEMA_VERSION } from './types/verify.js';
export { ERROR_CODES } from './types/error-codes.js';
export type { ErrorCode } from './types/error-codes.js';
export { PROPOSE_RESULT_SCHEMA_VERSION } from './core/workflow/propose/types.js';
// Envelope version constant — consumers can pin against this to detect drift.
export { ENVELOPE_VERSION } from './cli/json-envelope.js';

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

// ── CLI output contracts (stable JSON shapes for --json consumers) ──
export type {
  CliJsonEnvelope,
  ListItem,
  ListResult,
  StatusResult,
  StatusSectionCompleteness,
  CliErrorPayload,
} from './types/cli-contracts.js';
