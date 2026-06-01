import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectAgents } from '../../../src/cli/init/agents/detect.js';

describe('detectAgents', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-detect-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('explicit claude/codex/both override scanning (hermetic)', () => {
    expect(detectAgents(dir, 'claude')).toEqual(['claude']);
    expect(detectAgents(dir, 'codex')).toEqual(['codex']);
    expect(detectAgents(dir, 'both')).toEqual(['claude', 'codex']);
  });

  it('detects claude from project .claude/ marker', () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    expect(detectAgents(dir, 'auto', { host: () => [] })).toEqual(['claude']);
  });

  it('detects codex from project AGENTS.md marker', () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# x');
    expect(detectAgents(dir, 'auto', { host: () => [] })).toEqual(['codex']);
  });

  it('detects both when both project markers present, stable order', () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.mkdirSync(path.join(dir, '.agents'));
    expect(detectAgents(dir, 'auto', { host: () => [] })).toEqual(['claude', 'codex']);
  });

  it('falls back to claude when no project markers and host signals empty', () => {
    expect(detectAgents(dir, 'auto', { host: () => [] })).toEqual(['claude']);
  });

  it('uses host fallback only when no project markers', () => {
    expect(detectAgents(dir, 'auto', { host: () => ['codex'] })).toEqual(['codex']);
    expect(detectAgents(dir, 'auto', { host: () => ['codex', 'claude'] })).toEqual(['claude', 'codex']);
  });

  it('project markers take precedence over host signals', () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    expect(detectAgents(dir, 'auto', { host: () => ['codex'] })).toEqual(['claude']);
  });
});
