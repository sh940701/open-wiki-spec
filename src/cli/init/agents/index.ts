import type { AgentAdapter, AgentId, AgentSelector } from './types.js';
import type { WorkflowDefinition } from '../workflow-definitions.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { detectAgents } from './detect.js';

export const ADAPTERS: Record<AgentId, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};

export interface RunAdaptersResult {
  agents: AgentId[];
  agentArtifacts: Partial<Record<AgentId, string[]>>;
  allFiles: string[];
  warnings: string[];
}

/** Detect (or honor explicit) agents, run each adapter, aggregate results. */
export function runAdapters(
  projectPath: string,
  defs: WorkflowDefinition[],
  explicit?: AgentSelector,
): RunAdaptersResult {
  const agents = detectAgents(projectPath, explicit);
  const agentArtifacts: Partial<Record<AgentId, string[]>> = {};
  const allFiles: string[] = [];
  const warnings: string[] = [];
  for (const id of agents) {
    const files = ADAPTERS[id].writeAll(projectPath, defs, warnings);
    agentArtifacts[id] = files;
    allFiles.push(...files);
  }
  return { agents, agentArtifacts, allFiles, warnings };
}

export { detectAgents };
export type { AgentId, AgentSelector, AgentAdapter, AgentArtifact } from './types.js';
