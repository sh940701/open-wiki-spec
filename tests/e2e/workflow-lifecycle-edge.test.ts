/**
 * E2E tests: workflow lifecycle edge cases.
 *
 * Tests edge cases for apply, continue, verify, archive, and security
 * using real file I/O against temporary vaults.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildIndex } from '../../src/core/index/index.js';
import { applyChange } from '../../src/core/workflow/apply/apply.js';
import { continueChange } from '../../src/core/workflow/continue/continue.js';
import { verify } from '../../src/core/workflow/verify/verify.js';
import { archiveChange } from '../../src/cli/commands/archive.js';
import { parseNote } from '../../src/core/parser/note-parser.js';
import { computeRequirementHash } from '../../src/core/workflow/apply/stale-checker.js';
import { analyzeSequencing } from '../../src/core/sequencing/analyze.js';
import { assertInsideVault } from '../../src/utils/path-safety.js';
import type { ApplyDeps } from '../../src/core/workflow/apply/types.js';
import type { ContinueDeps } from '../../src/core/workflow/continue/types.js';

// ── Shared helpers ──

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function makeApplyDeps(vaultRoot: string): ApplyDeps {
  return {
    parseNote: (filePath: string) => {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      return parseNote(absPath);
    },
    readFile: (filePath: string) => {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      return fs.readFileSync(absPath, 'utf-8');
    },
    writeFile: (filePath: string, content: string) => {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      fs.writeFileSync(absPath, content);
    },
    fileExists: (filePath: string) => {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      return fs.existsSync(absPath);
    },
    moveFile: (from: string, to: string) => {
      const absFrom = path.isAbsolute(from) ? from : path.join(vaultRoot, from);
      const absTo = path.isAbsolute(to) ? to : path.join(vaultRoot, to);
      fs.mkdirSync(path.dirname(absTo), { recursive: true });
      fs.renameSync(absFrom, absTo);
    },
    ensureDir: (dirPath: string) => {
      const absDir = path.isAbsolute(dirPath) ? dirPath : path.join(vaultRoot, dirPath);
      fs.mkdirSync(absDir, { recursive: true });
    },
    deleteFile: (filePath: string) => {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      fs.unlinkSync(absPath);
    },
  };
}

function makeContinueDeps(vaultRoot: string): ContinueDeps {
  return {
    analyzeSequencing: (records) => analyzeSequencing(records),
    parseNote: (filePath: string) => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      return parseNote(resolved);
    },
    writeFile: (filePath: string, content: string) => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      fs.writeFileSync(resolved, content, 'utf-8');
    },
    readFile: (filePath: string) => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      return fs.readFileSync(resolved, 'utf-8');
    },
  };
}

/**
 * Create a standard vault structure with a system, feature (2 requirements),
 * schema.md, and log.md.
 */
function createStandardVault(wikiPath: string): void {
  // Directories
  const dirs = [
    '00-meta', '01-sources', '02-systems', '03-features',
    '04-changes', '05-decisions', '06-queries', '99-archive',
  ];
  for (const d of dirs) {
    fs.mkdirSync(path.join(wikiPath, d), { recursive: true });
  }

  // schema.md
  writeFile(
    path.join(wikiPath, '00-meta', 'schema.md'),
    `---
type: meta
schema_version: "2026-04-06-v1"
---

# Vault Schema
`,
  );

  // log.md
  writeFile(
    path.join(wikiPath, '00-meta', 'log.md'),
    `---
type: meta
---

# Vault Operation Log

| Date | Operation | Target | Agent |
|------|-----------|--------|-------|
| 2026-04-06 | init | vault | ows |
`,
  );

  // System
  writeFile(
    path.join(wikiPath, '02-systems', 'auth-system.md'),
    `---
type: system
id: auth-system
status: active
---

# System: Auth System

## Overview

Authentication subsystem.

## Boundaries

Login and session management.

## Key Components

- Login controller
- Session manager

## Interfaces

- REST API
`,
  );

  // Feature with 3 requirements
  writeFile(
    path.join(wikiPath, '03-features', 'user-auth.md'),
    `---
type: feature
id: user-auth
status: active
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
changes: []
---

# Feature: User Auth

## Purpose

User authentication via password login.

## Current Behavior

Users log in with email and password. JWT tokens manage sessions.

## Constraints

- Must rate limit login attempts.

## Known Gaps

- No OAuth support.

## Requirements

### Requirement: Password Login

The system SHALL allow users to authenticate using email and password.

#### Scenario: Successful login

WHEN a user submits valid email and password
THEN the system returns a JWT token

### Requirement: Session Management

The system MUST issue JWT tokens with a maximum lifetime of 24 hours.

#### Scenario: Token expiry

WHEN a JWT token is older than 24 hours
THEN the system rejects the token

### Requirement: Rate Limiting

The system SHALL limit login attempts to 5 per minute per IP.

#### Scenario: Rate limit exceeded

WHEN a user exceeds 5 login attempts per minute
THEN the system returns HTTP 429
`,
  );
}

/**
 * Create a standard in_progress change note ready for apply.
 */
function createInProgressChange(
  wikiPath: string,
  id: string,
  deltaSummary: string,
  opts?: { tasks?: string },
): void {
  const tasks = opts?.tasks ?? '- [x] Done';
  writeFile(
    path.join(wikiPath, '04-changes', `${id}.md`),
    `---
type: change
id: ${id}
status: in_progress
created_at: "2026-04-02"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: ${id}

## Why

Testing edge case.

## Delta Summary

${deltaSummary}

## Proposed Update

Testing.

## Impact

- None.

## Tasks

${tasks}

## Validation

- Test passes
`,
  );
}

// =====================================================================
// Group 1: Apply edge cases
// =====================================================================
describe('Group 1: Apply edge cases', () => {
  let tempDir: string;
  let vaultRoot: string;
  let wikiPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-edge-1-'));
    vaultRoot = tempDir;
    wikiPath = path.join(vaultRoot, 'wiki');
    createStandardVault(wikiPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 1: Apply with RENAMED requirement
  it('should rename a requirement heading in the Feature file', () => {
    const index1 = buildIndex(vaultRoot);
    const feat = index1.records.get('user-auth')!;
    const loginReq = feat.requirements.find(r => r.name === 'Password Login')!;
    const baseHash = computeRequirementHash(loginReq);

    createInProgressChange(
      wikiPath,
      'rename-req',
      `- RENAMED requirement "Password Login" to "Email Password Auth" in [[Feature: User Auth]] [base: ${baseHash}]`,
    );

    const index = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const result = applyChange({ changeId: 'rename-req', vaultRoot }, index, deps);

    expect(result.success).toBe(true);
    expect(result.statusTransitioned).toBe(true);

    const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
    expect(featureContent).toContain('### Requirement: Email Password Auth');
    expect(featureContent).not.toContain('### Requirement: Password Login');
    // Other requirements preserved
    expect(featureContent).toContain('### Requirement: Session Management');
    expect(featureContent).toContain('### Requirement: Rate Limiting');
  });

  // Test 2: Apply with REMOVED requirement (3 requirements -> 2 preserved)
  it('should remove one requirement and preserve the other two', () => {
    const index1 = buildIndex(vaultRoot);
    const feat = index1.records.get('user-auth')!;
    const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
    const baseHash = computeRequirementHash(sessionReq);

    createInProgressChange(
      wikiPath,
      'remove-one',
      `- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]`,
    );

    const index = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const result = applyChange({ changeId: 'remove-one', vaultRoot }, index, deps);

    expect(result.success).toBe(true);

    const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
    expect(featureContent).not.toContain('### Requirement: Session Management');
    expect(featureContent).not.toContain('Token expiry');
    // The other 2 requirements preserved
    expect(featureContent).toContain('### Requirement: Password Login');
    expect(featureContent).toContain('### Requirement: Rate Limiting');
  });

  // Test 3: Apply with multiple operations (RENAMED + REMOVED + ADDED) — atomic order
  it('should apply RENAMED first, then REMOVED, then ADDED in atomic order', () => {
    const index1 = buildIndex(vaultRoot);
    const feat = index1.records.get('user-auth')!;
    const loginReq = feat.requirements.find(r => r.name === 'Password Login')!;
    const rateReq = feat.requirements.find(r => r.name === 'Rate Limiting')!;
    const loginHash = computeRequirementHash(loginReq);
    const rateHash = computeRequirementHash(rateReq);

    createInProgressChange(
      wikiPath,
      'multi-ops',
      [
        `- RENAMED requirement "Password Login" to "Email Auth" in [[Feature: User Auth]] [base: ${loginHash}]`,
        `- REMOVED requirement "Rate Limiting" from [[Feature: User Auth]] [base: ${rateHash}]`,
        `- ADDED requirement "OAuth Login" to [[Feature: User Auth]]`,
      ].join('\n'),
    );

    const index = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const result = applyChange({ changeId: 'multi-ops', vaultRoot }, index, deps);

    expect(result.success).toBe(true);

    // ADDED is agent-driven, so pendingAgentOps should contain it
    expect(result.pendingAgentOps).toHaveLength(1);
    expect(result.pendingAgentOps[0].entry.op).toBe('ADDED');

    const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
    // RENAMED happened
    expect(featureContent).toContain('### Requirement: Email Auth');
    expect(featureContent).not.toContain('### Requirement: Password Login');
    // REMOVED happened
    expect(featureContent).not.toContain('### Requirement: Rate Limiting');
    // ADDED skeleton inserted
    expect(featureContent).toContain('### Requirement: OAuth Login');
    // Session Management untouched
    expect(featureContent).toContain('### Requirement: Session Management');
  });

  // Test 4: Apply stale detection
  it('should detect stale base when Feature was modified after Change was written', () => {
    createInProgressChange(
      wikiPath,
      'stale-test',
      '- MODIFIED requirement "Password Login" in [[Feature: User Auth]] [base: sha256:0000000000000000000000000000000000000000000000000000000000000000]',
    );

    const index = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const result = applyChange({ changeId: 'stale-test', vaultRoot }, index, deps);

    expect(result.success).toBe(false);
    expect(result.staleReport.blocked).toBe(true);
    expect(result.errors.some(e => e.includes('STALE'))).toBe(true);
  });

  // Test 5: Apply lockfile prevents concurrent apply
  it('should reject apply when lock file exists (another apply in progress)', () => {
    const index1 = buildIndex(vaultRoot);
    const feat = index1.records.get('user-auth')!;
    const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
    const baseHash = computeRequirementHash(sessionReq);

    createInProgressChange(
      wikiPath,
      'lock-test',
      `- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]`,
    );

    // Manually create a lock file with current PID and recent timestamp
    const lockPath = path.join(wikiPath, '.ows-lock');
    const lockContent = JSON.stringify({
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(lockPath, lockContent);

    const index = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const result = applyChange({ changeId: 'lock-test', vaultRoot }, index, deps);

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('another apply') || e.includes('in progress') || e.includes('.ows-lock'))).toBe(true);

    // Cleanup lock
    fs.unlinkSync(lockPath);
  });

  // Test 6: Apply --no-auto-transition with pendingAgentOps
  it('should stay in_progress with noAutoTransition when there are pending agent ops', () => {
    createInProgressChange(
      wikiPath,
      'no-auto-transition',
      '- ADDED requirement "New Feature" to [[Feature: User Auth]]',
    );

    const index = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const result = applyChange(
      { changeId: 'no-auto-transition', vaultRoot, noAutoTransition: true },
      index,
      deps,
    );

    expect(result.success).toBe(true);
    expect(result.pendingAgentOps).toHaveLength(1);
    // Status should NOT have transitioned to applied
    expect(result.statusTransitioned).toBe(false);

    // Verify on disk: status should still be in_progress
    const changeContent = readFile(path.join(wikiPath, '04-changes', 'no-auto-transition.md'));
    expect(changeContent).toContain('status: in_progress');
  });

  // Test 7: Apply with section op should hard-fail
  it('should reject delta with section-level operation', () => {
    createInProgressChange(
      wikiPath,
      'section-op-test',
      '- MODIFIED section "Current Behavior" in [[Feature: User Auth]]',
    );

    const index = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const result = applyChange({ changeId: 'section-op-test', vaultRoot }, index, deps);

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('section-level') || e.includes('not yet supported'))).toBe(true);
  });
});

// =====================================================================
// Group 2: Continue edge cases
// =====================================================================
describe('Group 2: Continue edge cases', () => {
  let tempDir: string;
  let vaultRoot: string;
  let wikiPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-edge-2-'));
    vaultRoot = tempDir;
    wikiPath = path.join(vaultRoot, 'wiki');
    createStandardVault(wikiPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 8: Continue --dry-run
  it('should not write files or transition status with dryRun', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'dry-run-test.md'),
      `---
type: change
id: dry-run-test
status: proposed
created_at: "2026-04-02"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Dry Run Test

## Why

Testing dry run.

## Delta Summary

- ADDED requirement "Dry Run Req" to [[Feature: User Auth]]

## Tasks

- [ ] Do stuff

## Validation

- Test passes
`,
    );

    const index = buildIndex(vaultRoot);
    const deps = makeContinueDeps(vaultRoot);
    const result = continueChange(index, deps, { changeName: 'dry-run-test', dryRun: true });

    // nextAction should be computed
    expect(result.nextAction).toBeDefined();
    expect(result.changeId).toBe('dry-run-test');

    // Status should NOT have changed on disk
    const content = readFile(path.join(wikiPath, '04-changes', 'dry-run-test.md'));
    expect(content).toContain('status: proposed');
  });

  // Test 9: Continue multiple active changes without explicit ID
  it('should error when multiple active changes exist and no changeId specified', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'change-a.md'),
      `---
type: change
id: change-a
status: proposed
created_at: "2026-04-02"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Change A

## Why

Testing.

## Delta Summary

- ADDED requirement "A" to [[Feature: User Auth]]

## Tasks

- [ ] Do A

## Validation

- Test
`,
    );

    writeFile(
      path.join(wikiPath, '04-changes', 'change-b.md'),
      `---
type: change
id: change-b
status: proposed
created_at: "2026-04-02"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Change B

## Why

Testing.

## Delta Summary

- ADDED requirement "B" to [[Feature: User Auth]]

## Tasks

- [ ] Do B

## Validation

- Test
`,
    );

    const index = buildIndex(vaultRoot);
    const deps = makeContinueDeps(vaultRoot);

    expect(() => continueChange(index, deps)).toThrow(/Multiple active changes/);
    // Error message should list both changes
    try {
      continueChange(index, deps);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('change-a');
      expect(message).toContain('change-b');
    }
  });

  // Test 10: Continue proposed -> planned transition
  it('should transition from proposed to planned when all required sections are filled', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'propose-to-planned.md'),
      `---
type: change
id: propose-to-planned
status: proposed
created_at: "2026-04-02"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Propose To Planned

## Why

We need this feature because users want OAuth.

## Delta Summary

- ADDED requirement "OAuth Login" to [[Feature: User Auth]]

## Tasks

- [ ] Implement OAuth flow
- [ ] Add tests

## Validation

Verify OAuth redirect works correctly with all providers.
`,
    );

    const index = buildIndex(vaultRoot);
    const deps = makeContinueDeps(vaultRoot);
    const result = continueChange(index, deps, { changeName: 'propose-to-planned' });

    // After transition proposed->planned, next action should reflect new state
    expect(result.currentStatus).toBe('planned');
    expect(result.nextAction.action).toBe('start_implementation');

    // Verify on disk
    const content = readFile(path.join(wikiPath, '04-changes', 'propose-to-planned.md'));
    expect(content).toContain('status: planned');
  });

  // Test 11: Continue planned -> in_progress
  it('should transition from planned to in_progress', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'planned-to-ip.md'),
      `---
type: change
id: planned-to-ip
status: planned
created_at: "2026-04-02"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Planned To In Progress

## Why

Need OAuth support.

## Delta Summary

- ADDED requirement "OAuth" to [[Feature: User Auth]]

## Tasks

- [ ] Implement OAuth
- [ ] Add tests

## Validation

Verify OAuth flow.
`,
    );

    const index = buildIndex(vaultRoot);
    const deps = makeContinueDeps(vaultRoot);
    const result = continueChange(index, deps, { changeName: 'planned-to-ip' });

    expect(result.currentStatus).toBe('in_progress');

    // Verify on disk
    const content = readFile(path.join(wikiPath, '04-changes', 'planned-to-ip.md'));
    expect(content).toContain('status: in_progress');
  });

  // Test 12: Continue in_progress with all tasks done -> ready_to_apply
  it('should return ready_to_apply when all tasks are checked', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'all-tasks-done.md'),
      `---
type: change
id: all-tasks-done
status: in_progress
created_at: "2026-04-02"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: All Tasks Done

## Why

Testing ready_to_apply.

## Delta Summary

- ADDED requirement "Complete Feature" to [[Feature: User Auth]]

## Tasks

- [x] Task 1
- [x] Task 2
- [x] Task 3

## Validation

All tests pass.
`,
    );

    const index = buildIndex(vaultRoot);
    const deps = makeContinueDeps(vaultRoot);
    const result = continueChange(index, deps, { changeName: 'all-tasks-done' });

    expect(result.currentStatus).toBe('in_progress');
    expect(result.nextAction.action).toBe('ready_to_apply');
  });
});

// =====================================================================
// Group 3: Verify edge cases
// =====================================================================
describe('Group 3: Verify edge cases', () => {
  let tempDir: string;
  let vaultRoot: string;
  let wikiPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-edge-3-'));
    vaultRoot = tempDir;
    wikiPath = path.join(vaultRoot, 'wiki');
    createStandardVault(wikiPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 13: Verify unfilled apply markers
  it('should detect unfilled apply markers in Feature after apply', () => {
    // Create a change with ADDED (which inserts markers into Feature)
    createInProgressChange(
      wikiPath,
      'unfilled-markers',
      '- ADDED requirement "New Req" to [[Feature: User Auth]]',
    );

    const index1 = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);

    // Apply with noAutoTransition to keep it from auto-transitioning
    // Actually, ADDED creates pendingAgentOps, so with noAutoTransition
    // it stays in_progress. We need to manually set to applied for verify check.
    const result = applyChange(
      { changeId: 'unfilled-markers', vaultRoot },
      index1,
      deps,
    );
    expect(result.success).toBe(true);

    // Apply inserts ADDED skeletons in the Feature but — per the updated
    // safety policy — does NOT auto-transition the Change to `applied`
    // while agent-driven markers remain unfilled. Confirm the warning
    // was surfaced and the Change stays in `in_progress` until the user
    // fills the markers and re-runs apply.
    expect(result.statusTransitioned).toBe(false);
    expect(
      result.warnings.some((w) => w.includes('Auto-transition to "applied" blocked')),
    ).toBe(true);
    const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
    expect(featureContent).toContain('<!-- ADDED by change:');

    // Rebuild index and confirm the Change is still in_progress (apply
    // guarded the transition). The old behavior transitioned to
    // `applied` and relied on `UNFILLED_APPLY_MARKER` to catch it
    // after the fact — the new behavior prevents the lie up front.
    const index2 = buildIndex(vaultRoot);
    const changeRec = index2.records.get('unfilled-markers');
    expect(changeRec).toBeDefined();
    expect(changeRec!.status).toBe('in_progress');
  });

  // Test 14: Verify empty required sections
  it('should detect empty required sections (heading present but no content)', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'empty-section.md'),
      `---
type: change
id: empty-section
status: proposed
created_at: "2026-04-05"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Empty Section

## Why

## Delta Summary

- ADDED requirement "X" to [[Feature: User Auth]]

## Tasks

- [ ] Do something

## Validation

Test
`,
    );

    const index = buildIndex(vaultRoot);
    const report = verify(index);

    const emptyIssues = report.issues.filter(i => i.code === 'EMPTY_REQUIRED_SECTION');
    expect(emptyIssues.length).toBeGreaterThan(0);
    // At least "Why" should be flagged
    expect(emptyIssues.some(i => i.message.includes('Why'))).toBe(true);
  });

  // Test 15: Verify broken wikilink
  it('should detect unresolved wikilink to non-existent note', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'broken-link.md'),
      `---
type: change
id: broken-link
status: proposed
created_at: "2026-04-05"
feature: "[[Feature: Non Existent Note]]"
depends_on: []
touches:
  - "[[Feature: Non Existent Note]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Broken Link

## Why

Testing broken wikilinks.

## Delta Summary

- ADDED requirement "Ghost" to [[Feature: Non Existent Note]]

## Tasks

- [ ] Nothing

## Validation

Nothing passes
`,
    );

    const index = buildIndex(vaultRoot);
    const report = verify(index);

    const unresolvedIssues = report.issues.filter(i => i.code === 'UNRESOLVED_WIKILINK');
    expect(unresolvedIssues.length).toBeGreaterThan(0);
    expect(report.pass).toBe(false);
  });

  // Test 16: Verify duplicate ID
  it('should detect duplicate ID across two notes', () => {
    // Create a second feature with the same id as user-auth
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth-duplicate.md'),
      `---
type: feature
id: user-auth
status: active
systems:
  - "[[System: Auth System]]"
---

# Feature: User Auth Duplicate

## Purpose

Duplicate.

## Current Behavior

None.

## Requirements

### Requirement: Dup Req

The system SHALL be duplicated.

#### Scenario: Dup

WHEN dup
THEN dup
`,
    );

    const index = buildIndex(vaultRoot);
    const report = verify(index);

    const dupIssues = report.issues.filter(i => i.code === 'DUPLICATE_ID');
    expect(dupIssues.length).toBeGreaterThan(0);
    expect(report.pass).toBe(false);
  });

  // Test 17: Verify empty file in typed folder
  it('should detect empty .md file in a typed folder', () => {
    // Create an empty file in 03-features/
    const emptyPath = path.join(wikiPath, '03-features', 'empty-feature.md');
    fs.writeFileSync(emptyPath, '');

    const index = buildIndex(vaultRoot);
    const report = verify(index);

    const emptyIssues = report.issues.filter(i => i.code === 'EMPTY_TYPED_NOTE');
    expect(emptyIssues.length).toBeGreaterThan(0);
    expect(emptyIssues.some(i => i.message.includes('empty-feature.md'))).toBe(true);
  });
});

// =====================================================================
// Group 4: Archive edge cases
// =====================================================================
describe('Group 4: Archive edge cases', () => {
  let tempDir: string;
  let vaultRoot: string;
  let wikiPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-edge-4-'));
    vaultRoot = tempDir;
    wikiPath = path.join(vaultRoot, 'wiki');
    createStandardVault(wikiPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 18: Archive non-applied change should be rejected
  it('should reject archiving a proposed change', () => {
    writeFile(
      path.join(wikiPath, '04-changes', 'not-applied.md'),
      `---
type: change
id: not-applied
status: proposed
created_at: "2026-04-05"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Not Applied

## Why

Testing.

## Delta Summary

- ADDED requirement "Test" to [[Feature: User Auth]]

## Tasks

- [ ] Not done

## Validation

None.
`,
    );

    const index = buildIndex(vaultRoot);
    expect(() => archiveChange('not-applied', index, vaultRoot)).toThrow(
      'Only applied changes can be archived',
    );
  });

  // Test 19: Archive with verify failure (unfilled markers) should fail or require --force
  it('should fail to archive when verify finds errors (unfilled markers)', () => {
    // Create and apply a change that leaves unfilled markers
    createInProgressChange(
      wikiPath,
      'archive-verify-fail',
      '- ADDED requirement "Agent Req" to [[Feature: User Auth]]',
    );

    const index1 = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const applyResult = applyChange(
      { changeId: 'archive-verify-fail', vaultRoot },
      index1,
      deps,
    );
    expect(applyResult.success).toBe(true);

    // Feature now has unfilled markers, and per the new safety policy
    // the Change stayed in `in_progress` because agent ops remain.
    const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
    expect(featureContent).toContain('<!-- ADDED by change:');

    const index2 = buildIndex(vaultRoot);
    const changeRec = index2.records.get('archive-verify-fail');
    expect(changeRec).toBeDefined();
    expect(changeRec!.status).toBe('in_progress');

    // Archive refuses non-applied changes without --force (was "Only
    // applied changes can be archived"). With --force, it archives the
    // in-progress change despite the unfilled markers.
    expect(() => archiveChange('archive-verify-fail', index2, vaultRoot)).toThrow(
      /Only applied changes can be archived/,
    );

    const archiveResult = archiveChange('archive-verify-fail', index2, vaultRoot, { force: true });
    expect(archiveResult.changeId).toBe('archive-verify-fail');
    expect(archiveResult.newPath).toContain('99-archive');
  });

  // Test 20: Archive preserves ID
  it('should preserve the note ID after archiving', () => {
    const index1 = buildIndex(vaultRoot);
    const feat = index1.records.get('user-auth')!;
    const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
    const baseHash = computeRequirementHash(sessionReq);

    createInProgressChange(
      wikiPath,
      'archive-id-test',
      `- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]`,
    );

    // Apply
    const index2 = buildIndex(vaultRoot);
    const deps = makeApplyDeps(vaultRoot);
    const applyResult = applyChange(
      { changeId: 'archive-id-test', vaultRoot },
      index2,
      deps,
    );
    expect(applyResult.success).toBe(true);
    expect(applyResult.statusTransitioned).toBe(true);

    // Archive
    const index3 = buildIndex(vaultRoot);
    const archiveResult = archiveChange('archive-id-test', index3, vaultRoot, { force: true });
    expect(archiveResult.newPath).toContain('99-archive');

    // Verify ID preserved
    const archivedPath = path.join(vaultRoot, archiveResult.newPath);
    const archivedContent = readFile(archivedPath);
    expect(archivedContent).toContain('id: archive-id-test');
    expect(archivedContent).toContain('status: applied');

    // Rebuild index and verify
    const index4 = buildIndex(vaultRoot);
    const archivedRecord = index4.records.get('archive-id-test');
    expect(archivedRecord).toBeDefined();
    expect(archivedRecord!.id).toBe('archive-id-test');
    expect(archivedRecord!.path).toContain('99-archive');
  });
});

// =====================================================================
// Group 5: Security edge cases
// =====================================================================
describe('Group 5: Security edge cases', () => {
  let tempDir: string;
  let vaultRoot: string;
  let wikiPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-edge-5-'));
    vaultRoot = tempDir;
    wikiPath = path.join(vaultRoot, 'wiki');
    createStandardVault(wikiPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 21: Path traversal in changeId
  it('should not access files outside vault with path traversal in changeId', () => {
    // The path traversal attack: using "../../etc/passwd" as a changeId
    const index = buildIndex(vaultRoot);

    // applyChange should throw because the changeId won't be found in index
    expect(() => {
      const deps = makeApplyDeps(vaultRoot);
      applyChange({ changeId: '../../etc/passwd', vaultRoot }, index, deps);
    }).toThrow(/not found/);

    // For status, the change shouldn't exist in index either
    expect(() => {
      continueChange(index, makeContinueDeps(vaultRoot), { changeName: '../../etc/passwd' });
    }).toThrow(/not found/);
  });

  // Test 22: assertInsideVault blocks symlink-based path traversal
  it('should block write operations via symlink that escapes vault', () => {
    // Create a symlink inside wiki/ that points outside the vault
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-outside-'));
    const symlinkPath = path.join(wikiPath, '03-features', 'escape-link');

    try {
      fs.symlinkSync(outsideDir, symlinkPath);

      // assertInsideVault should block the symlink target
      const targetFile = path.join(symlinkPath, 'evil.md');
      // The resolved path of targetFile would be outside vaultRoot
      expect(() => {
        assertInsideVault(fs.realpathSync(symlinkPath), vaultRoot);
      }).toThrow(/Path traversal blocked/);
    } finally {
      // Cleanup
      try {
        fs.unlinkSync(symlinkPath);
      } catch { /* ignore */ }
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
