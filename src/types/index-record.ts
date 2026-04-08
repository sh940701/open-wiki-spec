import type { NoteType } from './notes.js';
import type { Requirement } from './requirement.js';
import type { DeltaSummaryEntry } from './delta.js';
import type { TaskItem } from './task.js';

export interface IndexRecord {
  schema_version: string;
  id: string;
  type: NoteType;
  title: string;
  aliases: string[];
  path: string;
  status: string;
  created_at?: string;
  tags: string[];

  // Relationship fields (wikilink-resolved to ids)
  systems: string[];
  sources: string[];
  decisions: string[];
  changes: string[];
  feature?: string;
  features?: string[];
  depends_on: string[];
  touches: string[];

  // Graph fields
  links_out: string[];
  links_in: string[];

  // Content fields
  headings: string[];
  requirements: Requirement[];
  delta_summary: DeltaSummaryEntry[];
  tasks: TaskItem[];
  raw_text: string;
  content_hash: string;
}

export interface VaultIndex {
  schema_version: string;
  scanned_at: string;
  /** Absolute path to the vault root (project directory containing wiki/) */
  vaultRoot: string;
  records: Map<string, IndexRecord>;
  warnings: IndexWarning[];
}

export type IndexWarningType =
  | 'duplicate_id'
  | 'unresolved_wikilink'
  | 'ambiguous_alias'
  | 'missing_id'
  | 'schema_mismatch'
  | 'invalid_frontmatter'
  | 'empty_typed_note';

export interface IndexWarning {
  type: IndexWarningType;
  severity?: 'warning' | 'error';
  note_path: string;
  message: string;
}
