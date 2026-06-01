import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProgram } from '../../src/cli/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function initCommand() {
  const program = createProgram();
  return program.commands.find((c) => c.name() === 'init')!;
}

describe('ows init --agent option', () => {
  it('registers --agent with the four allowed choices and default auto', () => {
    const cmd = initCommand();
    const opt = (cmd.options as Array<{ long?: string; argChoices?: string[]; defaultValue?: unknown }>)
      .find((o) => o.long === '--agent');
    expect(opt).toBeTruthy();
    expect(opt!.argChoices).toEqual(['claude', 'codex', 'both', 'auto']);
    expect(opt!.defaultValue).toBe('auto');
  });

  it('rejects an invalid --agent value before running the action', () => {
    const program = createProgram();
    program.exitOverride();
    const init = program.commands.find((c) => c.name() === 'init')!;
    init.exitOverride();
    init.configureOutput({ writeErr: () => {}, write: () => {} });
    let thrown: any;
    try {
      program.parse(['node', 'ows', 'init', '/tmp/ows-x', '--agent', 'bogus']);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    expect(thrown.code).toBe('commander.invalidArgument');
    expect(String(thrown.message)).toContain('claude, codex, both, auto');
  });

  it('accepts each valid --agent value at the option layer', () => {
    const cmd = initCommand();
    const opt = (cmd.options as Array<{ long?: string; argChoices?: string[] }>).find((o) => o.long === '--agent')!;
    for (const v of ['claude', 'codex', 'both', 'auto']) {
      expect(opt.argChoices).toContain(v);
    }
  });

  it('--json output envelope includes agents and agentArtifacts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-initjson-'));
    const program = createProgram();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    try {
      await program.parseAsync(['node', 'ows', 'init', dir, '--agent', 'codex', '--json']);
    } finally {
      spy.mockRestore();
    }
    const jsonLine = logs.find((l) => l.trim().startsWith('{'));
    expect(jsonLine, 'no JSON envelope on stdout').toBeTruthy();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('init');
    expect(Array.isArray(parsed.data.agents)).toBe(true);
    expect(parsed.data.agents).toContain('codex');
    expect(Array.isArray(parsed.data.agentArtifacts.codex)).toBe(true);
    expect(parsed.data.agentArtifacts.codex.length).toBeGreaterThanOrEqual(13);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('ows init — real subprocess (built bin)', () => {
  const bin = path.join(REPO_ROOT, 'bin', 'open-wiki-spec.js');

  beforeAll(() => {
    // The bin runs the compiled dist; always rebuild so a stale dist can't pass.
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'ignore' });
  }, 120_000);

  it('`ows init --agent codex --json` exits 0 and emits a valid envelope on real stdout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-subproc-'));
    let stdout = '';
    let exitCode = 0;
    try {
      stdout = execFileSync(process.execPath, [bin, 'init', dir, '--agent', 'codex', '--json'], {
        encoding: 'utf-8',
      });
    } catch (e: any) {
      exitCode = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    expect(exitCode, `stderr/stdout: ${stdout}`).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('init');
    expect(parsed.data.agents).toContain('codex');
    expect(Array.isArray(parsed.data.agentArtifacts.codex)).toBe(true);
    // the real filesystem effect happened too
    expect(fs.existsSync(path.join(dir, '.agents', 'skills', 'ows-propose', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('`ows init --agent bogus` exits non-zero and writes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-subproc-bad-'));
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [bin, 'init', dir, '--agent', 'bogus'], { encoding: 'utf-8' });
    } catch (e: any) {
      exitCode = e.status ?? 1;
      stderr = String(e.stderr ?? '');
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/claude, codex, both, auto/);
    // the bad invocation did not scaffold a vault
    expect(fs.existsSync(path.join(dir, 'wiki'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
