import type { DeltaOp } from '../../../types/delta.js';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import type { ParseResult } from '../../parser/types.js';

// ── Delta Entry (internal camelCase form) ──

export interface DeltaEntry {
  op: DeltaOp;
  targetType: 'requirement' | 'section';
  targetName: string;
  newName?: string;
  targetNote: string;
  targetNoteId?: string;
  baseFingerprint: string | null;
  description?: string;
  rawLine: string;
}

export interface DeltaPlan {
  entries: DeltaEntry[];
  byTargetNote: Map<string, DeltaEntry[]>;
  warnings: string[];
}

// ── Stale detection ──

export interface StaleCheckResult {
  entry: DeltaEntry;
  isStale: boolean;
  currentHash: string | null;
  expectedHash: string | null;
  reason?: string;
}

export interface StaleReport {
  hasStaleEntries: boolean;
  staleEntries: StaleCheckResult[];
  cleanEntries: StaleCheckResult[];
  blocked: boolean;
}

// ── Feature updater ──

export interface ApplyOperation {
  priority: number;
  entry: DeltaEntry;
}

export interface ApplyOperationResult {
  entry: DeltaEntry;
  success: boolean;
  error?: string;
  contentChanged?: boolean;
}

export interface FeatureApplyResult {
  featureId: string;
  featurePath: string;
  operations: ApplyOperationResult[];
  updatedContent: string;
  requiresWrite: boolean;
}

// ── Validation ──

export interface PreValidation {
  entry: DeltaEntry;
  valid: boolean;
  error?: string;
}

export interface PostValidation {
  entry: DeltaEntry;
  valid: boolean;
  error?: string;
  hashChanged?: boolean;
}

// ── Section apply ──

export interface SectionApplyResult {
  noteId: string;
  notePath: string;
  sectionName: string;
  op: 'ADDED' | 'MODIFIED' | 'REMOVED';
  success: boolean;
  error?: string;
}

// ── Pending agent op ──

export interface PendingAgentOp {
  entry: DeltaEntry;
  featureId: string;
  featurePath: string;
}

// ── Main apply types ──

export interface ApplyOptions {
  changeId: string;
  vaultRoot: string;
  dryRun?: boolean;
  forceStale?: boolean;
  /** When true, do not auto-transition to 'applied' if pendingAgentOps exist. */
  noAutoTransition?: boolean;
}

export interface ApplyResult {
  changeId: string;
  changeName: string;
  success: boolean;
  staleReport: StaleReport;
  featureResults: FeatureApplyResult[];
  sectionResults: SectionApplyResult[];
  postValidation: PostValidation[];
  pendingAgentOps: PendingAgentOp[];
  preEditSnapshots: Map<string, Map<string, string>>;
  statusTransitioned: boolean;
  modifiedFiles?: string[];
  warnings: string[];
  errors: string[];
}

// ── Archive ──

export interface ArchiveOptions {
  changeId: string;
  vaultRoot: string;
}

export interface ArchiveResult {
  success: boolean;
  fromPath: string;
  toPath: string;
  indexInvalidated: boolean;
  error?: string;
}

// ── Dependency injection ──

export interface ApplyDeps {
  parseNote: (filePath: string) => ParseResult;
  writeFile: (filePath: string, content: string) => void;
  readFile: (filePath: string) => string;
  fileExists: (filePath: string) => boolean;
  moveFile: (from: string, to: string) => void;
  ensureDir: (dirPath: string) => void;
  /** Delete a file. Used for atomic write cleanup. Optional for backward compat. */
  deleteFile?: (filePath: string) => void;
  /**
   * Atomically create a file with exclusive access (fails if file exists).
   * Used for lock acquisition. Defaults to fs.openSync(path, 'wx') when not provided.
   */
  exclusiveCreateFile?: (filePath: string, content: string) => void;
}
