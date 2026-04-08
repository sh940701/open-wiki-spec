export type DeltaOp = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
export type DeltaTargetType = 'requirement' | 'section';

export interface DeltaSummaryEntry {
  op: DeltaOp;
  target_type: DeltaTargetType;
  /** Name of the requirement or section */
  target_name: string;
  /** For RENAMED: the new name */
  new_name?: string;
  /** Wikilink-resolved feature/note id */
  target_note_id: string;
  /** SHA-256 hash of the target at time of writing. null for ADDED. */
  base_fingerprint: string | null;
  /** Free-text description of the change */
  description?: string;
}
