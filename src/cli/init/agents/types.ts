import type { WorkflowDefinition } from '../workflow-definitions.js';

export type AgentId = 'claude' | 'codex';
export type AgentSelector = AgentId | 'both' | 'auto';

/** One file an adapter wants written. `path` is relative to the project root. */
export interface AgentArtifact {
  path: string;
  contents: string;
}

export interface AgentAdapter {
  readonly id: AgentId;
  /** Pure: produce all artifacts for the given workflows. No filesystem access. */
  render(defs: WorkflowDefinition[]): AgentArtifact[];
  /**
   * Write artifacts to disk (with adapter-specific merge/backup). Returns absolute
   * paths written. May push human-readable strings into `warnings`.
   */
  writeAll(projectPath: string, defs: WorkflowDefinition[], warnings?: string[]): string[];
}
