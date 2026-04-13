import type { ChangeStatus } from './notes.js';

export type NextActionType =
  | 'fill_section'
  | 'transition'
  | 'start_implementation'
  | 'continue_task'
  | 'blocked'
  | 'ready_to_apply'
  | 'verify_then_archive';

export interface NextAction {
  action: NextActionType;
  /**
   * Human-readable target name. For `fill_section` this is the section name
   * (e.g. "Why"). For `continue_task`/`start_implementation` this is the task
   * description (e.g. "Add OAuth support").
   */
  target?: string;
  /**
   * Zero-based task index, present for `continue_task` and `start_implementation`.
   * Agents can use this to know exactly which task in the Tasks list to work on
   * even if multiple tasks share the same description prefix.
   */
  taskIndex?: number;
  /**
   * Agent-facing guidance for `fill_section`. Explains what content the section
   * should contain so an automation can fill it without re-reading docs.
   */
  guidance?: string;
  /**
   * Markdown template snippet for `fill_section`. Can be inserted verbatim and
   * then populated with specifics.
   */
  templateHint?: string;
  to?: ChangeStatus;
  reason?: string;
  blockers?: string[];
}
