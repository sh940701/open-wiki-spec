/**
 * Per-agent rendering transforms applied to workflow bodies/descriptions.
 *
 * Source text is authored in Claude form. The Claude render is identity (so output
 * stays byte-identical to historical releases); the Codex render rewrites
 * Claude-specific slash syntax and wording into Codex-idiomatic form.
 */

export function toClaude(text: string): string {
  return text;
}

// Order matters: replace longer / more-specific phrases before generic ones.
export function toCodex(text: string): string {
  return text
    // 1. slash cross-refs -> codex explicit-mention token ($ows-<cmd>)
    .replace(/\/ows-([a-z]+)/g, '$$ows-$1')
    // 2. de-Claude wording (specific first)
    .replace(/Claude Code skill files/g, 'Codex skill files')
    .replace(/Claude Code/g, 'Codex')
    .replace(/Claude/g, 'Codex')
    // 3. neutralize subagent framing (conceptual term, Claude-flavored)
    .replace(/retrieval subagent/g, 'retrieval helper')
    .replace(/subagent/g, 'helper');
}
