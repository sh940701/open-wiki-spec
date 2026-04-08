import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { planMigration, executeMigration, migrate } from '../../../src/core/migrate/migrate.js';

describe('planMigration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-migrate-plan-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when openspec directory is not found', () => {
    expect(() => planMigration({ projectPath: tmpDir })).toThrow('OpenSpec directory not found');
  });

  it('creates a plan from a minimal openspec project', () => {
    // Set up minimal openspec structure
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'auth');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(openspecDir, 'config.yaml'),
      'schema: spec-driven',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(specsDir, 'spec.md'),
      '# Auth Spec\n\n## Purpose\nAuth stuff.\n\n## Requirements\n### Requirement: Login\nThe system SHALL authenticate.',
      'utf-8',
    );

    const plan = planMigration({ projectPath: tmpDir });

    expect(plan.openspecPath).toBe(openspecDir);
    expect(plan.wikiPath).toBe(path.join(tmpDir, 'wiki'));
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.totalFiles).toBeGreaterThanOrEqual(2); // system + feature
  });

  it('includes archived changes when skipArchive is false', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'auth');
    const archiveDir = path.join(openspecDir, 'changes', 'archive', '2025-01-01-old');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'spec.md'), '# Auth\n\n## Requirements\n', 'utf-8');
    fs.writeFileSync(path.join(archiveDir, 'proposal.md'), '## Why\nOld reason.', 'utf-8');

    const plan = planMigration({ projectPath: tmpDir });

    const archiveStep = plan.steps.find(s => s.name === 'Convert Archived Changes');
    expect(archiveStep).toBeDefined();
    expect(archiveStep!.outputs.length).toBeGreaterThanOrEqual(1);
  });

  it('excludes archived changes when skipArchive is true', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'auth');
    const archiveDir = path.join(openspecDir, 'changes', 'archive', '2025-01-01-old');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'spec.md'), '# Auth\n\n## Requirements\n', 'utf-8');
    fs.writeFileSync(path.join(archiveDir, 'proposal.md'), '## Why\nOld reason.', 'utf-8');

    const plan = planMigration({ projectPath: tmpDir, skipArchive: true });

    const archiveStep = plan.steps.find(s => s.name === 'Convert Archived Changes');
    expect(archiveStep).toBeUndefined();
  });

  it('handles active changes with delta specs', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'auth');
    const changeDir = path.join(openspecDir, 'changes', 'add-feature');
    const deltaDir = path.join(changeDir, 'specs', 'auth');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(deltaDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'spec.md'), '# Auth\n\n## Requirements\n', 'utf-8');
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nNeed feature.\n\n## What Changes\nStuff.', 'utf-8');
    fs.writeFileSync(path.join(deltaDir, 'spec.md'), '# Delta auth spec', 'utf-8');

    const plan = planMigration({ projectPath: tmpDir });

    const changeStep = plan.steps.find(s => s.name === 'Convert Active Changes');
    expect(changeStep).toBeDefined();
    expect(changeStep!.outputs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('executeMigration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-migrate-exec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes files in non-dry-run mode', async () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'auth');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'spec.md'), '# Auth\n\n## Purpose\nAuth.\n\n## Requirements\n', 'utf-8');

    const plan = planMigration({ projectPath: tmpDir });
    const result = await executeMigration(plan, false);

    expect(result.dryRun).toBe(false);
    expect(result.filesWritten.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    // Verify files actually exist
    for (const file of result.filesWritten) {
      const fullPath = path.join(tmpDir, file);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });

  it('does not write files in dry-run mode', async () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'auth');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'spec.md'), '# Auth\n\n## Requirements\n', 'utf-8');

    const plan = planMigration({ projectPath: tmpDir });
    const result = await executeMigration(plan, true);

    expect(result.dryRun).toBe(true);
    expect(result.filesWritten).toHaveLength(0);
    expect(result.filesSkipped).toHaveLength(0);
  });

  it('skips files that already exist (idempotent)', async () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'auth');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'spec.md'), '# Auth\n\n## Purpose\nAuth.\n\n## Requirements\n', 'utf-8');

    const plan = planMigration({ projectPath: tmpDir });

    // First execution
    const result1 = await executeMigration(plan, false);
    expect(result1.filesWritten.length).toBeGreaterThan(0);

    // Second execution (should skip existing)
    const result2 = await executeMigration(plan, false);
    expect(result2.filesSkipped.length).toBeGreaterThan(0);
  });
});

describe('migrate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-migrate-full-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs full migration with dry-run', async () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'cli-init');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, 'spec.md'),
      '# CLI Init\n\n## Purpose\nInit command.\n\n## Requirements\n### Requirement: Init\nThe system SHALL init.',
      'utf-8',
    );

    const result = await migrate({ projectPath: tmpDir, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.plan.totalFiles).toBeGreaterThan(0);
  });

  it('runs full migration writing files', async () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'cli-init');
    const changeDir = path.join(openspecDir, 'changes', 'add-feature');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, 'spec.md'),
      '# CLI Init\n\n## Purpose\nInit.\n\n## Requirements\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(changeDir, 'proposal.md'),
      '## Why\nNeed feature.\n\n## What Changes\nAdding stuff.',
      'utf-8',
    );

    const result = await migrate({ projectPath: tmpDir });
    expect(result.dryRun).toBe(false);
    expect(result.filesWritten.length).toBeGreaterThan(0);

    // Verify wiki structure
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '00-meta'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '02-systems'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '03-features'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '04-changes'))).toBe(true);
  });
});
