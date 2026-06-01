import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentId, AgentSelector } from './types.js';

export interface DetectDeps {
  /** Host-level signal provider (injectable for tests). */
  host?: () => AgentId[];
}

function onPath(bin: string): boolean {
  try {
    execSync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Default host signals: agent home dir present OR agent binary on PATH. */
function hostSignals(): AgentId[] {
  const out: AgentId[] = [];
  const home = os.homedir();
  if (fs.existsSync(path.join(home, '.claude')) || onPath('claude')) out.push('claude');
  if (fs.existsSync(path.join(home, '.codex')) || onPath('codex')) out.push('codex');
  return out;
}

const exists = (p: string): boolean => fs.existsSync(p);

/**
 * Decide which agent integration(s) to generate.
 *
 * - explicit `claude`/`codex`/`both` → deterministic, no scan (hermetic).
 * - `auto`/undefined → project markers first, then host signals, then `['claude']`.
 *
 * Always returns a de-duped, stable-ordered, non-empty list.
 */
export function detectAgents(projectPath: string, explicit?: AgentSelector, deps: DetectDeps = {}): AgentId[] {
  if (explicit === 'claude') return ['claude'];
  if (explicit === 'codex') return ['codex'];
  if (explicit === 'both') return ['claude', 'codex'];

  const found: AgentId[] = [];
  const claudeMarker =
    exists(path.join(projectPath, '.claude')) ||
    exists(path.join(projectPath, 'CLAUDE.md')) ||
    exists(path.join(projectPath, 'claude.md'));
  const codexMarker =
    exists(path.join(projectPath, '.codex')) ||
    exists(path.join(projectPath, '.agents')) ||
    exists(path.join(projectPath, 'AGENTS.md'));
  if (claudeMarker) found.push('claude');
  if (codexMarker) found.push('codex');
  if (found.length) return found;

  const host = (deps.host ?? hostSignals)();
  const ordered = (['claude', 'codex'] as AgentId[]).filter((a) => host.includes(a));
  return ordered.length ? ordered : ['claude'];
}
