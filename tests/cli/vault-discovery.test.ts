import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverVaultPath } from '../../src/cli/vault-discovery.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('discoverVaultPath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should find wiki/ in the current directory', () => {
    const wikiPath = path.join(tempDir, 'wiki');
    const metaPath = path.join(wikiPath, '00-meta');
    fs.mkdirSync(metaPath, { recursive: true });
    fs.writeFileSync(path.join(metaPath, 'schema.md'), '---\nschema_version: "v1"\n---\n');

    const result = discoverVaultPath(tempDir);
    // discoverVaultPath returns the project root (containing wiki/), not wiki/ itself
    expect(result).toBe(tempDir);
  });

  it('should walk up and find wiki/ in parent directory', () => {
    const wikiPath = path.join(tempDir, 'wiki');
    const metaPath = path.join(wikiPath, '00-meta');
    fs.mkdirSync(metaPath, { recursive: true });
    fs.writeFileSync(path.join(metaPath, 'schema.md'), '---\nschema_version: "v1"\n---\n');

    const subDir = path.join(tempDir, 'src', 'core');
    fs.mkdirSync(subDir, { recursive: true });

    const result = discoverVaultPath(subDir);
    // discoverVaultPath returns the project root (containing wiki/), not wiki/ itself
    expect(result).toBe(tempDir);
  });

  it('should throw when no wiki/ exists in any ancestor', () => {
    expect(() => discoverVaultPath(tempDir)).toThrow('No wiki/ vault found');
  });

  it('should not recognize wiki/ without 00-meta/schema.md', () => {
    const wikiPath = path.join(tempDir, 'wiki');
    fs.mkdirSync(wikiPath, { recursive: true });
    // No 00-meta/schema.md

    expect(() => discoverVaultPath(tempDir)).toThrow('No wiki/ vault found');
  });
});
