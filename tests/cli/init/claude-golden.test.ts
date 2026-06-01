import { describe, it, expect } from 'vitest';
import { WORKFLOW_SKILLS, generateSkillFile } from '../../../src/cli/init/skill-generator.js';

// The 12 workflow keys in canonical order.
const KEYS = ['propose', 'continue', 'apply', 'verify', 'query', 'status', 'retrieve', 'archive', 'init', 'explore', 'onboard', 'migrate'];

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
