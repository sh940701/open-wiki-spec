import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexAdapter, invocationSection } from '../../../src/cli/init/agents/codex.js';
import { WORKFLOW_DEFINITIONS } from '../../../src/cli/init/workflow-definitions.js';
import { toCodex } from '../../../src/cli/init/agents/transform.js';

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

  it('ANTI-LEAK: no Codex skill leaks Claude-isms (case-insensitive, all 12 skills)', () => {
    for (const a of skills) {
      expect(a.contents, `${a.path}: /ows- slash ref`).not.toMatch(/\/ows-/);
      expect(a.contents, `${a.path}: claude`).not.toMatch(/\bclaude\b/i);
      expect(a.contents, `${a.path}: subagent`).not.toMatch(/\bsubagent\b/i);
      expect(a.contents, `${a.path}: slash command`).not.toMatch(/slash command/i);
      expect(a.contents, `${a.path}: Task tool`).not.toMatch(/\bTask tool\b/i);
      expect(a.contents, `${a.path}: $ARGUMENTS`).not.toMatch(/\$ARGUMENTS/);
    }
  });

  it('uses the intentional Codex invocation surface ($ows-<name> + /skills) in every skill', () => {
    for (const a of skills) {
      const name = a.path.split('/')[2];
      expect(a.contents, `${a.path}: $${name}`).toContain(`$${name}`);
      expect(a.contents, `${a.path}: /skills picker`).toContain('/skills'); // Codex picker, not a Claude leak
    }
  });

  it('each skill content is EXACTLY the expected template (full identity, no corruption)', () => {
    // Full `.toBe` identity: frontmatter + invocation header + toCodex(body), byte-for-byte.
    // A stub/duplicated/appended/corrupted transform, or any stray injected text anywhere,
    // fails here. (Previous `.toContain` could not catch injection between head and body.)
    for (const d of WORKFLOW_DEFINITIONS) {
      const a = skills.find((s) => s.path === `.agents/skills/${d.name}/SKILL.md`)!;
      const expected =
        `---\nname: ${d.name}\ndescription: ${toCodex(d.description)}\n---\n\n` +
        `${invocationSection(d.name)}${toCodex(d.body)}\n`;
      expect(a.contents, `${d.name} full identity`).toBe(expected);
      // the transform must actually have changed something for workflows with cross-refs
      if (/\/ows-/.test(d.body)) {
        expect(toCodex(d.body), `${d.name} transform is a no-op`).not.toBe(d.body);
      }
    }
  });

  it('full Codex skill set hashes to a pinned golden (regression guard for all 12 skills)', async () => {
    const { createHash } = await import('node:crypto');
    const sorted = [...skills].sort((a, b) => a.path.localeCompare(b.path));
    const h = createHash('sha256');
    for (const a of sorted) h.update(Buffer.from(a.contents, 'utf8'));
    // Pinned set-SHA; intentional Codex wording changes must update this on purpose.
    expect(h.digest('hex')).toBe('d86699fdfd3df8e089f11e77a79a404ab37c5573a92d619000178aefb7b90a0a');
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
