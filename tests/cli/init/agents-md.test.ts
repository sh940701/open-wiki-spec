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
