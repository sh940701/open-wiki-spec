/**
 * Types for OpenSpec → open-wiki-spec migration.
 */

/** Parsed OpenSpec config.yaml content */
export interface OpenSpecConfig {
  schema?: string;
  context?: string;
  rules?: Record<string, unknown>;
}

/** A scanned OpenSpec spec entry */
export interface ScannedSpec {
  /** Capability name (directory name, e.g. "cli-init") */
  capability: string;
  /** Relative path to spec.md */
  specPath: string;
  /** Raw markdown content */
  content: string;
}

/** A scanned OpenSpec change entry */
export interface ScannedChange {
  /** Change name (directory name, e.g. "add-dark-mode") */
  name: string;
  /** Relative path to the change directory */
  dirPath: string;
  /** proposal.md content (null if missing) */
  proposal: string | null;
  /** design.md content (null if missing) */
  design: string | null;
  /** tasks.md content (null if missing) */
  tasks: string | null;
  /** .openspec.yaml content (null if missing) */
  metadata: OpenSpecChangeMetadata | null;
  /** Delta spec paths and contents */
  deltaSpecs: Array<{ capability: string; content: string }>;
  /** Whether this is an archived change */
  archived: boolean;
}

/** Parsed .openspec.yaml metadata */
export interface OpenSpecChangeMetadata {
  schema?: string;
  created?: string;
  dependsOn?: string[];
  provides?: string[];
  requires?: string[];
  touches?: string[];
  parent?: string;
}

/** Complete scan result of an OpenSpec project */
export interface ScanResult {
  /** Path to the openspec/ directory */
  openspecPath: string;
  /** Parsed config */
  config: OpenSpecConfig | null;
  /** All discovered specs */
  specs: ScannedSpec[];
  /** Active changes */
  activeChanges: ScannedChange[];
  /** Archived changes */
  archivedChanges: ScannedChange[];
  /** Warnings during scanning */
  warnings: string[];
}

/** Result of converting a single item */
export interface ConversionResult {
  /** Relative path within wiki/ where the file should be written */
  targetPath: string;
  /** Generated markdown content */
  content: string;
  /** Source description for logging */
  sourceDescription: string;
}

/** A single step in the migration plan */
export interface MigrationStep {
  /** Step name for display */
  name: string;
  /** What this step does */
  description: string;
  /** Files that would be created */
  outputs: ConversionResult[];
  /** Warnings encountered */
  warnings: string[];
}

/** Complete migration plan (can be used for dry-run) */
export interface MigrationPlan {
  /** Source OpenSpec directory */
  openspecPath: string;
  /** Target wiki directory */
  wikiPath: string;
  /** Ordered migration steps */
  steps: MigrationStep[];
  /** Total file count */
  totalFiles: number;
  /** Total warnings */
  totalWarnings: number;
}

/** Result after executing a migration */
export interface MigrationResult {
  /** The plan that was executed */
  plan: MigrationPlan;
  /** Files actually written */
  filesWritten: string[];
  /** Files skipped (already existed) */
  filesSkipped: string[];
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Errors encountered during execution */
  errors: string[];
}

/** Options for the migrate command */
export interface MigrateOptions {
  /** Path to the openspec/ directory (default: auto-detect) */
  openspecDir?: string;
  /** Target project path (default: cwd) */
  projectPath?: string;
  /** Dry run mode - plan but don't write */
  dryRun?: boolean;
  /** Skip archived changes */
  skipArchive?: boolean;
  /** Output as JSON */
  json?: boolean;
  /**
   * Allow migration to proceed even when a `wiki/` directory with typed
   * notes already exists at the target path. Without this flag, migrate
   * refuses so the user doesn't silently interleave an openspec import
   * into an already-bootstrapped vault — which causes half-merged state
   * that only surfaces later as `filesSkipped` entries and unresolved
   * wikilinks. Setting this flag acknowledges the risk explicitly.
   */
  allowExistingVault?: boolean;
}
