/**
 * Back-compat shim.
 *
 * Workflow content now lives in `workflow-definitions.ts` and is rendered by
 * pluggable agent adapters (`agents/`). These exports are preserved so existing
 * callers and tests keep working; new code should use `WORKFLOW_DEFINITIONS` and
 * the agent adapters directly.
 */
import type { SkillDefinition } from './types.js';
import { WORKFLOW_DEFINITIONS } from './workflow-definitions.js';
import { ClaudeAdapter } from './agents/claude.js';

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
