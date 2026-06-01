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

/**
 * Insert or replace the ows managed block in an `AGENTS.md` body. Pure.
 *
 * - empty existing → just the block
 * - existing with a block → replace ONLY the block, preserve everything else
 * - existing without a block → append the block after a blank line
 */
export function mergeAgentsMd(existing: string, block: string): string {
  const normBlock = block.trimEnd() + '\n';
  if (!existing.trim()) return normBlock;

  const b = existing.indexOf(BEGIN);
  const e = existing.indexOf(END);
  if (b !== -1 && e !== -1 && e > b) {
    const before = existing.slice(0, b);
    const after = existing.slice(e + END.length);
    return (before + normBlock.trimEnd() + after).replace(/\n{3,}/g, '\n\n');
  }
  // no block present: append after existing content + a blank line
  return existing.replace(/\s*$/, '') + '\n\n' + normBlock;
}
