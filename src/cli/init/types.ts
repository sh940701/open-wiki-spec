/**
 * Init-related types.
 */

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
}

export interface InitResult {
  mode: 'fresh' | 'extend';
  wikiPath: string;
  directoriesCreated: string[];
  metaFilesCreated: string[];
  seedFilesCreated: string[];
  skillFilesGenerated: string[];
  warnings: string[];
}

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
}
