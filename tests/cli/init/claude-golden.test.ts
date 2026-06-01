import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { WORKFLOW_SKILLS, generateSkillFile } from '../../../src/cli/init/skill-generator.js';
import { ClaudeAdapter } from '../../../src/cli/init/agents/claude.js';
import { WORKFLOW_DEFINITIONS } from '../../../src/cli/init/workflow-definitions.js';

// The 12 workflow keys in canonical order.
const KEYS = ['propose', 'continue', 'apply', 'verify', 'query', 'status', 'retrieve', 'archive', 'init', 'explore', 'onboard', 'migrate'];

// Baseline set-SHA captured from open-wiki-spec 0.3.1 (pre-refactor) by concatenating
// the sorted `.claude/commands/ows-*.md` files. This is the REAL byte-identity gate:
// any change to a Claude command body, frontmatter, or ordering flips this hash.
const CLAUDE_BASELINE_SHA = '0630d58272d5f672a806b170e215ccbf52d5f39339ac7b6081ed0ce92ee1a7bd';

describe('Claude byte-identity (golden)', () => {
  it('concatenated sorted Claude command set hashes to the 0.3.x baseline', () => {
    const arts = new ClaudeAdapter().render(WORKFLOW_DEFINITIONS);
    const sorted = [...arts].sort((a, b) => a.path.localeCompare(b.path));
    const h = createHash('sha256');
    for (const a of sorted) h.update(Buffer.from(a.contents, 'utf8'));
    expect(h.digest('hex')).toBe(CLAUDE_BASELINE_SHA);
  });

  it('renders exactly 12 commands at .claude/commands/ows-<key>.md', () => {
    const arts = new ClaudeAdapter().render(WORKFLOW_DEFINITIONS);
    expect(arts).toHaveLength(12);
    for (const key of KEYS) {
      expect(arts.find((a) => a.path === `.claude/commands/ows-${key}.md`), `missing ${key}`).toBeTruthy();
    }
  });
});

describe('Claude skill output (characterization)', () => {
  it('generates exactly 12 skills with name+description frontmatter', () => {
    expect(Object.keys(WORKFLOW_SKILLS).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const def = WORKFLOW_SKILLS[key];
      const out = generateSkillFile(def);
      expect(out.startsWith(`---\nname: ows-${key}\ndescription: ${def.description}\n---\n\n`)).toBe(true);
      expect(out.endsWith('\n')).toBe(true);
    }
  });

  it('every skill body is non-empty and references the ows CLI', () => {
    for (const key of KEYS) {
      const out = generateSkillFile(WORKFLOW_SKILLS[key]);
      expect(out).toContain('ows ');
    }
  });
});
