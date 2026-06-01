# Codex Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ows init` generate first-class OpenAI Codex integration (`.agents/skills/ows-*/SKILL.md` + an `AGENTS.md` managed block) alongside the existing Claude Code output, behind an auto-detecting `--agent` selector, with zero regression to Claude output.

**Architecture:** Refactor the init delivery layer into an adapter pattern. `WORKFLOW_DEFINITIONS` (12 agent-neutral workflow bodies, unchanged from today's text) is the single source of truth. `ClaudeAdapter` renders it **identity** (byte-identical to today). `CodexAdapter` renders it through a deterministic transform pipeline (`/ows-x`→`$ows-x`, de-Claude wording) into Codex skills + an idempotent `AGENTS.md` block. `detectAgents()` picks adapters; `--agent claude|codex|both|auto` overrides.

**Tech Stack:** TypeScript (ESM, NodeNext), Commander, vitest, Node ≥20. No new dependencies.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/cli/init/workflow-definitions.ts` | NEW. `WorkflowDefinition` type + `WORKFLOW_DEFINITIONS` array (12 entries, bodies verbatim from today's `WORKFLOW_SKILLS`). Single source of truth. |
| `src/cli/init/agents/types.ts` | NEW. `AgentId`, `AgentSelector`, `AgentArtifact`, `AgentAdapter`, `WriteResult`. |
| `src/cli/init/agents/transform.ts` | NEW. `toClaude(s)` (identity) + `toCodex(s)` (replacement pipeline). Pure string fns. |
| `src/cli/init/agents/claude.ts` | NEW. `ClaudeAdapter`: render → `.claude/commands/ows-*.md`; write with `.bak`-on-user-edit. |
| `src/cli/init/agents/codex.ts` | NEW. `CodexAdapter`: render → `.agents/skills/ows-*/SKILL.md` + `AGENTS.md` block; idempotent merge + safeguards. |
| `src/cli/init/agents/agents-md.ts` | NEW. `OWS_BLOCK` content + `mergeAgentsMd(existing, block)` pure fn. |
| `src/cli/init/agents/detect.ts` | NEW. `detectAgents(projectPath, explicit?)`. |
| `src/cli/init/agents/index.ts` | NEW. `ADAPTERS` registry + `runAdapters()` helper. |
| `src/cli/init/skill-generator.ts` | MODIFY. Becomes a thin back-compat shim re-exporting from the new modules (`WORKFLOW_SKILLS`, `generateSkillFile`, `writeAllSkillFiles`). |
| `src/cli/init/init-engine.ts` | MODIFY. Replace `writeAllSkillFiles(projectPath)` with detect+run adapters; aggregate artifacts/warnings. |
| `src/cli/init/types.ts` | MODIFY. `InitOptions.agent`; `InitResult.agents` + `agentArtifacts`. |
| `src/cli/commands/init.ts` | MODIFY. `--agent` flag, validation, richer output. |
| `tests/cli/init/claude-golden.test.ts` | NEW. Characterization/byte-identity pin. |
| `tests/cli/init/transform.test.ts` | NEW. |
| `tests/cli/init/codex-adapter.test.ts` | NEW. |
| `tests/cli/init/agents-md.test.ts` | NEW. |
| `tests/cli/init/detect.test.ts` | NEW. |
| `tests/cli/init/init-agents.test.ts` | NEW. integration. |
| `tests/cli/init.test.ts` | MODIFY. Pin existing tests to `agent:'claude'`. |
| `README.md`, `overview.md`, `CHANGELOG.md`, `package.json` | MODIFY. Docs + version. |

---

## Task 1: Characterization golden test (pin current Claude output)

Lock today's behavior before refactoring. This test passes immediately against the
unchanged code and must stay green through every later task.

**Files:**
- Create: `tests/cli/init/claude-golden.test.ts`

- [ ] **Step 1: Write the characterization test**

```ts
import { describe, it, expect } from 'vitest';
import { WORKFLOW_SKILLS, generateSkillFile } from '../../../src/cli/init/skill-generator.js';

// The 12 workflow keys in canonical order.
const KEYS = ['propose','continue','apply','verify','query','status','retrieve','archive','init','explore','onboard','migrate'];

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
```

- [ ] **Step 2: Run to verify it passes against unchanged code**

Run: `npx vitest run tests/cli/init/claude-golden.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/cli/init/claude-golden.test.ts
git commit -m "test: characterization pin for Claude skill output"
```

---

## Task 2: Extract agent-neutral WORKFLOW_DEFINITIONS

Move the 12 workflow definitions into their own module **without changing any body
text**. `skill-generator.ts` keeps exporting `WORKFLOW_SKILLS` (now derived) so the
golden test and `init-engine` stay green.

**Files:**
- Create: `src/cli/init/workflow-definitions.ts`
- Modify: `src/cli/init/skill-generator.ts`

- [ ] **Step 1: Create `workflow-definitions.ts`**

```ts
/** Agent-neutral workflow definitions — the single source of truth for ows
 *  workflow instructions. Adapters (Claude, Codex) render these per agent. */
export interface WorkflowDefinition {
  /** workflow key, e.g. 'propose' — drives the skill/command name `ows-<key>`. */
  key: string;
  /** skill/command name, always `ows-<key>`. */
  name: string;
  /** one-line description (frontmatter `description`). */
  description: string;
  /** instruction body. Contains `/ows-<cmd>` cross-refs and Claude-Code wording
   *  in their raw (Claude) form; the CodexAdapter transforms them at render time. */
  body: string;
}

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  // For each of the 12 workflows, COPY VERBATIM from the current
  // src/cli/init/skill-generator.ts `WORKFLOW_SKILLS` entries:
  //   { key: 'propose', name: 'ows-propose', description: <existing>, body: <existing instructions string> },
  //   ... continue, apply, verify, query, status, retrieve, archive, init, explore, onboard, migrate
  // Order MUST be: propose, continue, apply, verify, query, status, retrieve,
  // archive, init, explore, onboard, migrate.
  // The body is the EXACT string currently assigned to `instructions`. Do not edit a single character.
];
```

> Implementation note: physically cut each `instructions` template literal from
> `skill-generator.ts` and paste it as `body` here, renaming `instructions`→`body`
> and adding `key`/`name`. Keep all backtick-escaping identical.

- [ ] **Step 2: Rewrite `skill-generator.ts` to derive from definitions (back-compat)**

```ts
/** Back-compat shim. Workflow content now lives in workflow-definitions.ts and is
 *  rendered by agent adapters. These exports are preserved for existing callers. */
import { WORKFLOW_DEFINITIONS, type WorkflowDefinition } from './workflow-definitions.js';
import { ClaudeAdapter } from './agents/claude.js';

export type SkillDefinition = { name: string; description: string; instructions: string };

/** Legacy keyed map: { propose: {name, description, instructions}, ... } */
export const WORKFLOW_SKILLS: Record<string, SkillDefinition> = Object.fromEntries(
  WORKFLOW_DEFINITIONS.map((d) => [d.key, { name: d.name, description: d.description, instructions: d.body }]),
);

/** Legacy single-file renderer (Claude frontmatter + body). */
export function generateSkillFile(skillDef: SkillDefinition): string {
  return `---\nname: ${skillDef.name}\ndescription: ${skillDef.description}\n---\n\n${skillDef.instructions}\n`;
}

/** Legacy writer — delegates to ClaudeAdapter (identical output). */
export function writeAllSkillFiles(projectPath: string): string[] {
  return new ClaudeAdapter().writeAll(projectPath, WORKFLOW_DEFINITIONS);
}
```

> NOTE: this step references `ClaudeAdapter` (Task 3). To keep the build green
> between commits, do Task 2 Step 2 and Task 3 in the **same commit** if your
> toolchain type-checks on commit. Otherwise temporarily inline the old
> `writeAllSkillFiles` body and switch to the adapter in Task 3.

- [ ] **Step 3: Run golden + full init test**

Run: `npx vitest run tests/cli/init/claude-golden.test.ts tests/cli/init.test.ts`
Expected: PASS (golden 2 + init 12). If `ClaudeAdapter` not yet present, complete Task 3 first.

- [ ] **Step 4: Commit (with Task 3 if needed for green build)**

```bash
git add src/cli/init/workflow-definitions.ts src/cli/init/skill-generator.ts
git commit -m "refactor: extract agent-neutral WORKFLOW_DEFINITIONS"
```

---

## Task 3: Adapter types + transform pipeline + ClaudeAdapter

**Files:**
- Create: `src/cli/init/agents/types.ts`, `src/cli/init/agents/transform.ts`, `src/cli/init/agents/claude.ts`
- Create: `tests/cli/init/transform.test.ts`

- [ ] **Step 1: Write `agents/types.ts`**

```ts
import type { WorkflowDefinition } from '../workflow-definitions.js';

export type AgentId = 'claude' | 'codex';
export type AgentSelector = AgentId | 'both' | 'auto';

/** One file an adapter wants written. `path` is relative to the project root. */
export interface AgentArtifact { path: string; contents: string; }

export interface AgentAdapter {
  readonly id: AgentId;
  /** Pure: produce all artifacts for the given workflows. No filesystem access. */
  render(defs: WorkflowDefinition[]): AgentArtifact[];
  /** Write artifacts to disk (with adapter-specific merge/backup). Returns absolute
   *  paths written. May push human-readable strings into `warnings`. */
  writeAll(projectPath: string, defs: WorkflowDefinition[], warnings?: string[]): string[];
}
```

- [ ] **Step 2: Write the transform test FIRST**

```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/cli/init/transform.test.ts`
Expected: FAIL ("Cannot find module .../transform.js").

- [ ] **Step 4: Write `agents/transform.ts`**

```ts
/** Per-agent rendering transforms applied to workflow bodies/descriptions.
 *  Source text is authored in Claude form; Claude render is identity, Codex
 *  render rewrites Claude-specific syntax and wording. */

export function toClaude(text: string): string {
  return text;
}

// Order matters: replace longer/more-specific phrases before generic ones.
export function toCodex(text: string): string {
  return text
    // 1. slash cross-refs -> codex explicit-mention token
    .replace(/\/ows-([a-z]+)/g, '$$ows-$1')
    // 2. de-Claude wording (specific first)
    .replace(/Claude Code skill files/g, 'Codex skill files')
    .replace(/Claude Code/g, 'Codex')
    .replace(/Claude/g, 'Codex')
    // 3. neutralize subagent framing (conceptual term, Claude-flavored)
    .replace(/retrieval subagent/g, 'retrieval helper')
    .replace(/subagent/g, 'helper');
}
```

> The `$$` in the replacement string emits a single literal `$` (JS `replace`
> escaping), so `/ows-continue` → `$ows-continue`.

- [ ] **Step 5: Run to verify transform tests pass**

Run: `npx vitest run tests/cli/init/transform.test.ts`
Expected: PASS.

- [ ] **Step 6: Write `agents/claude.ts`**

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowDefinition } from '../workflow-definitions.js';
import type { AgentAdapter, AgentArtifact } from './types.js';
import { toClaude } from './transform.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;

  render(defs: WorkflowDefinition[]): AgentArtifact[] {
    return defs.map((d) => ({
      path: path.join('.claude', 'commands', `${d.name}.md`),
      contents: `---\nname: ${d.name}\ndescription: ${toClaude(d.description)}\n---\n\n${toClaude(d.body)}\n`,
    }));
  }

  writeAll(projectPath: string, defs: WorkflowDefinition[]): string[] {
    const written: string[] = [];
    for (const art of this.render(defs)) {
      const abs = path.join(projectPath, art.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.existsSync(abs)) {
        try {
          const existing = fs.readFileSync(abs, 'utf-8');
          if (existing !== art.contents) fs.writeFileSync(`${abs}.bak`, existing);
        } catch { /* best-effort backup */ }
      }
      fs.writeFileSync(abs, art.contents);
      written.push(abs);
    }
    return written;
  }
}
```

- [ ] **Step 7: Run golden + init + transform together**

Run: `npx vitest run tests/cli/init/claude-golden.test.ts tests/cli/init.test.ts tests/cli/init/transform.test.ts`
Expected: PASS (all). This proves Claude output is unchanged through the refactor.

- [ ] **Step 8: Verify byte-identity against the captured baseline**

Run:
```bash
npm run build >/dev/null 2>&1
TMP=$(mktemp -d); node ./bin/open-wiki-spec.js init "$TMP" >/dev/null 2>&1
(cd "$TMP/.claude/commands" && cat $(ls | sort) | shasum -a 256); rm -rf "$TMP"
```
Expected: `0630d58272d5f672a806b170e215ccbf52d5f39339ac7b6081ed0ce92ee1a7bd` (exact baseline set-SHA).

- [ ] **Step 9: Commit**

```bash
git add src/cli/init/agents/types.ts src/cli/init/agents/transform.ts src/cli/init/agents/claude.ts src/cli/init/workflow-definitions.ts src/cli/init/skill-generator.ts tests/cli/init/transform.test.ts
git commit -m "refactor: ClaudeAdapter + transform pipeline (byte-identical output)"
```

---

## Task 4: CodexAdapter — skill rendering

**Files:**
- Create: `src/cli/init/agents/codex.ts` (render only this task; write in Task 5)
- Create: `tests/cli/init/codex-adapter.test.ts`

- [ ] **Step 1: Write the render test FIRST**

```ts
import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../../../src/cli/init/agents/codex.js';
import { WORKFLOW_DEFINITIONS } from '../../../src/cli/init/workflow-definitions.js';

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

  it('ANTI-LEAK: no Codex skill contains /ows-, "Claude", or "subagent"', () => {
    for (const a of skills) {
      expect(a.contents, a.path).not.toMatch(/\/ows-/);
      expect(a.contents, a.path).not.toMatch(/Claude/);
      expect(a.contents, a.path).not.toMatch(/subagent/);
      expect(a.contents, a.path).not.toMatch(/\$ARGUMENTS/);
    }
  });

  it('skill names satisfy Codex charset (lowercase/digits/hyphen, <64)', () => {
    for (const a of skills) {
      const folder = a.path.split('/')[2];
      expect(folder).toMatch(/^[a-z0-9-]+$/);
      expect(folder.length).toBeLessThan(64);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cli/init/codex-adapter.test.ts`
Expected: FAIL ("Cannot find module .../codex.js").

- [ ] **Step 3: Write `agents/codex.ts` (render + helpers; writeAll stub for now)**

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowDefinition } from '../workflow-definitions.js';
import type { AgentAdapter, AgentArtifact } from './types.js';
import { toCodex } from './transform.js';
import { OWS_AGENTS_BLOCK, mergeAgentsMd, AGENTS_MAX_BYTES } from './agents-md.js';

const INVOCATION = (name: string) =>
  `## Invocation\n\nImplicitly selected when your task matches the description above, ` +
  `or invoke it explicitly: mention \`$${name}\` inline, or pick \`${name}\` from \`/skills\`. ` +
  `This skill drives the \`ows\` CLI — run the commands below directly.\n\n`;

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;

  render(defs: WorkflowDefinition[]): AgentArtifact[] {
    const arts: AgentArtifact[] = defs.map((d) => ({
      path: `.agents/skills/${d.name}/SKILL.md`,
      contents: `---\nname: ${d.name}\ndescription: ${toCodex(d.description)}\n---\n\n${INVOCATION(d.name)}${toCodex(d.body)}\n`,
    }));
    arts.push({ path: 'AGENTS.md', contents: OWS_AGENTS_BLOCK });
    return arts;
  }

  writeAll(_projectPath: string, _defs: WorkflowDefinition[], _warnings?: string[]): string[] {
    throw new Error('not implemented — Task 5');
  }
}
```

> `AGENTS.md` is emitted as a render artifact carrying ONLY the managed block; the
> `writeAll` step (Task 5) merges it into any existing file.

- [ ] **Step 4: Create a minimal `agents/agents-md.ts` stub so the import resolves**

```ts
export const AGENTS_MAX_BYTES = 32 * 1024;
export const OWS_AGENTS_BLOCK = '<!-- ows:begin -->\n<!-- ows:end -->\n'; // filled in Task 5
export function mergeAgentsMd(existing: string, _block: string): string { return existing; } // replaced in Task 5
```

- [ ] **Step 5: Run codex render test**

Run: `npx vitest run tests/cli/init/codex-adapter.test.ts`
Expected: PASS (render tests). The ANTI-LEAK test is the key gate.

- [ ] **Step 6: Commit**

```bash
git add src/cli/init/agents/codex.ts src/cli/init/agents/agents-md.ts tests/cli/init/codex-adapter.test.ts
git commit -m "feat: CodexAdapter skill rendering (.agents/skills/ows-*/SKILL.md)"
```

---

## Task 5: AGENTS.md managed block + idempotent merge + safeguards

**Files:**
- Modify: `src/cli/init/agents/agents-md.ts`
- Modify: `src/cli/init/agents/codex.ts` (implement `writeAll`)
- Create: `tests/cli/init/agents-md.test.ts`

- [ ] **Step 1: Write the merge test FIRST**

```ts
import { describe, it, expect } from 'vitest';
import { mergeAgentsMd, OWS_AGENTS_BLOCK, BEGIN, END } from '../../../src/cli/init/agents/agents-md.js';

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
    expect((out.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length).toBe(1);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cli/init/agents-md.test.ts`
Expected: FAIL (BEGIN/END not exported; block is a stub).

- [ ] **Step 3: Implement `agents/agents-md.ts`**

```ts
export const BEGIN = '<!-- ows:begin (managed by open-wiki-spec; edits inside this block are overwritten) -->';
export const END = '<!-- ows:end -->';
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
\`proposed → planned → in_progress → applied → (archived)\`. Use \`ows continue <id>\`
to advance, \`ows apply <id>\` to fold a Change into Feature notes, \`ows verify\` to
check consistency (4 dimensions), \`ows archive <id>\` when done.

### Skills (in \`.agents/skills/\`)
\`ows-propose\`, \`ows-continue\`, \`ows-apply\`, \`ows-verify\`, \`ows-query\`,
\`ows-status\`, \`ows-retrieve\`, \`ows-archive\`, \`ows-init\`, \`ows-explore\`,
\`ows-onboard\`, \`ows-migrate\`. Mention one inline as \`$ows-<name>\` or pick it
from \`/skills\`. Each skill drives the matching \`ows\` subcommand.

### Guardrails
Always \`--dry-run\` destructive/creative steps first. Never auto-resolve
\`needs_confirmation\` or \`stale_base\` — ask the user. Show \`ows\` JSON reasoning
(classification, scores) so decisions are explainable.
${END}
`;

/** Insert/replace the ows managed block in an AGENTS.md body. Pure. */
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
  // no block present: append after existing content + blank line
  return existing.replace(/\s*$/, '') + '\n\n' + normBlock;
}
```

- [ ] **Step 4: Run merge tests**

Run: `npx vitest run tests/cli/init/agents-md.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `CodexAdapter.writeAll` (skills + AGENTS.md merge + safeguards)**

Replace the stub `writeAll` in `agents/codex.ts`:

```ts
  writeAll(projectPath: string, defs: WorkflowDefinition[], warnings: string[] = []): string[] {
    const written: string[] = [];
    for (const art of this.render(defs)) {
      const abs = path.join(projectPath, art.path);
      if (art.path === 'AGENTS.md') {
        // safeguards
        if (fs.existsSync(path.join(projectPath, 'AGENTS.override.md'))) {
          warnings.push('AGENTS.override.md exists — Codex ignores the generated AGENTS.md while it is present.');
        }
        const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '';
        const merged = mergeAgentsMd(existing, art.contents);
        if (Buffer.byteLength(merged, 'utf8') > AGENTS_MAX_BYTES) {
          warnings.push(`AGENTS.md exceeds ${AGENTS_MAX_BYTES} bytes — Codex may truncate it.`);
        }
        if (merged !== existing) {
          if (existing) fs.writeFileSync(`${abs}.bak`, existing);
          fs.writeFileSync(abs, merged);
          written.push(abs);
        }
        continue;
      }
      // skill files
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.existsSync(abs)) {
        try {
          const cur = fs.readFileSync(abs, 'utf-8');
          if (cur !== art.contents) fs.writeFileSync(`${abs}.bak`, cur);
        } catch { /* best-effort */ }
      }
      fs.writeFileSync(abs, art.contents);
      written.push(abs);
    }
    return written;
  }
```

- [ ] **Step 6: Add a write/idempotency integration test to `codex-adapter.test.ts`**

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('CodexAdapter.writeAll', () => {
  it('writes skills + AGENTS.md, preserves user AGENTS.md content, idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-codex-'));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# House rules\n\nUse spaces.\n');
    const a = new CodexAdapter();
    const w1: string[] = []; a.writeAll(dir, WORKFLOW_DEFINITIONS, w1);
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
```

- [ ] **Step 7: Run codex tests**

Run: `npx vitest run tests/cli/init/codex-adapter.test.ts tests/cli/init/agents-md.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cli/init/agents/agents-md.ts src/cli/init/agents/codex.ts tests/cli/init/agents-md.test.ts tests/cli/init/codex-adapter.test.ts
git commit -m "feat: CodexAdapter AGENTS.md managed block + idempotent merge + safeguards"
```

---

## Task 6: detectAgents

**Files:**
- Create: `src/cli/init/agents/detect.ts`
- Create: `tests/cli/init/detect.test.ts`

- [ ] **Step 1: Write the detect test FIRST**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectAgents } from '../../../src/cli/init/agents/detect.js';

describe('detectAgents', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-detect-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('explicit claude/codex/both override scanning (hermetic)', () => {
    expect(detectAgents(dir, 'claude')).toEqual(['claude']);
    expect(detectAgents(dir, 'codex')).toEqual(['codex']);
    expect(detectAgents(dir, 'both')).toEqual(['claude', 'codex']);
  });

  it('detects claude from project .claude/ marker', () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    expect(detectAgents(dir, 'auto')).toEqual(['claude']);
  });

  it('detects codex from project AGENTS.md marker', () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# x');
    expect(detectAgents(dir, 'auto')).toEqual(['codex']);
  });

  it('detects both when both project markers present, stable order', () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.mkdirSync(path.join(dir, '.agents'));
    expect(detectAgents(dir, 'auto')).toEqual(['claude', 'codex']);
  });

  it('falls back to claude when no project markers and host signals disabled', () => {
    expect(detectAgents(dir, 'auto', { host: () => [] })).toEqual(['claude']);
  });

  it('uses host fallback only when no project markers', () => {
    expect(detectAgents(dir, 'auto', { host: () => ['codex'] })).toEqual(['codex']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cli/init/detect.test.ts`
Expected: FAIL ("Cannot find module .../detect.js").

- [ ] **Step 3: Write `agents/detect.ts`**

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentId, AgentSelector } from './types.js';

interface DetectDeps { host?: () => AgentId[]; }

function onPath(bin: string): boolean {
  try { execSync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function hostSignals(): AgentId[] {
  const out: AgentId[] = [];
  const home = os.homedir();
  if (fs.existsSync(path.join(home, '.claude')) || onPath('claude')) out.push('claude');
  if (fs.existsSync(path.join(home, '.codex')) || onPath('codex')) out.push('codex');
  return out;
}

const exists = (p: string) => fs.existsSync(p);

export function detectAgents(projectPath: string, explicit?: AgentSelector, deps: DetectDeps = {}): AgentId[] {
  if (explicit === 'claude') return ['claude'];
  if (explicit === 'codex') return ['codex'];
  if (explicit === 'both') return ['claude', 'codex'];

  const found: AgentId[] = [];
  const claudeMarker = exists(path.join(projectPath, '.claude')) ||
    exists(path.join(projectPath, 'CLAUDE.md')) || exists(path.join(projectPath, 'claude.md'));
  const codexMarker = exists(path.join(projectPath, '.codex')) ||
    exists(path.join(projectPath, '.agents')) || exists(path.join(projectPath, 'AGENTS.md'));
  if (claudeMarker) found.push('claude');
  if (codexMarker) found.push('codex');
  if (found.length) return found;

  const host = (deps.host ?? hostSignals)();
  const ordered = (['claude', 'codex'] as AgentId[]).filter((a) => host.includes(a));
  return ordered.length ? ordered : ['claude'];
}
```

- [ ] **Step 4: Run detect tests**

Run: `npx vitest run tests/cli/init/detect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/init/agents/detect.ts tests/cli/init/detect.test.ts
git commit -m "feat: detectAgents (project markers + host fallback + explicit override)"
```

---

## Task 7: Adapter registry + init-engine wiring + types

**Files:**
- Create: `src/cli/init/agents/index.ts`
- Modify: `src/cli/init/types.ts`, `src/cli/init/init-engine.ts`
- Modify: `tests/cli/init.test.ts` (pin to `agent:'claude'`)
- Create: `tests/cli/init/init-agents.test.ts`

- [ ] **Step 1: Write `agents/index.ts`**

```ts
import type { AgentAdapter, AgentId, AgentSelector } from './types.js';
import type { WorkflowDefinition } from '../workflow-definitions.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { detectAgents } from './detect.js';

export const ADAPTERS: Record<AgentId, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};

export interface RunAdaptersResult {
  agents: AgentId[];
  agentArtifacts: Record<string, string[]>;
  allFiles: string[];
  warnings: string[];
}

export function runAdapters(projectPath: string, defs: WorkflowDefinition[], explicit?: AgentSelector): RunAdaptersResult {
  const agents = detectAgents(projectPath, explicit);
  const agentArtifacts: Record<string, string[]> = {};
  const allFiles: string[] = [];
  const warnings: string[] = [];
  for (const id of agents) {
    const files = ADAPTERS[id].writeAll(projectPath, defs, warnings);
    agentArtifacts[id] = files;
    allFiles.push(...files);
  }
  return { agents, agentArtifacts, allFiles, warnings };
}

export { detectAgents };
```

- [ ] **Step 2: Update `src/cli/init/types.ts`**

Add to `InitOptions`:
```ts
  /** Which agent integration(s) to generate. Default: 'auto' (detect). */
  agent?: import('./agents/types.js').AgentSelector;
```
Add to `InitResult`:
```ts
  /** Agents that integration files were generated for. */
  agents: import('./agents/types.js').AgentId[];
  /** Files written per agent. */
  agentArtifacts: Record<string, string[]>;
```

- [ ] **Step 3: Wire `init-engine.ts`**

In both `initVault` (fresh) and `extendVault`, replace:
```ts
const skillFilesGenerated = writeAllSkillFiles(projectPath);
```
with:
```ts
import { runAdapters } from './agents/index.js';
import { WORKFLOW_DEFINITIONS } from './workflow-definitions.js';
// ...
const run = runAdapters(projectPath, WORKFLOW_DEFINITIONS, options.agent);
const skillFilesGenerated = run.allFiles;
```
And in the returned `InitResult` add `agents: run.agents, agentArtifacts: run.agentArtifacts`, and merge `run.warnings` into `warnings` (fresh mode: `warnings: run.warnings`; extend mode: `warnings.push(...run.warnings)`).
`extendVault` must accept `options` (or at least `options.agent`) — thread it through from `initVault`'s `extendVault(wikiPath, projectPath, options.skipSeed)` call → add an `agent` param.

- [ ] **Step 4: Pin existing init tests to claude (hermetic)**

In `tests/cli/init.test.ts`, change the two assertions that depend on exact Claude
output to pass `agent: 'claude'`:
```ts
// 'should generate Claude Code skill files'
const result = await initVault({ path: tempDir, agent: 'claude' });
// ... existing assertions unchanged
```
```ts
// 'should return correct InitResult structure'
const result = await initVault({ path: tempDir, agent: 'claude' });
expect(result.metaFilesCreated.length).toBe(4);
expect(result.agents).toEqual(['claude']);
```
Leave all other tests as-is (they assert vault dirs/meta/seed, agent-independent).

- [ ] **Step 5: Write integration test `init-agents.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initVault } from '../../../src/cli/init/init-engine.js';

const exists = (d: string, p: string) => fs.existsSync(path.join(d, p));

describe('initVault agent selection', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-initagents-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('agent:claude → only .claude/commands', async () => {
    const r = await initVault({ path: dir, agent: 'claude' });
    expect(r.agents).toEqual(['claude']);
    expect(exists(dir, '.claude/commands/ows-propose.md')).toBe(true);
    expect(exists(dir, '.agents/skills/ows-propose/SKILL.md')).toBe(false);
  });

  it('agent:codex → .agents/skills + AGENTS.md, no .claude', async () => {
    const r = await initVault({ path: dir, agent: 'codex' });
    expect(r.agents).toEqual(['codex']);
    expect(exists(dir, '.agents/skills/ows-propose/SKILL.md')).toBe(true);
    expect(exists(dir, 'AGENTS.md')).toBe(true);
    expect(exists(dir, '.claude/commands/ows-propose.md')).toBe(false);
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('ows --version');
  });

  it('agent:both → both trees, agentArtifacts keyed per agent', async () => {
    const r = await initVault({ path: dir, agent: 'both' });
    expect(r.agents).toEqual(['claude', 'codex']);
    expect(exists(dir, '.claude/commands/ows-verify.md')).toBe(true);
    expect(exists(dir, '.agents/skills/ows-verify/SKILL.md')).toBe(true);
    expect(r.agentArtifacts.claude.length).toBe(12);
    expect(r.agentArtifacts.codex.length).toBeGreaterThanOrEqual(13); // 12 skills + AGENTS.md
  });

  it('extend mode regenerates for the selected agent', async () => {
    await initVault({ path: dir, agent: 'codex' });
    const r2 = await initVault({ path: dir, agent: 'codex' });
    expect(r2.mode).toBe('extend');
    expect(exists(dir, '.agents/skills/ows-apply/SKILL.md')).toBe(true);
  });
});
```

- [ ] **Step 6: Run the init suite + integration + golden**

Run: `npx vitest run tests/cli/init.test.ts tests/cli/init/`
Expected: PASS (all).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/cli/init/agents/index.ts src/cli/init/types.ts src/cli/init/init-engine.ts tests/cli/init.test.ts tests/cli/init/init-agents.test.ts
git commit -m "feat: wire agent adapters into init-engine (--agent selection)"
```

---

## Task 8: CLI `--agent` flag

**Files:**
- Modify: `src/cli/commands/init.ts`
- Create: `tests/cli/init-cli.test.ts`

- [ ] **Step 1: Write the CLI test FIRST**

```ts
import { describe, it, expect } from 'vitest';
import { createProgram } from '../../src/cli/index.js';

describe('ows init --agent', () => {
  it('rejects an invalid --agent value (exit code 2)', () => {
    const program = createProgram();
    program.exitOverride();
    expect(() => program.parse(['node', 'ows', 'init', '/tmp/x', '--agent', 'bogus'])).toThrow();
  });
  it('accepts claude|codex|both|auto', () => {
    for (const v of ['claude', 'codex', 'both', 'auto']) {
      const program = createProgram();
      program.exitOverride();
      // parse only validates the option; action is async and not awaited here.
      expect(() => program.parseOptions(['init', '/tmp/x', '--agent', v])).not.toThrow();
    }
  });
});
```

> If `createProgram` is not currently exported, export it from `src/cli/index.ts`
> (it is defined there). Use Commander's `.choices(['claude','codex','both','auto'])`
> on the option so invalid values produce a parse error (exit 2).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cli/init-cli.test.ts`
Expected: FAIL (no `--agent` option / no validation yet).

- [ ] **Step 3: Add the flag in `src/cli/commands/init.ts`**

Add the option (after `--skip-seed`):
```ts
    .option('--agent <agent>', 'Agent integration to generate: claude, codex, both, or auto', 'auto')
```
Pass it through and validate:
```ts
.action(async (targetPath, opts: { force?: boolean; skipSeed?: boolean; json?: boolean; agent?: string }) => {
  const VALID = ['claude', 'codex', 'both', 'auto'];
  if (opts.agent && !VALID.includes(opts.agent)) {
    // Commander usage error → exit 2
    throw new (await import('commander')).InvalidOptionArgumentError(`--agent must be one of ${VALID.join(', ')}`);
  }
  const result = await initVault({ path: targetPath, force: opts.force, skipSeed: opts.skipSeed, agent: opts.agent as any });
  // ...
```
> Prefer `.choices(['claude','codex','both','auto'])` on the option if available in
> the installed Commander v12 (it is) — that yields exit 2 automatically and you can
> drop the manual check.

Update the human-readable output to report agents:
```ts
console.log(`  Agents: ${result.agents.join(', ')}`);
for (const id of result.agents) {
  console.log(`    ${id}: ${result.agentArtifacts[id]?.length ?? 0} files`);
}
```

- [ ] **Step 4: Run CLI test + ensure full init still green**

Run: `npx vitest run tests/cli/init-cli.test.ts tests/cli/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/init.ts tests/cli/init-cli.test.ts
git commit -m "feat: ows init --agent claude|codex|both|auto flag"
```

---

## Task 9: Docs + version bump

**Files:**
- Modify: `README.md`, `overview.md`, `CHANGELOG.md`, `package.json`

- [ ] **Step 1: README — flip the Codex wishlist + add Codex docs**

- In "Areas where help is especially welcome", change
  `- **Additional agent runtime support** — Cursor, Codex, Gemini CLI adapters`
  to `- **Additional agent runtime support** — Cursor, Gemini CLI adapters (Codex shipped in 0.4.0)`.
- Under the `ows init` section, replace the sentence
  "`ows init` creates the vault structure and generates 12 Claude Code skill files (`.claude/commands/ows-*.md`)…"
  with text describing auto-detection + `--agent`:
  ```markdown
  `ows init` creates the vault structure and generates agent integration files for
  whichever agent(s) it detects (override with `--agent claude|codex|both|auto`):

  - **Claude Code** → 12 slash commands in `.claude/commands/ows-*.md`
  - **Codex** → 12 skills in `.agents/skills/ows-*/SKILL.md` + an `AGENTS.md` managed block

  Detection looks for project markers (`.claude/`, `CLAUDE.md` → Claude;
  `.codex/`, `.agents/`, `AGENTS.md` → Codex), falling back to whichever agent is
  installed on your machine, then to Claude.
  ```
- Add a short "### Codex support" subsection near "CLI commands" summarizing the same.

- [ ] **Step 2: overview.md §9.4 addendum**

Append to the "v1 Product Scope: Claude Code Only" section (do NOT rewrite the
existing text — add an addendum paragraph):
```markdown
> **Addendum (v0.4.0):** The v1 Claude-Code-only scope was intentional for initial
> hardening. As of v0.4.0, the init layer is an agent-neutral adapter architecture
> and Codex is a first-class target — `ows init --agent codex|both` generates Codex
> skills (`.agents/skills/ows-*/SKILL.md`) and an `AGENTS.md` managed block. The
> retrieval/workflow contract is unchanged; only the delivery layer is per-agent.
```

- [ ] **Step 3: CHANGELOG.md — add 0.4.0 entry at the top**

```markdown
## 0.4.0

### Added
- **Codex compatibility.** `ows init` now generates OpenAI Codex integration:
  `.agents/skills/ows-*/SKILL.md` skills plus an idempotent `AGENTS.md` managed block.
- `ows init --agent claude|codex|both|auto` selector. Default `auto` detects which
  agent(s) a project/host uses; backward-compatible (Claude-only projects unchanged).

### Changed
- Refactored the init delivery layer into an agent-neutral adapter pattern
  (`WORKFLOW_DEFINITIONS` + `ClaudeAdapter`/`CodexAdapter`). Claude output is
  byte-identical to 0.3.x.
```

- [ ] **Step 4: package.json — bump version + keyword**

- `"version": "0.3.1"` → `"version": "0.4.0"`.
- Add `"codex"` to the `keywords` array (after `"claude"`).

- [ ] **Step 5: Build + full test suite**

Run: `npm run typecheck && npm run build && npx vitest run`
Expected: typecheck clean, build clean, ALL tests pass (≥805 + new).

- [ ] **Step 6: Commit**

```bash
git add README.md overview.md CHANGELOG.md package.json
git commit -m "docs: document Codex support; bump 0.4.0"
```

---

## Task 10: End-to-end verification + Codex final gate

**Files:** none (verification only)

- [ ] **Step 1: Re-confirm Claude byte-identity**

Run:
```bash
npm run build >/dev/null 2>&1
TMP=$(mktemp -d); node ./bin/open-wiki-spec.js init "$TMP" --agent claude >/dev/null 2>&1
(cd "$TMP/.claude/commands" && cat $(ls | sort) | shasum -a 256); rm -rf "$TMP"
```
Expected: `0630d58272d5f672a806b170e215ccbf52d5f39339ac7b6081ed0ce92ee1a7bd`.

- [ ] **Step 2: Smoke-test Codex output shape + anti-leak**

Run:
```bash
TMP=$(mktemp -d); node ./bin/open-wiki-spec.js init "$TMP" --agent both >/dev/null 2>&1
ls "$TMP/.agents/skills" | wc -l                       # expect 12
test -f "$TMP/AGENTS.md" && echo "AGENTS.md OK"
grep -rl '/ows-' "$TMP/.agents/skills" && echo "LEAK!" || echo "no /ows- leak"
grep -rl 'Claude' "$TMP/.agents/skills" "$TMP/AGENTS.md" && echo "LEAK!" || echo "no Claude leak"
wc -c "$TMP/AGENTS.md"                                  # expect < 32768
rm -rf "$TMP"
```
Expected: 12 skills, AGENTS.md OK, "no /ows- leak", "no Claude leak", size < 32768.

- [ ] **Step 3: Idempotent re-init**

Run:
```bash
TMP=$(mktemp -d); node ./bin/open-wiki-spec.js init "$TMP" --agent codex >/dev/null 2>&1
A=$(shasum -a 256 "$TMP/AGENTS.md"); node ./bin/open-wiki-spec.js init "$TMP" --agent codex >/dev/null 2>&1
B=$(shasum -a 256 "$TMP/AGENTS.md"); [ "$A" = "$B" ] && echo "idempotent" || echo "NOT idempotent"; rm -rf "$TMP"
```
Expected: "idempotent".

- [ ] **Step 4: Codex final verification gate**

Dispatch `codex-rescue` (foreground, English, xhigh) with the full diff
(`git diff main...feat/codex-compat`) and ask it to adversarially verify: correct
`.agents/skills` layout, valid SKILL.md frontmatter, AGENTS.md safety, zero Claude
leakage, no regression risk. Fold in any confirmed findings; re-run the suite.

- [ ] **Step 5: Manual Codex runtime check (document result)**

In a temp vault initialized with `--agent codex`, start a real Codex session and
confirm `ows-propose` is discoverable (`$` picker / implicit) and `ows --version`
runs. Record the outcome in the PR description.

- [ ] **Step 6: Finishing**

Invoke `superpowers:finishing-a-development-branch` to choose merge/PR/cleanup.
Default: open a PR from `feat/codex-compat` to the repo default branch.

---

## Self-Review (completed by plan author)

- **Spec coverage:** adapter pattern (T2–T7), Codex skills (T4), AGENTS.md block +
  safeguards (T5), detect/auto (T6), `--agent` (T8), docs/version (T9), byte-identity
  (T1/T3/T10), anti-leak (T3/T4/T10), Codex gates (spec done; T10 final). ✓
- **Placeholders:** none — every code/test step has concrete content. The only
  "copy verbatim" instruction (T2 bodies) is a deliberate move-without-edit and is
  guarded by the golden test + set-SHA. ✓
- **Type consistency:** `AgentAdapter.writeAll(projectPath, defs, warnings?)` used
  consistently (claude.ts, codex.ts, index.ts, back-compat shim). `WorkflowDefinition`
  fields `{key,name,description,body}` consistent across T2–T7. `detectAgents(path,
  explicit?, deps?)` consistent T6/T7. ✓
```
