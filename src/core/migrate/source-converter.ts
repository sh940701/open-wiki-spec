/**
 * Converts OpenSpec config.yaml context into an open-wiki-spec Source note.
 * Rich config contexts (project architecture, stack, conventions) become
 * project-context Source notes for reference.
 */
import * as path from 'node:path';
import type { OpenSpecConfig, ConversionResult } from './types.js';

/**
 * Convert the config.yaml context field into a Source note.
 */
export function convertConfigToSource(
  context: string,
  config: OpenSpecConfig,
): ConversionResult {
  const id = 'project-context';
  const rulesBlock = config.rules ? formatRules(config.rules) : '';

  const content = `---
type: source
id: ${id}
status: active
source_type: other
tags:
  - source
  - migrated
  - project-context
---

# Source: Project Context

## Summary

Project context and conventions migrated from OpenSpec config.yaml.

## Key Points

${context.trim()}

${rulesBlock ? `## OpenSpec Rules\n\n${rulesBlock}` : ''}

## Related Notes
`;

  return {
    targetPath: path.join('wiki', '01-sources', `${id}.md`),
    content,
    sourceDescription: 'openspec/config.yaml (context field)',
  };
}

function formatRules(rules: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(rules)) {
    lines.push(`### ${key}`);
    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push(`- ${item}`);
      }
    } else if (typeof value === 'string') {
      lines.push(value);
    } else {
      lines.push(String(value));
    }
    lines.push('');
  }
  return lines.join('\n');
}
