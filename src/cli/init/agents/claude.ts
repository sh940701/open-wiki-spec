import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowDefinition } from '../workflow-definitions.js';
import type { AgentAdapter, AgentArtifact } from './types.js';
import { toClaude } from './transform.js';

/**
 * Renders ows workflows as Claude Code slash commands at `.claude/commands/ows-*.md`.
 * Output is byte-identical to historical releases (transform is identity).
 */
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
      // If an existing file was customized, back it up before overwriting.
      if (fs.existsSync(abs)) {
        try {
          const existing = fs.readFileSync(abs, 'utf-8');
          if (existing !== art.contents) fs.writeFileSync(`${abs}.bak`, existing);
        } catch {
          // best-effort backup — don't block init if read fails
        }
      }
      fs.writeFileSync(abs, art.contents);
      written.push(abs);
    }
    return written;
  }
}
