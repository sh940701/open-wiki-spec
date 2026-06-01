import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initVault } from '../../../src/cli/init/init-engine.js';

const exists = (d: string, p: string) => fs.existsSync(path.join(d, p));

describe('initVault agent selection', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-initagents-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('agent:claude → only .claude/commands', async () => {
    const r = await initVault({ path: dir, agent: 'claude' });
    expect(r.agents).toEqual(['claude']);
    expect(exists(dir, '.claude/commands/ows-propose.md')).toBe(true);
    expect(exists(dir, '.agents/skills/ows-propose/SKILL.md')).toBe(false);
  });

  it('agent:codex → .agents/skills + AGENTS.md, no .claude', async () => {
    const r = await initVault({ path: dir, agent: 'codex' });
    expect(r.agents).toEqual(['codex']);
    expect(exists(dir, '.agents/skills/ows-propose/SKILL.md')).toBe(true);
    expect(exists(dir, 'AGENTS.md')).toBe(true);
    expect(exists(dir, '.claude/commands/ows-propose.md')).toBe(false);
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('ows --version');
  });

  it('agent:both → both trees, agentArtifacts keyed per agent', async () => {
    const r = await initVault({ path: dir, agent: 'both' });
    expect(r.agents).toEqual(['claude', 'codex']);
    expect(exists(dir, '.claude/commands/ows-verify.md')).toBe(true);
    expect(exists(dir, '.agents/skills/ows-verify/SKILL.md')).toBe(true);
    expect(r.agentArtifacts.claude!.length).toBe(12);
    expect(r.agentArtifacts.codex!.length).toBeGreaterThanOrEqual(13); // 12 skills + AGENTS.md
  });

  it('extend mode regenerates for the selected agent', async () => {
    await initVault({ path: dir, agent: 'codex' });
    const r2 = await initVault({ path: dir, agent: 'codex' });
    expect(r2.mode).toBe('extend');
    expect(exists(dir, '.agents/skills/ows-apply/SKILL.md')).toBe(true);
  });
});
