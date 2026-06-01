import { describe, it, expect } from 'vitest';
import { mergeAgentsMd, OWS_AGENTS_BLOCK, BEGIN, END } from '../../../src/cli/init/agents/agents-md.js';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('mergeAgentsMd', () => {
  it('returns just the block when there is no existing file', () => {
    expect(mergeAgentsMd('', OWS_AGENTS_BLOCK)).toBe(OWS_AGENTS_BLOCK.trimEnd() + '\n');
  });
  it('appends the block (after a blank line) when file has no block', () => {
    const out = mergeAgentsMd('# My rules\n\nKeep tabs.\n', OWS_AGENTS_BLOCK);
    expect(out).toContain('# My rules');
    expect(out).toContain('Keep tabs.');
    expect(out).toContain(BEGIN);
    expect(out.indexOf('Keep tabs.')).toBeLessThan(out.indexOf(BEGIN));
  });
  it('replaces ONLY the existing block, preserving surrounding content', () => {
    const existing = `TOP\n${BEGIN}\nold managed text\n${END}\nBOTTOM\n`;
    const out = mergeAgentsMd(existing, OWS_AGENTS_BLOCK);
    expect(out).toContain('TOP');
    expect(out).toContain('BOTTOM');
    expect(out).not.toContain('old managed text');
    expect((out.match(new RegExp(escape(BEGIN), 'g')) || []).length).toBe(1);
  });
  it('is idempotent (merge twice == merge once)', () => {
    const once = mergeAgentsMd('TOP\n', OWS_AGENTS_BLOCK);
    const twice = mergeAgentsMd(once, OWS_AGENTS_BLOCK);
    expect(twice).toBe(once);
  });

  const countMarkers = (s: string, m: string) => s.split(m).length - 1;

  it('converges to exactly one block from malformed marker states', () => {
    const cases = [
      `TOP\n${BEGIN}\nno end here\nBOTTOM\n`, // BEGIN only
      `TOP\n${END}\nBOTTOM\n`, // END only
      `TOP\n${END}\nstuff\n${BEGIN}\nBOTTOM\n`, // END before BEGIN
      `${BEGIN}\nfirst\n${END}\nmid\n${BEGIN}\nsecond\n${END}\n`, // duplicate pairs
    ];
    for (const input of cases) {
      const out = mergeAgentsMd(input, OWS_AGENTS_BLOCK);
      expect(countMarkers(out, BEGIN), `BEGIN count for: ${JSON.stringify(input)}`).toBe(1);
      expect(countMarkers(out, END), `END count for: ${JSON.stringify(input)}`).toBe(1);
      // second merge is stable
      expect(mergeAgentsMd(out, OWS_AGENTS_BLOCK)).toBe(out);
    }
  });

  it('does not collapse user blank-line runs outside the managed block', () => {
    const existing = `line A\n\n\n\nline B\n`; // 3 blank lines the user authored
    const out = mergeAgentsMd(existing, OWS_AGENTS_BLOCK);
    expect(out).toContain('line A\n\n\n\nline B');
  });
});

describe('OWS_AGENTS_BLOCK content', () => {
  it('has begin/end markers and the golden rule + setup check', () => {
    expect(OWS_AGENTS_BLOCK).toContain(BEGIN);
    expect(OWS_AGENTS_BLOCK).toContain(END);
    expect(OWS_AGENTS_BLOCK).toContain('ows --version');
    expect(OWS_AGENTS_BLOCK).toContain('--dry-run --json');
    expect(OWS_AGENTS_BLOCK).not.toMatch(/\/ows-/);
    expect(OWS_AGENTS_BLOCK).not.toMatch(/Claude/);
  });
  it('stays well under the 32KiB cap', () => {
    expect(Buffer.byteLength(OWS_AGENTS_BLOCK, 'utf8')).toBeLessThan(6 * 1024);
  });
});
