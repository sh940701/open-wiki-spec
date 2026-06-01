import { describe, it, expect } from 'vitest';
import { toClaude, toCodex } from '../../../src/cli/init/agents/transform.js';

describe('toClaude', () => {
  it('is identity', () => {
    const s = 'Run `/ows-continue` then Claude Code does X. retrieval subagent.';
    expect(toClaude(s)).toBe(s);
  });
});

describe('toCodex', () => {
  it('rewrites /ows-<cmd> cross-refs to $ows-<cmd>', () => {
    expect(toCodex('See `/ows-continue` and /ows-apply.')).toBe('See `$ows-continue` and $ows-apply.');
  });
  it('de-Claude-ifies wording', () => {
    expect(toCodex('generates 12 Claude Code skill files')).toBe('generates 12 Codex skill files');
    expect(toCodex('the Claude Code main agent')).toBe('the Codex main agent');
  });
  it('neutralizes "retrieval subagent" framing', () => {
    expect(toCodex('This is the **retrieval subagent** described')).toBe('This is the **retrieval helper** described');
    expect(toCodex('Run the open-wiki-spec retrieval subagent.')).toBe('Run the open-wiki-spec retrieval helper.');
  });
  it('leaves plain ows CLI commands untouched', () => {
    expect(toCodex('ows propose "x" --json')).toBe('ows propose "x" --json');
  });
  it('produces no /ows- or Claude leakage on a combined sample', () => {
    const out = toCodex('`/ows-verify` via Claude Code retrieval subagent /ows-propose');
    expect(out).not.toMatch(/\/ows-/);
    expect(out).not.toMatch(/Claude/);
    expect(out).not.toMatch(/subagent/);
  });
});
