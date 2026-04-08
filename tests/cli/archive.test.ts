import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { archiveChange } from '../../src/cli/commands/archive.js';
import { createIndex, createChange, createFeature } from '../helpers/mock-index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('archiveChange', () => {
  let tempDir: string;
  let vaultPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-archive-test-'));
    vaultPath = path.join(tempDir, 'wiki');
    // Create vault structure
    fs.mkdirSync(path.join(vaultPath, '00-meta'), { recursive: true });
    fs.mkdirSync(path.join(vaultPath, '04-changes'), { recursive: true });
    fs.mkdirSync(path.join(vaultPath, '99-archive'), { recursive: true });
    // Create log.md
    fs.writeFileSync(
      path.join(vaultPath, '00-meta', 'log.md'),
      '---\ntype: meta\n---\n\n# Log\n\n| Date | Operation | Target | Agent |\n|------|-----------|--------|-------|\n',
    );
    // Create schema.md
    fs.writeFileSync(
      path.join(vaultPath, '00-meta', 'schema.md'),
      '---\nschema_version: "2026-04-06-v1"\n---\n# Schema\n',
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should move applied change from 04-changes/ to 99-archive/', () => {
    // Create the change file
    const changePath = path.join(vaultPath, '04-changes', 'add-passkey.md');
    fs.writeFileSync(changePath, '---\ntype: change\nid: chg-1\nstatus: applied\n---\n# Change');

    const feat = createFeature('feat-1', {
      links_out: [],
      links_in: ['chg-1'],
      requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN' }], content_hash: 'abc' }],
    });
    const change = createChange('chg-1', {
      status: 'applied',
      path: 'wiki/04-changes/add-passkey.md',
      feature: 'feat-1',
      systems: ['sys-1'],
      links_out: ['feat-1'],
      links_in: [],
      delta_summary: [
        { op: 'ADDED', target_type: 'requirement', target_name: 'R2', target_note_id: 'feat-1', base_fingerprint: null },
      ],
      tasks: [{ text: 'Done', done: true }],
    });
    const index = createIndex([feat, change]);

    // archiveChange expects project root (tempDir), not wiki/ directory
    const result = archiveChange('chg-1', index, tempDir, { force: true });
    expect(result.changeId).toBe('chg-1');
    expect(result.newPath).toContain('99-archive');
    expect(fs.existsSync(path.join(vaultPath, '99-archive', 'add-passkey.md'))).toBe(true);
    expect(fs.existsSync(changePath)).toBe(false);
  });

  it('should throw for non-applied changes', () => {
    const change = createChange('chg-1', { status: 'proposed' });
    const index = createIndex([change]);

    expect(() => archiveChange('chg-1', index, tempDir)).toThrow('Only applied changes can be archived');
  });

  it('should throw for non-existent change', () => {
    const index = createIndex([]);
    expect(() => archiveChange('nonexistent', index, tempDir)).toThrow('not found');
  });

  it('should append to log.md', () => {
    const changePath = path.join(vaultPath, '04-changes', 'test.md');
    fs.writeFileSync(changePath, '---\ntype: change\nid: chg-1\nstatus: applied\n---\n');

    const change = createChange('chg-1', {
      status: 'applied',
      path: 'wiki/04-changes/test.md',
      feature: 'feat-1',
      systems: ['sys-1'],
      links_out: ['feat-1'],
      links_in: [],
      delta_summary: [],
      tasks: [{ text: 'Done', done: true }],
    });
    const feat = createFeature('feat-1', { links_in: ['chg-1'], links_out: [] });
    const index = createIndex([feat, change]);

    archiveChange('chg-1', index, tempDir, { force: true });

    const logContent = fs.readFileSync(path.join(vaultPath, '00-meta', 'log.md'), 'utf-8');
    expect(logContent).toContain('archive');
    expect(logContent).toContain('chg-1');
  });
});
