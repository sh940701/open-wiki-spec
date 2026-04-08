/**
 * Migration orchestrator: coordinates scanning, conversion, and writing
 * to migrate an OpenSpec project to open-wiki-spec format.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanOpenSpec, findOpenSpecDir } from './scanner.js';
import { convertAllSpecs } from './spec-converter.js';
import { convertAllChanges } from './change-converter.js';
import { convertConfigToSource } from './source-converter.js';
import {
  inferSystems,
  convertSystems,
  buildSystemRefMap,
  buildFeatureRefMap,
} from './system-inferrer.js';
import { initVault } from '../../cli/init/init-engine.js';
import type {
  MigrateOptions,
  MigrationPlan,
  MigrationResult,
  MigrationStep,
  ConversionResult,
} from './types.js';

/**
 * Plan a migration from OpenSpec to open-wiki-spec.
 * Does not write any files - just produces a plan.
 */
export function planMigration(options: MigrateOptions): MigrationPlan {
  const projectPath = path.resolve(options.projectPath ?? '.');
  const openspecPath = options.openspecDir
    ? path.resolve(options.openspecDir)
    : findOpenSpecDir(projectPath) ?? '';

  if (!openspecPath || !fs.existsSync(openspecPath)) {
    throw new Error(
      `OpenSpec directory not found. Specify with --openspec-dir or ensure openspec/ exists in ${projectPath}`,
    );
  }

  const wikiPath = path.join(projectPath, 'wiki');

  // Step 1: Scan
  const scan = scanOpenSpec(openspecPath);
  const scanStep: MigrationStep = {
    name: 'Scan OpenSpec',
    description: `Found ${scan.specs.length} specs, ${scan.activeChanges.length} active changes, ${scan.archivedChanges.length} archived changes`,
    outputs: [],
    warnings: [...scan.warnings],
  };

  // Step 2: Generate source note from config context
  const sourceOutputs: ConversionResult[] = [];
  if (scan.config?.context) {
    sourceOutputs.push(convertConfigToSource(scan.config.context, scan.config));
  }
  const sourceStep: MigrationStep = {
    name: 'Generate Source Notes',
    description: sourceOutputs.length > 0
      ? `Generated ${sourceOutputs.length} source note from config.yaml context`
      : 'No config context found, skipping source generation',
    outputs: sourceOutputs,
    warnings: [],
  };

  // Step 3: Infer systems
  const systems = inferSystems(scan.specs);
  const systemRefMap = buildSystemRefMap(systems);
  const systemOutputs = convertSystems(systems);
  const systemStep: MigrationStep = {
    name: 'Infer Systems',
    description: `Inferred ${systems.length} systems from capability domains`,
    outputs: systemOutputs,
    warnings: [],
  };

  // Step 4: Convert specs to features
  const featureRefMap = buildFeatureRefMap(scan.specs.map(s => s.capability));
  const { results: featureOutputs, warnings: featureWarnings } = convertAllSpecs(
    scan.specs,
    systemRefMap,
  );
  const featureStep: MigrationStep = {
    name: 'Convert Specs to Features',
    description: `Converted ${featureOutputs.length} specs to Feature notes`,
    outputs: featureOutputs,
    warnings: featureWarnings,
  };

  // Step 5: Convert active changes
  const { results: activeChangeOutputs, warnings: activeChangeWarnings } = convertAllChanges(
    scan.activeChanges,
    featureRefMap,
    systemRefMap,
  );
  const activeChangeStep: MigrationStep = {
    name: 'Convert Active Changes',
    description: `Converted ${scan.activeChanges.length} active changes`,
    outputs: activeChangeOutputs,
    warnings: activeChangeWarnings,
  };

  // Step 6: Convert archived changes (optional)
  const steps: MigrationStep[] = [scanStep, sourceStep, systemStep, featureStep, activeChangeStep];

  if (!options.skipArchive) {
    const { results: archiveOutputs, warnings: archiveWarnings } = convertAllChanges(
      scan.archivedChanges,
      featureRefMap,
      systemRefMap,
    );
    const archiveStep: MigrationStep = {
      name: 'Convert Archived Changes',
      description: `Converted ${scan.archivedChanges.length} archived changes`,
      outputs: archiveOutputs,
      warnings: archiveWarnings,
    };
    steps.push(archiveStep);
  }

  // Count totals
  const totalFiles = steps.reduce((sum, s) => sum + s.outputs.length, 0);
  const totalWarnings = steps.reduce((sum, s) => sum + s.warnings.length, 0);

  return {
    openspecPath,
    wikiPath,
    steps,
    totalFiles,
    totalWarnings,
  };
}

/**
 * Execute a migration plan: init vault structure and write all files.
 */
export async function executeMigration(
  plan: MigrationPlan,
  dryRun: boolean = false,
): Promise<MigrationResult> {
  const filesWritten: string[] = [];
  const filesSkipped: string[] = [];
  const errors: string[] = [];

  if (!dryRun) {
    // Initialize vault structure (creates directories and meta files)
    try {
      await initVault({ path: path.dirname(plan.wikiPath), skipSeed: true });
    } catch (err) {
      errors.push(`Failed to init vault: ${(err as Error).message}`);
    }

    // Write all outputs
    for (const step of plan.steps) {
      for (const output of step.outputs) {
        const fullPath = path.join(path.dirname(plan.wikiPath), output.targetPath);
        try {
          if (fs.existsSync(fullPath)) {
            filesSkipped.push(output.targetPath);
            continue;
          }

          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(fullPath, output.content, 'utf-8');
          filesWritten.push(output.targetPath);
        } catch (err) {
          errors.push(`Failed to write ${output.targetPath}: ${(err as Error).message}`);
        }
      }
    }
  }

  return {
    plan,
    filesWritten,
    filesSkipped,
    dryRun,
    errors,
  };
}

/**
 * Run the full migration: plan and execute.
 */
export async function migrate(options: MigrateOptions): Promise<MigrationResult> {
  const plan = planMigration(options);
  return executeMigration(plan, options.dryRun);
}
