/**
 * The ows-managed block injected into a project's `AGENTS.md` (Codex's always-on
 * guidance file), plus a pure idempotent merge helper.
 */

export const BEGIN = '<!-- ows:begin (managed by open-wiki-spec; edits inside this block are overwritten) -->';
export const END = '<!-- ows:end -->';

/** Codex's combined AGENTS.md cap (`project_doc_max_bytes`, ~32 KiB). */
export const AGENTS_MAX_BYTES = 32 * 1024;

export const OWS_AGENTS_BLOCK = `${BEGIN}
## open-wiki-spec (ows) — agent knowledge layer

This project keeps a persistent, typed knowledge layer in \`wiki/\` (a markdown
"vault"). Prefer reading and maintaining that vault over re-scanning the filesystem
from scratch each session. The \`ows\` CLI is the engine; it emits structured JSON
(\`--json\`) that you parse and act on.

### Setup check
Run \`ows --version\` before using these skills. If it is missing, install with
\`npm i -g open-wiki-spec\`. Codex must run in a sandbox mode that permits executing
\`ows\` (\`workspace-write\` or \`danger-full-access\`).

### Golden rule (deterministic preflight)
Before creating any Feature or Change, ALWAYS run the preflight and act on its
\`classification\`:
\`\`\`bash
ows propose "<summary>" --keywords "<k1>,<k2>" --dry-run --json
\`\`\`
Never decide "does something similar already exist?" by free-form reasoning — the
CLI is the retrieval engine. Classifications: \`existing_change\`, \`existing_feature\`,
\`new_feature\`, \`needs_confirmation\` (stop and ask the user).

### Note types
Feature (canonical current behavior) · Change (a unit of proposed work) · System
(component boundary) · Decision (rationale) · Source (evidence) · Query (investigation).

### Lifecycle
\`proposed -> planned -> in_progress -> applied -> (archived)\`. Use \`ows continue <id>\`
to advance, \`ows apply <id>\` to fold a Change into Feature notes, \`ows verify\` to
check consistency (4 dimensions), \`ows archive <id>\` when done.

### Skills (in \`.agents/skills/\`)
\`ows-propose\`, \`ows-continue\`, \`ows-apply\`, \`ows-verify\`, \`ows-query\`,
\`ows-status\`, \`ows-retrieve\`, \`ows-archive\`, \`ows-init\`, \`ows-explore\`,
\`ows-onboard\`, \`ows-migrate\`. Mention one inline as \`$ows-<name>\` or pick it
from \`/skills\`. Each skill drives the matching \`ows\` subcommand.

### Guardrails
Always \`--dry-run\` destructive or creative steps first. Never auto-resolve
\`needs_confirmation\` or \`stale_base\` — ask the user. Show \`ows\` JSON reasoning
(classification, scores) so decisions stay explainable.
${END}
`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Insert or replace the ows managed block in an `AGENTS.md` body. Pure and
 * convergent — any input yields a body with exactly one well-formed block.
 *
 * - empty existing → just the block
 * - exactly one well-formed block → replace it IN PLACE (surrounding order kept)
 * - no markers → append the block after the existing content
 * - malformed/duplicate markers (BEGIN-only, END-only, END-before-BEGIN, multiple
 *   pairs) → strip every managed region and stray marker, then append one clean block
 *
 * Whitespace is normalized only at the join boundaries, never across the whole
 * document, so user-authored blank-line runs elsewhere are preserved.
 */
export function mergeAgentsMd(existing: string, block: string): string {
  const normBlock = block.trimEnd() + '\n';
  if (!existing.trim()) return normBlock;

  const begins = countOccurrences(existing, BEGIN);
  const ends = countOccurrences(existing, END);
  const b = existing.indexOf(BEGIN);
  const e = existing.indexOf(END);

  // Exactly one well-formed pair → replace in place, preserving surrounding order.
  if (begins === 1 && ends === 1 && b !== -1 && e > b) {
    const before = existing.slice(0, b).replace(/\s+$/, '');
    const after = existing.slice(e + END.length).replace(/^\s+/, '');
    const parts = [before, normBlock.trimEnd(), after].filter((p) => p.length > 0);
    return parts.join('\n\n').replace(/\s+$/, '') + '\n';
  }

  // No markers at all → append after the existing content.
  if (begins === 0 && ends === 0) {
    return existing.replace(/\s+$/, '') + '\n\n' + normBlock;
  }

  // Malformed/duplicate markers → strip all managed regions + stray markers, append clean.
  let base = existing.replace(new RegExp(escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END), 'g'), '');
  base = base
    .split('\n')
    .filter((line) => !line.includes(BEGIN) && !line.includes(END))
    .join('\n')
    .replace(/\s+$/, '');
  return base ? base + '\n\n' + normBlock : normBlock;
}
