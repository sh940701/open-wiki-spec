/**
 * Scanner for OpenSpec directory structure.
 * Reads and catalogs all specs, changes, and config from an openspec/ directory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  ScanResult,
  ScannedSpec,
  ScannedChange,
  OpenSpecConfig,
  OpenSpecChangeMetadata,
} from './types.js';

/**
 * Scan an OpenSpec directory and return all discovered artifacts.
 */
export function scanOpenSpec(openspecPath: string): ScanResult {
  const warnings: string[] = [];

  if (!fs.existsSync(openspecPath)) {
    throw new Error(`OpenSpec directory not found: ${openspecPath}`);
  }

  const config = readConfig(openspecPath, warnings);
  const specs = scanSpecs(openspecPath, warnings);
  const { activeChanges, archivedChanges } = scanChanges(openspecPath, warnings);

  return {
    openspecPath,
    config,
    specs,
    activeChanges,
    archivedChanges,
    warnings,
  };
}

/**
 * Auto-detect the openspec/ directory from a project root.
 */
export function findOpenSpecDir(projectPath: string): string | null {
  const candidate = path.join(projectPath, 'openspec');
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return candidate;
  }
  return null;
}

function readConfig(openspecPath: string, warnings: string[]): OpenSpecConfig | null {
  const configPath = path.join(openspecPath, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    warnings.push('No config.yaml found in OpenSpec directory');
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const data = parseYaml(raw);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      warnings.push('config.yaml does not contain a valid YAML object');
      return null;
    }
    return data as OpenSpecConfig;
  } catch (err) {
    warnings.push(`Failed to parse config.yaml: ${(err as Error).message}`);
    return null;
  }
}

function scanSpecs(openspecPath: string, warnings: string[]): ScannedSpec[] {
  const specsDir = path.join(openspecPath, 'specs');
  if (!fs.existsSync(specsDir)) {
    warnings.push('No specs/ directory found');
    return [];
  }

  const specs: ScannedSpec[] = [];
  const entries = fs.readdirSync(specsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const specFile = path.join(specsDir, entry.name, 'spec.md');
    if (!fs.existsSync(specFile)) {
      warnings.push(`Spec directory ${entry.name}/ has no spec.md`);
      continue;
    }

    try {
      const content = fs.readFileSync(specFile, 'utf-8');
      specs.push({
        capability: entry.name,
        specPath: path.join('specs', entry.name, 'spec.md'),
        content,
      });
    } catch (err) {
      warnings.push(`Failed to read ${specFile}: ${(err as Error).message}`);
    }
  }

  return specs;
}

function scanChanges(
  openspecPath: string,
  warnings: string[],
): { activeChanges: ScannedChange[]; archivedChanges: ScannedChange[] } {
  const changesDir = path.join(openspecPath, 'changes');
  if (!fs.existsSync(changesDir)) {
    warnings.push('No changes/ directory found');
    return { activeChanges: [], archivedChanges: [] };
  }

  const activeChanges: ScannedChange[] = [];
  const archivedChanges: ScannedChange[] = [];

  // Scan active changes
  const entries = fs.readdirSync(changesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'archive') continue;

    const change = scanSingleChange(
      path.join(changesDir, entry.name),
      entry.name,
      false,
      warnings,
    );
    if (change) activeChanges.push(change);
  }

  // Scan archived changes
  const archiveDir = path.join(changesDir, 'archive');
  if (fs.existsSync(archiveDir)) {
    const archiveEntries = fs.readdirSync(archiveDir, { withFileTypes: true });
    for (const entry of archiveEntries) {
      if (!entry.isDirectory()) continue;

      const change = scanSingleChange(
        path.join(archiveDir, entry.name),
        entry.name,
        true,
        warnings,
      );
      if (change) archivedChanges.push(change);
    }
  }

  return { activeChanges, archivedChanges };
}

function scanSingleChange(
  changePath: string,
  name: string,
  archived: boolean,
  warnings: string[],
): ScannedChange | null {
  const proposal = readFileOrNull(path.join(changePath, 'proposal.md'));
  const design = readFileOrNull(path.join(changePath, 'design.md'));
  const tasks = readFileOrNull(path.join(changePath, 'tasks.md'));
  const metadata = readChangeMetadata(path.join(changePath, '.openspec.yaml'), warnings);

  if (!proposal) {
    warnings.push(`Change ${name} has no proposal.md, skipping`);
    return null;
  }

  // Scan delta specs
  const deltaSpecs: Array<{ capability: string; content: string }> = [];
  const specsDir = path.join(changePath, 'specs');
  if (fs.existsSync(specsDir)) {
    const specEntries = fs.readdirSync(specsDir, { withFileTypes: true });
    for (const entry of specEntries) {
      if (!entry.isDirectory()) continue;
      const specFile = path.join(specsDir, entry.name, 'spec.md');
      if (fs.existsSync(specFile)) {
        try {
          deltaSpecs.push({
            capability: entry.name,
            content: fs.readFileSync(specFile, 'utf-8'),
          });
        } catch {
          warnings.push(`Failed to read delta spec ${entry.name}/spec.md in change ${name}`);
        }
      }
    }
  }

  return {
    name,
    dirPath: changePath,
    proposal,
    design,
    tasks,
    metadata,
    deltaSpecs,
    archived,
  };
}

function readFileOrNull(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readChangeMetadata(
  filePath: string,
  warnings: string[],
): OpenSpecChangeMetadata | null {
  const raw = readFileOrNull(filePath);
  if (!raw) return null;

  try {
    const data = parseYaml(raw);
    if (typeof data !== 'object' || data === null) return null;
    return data as OpenSpecChangeMetadata;
  } catch (err) {
    warnings.push(`Failed to parse .openspec.yaml: ${(err as Error).message}`);
    return null;
  }
}
