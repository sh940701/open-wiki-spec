/**
 * Public JSON output contracts for the `ows` CLI.
 *
 * These interfaces define the stable wire-shape of `--json` output for each
 * command. AI agents and automation scripts should type their consumers
 * against these types to survive minor implementation changes.
 *
 * Stability: Adding new OPTIONAL fields is non-breaking. Removing or renaming
 * existing fields requires a schema_version bump in CURRENT_SCHEMA_VERSION
 * and a release note.
 */
import type { NoteType } from './notes.js';
import type { NextAction } from './next-action.js';

/** Single item returned by `ows list --json`. */
export interface ListItem {
  id: string;
  type: NoteType;
  title: string;
  status: string;
  path: string;
  linkedFeature?: string;
  taskProgress?: { total: number; completed: number };
}

/** Result of `ows list --json`. */
export interface ListResult {
  type: 'changes' | 'features' | 'all';
  items: ListItem[];
}

/** Section completeness map returned by `ows status --json`. */
export interface StatusSectionCompleteness {
  why: boolean;
  deltaSummary: boolean;
  tasks: boolean;
  validation: boolean;
  designApproach?: boolean;
}

/** Result of `ows status <id> --json`. */
export interface StatusResult {
  changeId: string;
  status: string;
  /** Linked Feature note IDs (resolved from the change's `feature`/`features` field). */
  features: string[];
  sectionCompleteness: StatusSectionCompleteness;
  taskProgress: { total: number; completed: number };
  nextAction: NextAction;
  /** Change IDs (or raw wikilink targets) blocking this change. */
  blockedBy: string[];
}

/** Unified success envelope for all CLI --json output. */
export interface CliJsonEnvelope<T = unknown> {
  ok: true;
  command: string;
  /**
   * Envelope schema version. Current CLI always emits `"1"` (see
   * `ENVELOPE_VERSION`). Typed as `string` so consumers can parse
   * future versions without retyping; check against `ENVELOPE_VERSION`
   * at runtime if strict version pinning is needed.
   */
  envelope_version: string;
  /** CLI package version that produced this envelope. */
  version: string;
  data: T;
}

/** Unified error payload produced by handleCliError() in --json mode. */
export interface CliErrorPayload {
  error: true;
  code: string;
  message: string;
  /** Extra structured data carried by typed errors (e.g., AmbiguousChangeError candidates). */
  details?: Record<string, unknown>;
}
