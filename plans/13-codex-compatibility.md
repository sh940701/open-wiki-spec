# Design: Codex Compatibility for open-wiki-spec

- **Date:** 2026-06-01
- **Status:** Approved (design decisions confirmed; Codex-reviewed — corrections folded in)
- **Target version:** `0.4.0` (additive feature; vault schema version unchanged)
- **Branch:** `feat/codex-compat`

## 1. Problem

`open-wiki-spec` (`ows`) is an agent-maintained knowledge-layer CLI. The CLI engine
is agent-agnostic — every workflow tells the agent to run `ows <cmd> --json` and
parse the structured result. But the **delivery layer is hardcoded to Claude Code**:
`ows init` writes 12 slash-command files to `.claude/commands/ows-*.md`. The design
brief (`overview.md` §9.4) scoped v1 to "Claude Code Only", and the README lists
"Additional agent runtime support — Cursor, **Codex**, Gemini CLI adapters" as a
wanted contribution.

**Goal:** make `ows` work perfectly under OpenAI Codex CLI, refactoring the init
layer so additional runtimes are first-class rather than bolted on, with zero
regression to existing Claude output.

## 2. Ground truth (official sources)

Verified against the OpenAI-official `migrate-to-codex` skill (`~/.codex/skills/migrate-to-codex/references/differences.md`, "Docs last checked: 2026-04-20") and `developers.openai.com/codex/{skills,custom-prompts}`. Local Codex: `codex-cli 0.133.0`.

| Concern | Codex idiomatic answer |
|---|---|
| Analog of `.claude/commands/*.md` | **Codex Skills**: `.agents/skills/<name>/SKILL.md` (project-scoped, version-controlled, implicitly invocable). `differences.md`'s *migrator* maps `.claude/commands/<n>.md` → `.agents/skills/source-command-<n>/SKILL.md` (prefixed). We author natively, so we use our own `ows-<key>` folder names; **folder name MUST equal skill `name`**. |
| SKILL.md frontmatter | `name` + `description` — **identical schema** to Claude command frontmatter. |
| Skill name constraints | lowercase / digits / hyphens, < 64 chars, folder name == `name` (skill-creator SKILL.md). `ows-*` complies. |
| Always-on project guidance | **`AGENTS.md`** (Codex's CLAUDE.md analog; layered global → repo-root → cwd). **~32 KiB combined cap** (`project_doc_max_bytes`); **`AGENTS.override.md` fully supersedes it** if present. |
| Optional skill metadata | `agents/openai.yaml` (`interface`/`dependencies`/`policy.allow_implicit_invocation`). **Omitted** — `allow_implicit_invocation` defaults `true`; we need no display metadata or MCP deps (Codex-review correction). |
| Custom prompts (`~/.codex/prompts/*.md`) | **Rejected.** Global-only (project-scoped `.codex/prompts` is open issue #9848), officially deprecated in favor of skills. |
| Skill invocation | Implicit (description match) or explicit: inline `$ows-<key>` mention, or `/skills` picker. (`/ows-<key>` slash syntax is **Claude-only**, meaningless in Codex.) |

**Confirmed locally:** `~/.agents/skills/` and `~/.codex/skills/` both exist and hold
real skills with `name`/`description` frontmatter + optional `scripts/`,
`references/`, `agents/openai.yaml`.

## 3. Confirmed design decisions

1. **`ows init` default = auto-detect** which agent(s) are present, with explicit
   `--agent claude|codex|both|auto` override. Backward-compatible: a project with
   only Claude markers (and no Codex signal) still gets exactly today's output.
2. **Adapter pattern** refactor: `WORKFLOW_DEFINITIONS` is the single source of
   truth; pluggable `AgentAdapter`s render it per agent. Claude output stays
   byte-identical (proven by golden test).
3. **Skills + AGENTS.md only** for Codex. No legacy global `~/.codex/prompts`.

## 4. Architecture

```
src/cli/init/
  workflow-definitions.ts   NEW  12 workflows as agent-neutral structured data.
  agents/
    types.ts        NEW  AgentId, AgentAdapter, AgentArtifact, RenderContext
    detect.ts       NEW  detectAgents(projectPath, explicit?): AgentId[]
    claude.ts       NEW  ClaudeAdapter -> .claude/commands/ows-*.md
    codex.ts        NEW  CodexAdapter  -> .agents/skills/ows-*/SKILL.md + AGENTS.md managed block
    index.ts        NEW  adapter registry: { claude, codex }
  skill-generator.ts  KEPT  thin back-compat shim re-exporting from claude.ts/workflow-definitions.ts
  init-engine.ts    EDIT  detect → run selected adapters; aggregate artifacts
  types.ts          EDIT  InitOptions.agent; InitResult.agents + agentArtifacts
  meta-files.ts     UNCHANGED
```

### 4.1 Agent-neutral workflow definitions

The 12 instruction bodies move verbatim into `workflow-definitions.ts`, with two
classes of Claude-coupled text replaced by **render tokens**:

| Token | Claude renders | Codex renders |
|---|---|---|
| `{{cmd:continue}}` (and siblings) | `/ows-continue` | `$ows-continue` |
| `{{skillNoun}}` | `Claude Code skill files` | `Codex skill files` |
| `{{skillNounSingular}}` | `skill` | `skill` |
| `{{agentName}}` | `Claude Code` | `Codex` |

Token→Claude mappings reproduce the **exact** original strings, so Claude output is
byte-identical. A golden test enforces this (baseline set-SHA `0630d58…`, 12 files).

`WorkflowDefinition` shape:

```ts
interface WorkflowDefinition {
  key: string;            // 'propose' (drives ows-propose / source command)
  name: string;           // 'ows-propose'
  description: string;
  body: string;           // instruction template with {{...}} tokens
}
```

### 4.2 AgentAdapter interface

```ts
type AgentId = 'claude' | 'codex';

interface AgentArtifact { path: string; contents: string; }  // path relative to projectPath

interface AgentAdapter {
  id: AgentId;
  /** Pure: produce artifacts for all workflows; no I/O. */
  render(defs: WorkflowDefinition[]): AgentArtifact[];
  /** Adapter-specific merge (e.g. AGENTS.md managed block, .bak on user edits). */
  write(projectPath: string, artifacts: AgentArtifact[]): string[];  // returns written abs paths
}
```

`render` is pure (unit-testable without a filesystem). `write` owns side effects and
the same backup-on-user-edit behavior the current `writeAllSkillFiles` has.

### 4.3 ClaudeAdapter

- `render`: for each def, `---\nname: {name}\ndescription: {desc}\n---\n\n{body→claude}\n`.
- `write`: to `.claude/commands/ows-<key>.md`; if an existing file differs from the
  new content, write `<file>.bak` first (preserves current behavior exactly).

### 4.4 CodexAdapter

- **Per-skill** `render` emits **one** artifact each (no `openai.yaml` — Codex-review
  correction; implicit invocation is already the default):
  - `.agents/skills/ows-<key>/SKILL.md` — `---\nname: ows-<key>\ndescription: {desc}\n---\n\n## Invocation\n\nImplicitly selected by description, or mention `$ows-<key>` inline / pick it from `/skills`. This skill drives the `ows` CLI; run the commands below directly.\n\n{body→codex}\n`
- **AGENTS.md** managed block (one extra artifact, path `AGENTS.md`): the ows contract
  wrapped in `<!-- ows:begin -->` / `<!-- ows:end -->`. Kept **compact (< ~6 KiB)** so it
  never threatens the ~32 KiB `project_doc_max_bytes` cap.
- `write`:
  - skill files: mkdir -p, write; `.bak` on user-edit (same policy as Claude).
  - `AGENTS.md`: **idempotent managed-block merge** — if file absent, create with the
    block; if present and block exists, replace only the block; if present without a
    block, append the block after a blank line. **Never modify content outside the
    markers.**
  - **Safeguards (warnings, non-fatal):** (a) if `AGENTS.override.md` exists at project
    root, emit a warning — the generated `AGENTS.md` is shadowed and ignored by Codex;
    (b) if the resulting `AGENTS.md` exceeds `project_doc_max_bytes` (~32 KiB), warn that
    Codex may truncate it.

#### AGENTS.md managed block (content outline)

```
<!-- ows:begin (managed by open-wiki-spec; edits inside this block are overwritten) -->
## open-wiki-spec (ows) — agent knowledge layer

This project uses an `ows` vault (`wiki/`) as a persistent, typed knowledge layer.
Prefer reading/maintaining the vault over re-scanning the filesystem from scratch.

### Setup check
Confirm the CLI is available before using ows: `ows --version`. If missing, the
skills won't work — install with `npm i -g open-wiki-spec`. Codex must run with a
sandbox mode that permits running `ows` (`workspace-write` or `danger-full-access`).

### Golden rule
Before creating any Feature/Change, ALWAYS run the deterministic preflight —
`ows propose "<summary>" --dry-run --json` — and act on its `classification`.
Never decide similarity by free-form reasoning; the CLI is the retrieval engine.

### Note types / lifecycle / JSON contract / skills index / guardrails
... (condensed, agent-neutral; mirrors README + skill bodies) ...
<!-- ows:end -->
```

### 4.5 detectAgents

```ts
function detectAgents(projectPath: string, explicit?: AgentSelector): AgentId[]
// explicit 'claude'|'codex'|'both' → deterministic, no scan (hermetic).
// 'auto'|undefined → scan:
//   project markers:  .claude/ or CLAUDE.md/claude.md → claude
//                     .codex/ or .agents/ or AGENTS.md → codex
//   if none: host fallback — codex if (~/.codex or `codex` on PATH);
//                            claude if (~/.claude or `claude` on PATH)
//   final fallback: ['claude']
// returns de-duped, stable order ['claude','codex'].
```

`OWS_INIT_AGENT` env overrides when the CLI flag is absent. `initVault` is hermetic
whenever an explicit agent is supplied → deterministic tests.

### 4.6 Types & init-engine

- `InitOptions.agent?: 'claude' | 'codex' | 'both' | 'auto'`.
- `InitResult` gains `agents: AgentId[]` and `agentArtifacts: Record<AgentId, string[]>`.
  `skillFilesGenerated` is retained as the union of all written agent files
  (existing test `skillFilesGenerated.length > 0` still holds when claude is included).
- `initVault`/`extendVault` replace the single `writeAllSkillFiles(projectPath)` call
  with: `const agents = detectAgents(projectPath, options.agent); for (const id of agents) run adapter`.

### 4.7 CLI

`init.ts`: add `.option('--agent <agent>', '… claude|codex|both|auto (default: auto)')`.
Validate ∈ {claude,codex,both,auto}; invalid → Commander usage error (exit 2).
Human output reports detected agents + per-agent artifact counts.

## 5. Docs & metadata

- **README**: flip the "Codex adapter" wishlist line → shipped; add Codex to Quick
  Start; new "Agent runtime support" subsection (auto-detect, `--agent`, where files land).
- **overview.md §9.4**: addendum — "v1 shipped Claude-only by design; v0.4 adds a
  Codex adapter via the agent-neutral init layer." (History preserved, not rewritten.)
- **CHANGELOG.md**: `0.4.0` entry.
- **package.json**: `0.3.1 → 0.4.0`. `keywords` += `codex`.
- Schema version: **unchanged**.

## 6. Testing (TDD)

1. **Golden / byte-identity** (`tests/cli/init/claude-adapter.golden.test.ts`):
   ClaudeAdapter render+write reproduces the captured baseline exactly (set-SHA pin).
2. **detectAgents** units: explicit selectors, project markers, host fallback,
   dedupe/order, empty→`['claude']`.
3. **CodexAdapter** units: SKILL.md path (`.agents/skills/ows-<key>/SKILL.md`) +
   frontmatter (`name` == folder, valid charset) + body; AGENTS.md created, idempotent
   on re-render, surrounding content preserved, block-only replacement; warns on
   `AGENTS.override.md` presence and on >32 KiB result.
4. **Anti-leak guard**: Codex artifacts contain no `/ows-` literals, no "Claude",
   no Claude-only `$ARGUMENTS`/subagent wording; Codex cross-refs use `$ows-`.
   (Exhaustive — enumerate every `/ows-`/"Claude" literal in the source bodies first.)
5. **init-engine integration**: `claude|codex|both|auto` produce expected file sets;
   extend/force idempotency; existing 12 init tests pinned to `agent:'claude'` where
   they assert exact output.
6. **CLI**: `--agent` parse + invalid→exit 2.

All ~805 existing tests must stay green.

## 7. Codex collaboration

Per the goal ("codex 와 함께 아주아주 완벽하게"), the `codex-rescue` subagent
(foreground, English prompt, xhigh effort) reviews at two gates:
(a) this spec, before any code (**done** — corrections folded in above);
(b) adversarial verification of the final diff.
No Codex output is applied without user sign-off.

**Manual runtime verification (post-implementation):** project-local skill discovery
could not be confirmed empirically in the build sandbox. After `ows init --agent codex`,
run a real Codex session in the vault and confirm `ows-propose` appears in the `$`
skill picker / is implicitly selectable, and that `ows --version` succeeds from within
the session. Document the result before declaring the feature production-ready.

## 8. Out of scope (YAGNI)

- Cursor / Gemini adapters (the refactor makes them trivial later, but not now).
- `.codex/config.toml` MCP, `.codex/agents/*.toml`, `.codex/hooks.json` — ows ships
  no MCP server / subagents / hooks, so nothing to emit.
- Codex plugin/marketplace packaging.
- Global `~/.codex/prompts` generation.
```
