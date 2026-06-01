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

  const SKILL_KEYS = ['propose', 'continue', 'apply', 'verify', 'query', 'status', 'retrieve', 'archive', 'init', 'explore', 'onboard', 'migrate'];

  it('agent:codex generates ALL 12 skills (not just a spot-checked one)', async () => {
    await initVault({ path: dir, agent: 'codex' });
    for (const k of SKILL_KEYS) {
      expect(exists(dir, `.agents/skills/ows-${k}/SKILL.md`), `ows-${k}`).toBe(true);
    }
  });

  it('agent:claude generates ALL 12 commands', async () => {
    await initVault({ path: dir, agent: 'claude' });
    for (const k of SKILL_KEYS) {
      expect(exists(dir, `.claude/commands/ows-${k}.md`), `ows-${k}`).toBe(true);
    }
  });

  it('re-init (extend) with codex is idempotent: exactly one AGENTS.md block, content stable', async () => {
    await initVault({ path: dir, agent: 'codex' });
    const first = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    await initVault({ path: dir, agent: 'codex' });
    const second = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(second).toBe(first); // no churn / double-insert
    expect(second.split('<!-- ows:begin').length - 1).toBe(1);
    expect(second.split('<!-- ows:end -->').length - 1).toBe(1);
    // no stray .bak on a clean idempotent re-init
    expect(fs.existsSync(path.join(dir, 'AGENTS.md.bak'))).toBe(false);
  });

  it('propagates the AGENTS.override.md warning through InitResult', async () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.override.md'), 'override');
    const r = await initVault({ path: dir, agent: 'codex' });
    expect(r.warnings.some((w) => w.includes('AGENTS.override.md'))).toBe(true);
  });

  it('propagates the >32KiB AGENTS.md warning through InitResult', async () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# big\n' + 'x'.repeat(33 * 1024) + '\n');
    const r = await initVault({ path: dir, agent: 'codex' });
    expect(r.warnings.some((w) => /exceeds \d+ bytes/.test(w))).toBe(true);
  });

  it('backs up user-customized files (.bak) for BOTH adapters on re-init', async () => {
    await initVault({ path: dir, agent: 'both' });
    const claudeFile = path.join(dir, '.claude/commands/ows-propose.md');
    const codexFile = path.join(dir, '.agents/skills/ows-propose/SKILL.md');
    fs.writeFileSync(claudeFile, 'CUSTOM CLAUDE EDIT');
    fs.writeFileSync(codexFile, 'CUSTOM CODEX EDIT');
    await initVault({ path: dir, agent: 'both' });
    expect(fs.readFileSync(`${claudeFile}.bak`, 'utf-8')).toBe('CUSTOM CLAUDE EDIT');
    expect(fs.readFileSync(`${codexFile}.bak`, 'utf-8')).toBe('CUSTOM CODEX EDIT');
    // and the canonical files were regenerated (no longer the custom text)
    expect(fs.readFileSync(claudeFile, 'utf-8')).not.toBe('CUSTOM CLAUDE EDIT');
    expect(fs.readFileSync(codexFile, 'utf-8')).not.toBe('CUSTOM CODEX EDIT');
  });
});
