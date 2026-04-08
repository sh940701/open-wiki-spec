export type IssueSeverity = 'error' | 'warning' | 'info';
export type VerifyDimension = 'completeness' | 'correctness' | 'coherence' | 'vault_integrity';

export interface VerifyIssue {
  dimension: VerifyDimension;
  severity: IssueSeverity;
  code: string;
  message: string;
  note_path?: string;
  note_id?: string;
  suggestion?: string;
}

export interface VerifyReport {
  scanned_at: string;
  total_notes: number;
  issues: VerifyIssue[];
  summary: Record<VerifyDimension, { errors: number; warnings: number; info: number }>;
  pass: boolean;
}
