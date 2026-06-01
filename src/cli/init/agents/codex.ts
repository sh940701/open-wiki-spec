import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowDefinition } from '../workflow-definitions.js';
import type { AgentAdapter, AgentArtifact } from './types.js';
import { toCodex } from './transform.js';
import { OWS_AGENTS_BLOCK, mergeAgentsMd, AGENTS_MAX_BYTES } from './agents-md.js';

/** The `## Invocation` header prepended to every Codex skill body. Exported so tests
 *  can assert each skill's full content by identity. */
export function invocationSection(name: string): string {
  const mention = '`$' + name + '`'; // e.g. `$ows-propose`
  return (
    `## Invocation\n\nImplicitly selected when your task matches the description above, ` +
    `or invoke it explicitly: mention ${mention} inline, or pick \`${name}\` from \`/skills\`. ` +
    `This skill drives the \`ows\` CLI - run the commands below directly.\n\n`
  );
}

/**
 * Renders ows workflows as OpenAI Codex skills under `.agents/skills/ows-<key>/`
 * (one `SKILL.md` each) and maintains an idempotent ows block in `AGENTS.md`.
 */
export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;

  render(defs: WorkflowDefinition[]): AgentArtifact[] {
    const arts: AgentArtifact[] = defs.map((d) => ({
      path: `.agents/skills/${d.name}/SKILL.md`,
      contents: `---\nname: ${d.name}\ndescription: ${toCodex(d.description)}\n---\n\n${invocationSection(d.name)}${toCodex(d.body)}\n`,
    }));
    // AGENTS.md artifact carries ONLY the managed block; writeAll merges it.
    arts.push({ path: 'AGENTS.md', contents: OWS_AGENTS_BLOCK });
    return arts;
  }

  writeAll(projectPath: string, defs: WorkflowDefinition[], warnings: string[] = []): string[] {
    const written: string[] = [];
    for (const art of this.render(defs)) {
      const abs = path.join(projectPath, art.path);

      if (art.path === 'AGENTS.md') {
        // Safeguard: AGENTS.override.md fully supersedes AGENTS.md in Codex.
        if (fs.existsSync(path.join(projectPath, 'AGENTS.override.md'))) {
          warnings.push(
            'AGENTS.override.md exists — Codex ignores the generated AGENTS.md while it is present.',
          );
        }
        const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '';
        const merged = mergeAgentsMd(existing, art.contents);
        if (Buffer.byteLength(merged, 'utf8') > AGENTS_MAX_BYTES) {
          warnings.push(
            `AGENTS.md exceeds ${AGENTS_MAX_BYTES} bytes — Codex may truncate it.`,
          );
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
        } catch {
          // best-effort backup
        }
      }
      fs.writeFileSync(abs, art.contents);
      written.push(abs);
    }
    return written;
  }
}
