import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanOpenSpec, findOpenSpecDir } from '../../../src/core/migrate/scanner.js';

describe('scanOpenSpec', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-migrate-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when openspec directory does not exist', () => {
    expect(() => scanOpenSpec(path.join(tmpDir, 'nonexistent'))).toThrow(
      'OpenSpec directory not found',
    );
  });

  it('scans empty openspec directory with warnings', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    fs.mkdirSync(openspecDir);

    const result = scanOpenSpec(openspecDir);
    expect(result.config).toBeNull();
    expect(result.specs).toHaveLength(0);
    expect(result.activeChanges).toHaveLength(0);
    expect(result.archivedChanges).toHaveLength(0);
    expect(result.warnings).toContain('No config.yaml found in OpenSpec directory');
    expect(result.warnings).toContain('No specs/ directory found');
    expect(result.warnings).toContain('No changes/ directory found');
  });

  it('reads config.yaml', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    fs.mkdirSync(openspecDir);
    fs.writeFileSync(
      path.join(openspecDir, 'config.yaml'),
      'schema: spec-driven\ncontext: |\n  Some context',
      'utf-8',
    );

    const result = scanOpenSpec(openspecDir);
    expect(result.config).not.toBeNull();
    expect(result.config!.schema).toBe('spec-driven');
  });

  it('warns on invalid config.yaml', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    fs.mkdirSync(openspecDir);
    fs.writeFileSync(path.join(openspecDir, 'config.yaml'), '- invalid\n- yaml', 'utf-8');

    const result = scanOpenSpec(openspecDir);
    expect(result.config).toBeNull();
    expect(result.warnings.some(w => w.includes('config.yaml'))).toBe(true);
  });

  it('scans specs', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs');
    const authSpec = path.join(specsDir, 'auth');
    fs.mkdirSync(authSpec, { recursive: true });
    fs.writeFileSync(
      path.join(authSpec, 'spec.md'),
      '# Auth Spec\n\n## Requirements\n### Requirement: Login\nThe system SHALL authenticate users.',
      'utf-8',
    );

    const result = scanOpenSpec(openspecDir);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0].capability).toBe('auth');
    expect(result.specs[0].content).toContain('Auth Spec');
  });

  it('warns when spec directory has no spec.md', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const specsDir = path.join(openspecDir, 'specs', 'empty-spec');
    fs.mkdirSync(specsDir, { recursive: true });

    const result = scanOpenSpec(openspecDir);
    expect(result.specs).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('empty-spec'))).toBe(true);
  });

  it('scans active changes', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const changeDir = path.join(openspecDir, 'changes', 'add-feature');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(
      path.join(changeDir, 'proposal.md'),
      '## Why\nWe need this.\n\n## What Changes\nAdding stuff.',
      'utf-8',
    );

    const result = scanOpenSpec(openspecDir);
    expect(result.activeChanges).toHaveLength(1);
    expect(result.activeChanges[0].name).toBe('add-feature');
    expect(result.activeChanges[0].archived).toBe(false);
    expect(result.activeChanges[0].proposal).toContain('We need this');
  });

  it('scans archived changes', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const archiveDir = path.join(openspecDir, 'changes', 'archive', '2025-01-01-old-change');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(archiveDir, 'proposal.md'),
      '## Why\nHistorical reason.',
      'utf-8',
    );

    const result = scanOpenSpec(openspecDir);
    expect(result.archivedChanges).toHaveLength(1);
    expect(result.archivedChanges[0].name).toBe('2025-01-01-old-change');
    expect(result.archivedChanges[0].archived).toBe(true);
  });

  it('reads .openspec.yaml metadata', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const changeDir = path.join(openspecDir, 'changes', 'add-feature');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nReason.', 'utf-8');
    fs.writeFileSync(
      path.join(changeDir, '.openspec.yaml'),
      'schema: spec-driven\ncreated: 2025-06-01',
      'utf-8',
    );

    const result = scanOpenSpec(openspecDir);
    expect(result.activeChanges[0].metadata).not.toBeNull();
    expect(result.activeChanges[0].metadata!.created).toBe('2025-06-01');
  });

  it('scans delta specs within a change', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const changeDir = path.join(openspecDir, 'changes', 'add-feature');
    const deltaDir = path.join(changeDir, 'specs', 'auth');
    fs.mkdirSync(deltaDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nReason.', 'utf-8');
    fs.writeFileSync(path.join(deltaDir, 'spec.md'), '# Delta auth spec', 'utf-8');

    const result = scanOpenSpec(openspecDir);
    expect(result.activeChanges[0].deltaSpecs).toHaveLength(1);
    expect(result.activeChanges[0].deltaSpecs[0].capability).toBe('auth');
  });

  it('skips changes without proposal.md', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const changeDir = path.join(openspecDir, 'changes', 'incomplete');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '- [ ] something', 'utf-8');

    const result = scanOpenSpec(openspecDir);
    expect(result.activeChanges).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('incomplete') && w.includes('proposal.md'))).toBe(true);
  });

  it('reads design.md and tasks.md', () => {
    const openspecDir = path.join(tmpDir, 'openspec');
    const changeDir = path.join(openspecDir, 'changes', 'add-feature');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nReason.', 'utf-8');
    fs.writeFileSync(path.join(changeDir, 'design.md'), '## Context\nDesign here.', 'utf-8');
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '- [ ] Task one\n- [x] Task two', 'utf-8');

    const result = scanOpenSpec(openspecDir);
    expect(result.activeChanges[0].design).toContain('Design here');
    expect(result.activeChanges[0].tasks).toContain('Task one');
  });
});

describe('findOpenSpecDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-find-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns path when openspec/ exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'openspec'));
    expect(findOpenSpecDir(tmpDir)).toBe(path.join(tmpDir, 'openspec'));
  });

  it('returns null when openspec/ does not exist', () => {
    expect(findOpenSpecDir(tmpDir)).toBeNull();
  });
});
