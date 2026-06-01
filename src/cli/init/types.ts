/**
 * Init-related types.
 */
import type { AgentId, AgentSelector } from './agents/types.js';

export interface InitOptions {
  /** Target directory path (default: current directory) */
  path?: string;
  /** Force re-initialization even if wiki/ already exists */
  force?: boolean;
  /** Skip interactive prompts */
  nonInteractive?: boolean;
  /** Output as JSON */
  json?: boolean;
  /** Skip seed note generation */
  skipSeed?: boolean;
  /** Which agent integration(s) to generate. Default: 'auto' (detect). */
  agent?: AgentSelector;
}

export interface InitResult {
  mode: 'fresh' | 'extend';
  wikiPath: string;
  directoriesCreated: string[];
  metaFilesCreated: string[];
  seedFilesCreated: string[];
  /** All agent integration files written (union across agents). */
  skillFilesGenerated: string[];
  /** Agents that integration files were generated for. */
  agents: AgentId[];
  /** Files written per agent (keyed by AgentId). */
  agentArtifacts: Record<string, string[]>;
  warnings: string[];
}

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
}
