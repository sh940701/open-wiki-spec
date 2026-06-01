import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexAdapter } from '../../../src/cli/init/agents/codex.js';
import { WORKFLOW_DEFINITIONS } from '../../../src/cli/init/workflow-definitions.js';

describe('CodexAdapter.render — skills', () => {
  const arts = new CodexAdapter().render(WORKFLOW_DEFINITIONS);
  const skills = arts.filter((a) => a.path.endsWith('SKILL.md'));

  it('emits one SKILL.md per workflow at .agents/skills/ows-<key>/SKILL.md', () => {
    expect(skills).toHaveLength(WORKFLOW_DEFINITIONS.length);
    for (const d of WORKFLOW_DEFINITIONS) {
      const a = skills.find((s) => s.path === `.agents/skills/${d.name}/SKILL.md`);
      expect(a, `missing skill for ${d.name}`).toBeTruthy();
    }
  });

  it('frontmatter name equals folder name (ows-<key>)', () => {
    for (const a of skills) {
      const folder = a.path.split('/')[2]; // .agents/skills/<folder>/SKILL.md
      expect(a.contents.startsWith(`---\nname: ${folder}\ndescription: `)).toBe(true);
    }
  });

  it('includes an Invocation section using $ows- explicit mention', () => {
    const propose = skills.find((s) => s.path.includes('ows-propose'))!;
    expect(propose.contents).toContain('## Invocation');
    expect(propose.contents).toContain('$ows-propose');
  });

  it('ANTI-LEAK: no Codex skill contains /ows-, "Claude", "subagent", or $ARGUMENTS', () => {
    for (const a of skills) {
      expect(a.contents, a.path).not.toMatch(/\/ows-/);
      expect(a.contents, a.path).not.toMatch(/Claude/);
      expect(a.contents, a.path).not.toMatch(/subagent/);
      expect(a.contents, a.path).not.toMatch(/\$ARGUMENTS/);
    }
  });

  it('skill names satisfy Codex charset (lowercase/digits/hyphen, <64)', () => {
    for (const a of skills) {
      const folder = a.path.split('/')[2];
      expect(folder).toMatch(/^[a-z0-9-]+$/);
      expect(folder.length).toBeLessThan(64);
    }
  });
});

describe('CodexAdapter.writeAll', () => {
  it('writes skills + AGENTS.md, preserves user AGENTS.md content, idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-codex-'));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# House rules\n\nUse spaces.\n');
    const a = new CodexAdapter();
    a.writeAll(dir, WORKFLOW_DEFINITIONS, []);
    expect(fs.existsSync(path.join(dir, '.agents/skills/ows-propose/SKILL.md'))).toBe(true);
    const agents1 = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(agents1).toContain('House rules');
    expect(agents1).toContain('ows --version');
    // idempotent
    a.writeAll(dir, WORKFLOW_DEFINITIONS, []);
    const agents2 = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(agents2).toBe(agents1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('warns when AGENTS.override.md is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-codex-'));
    fs.writeFileSync(path.join(dir, 'AGENTS.override.md'), 'x');
    const warns: string[] = [];
    new CodexAdapter().writeAll(dir, WORKFLOW_DEFINITIONS, warns);
    expect(warns.some((w) => w.includes('AGENTS.override.md'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
