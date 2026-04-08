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
  target?: string;
  to?: ChangeStatus;
  reason?: string;
  blockers?: string[];
}
