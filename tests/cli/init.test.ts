import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initVault } from '../../src/cli/init/init-engine.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('initVault', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-init-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create all vault directories on fresh init', async () => {
    const result = await initVault({ path: tempDir });
    expect(result.mode).toBe('fresh');
    expect(fs.existsSync(path.join(tempDir, 'wiki'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '00-meta'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '01-sources'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '02-systems'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '03-features'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '04-changes'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '05-decisions'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '06-queries'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '99-archive'))).toBe(true);
  });

  it('should create all 00-meta files', async () => {
    await initVault({ path: tempDir });
    expect(fs.existsSync(path.join(tempDir, 'wiki', '00-meta', 'schema.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '00-meta', 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '00-meta', 'log.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '00-meta', 'conventions.md'))).toBe(true);
  });

  it('should create schema.md with correct schema version', async () => {
    await initVault({ path: tempDir });
    const content = fs.readFileSync(path.join(tempDir, 'wiki', '00-meta', 'schema.md'), 'utf-8');
    expect(content).toContain('schema_version:');
    expect(content).toContain('2026-04-06-v1');
  });

  it('should create log.md with init entry', async () => {
    await initVault({ path: tempDir });
    const content = fs.readFileSync(path.join(tempDir, 'wiki', '00-meta', 'log.md'), 'utf-8');
    expect(content).toContain('init');
    expect(content).toContain('vault');
    expect(content).toContain('ows');
  });

  it('should generate Claude Code skill files', async () => {
    const result = await initVault({ path: tempDir });
    expect(result.skillFilesGenerated.length).toBeGreaterThan(0);
    const claudeDir = path.join(tempDir, '.claude', 'commands');
    expect(fs.existsSync(claudeDir)).toBe(true);
    // Check at least the propose skill exists
    expect(fs.existsSync(path.join(claudeDir, 'ows-propose.md'))).toBe(true);
  });

  it('should detect extend mode when wiki/ already exists', async () => {
    // First init
    await initVault({ path: tempDir });
    // Second init (extend)
    const result = await initVault({ path: tempDir });
    expect(result.mode).toBe('extend');
  });

  it('should recreate meta files on force re-init', async () => {
    await initVault({ path: tempDir });
    // Modify a meta file
    const schemaPath = path.join(tempDir, 'wiki', '00-meta', 'schema.md');
    fs.writeFileSync(schemaPath, 'modified content');

    await initVault({ path: tempDir, force: true });
    const content = fs.readFileSync(schemaPath, 'utf-8');
    expect(content).toContain('schema_version:');
    expect(content).not.toBe('modified content');
  });

  it('should return correct InitResult structure', async () => {
    const result = await initVault({ path: tempDir });
    expect(result.wikiPath).toBe(path.join(tempDir, 'wiki'));
    expect(result.directoriesCreated.length).toBeGreaterThan(0);
    expect(result.metaFilesCreated.length).toBe(4);
    expect(result.warnings).toBeDefined();
  });

  it('should create seed notes on fresh init', async () => {
    const result = await initVault({ path: tempDir });
    expect(result.seedFilesCreated).toContain('wiki/01-sources/seed-context.md');
    expect(result.seedFilesCreated).toContain('wiki/02-systems/default-system.md');
    expect(fs.existsSync(path.join(tempDir, 'wiki', '01-sources', 'seed-context.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '02-systems', 'default-system.md'))).toBe(true);
  });

  it('seed notes should have valid frontmatter', async () => {
    await initVault({ path: tempDir });
    const sourceContent = fs.readFileSync(path.join(tempDir, 'wiki', '01-sources', 'seed-context.md'), 'utf-8');
    expect(sourceContent).toContain('type: source');
    expect(sourceContent).toContain('id: source-seed-context');
    const systemContent = fs.readFileSync(path.join(tempDir, 'wiki', '02-systems', 'default-system.md'), 'utf-8');
    expect(systemContent).toContain('type: system');
    expect(systemContent).toContain('id: system-default');
  });

  it('should not overwrite seed notes in extend mode', async () => {
    await initVault({ path: tempDir });
    // Modify a seed note
    const seedPath = path.join(tempDir, 'wiki', '01-sources', 'seed-context.md');
    fs.writeFileSync(seedPath, 'custom content');
    // Extend
    const result = await initVault({ path: tempDir });
    expect(result.mode).toBe('extend');
    const content = fs.readFileSync(seedPath, 'utf-8');
    expect(content).toBe('custom content');
  });

  it('should skip seed notes when --skip-seed is set', async () => {
    const result = await initVault({ path: tempDir, skipSeed: true });
    expect(result.seedFilesCreated).toHaveLength(0);
    expect(fs.existsSync(path.join(tempDir, 'wiki', '01-sources', 'seed-context.md'))).toBe(false);
  });
});
