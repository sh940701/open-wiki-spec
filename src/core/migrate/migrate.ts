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

  // Hybrid-state guard: refuse to migrate into a vault that already holds
  // typed notes unless the caller explicitly opts in. Silent interleave
  // causes `filesSkipped` entries that later manifest as unresolved wiki-
  // links and drifted Change Log entries — a class of bug the user would
  // have no visibility into until `ows verify` catches it much later.
  if (!options.allowExistingVault && hasExistingTypedNotes(wikiPath)) {
    throw new Error(
      `Target vault already exists at ${wikiPath} and contains typed notes. ` +
        `Migrating into an existing vault can silently skip conflicting files and ` +
        `leave the graph in a half-merged state. Either: (1) migrate into an empty ` +
        `project directory, (2) move your existing wiki/ aside first, or ` +
        `(3) pass \`allowExistingVault: true\` (CLI: --allow-existing-vault) if you ` +
        `explicitly want to merge and accept the risk.`,
    );
  }

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
  if (scan.config?.context && typeof scan.config.context === 'string') {
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

  // Step 7: Feature ↔ Change backlink patch.
  // Each Change's frontmatter declares its target Feature(s), but the
  // Feature side isn't updated to link back. `ows verify` flags this
  // with MISSING_LINK, so a migrated vault looks broken on first run.
  // Post-process feature outputs to include `changes:` wikilinks to
  // every Change that points at them.
  applyFeatureChangeBacklinks(featureStep.outputs, [
    ...activeChangeStep.outputs,
    ...(steps.find((s) => s.name === 'Convert Archived Changes')?.outputs ?? []),
  ]);

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
 * Patch Feature ConversionResults' frontmatter to include back-references
 * to Changes that target them. Walks change outputs, extracts feature
 * wikilinks, then rewrites matching Feature outputs' `changes:` field.
 */
function applyFeatureChangeBacklinks(
  featureOutputs: ConversionResult[],
  changeOutputs: ConversionResult[],
): void {
  // feature target path -> set of change titles that reference it
  const backlinkMap = new Map<string, Set<string>>();

  for (const change of changeOutputs) {
    if (!change.targetPath.startsWith('wiki/04-changes/') &&
        !change.targetPath.startsWith('wiki/99-archive/')) continue;
    // Extract the Change title (H1). Change content uses `# Change: <title>`
    const titleMatch = change.content.match(/^#\s+(Change:\s*[^\n]+)$/m);
    if (!titleMatch) continue;
    const changeTitle = titleMatch[1].trim();
    // Extract feature refs from frontmatter. Accepts both `feature: "[[Feature: X]]"`
    // and multi-entry `features:` array blocks.
    const fmMatch = change.content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const fm = fmMatch[1];
    const featureLinks = new Set<string>();
    const singleMatch = fm.match(/^feature:\s*"(\[\[[^\]]+\]\])"/m);
    if (singleMatch) featureLinks.add(singleMatch[1]);
    const featuresBlockMatch = fm.match(/^features:\n((?:  -\s*"\[\[[^\]]+\]\]"\s*\n)+)/m);
    if (featuresBlockMatch) {
      const entries = featuresBlockMatch[1].matchAll(/"(\[\[[^\]]+\]\])"/g);
      for (const e of entries) featureLinks.add(e[1]);
    }
    for (const link of featureLinks) {
      const existing = backlinkMap.get(link) ?? new Set<string>();
      existing.add(`[[${changeTitle}]]`);
      backlinkMap.set(link, existing);
    }
  }

  // Now rewrite each Feature's `changes: []` line to include backlinks
  for (const feature of featureOutputs) {
    if (!feature.targetPath.startsWith('wiki/03-features/')) continue;
    const titleMatch = feature.content.match(/^#\s+(Feature:\s*[^\n]+)$/m);
    if (!titleMatch) continue;
    const featureLink = `[[${titleMatch[1].trim()}]]`;
    const changeTitles = backlinkMap.get(featureLink);
    if (!changeTitles || changeTitles.size === 0) continue;
    const linkList = [...changeTitles].map((t) => `  - "${t}"`).join('\n');
    // Replace an empty `changes: []` or `changes:\n` block with a populated list.
    feature.content = feature.content.replace(
      /^changes:\s*\[\]\s*$/m,
      `changes:\n${linkList}`,
    );
  }
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

/**
 * Does the target wiki/ directory already hold typed notes?
 * Checks for any .md file inside a typed subfolder. Meta/seed files under
 * `00-meta/` do not count — those are created by `ows init` and do not
 * imply user content.
 */
function hasExistingTypedNotes(wikiPath: string): boolean {
  if (!fs.existsSync(wikiPath)) return false;
  const TYPED_SUBDIRS = [
    '01-sources',
    '02-systems',
    '03-features',
    '04-changes',
    '05-decisions',
    '06-queries',
    '99-archive',
  ];
  for (const sub of TYPED_SUBDIRS) {
    const dir = path.join(wikiPath, sub);
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith('.md')) return true;
    }
  }
  return false;
}
