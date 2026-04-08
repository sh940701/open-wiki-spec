/**
 * Query workflow types.
 */
import type { NoteType } from '../../../types/notes.js';

// ─── Query Input ────────────────────────────────────────

export interface QueryRequest {
  /** The user's question or investigation topic */
  question: string;
  /** Optional: restrict search to specific note types */
  noteTypes?: NoteType[];
  /** Optional: restrict search to specific systems */
  systemIds?: string[];
  /** Optional: link to a specific change context */
  changeId?: string;
}

// ─── Query Search Result ────────────────────────────────

export interface QuerySearchResult {
  question: string;
  candidates: QueryCandidate[];
  graphContext: GraphContextNode[];
  existingQueries: QueryCandidate[];
  warnings: string[];
}

export interface QueryCandidate {
  id: string;
  type: NoteType;
  title: string;
  path: string;
  status: string;
  matchReasons: string[];
  score: number;
  relevantSections: string[];
}

export interface GraphContextNode {
  id: string;
  type: NoteType;
  title: string;
  relationTo: string;
  relationType: 'links_to' | 'linked_from' | 'same_system' | 'same_feature';
}

// ─── Query Note Input ──────────────────────────────────

export interface QueryNoteInput {
  question: string;
  title: string;
  context: string;
  findings: string;
  conclusion: string;
  consultedNotes: string[];
  relatedFeatures?: string[];
  relatedSystems?: string[];
  relatedChanges?: string[];
  relatedDecisions?: string[];
  relatedSources?: string[];
  relatedQueries?: string[];
  tags?: string[];
  recommendation?: string;
  openQuestions?: string;
}

// ─── Noteworthiness Assessment ──────────────────────────

export interface NoteworthinessAssessment {
  shouldCreate: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

// ─── Query Workflow Result ──────────────────────────────

export interface QueryWorkflowResult {
  searchResult: QuerySearchResult;
  contextDocument: string;
  assessment: NoteworthinessAssessment;
  createdNotePath?: string;
}
