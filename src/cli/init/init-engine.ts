/**
 * Core init logic: vault creation, meta file generation, extend mode.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InitOptions, InitResult } from './types.js';
import { createSchemaFile, createIndexFile, createLogFile, createConventionsFile } from './meta-files.js';
import { writeAllSkillFiles } from './skill-generator.js';

const SEED_SOURCE_CONTENT = `---
type: source
id: source-seed-context
status: active
tags: [seed]
systems: ["[[System: Default]]"]
---

# Source: Seed Context

## Summary

<!-- Describe your project here. What does it do? Who is it for? -->

## Content

<!-- Add project-specific context: tech stack, key decisions, constraints, etc. -->
`;

const SEED_SYSTEM_CONTENT = `---
type: system
id: system-default
status: active
tags: [seed]
---

# System: Default

## Purpose

<!-- Describe the primary system boundary for your project. -->

## Boundaries

<!-- Define what this system includes and excludes. -->
`;

const VAULT_DIRS = [
  'wiki',
  'wiki/00-meta',
  'wiki/01-sources',
  'wiki/02-systems',
  'wiki/03-features',
  'wiki/04-changes',
  'wiki/05-decisions',
  'wiki/06-queries',
  'wiki/99-archive',
] as const;

/**
 * Initialize or extend a vault.
 */
export async function initVault(options: InitOptions): Promise<InitResult> {
  const projectPath = path.resolve(options.path ?? '.');
  const wikiPath = path.join(projectPath, 'wiki');
  const isExtend = fs.existsSync(wikiPath);

  if (isExtend && !options.force) {
    return extendVault(wikiPath, projectPath);
  }

  // Fresh init or force re-init
  const directoriesCreated: string[] = [];
  for (const dir of VAULT_DIRS) {
    const fullPath = path.join(projectPath, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      directoriesCreated.push(dir);
    }
  }

  // Create meta files
  createSchemaFile(wikiPath);
  createIndexFile(wikiPath);
  createLogFile(wikiPath);
  createConventionsFile(wikiPath);

  const metaFilesCreated = [
    'wiki/00-meta/schema.md',
    'wiki/00-meta/index.md',
    'wiki/00-meta/log.md',
    'wiki/00-meta/conventions.md',
  ];

  // Create seed notes unless skipped
  const seedFilesCreated: string[] = [];
  if (!options.skipSeed) {
    seedFilesCreated.push(...createSeedNotes(wikiPath));
  }

  // Generate skill files
  const skillFilesGenerated = writeAllSkillFiles(projectPath);

  return {
    mode: 'fresh',
    wikiPath,
    directoriesCreated,
    metaFilesCreated,
    seedFilesCreated,
    skillFilesGenerated,
    warnings: [],
  };
}

/**
 * Extend an existing vault: add missing directories, regenerate skills.
 */
function extendVault(wikiPath: string, projectPath: string): InitResult {
  const directoriesCreated: string[] = [];
  const warnings: string[] = [];

  // Create any missing vault directories
  for (const dir of VAULT_DIRS) {
    const fullPath = path.join(projectPath, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      directoriesCreated.push(dir);
    }
  }

  // Create any missing meta files (do NOT overwrite existing ones)
  const metaFilesCreated: string[] = [];
  const metaPath = path.join(wikiPath, '00-meta');

  if (!fs.existsSync(path.join(metaPath, 'schema.md'))) {
    createSchemaFile(wikiPath);
    metaFilesCreated.push('wiki/00-meta/schema.md');
  }
  if (!fs.existsSync(path.join(metaPath, 'index.md'))) {
    createIndexFile(wikiPath);
    metaFilesCreated.push('wiki/00-meta/index.md');
  }
  if (!fs.existsSync(path.join(metaPath, 'log.md'))) {
    createLogFile(wikiPath);
    metaFilesCreated.push('wiki/00-meta/log.md');
  }
  if (!fs.existsSync(path.join(metaPath, 'conventions.md'))) {
    createConventionsFile(wikiPath);
    metaFilesCreated.push('wiki/00-meta/conventions.md');
  }

  if (metaFilesCreated.length === 0) {
    warnings.push('All meta files already exist. Use --force to recreate them.');
  }

  // Create seed notes only if they don't already exist (never overwrite in extend mode)
  const seedFilesCreated: string[] = [];
  seedFilesCreated.push(...createSeedNotes(wikiPath, true));

  // Regenerate skill files (always, in case CLI version changed)
  const skillFilesGenerated = writeAllSkillFiles(projectPath);

  return {
    mode: 'extend',
    wikiPath,
    directoriesCreated,
    metaFilesCreated,
    seedFilesCreated,
    skillFilesGenerated,
    warnings,
  };
}

/**
 * Create seed notes (Source: Project Context and System: Default).
 * When skipExisting is true, existing files are not overwritten (extend mode).
 */
function createSeedNotes(wikiPath: string, skipExisting = false): string[] {
  const created: string[] = [];

  const seeds: Array<{ relativePath: string; content: string }> = [
    { relativePath: '01-sources/seed-context.md', content: SEED_SOURCE_CONTENT },
    { relativePath: '02-systems/default-system.md', content: SEED_SYSTEM_CONTENT },
  ];

  for (const seed of seeds) {
    const fullPath = path.join(wikiPath, seed.relativePath);
    if (skipExisting && fs.existsSync(fullPath)) {
      continue;
    }
    fs.writeFileSync(fullPath, seed.content, 'utf-8');
    created.push(`wiki/${seed.relativePath}`);
  }

  return created;
}
