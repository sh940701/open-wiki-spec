import type { ChangeStatus } from '../../../types/notes.js';
import type { NextAction as PublicNextAction } from '../../../types/next-action.js';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import type { SequencingResult } from '../../../types/sequencing.js';
import type { ParseResult } from '../../parser/types.js';

// ── Section analysis ──

export interface SectionStatus {
  exists: boolean;
  isEmpty: boolean;
  content: string;
}

export interface SectionAnalysis {
  sections: Map<string, SectionStatus>;
  totalTasks: number;
  completedTasks: number;
  deltaSummaryCount: number;
  /** Raw task items from the parser, preserving text and done status */
  taskItems: Array<{ text: string; done: boolean }>;
}

// ── Prerequisites (shared with propose) ──

export interface PlannedPrerequisites {
  whyPresent: boolean;
  deltaSummaryPresent: boolean;
  tasksPresent: boolean;
  validationPresent: boolean;
}

export interface SoftPrerequisites {
  designApproachPresent: boolean;
  decisionLinkPresent: boolean;
}

// ── Section target ──

export interface SectionTarget {
  sectionName: string;
  guidance: string;
  templateHint: string;
}

// ── Task target ──

export interface TaskTarget {
  index: number;
  description: string;
}

// ── Internal rich NextAction (before flattening to public) ──

export type InternalNextAction =
  | { action: 'fill_section'; target: SectionTarget; context: GatheredContext }
  | { action: 'transition'; to: ChangeStatus; context: GatheredContext }
  | { action: 'blocked'; reason: string; unresolvedTargets: string[] }
  | { action: 'start_implementation'; target: TaskTarget; context: GatheredContext }
  | { action: 'continue_task'; target: TaskTarget; context: GatheredContext }
  | { action: 'ready_to_apply'; context: GatheredContext }
  | { action: 'verify_then_archive'; context: GatheredContext };

// ── Context ──

export interface ChangeContext {
  id: string;
  title: string;
  status: string;
  sections: SectionAnalysis;
  dependsOn: string[];
  touches: string[];
  frontmatter: Record<string, unknown>;
}

export interface LinkedNoteContext {
  id: string;
  title: string;
  type: string;
  relevantSections: Record<string, string>;
}

export interface GatheredContext {
  change: ChangeContext;
  features: LinkedNoteContext[];
  decisions: LinkedNoteContext[];
  systems: LinkedNoteContext[];
  sources: LinkedNoteContext[];
  softWarnings: string[];
}

// ── Continue result ──

export interface ContinueResult {
  changeName: string;
  changeId: string;
  currentStatus: string;
  nextAction: PublicNextAction;
  context: GatheredContext;
  summary: string;
}

// ── Selection ──

export interface ChangeSelectionCandidate {
  id: string;
  title: string;
  status: string;
  feature: string | null;
  lastModified: string;
  progressSummary: string;
}

// ── Dependency injection ──

export interface ContinueDeps {
  analyzeSequencing: (records: Map<string, IndexRecord>) => SequencingResult;
  parseNote: (filePath: string) => ParseResult;
  writeFile: (filePath: string, content: string) => void;
  readFile: (filePath: string) => string;
}
