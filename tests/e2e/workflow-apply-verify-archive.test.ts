/**
 * E2E tests for the full apply → verify → archive workflow.
 *
 * Uses real file I/O with temporary directories to exercise the complete
 * lifecycle of a Change note: setup vault, apply change, verify vault state,
 * detect intentional issues, and archive the applied change.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildIndex } from '../../src/core/index/index.js';
import { applyChange } from '../../src/core/workflow/apply/apply.js';
import { verify } from '../../src/core/workflow/verify/verify.js';
import { archiveChange } from '../../src/cli/commands/archive.js';
import { parseNote } from '../../src/core/parser/note-parser.js';
import { computeRequirementHash } from '../../src/core/workflow/apply/stale-checker.js';
import type { ApplyDeps } from '../../src/core/workflow/apply/types.js';

// ── Helpers ──

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Build real ApplyDeps wired to the filesystem.
 */
function makeRealDeps(vaultRoot: string): ApplyDeps {
  return {
    parseNote: (filePath: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(vaultRoot, filePath);
      return parseNote(absPath);
    },
    readFile: (filePath: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(vaultRoot, filePath);
      return fs.readFileSync(absPath, 'utf-8');
    },
    writeFile: (filePath: string, content: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(vaultRoot, filePath);
      fs.writeFileSync(absPath, content);
    },
    fileExists: (filePath: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(vaultRoot, filePath);
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
  };
}

describe('E2E: apply → verify → archive workflow', () => {
  let tempDir: string;
  let vaultRoot: string;
  let wikiPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-workflow-b-'));
    vaultRoot = tempDir;
    wikiPath = path.join(vaultRoot, 'wiki');

    // Create vault directory structure
    fs.mkdirSync(path.join(wikiPath, '00-meta'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, '01-sources'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, '02-systems'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, '03-features'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, '04-changes'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, '05-decisions'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, '06-queries'), { recursive: true });
    fs.mkdirSync(path.join(wikiPath, '99-archive'), { recursive: true });

    // Create schema.md (type: meta so it's skipped during index build)
    writeFile(
      path.join(wikiPath, '00-meta', 'schema.md'),
      `---
type: meta
schema_version: "2026-04-06-v1"
---

# Vault Schema
`,
    );

    // Create log.md
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
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Test 1: Setup a complete vault with a planned change ──

  describe('Test 1: Setup a complete vault with a planned change', () => {
    it('should create valid vault structure with feature and change notes', () => {
      // Create System note
      writeFile(
        path.join(wikiPath, '02-systems', 'auth-system.md'),
        `---
type: system
id: auth-system
status: active
---

# System: Auth System

## Overview

Authentication subsystem handling user identity.

## Boundaries

Handles login, session management, OAuth flows.

## Key Components

- Login controller
- Session manager

## Interfaces

- REST API endpoints
`,
      );

      // Create Feature note with requirements
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

Provides user authentication via password-based login.

## Current Behavior

Users authenticate with email and password. JWT tokens manage sessions.

## Constraints

- Must support rate limiting on login attempts.

## Known Gaps

- No OAuth login support.

## Requirements

### Requirement: Password Login

The system SHALL allow users to authenticate using email and password.

#### Scenario: Successful password login

WHEN a user submits valid email and password
THEN the system returns a JWT token

### Requirement: Session Management

The system MUST issue JWT tokens with a maximum lifetime of 24 hours.

#### Scenario: Token expiry

WHEN a JWT token is older than 24 hours
THEN the system rejects the token
`,
      );

      // Build index and verify vault
      const index = buildIndex(vaultRoot);
      expect(index.records.size).toBeGreaterThanOrEqual(2);

      const featureRecord = index.records.get('user-auth');
      expect(featureRecord).toBeDefined();
      expect(featureRecord!.type).toBe('feature');
      expect(featureRecord!.requirements).toHaveLength(2);
      expect(featureRecord!.requirements[0].name).toBe('Password Login');
      expect(featureRecord!.requirements[1].name).toBe('Session Management');

      const systemRecord = index.records.get('auth-system');
      expect(systemRecord).toBeDefined();
      expect(systemRecord!.type).toBe('system');
    });
  });

  // ── Test 2: ows apply ──

  describe('Test 2: ows apply', () => {
    it('should apply a change with ADDED requirement and transition status', () => {
      // Setup vault
      createFullVault(wikiPath);

      // Build index
      const index = buildIndex(vaultRoot);
      const featureBefore = index.records.get('user-auth')!;
      expect(featureBefore.requirements).toHaveLength(2);

      // Create change note in_progress with all tasks done and an ADDED delta
      writeFile(
        path.join(wikiPath, '04-changes', 'add-oauth-login.md'),
        `---
type: change
id: add-oauth-login
status: in_progress
created_at: "2026-04-01"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Add OAuth Login

## Why

Users need OAuth login for Google and GitHub to reduce friction.

## Delta Summary

- ADDED requirement "OAuth Login" to [[Feature: User Auth]]

## Proposed Update

Add OAuth2 flow for Google and GitHub providers.

## Impact

- Auth system needs new OAuth endpoints.

## Design Approach

Use Authorization Code flow with PKCE.

## Tasks

- [x] Define OAuth flow
- [x] Design provider abstraction
- [x] Update feature requirements

## Validation

- All scenarios pass for new requirement
- Manual testing of OAuth redirect flow
`,
      );

      // Rebuild index to include the change note
      const indexWithChange = buildIndex(vaultRoot);
      const changeRecord = indexWithChange.records.get('add-oauth-login');
      expect(changeRecord).toBeDefined();
      expect(changeRecord!.status).toBe('in_progress');

      // Apply the change
      const deps = makeRealDeps(vaultRoot);
      const result = applyChange(
        { changeId: 'add-oauth-login', vaultRoot },
        indexWithChange,
        deps,
      );

      // ADDED is an agent-driven op, so apply succeeds but returns pendingAgentOps
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      // ADDED is agent-driven, not programmatic
      expect(result.pendingAgentOps).toHaveLength(1);
      expect(result.pendingAgentOps[0].entry.op).toBe('ADDED');
      expect(result.pendingAgentOps[0].entry.targetName).toBe('OAuth Login');
    });

    it('should apply a change with REMOVED requirement (programmatic op) and auto-transition', () => {
      createFullVault(wikiPath);

      // Get the requirement and compute the hash using computeRequirementHash
      // (this matches what the stale-checker uses, which differs from the parser's content_hash)
      const index1 = buildIndex(vaultRoot);
      const feat = index1.records.get('user-auth')!;
      const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
      const baseHash = computeRequirementHash(sessionReq);

      // Create change to REMOVE "Session Management"
      writeFile(
        path.join(wikiPath, '04-changes', 'remove-session-mgmt.md'),
        `---
type: change
id: remove-session-mgmt
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

# Change: Remove Session Management

## Why

Session management is being moved to a separate microservice.

## Delta Summary

- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]

## Proposed Update

Remove Session Management requirement from User Auth feature.

## Impact

- Session management will be handled externally.

## Tasks

- [x] Identify migration path
- [x] Update feature requirements

## Validation

- Requirement no longer present in Feature
`,
      );

      const indexWithChange = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);

      const result = applyChange(
        { changeId: 'remove-session-mgmt', vaultRoot },
        indexWithChange,
        deps,
      );

      expect(result.success).toBe(true);
      expect(result.pendingAgentOps).toHaveLength(0); // REMOVED is programmatic
      expect(result.statusTransitioned).toBe(true); // Auto-transition for programmatic-only

      // Verify status was updated in the change file
      const changeContent = readFile(path.join(wikiPath, '04-changes', 'remove-session-mgmt.md'));
      expect(changeContent).toContain('status: applied');
    });

    it('should detect stale base fingerprint and block apply', () => {
      createFullVault(wikiPath);

      // Create change with wrong base fingerprint
      writeFile(
        path.join(wikiPath, '04-changes', 'stale-change.md'),
        `---
type: change
id: stale-change
status: in_progress
created_at: "2026-04-03"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Stale Change

## Why

Testing stale detection.

## Delta Summary

- MODIFIED requirement "Password Login" in [[Feature: User Auth]] [base: sha256:0000000000000000000000000000000000000000000000000000000000000000]

## Proposed Update

Modify password login.

## Impact

- None.

## Tasks

- [x] Done

## Validation

- Test passes
`,
      );

      const index = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);
      const result = applyChange(
        { changeId: 'stale-change', vaultRoot },
        index,
        deps,
      );

      expect(result.success).toBe(false);
      expect(result.staleReport.blocked).toBe(true);
      expect(result.errors.some(e => e.includes('STALE'))).toBe(true);
    });
  });

  // ── Test 2b: Programmatic file writes ──

  describe('Test 2b: Feature file is programmatically written', () => {
    it('RENAMED changes heading text in Feature file', () => {
      createFullVault(wikiPath);

      const index1 = buildIndex(vaultRoot);
      const feat = index1.records.get('user-auth')!;
      const loginReq = feat.requirements.find(r => r.name === 'Password Login')!;
      const baseHash = computeRequirementHash(loginReq);

      writeFile(
        path.join(wikiPath, '04-changes', 'rename-login.md'),
        `---
type: change
id: rename-login
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

# Change: Rename Login

## Why

Renaming for clarity.

## Delta Summary

- RENAMED requirement "Password Login" to "Email Password Login" in [[Feature: User Auth]] [base: ${baseHash}]

## Proposed Update

Rename requirement.

## Impact

- None.

## Tasks

- [x] Done

## Validation

- Check rename
`,
      );

      const indexWithChange = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);

      const result = applyChange(
        { changeId: 'rename-login', vaultRoot },
        indexWithChange,
        deps,
      );

      expect(result.success).toBe(true);
      expect(result.statusTransitioned).toBe(true);

      // Verify the Feature file was updated with new heading
      const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
      expect(featureContent).toContain('### Requirement: Email Password Login');
      expect(featureContent).not.toContain('### Requirement: Password Login');
      // Other requirement untouched
      expect(featureContent).toContain('### Requirement: Session Management');
    });

    it('REMOVED deletes entire requirement block from Feature file', () => {
      createFullVault(wikiPath);

      const index1 = buildIndex(vaultRoot);
      const feat = index1.records.get('user-auth')!;
      const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
      const baseHash = computeRequirementHash(sessionReq);

      writeFile(
        path.join(wikiPath, '04-changes', 'remove-session-block.md'),
        `---
type: change
id: remove-session-block
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

# Change: Remove Session Block

## Why

Moving to external service.

## Delta Summary

- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]

## Proposed Update

Remove.

## Impact

- None.

## Tasks

- [x] Done

## Validation

- Verified
`,
      );

      const indexWithChange = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);

      const result = applyChange(
        { changeId: 'remove-session-block', vaultRoot },
        indexWithChange,
        deps,
      );

      expect(result.success).toBe(true);

      const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
      expect(featureContent).not.toContain('### Requirement: Session Management');
      expect(featureContent).not.toContain('Token expiry');
      // Other requirement preserved
      expect(featureContent).toContain('### Requirement: Password Login');
    });

    it('ADDED appends requirement skeleton to Feature file', () => {
      createFullVault(wikiPath);

      writeFile(
        path.join(wikiPath, '04-changes', 'add-oauth.md'),
        `---
type: change
id: add-oauth
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

# Change: Add OAuth

## Why

Need OAuth support.

## Delta Summary

- ADDED requirement "OAuth Login" to [[Feature: User Auth]]

## Proposed Update

Add OAuth2 flow.

## Impact

- Auth system needs new endpoints.

## Tasks

- [x] Done

## Validation

- Verified
`,
      );

      const indexWithChange = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);

      const result = applyChange(
        { changeId: 'add-oauth', vaultRoot },
        indexWithChange,
        deps,
      );

      expect(result.success).toBe(true);

      const featureContent = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
      expect(featureContent).toContain('### Requirement: OAuth Login');
      expect(featureContent).toContain('<!-- ADDED by change:');
      // Existing requirements preserved
      expect(featureContent).toContain('### Requirement: Password Login');
      expect(featureContent).toContain('### Requirement: Session Management');
    });

    it('content outside Requirements section is preserved byte-for-byte', () => {
      createFullVault(wikiPath);

      const index1 = buildIndex(vaultRoot);
      const feat = index1.records.get('user-auth')!;
      const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
      const baseHash = computeRequirementHash(sessionReq);

      const featureBefore = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
      // Extract content before ## Requirements
      const reqSectionIndex = featureBefore.indexOf('## Requirements');
      const contentBefore = featureBefore.slice(0, reqSectionIndex);

      writeFile(
        path.join(wikiPath, '04-changes', 'preserve-test.md'),
        `---
type: change
id: preserve-test
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

# Change: Preserve Test

## Why

Testing content preservation.

## Delta Summary

- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]

## Proposed Update

Remove.

## Impact

- None.

## Tasks

- [x] Done

## Validation

- Verified
`,
      );

      const indexWithChange = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);

      applyChange(
        { changeId: 'preserve-test', vaultRoot },
        indexWithChange,
        deps,
      );

      const featureAfter = readFile(path.join(wikiPath, '03-features', 'user-auth.md'));
      const reqSectionIndexAfter = featureAfter.indexOf('## Requirements');
      const contentAfter = featureAfter.slice(0, reqSectionIndexAfter);

      // Content before ## Requirements must be identical
      expect(contentAfter).toBe(contentBefore);
    });
  });

  // ── Test 3: ows verify (clean state) ──

  describe('Test 3: ows verify on applied change', () => {
    it('should pass verify on a correctly applied change', () => {
      createFullVault(wikiPath);

      // Get the base hash for removal
      const index1 = buildIndex(vaultRoot);
      const feat = index1.records.get('user-auth')!;
      const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
      const baseHash = computeRequirementHash(sessionReq);

      // Create and apply a REMOVED change (auto-transitions to applied)
      writeFile(
        path.join(wikiPath, '04-changes', 'remove-session.md'),
        `---
type: change
id: remove-session
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

# Change: Remove Session

## Why

Moving session management to external service.

## Delta Summary

- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]

## Proposed Update

Remove session management.

## Impact

- External session service.

## Tasks

- [x] Done

## Validation

- Requirement removed
`,
      );

      const indexForApply = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);

      const applyResult = applyChange(
        { changeId: 'remove-session', vaultRoot },
        indexForApply,
        deps,
      );
      expect(applyResult.success).toBe(true);
      expect(applyResult.statusTransitioned).toBe(true);

      // Verify the Feature file was programmatically updated by apply
      const featurePath = path.join(wikiPath, '03-features', 'user-auth.md');
      const featureContent = readFile(featurePath);
      expect(featureContent).not.toContain('### Requirement: Session Management');

      // Rebuild index after apply + feature update
      const indexAfterApply = buildIndex(vaultRoot);

      // Verify
      const report = verify(indexAfterApply, { changeId: 'remove-session' });

      // Check report structure
      expect(report.scanned_at).toBeDefined();
      expect(report.total_notes).toBeGreaterThanOrEqual(2);
      expect(report.summary).toBeDefined();
      expect(report.summary.completeness).toBeDefined();
      expect(report.summary.correctness).toBeDefined();
      expect(report.summary.coherence).toBeDefined();
      expect(report.summary.vault_integrity).toBeDefined();

      // Filter for errors only (warnings like orphan note are acceptable)
      const errors = report.issues.filter(i => i.severity === 'error');
      // There might be a "removes all requirements" coherence warning
      // but no hard errors expected for a properly applied removal
      expect(errors).toHaveLength(0);
    });
  });

  // ── Test 4: ows verify with intentional issues ──

  describe('Test 4: ows verify with intentional issues', () => {
    it('should detect duplicate IDs', () => {
      createFullVault(wikiPath);

      // Create a second file with the same id as user-auth
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

Duplicate feature.

## Current Behavior

None.

## Requirements

### Requirement: Duplicate Req

The system SHALL be duplicated.

#### Scenario: Dup test

WHEN duplicated
THEN detected
`,
      );

      const index = buildIndex(vaultRoot);
      const report = verify(index);

      const dupIssues = report.issues.filter(i => i.code === 'DUPLICATE_ID');
      expect(dupIssues.length).toBeGreaterThan(0);
      expect(report.pass).toBe(false);
    });

    it('should detect unresolved wikilinks', () => {
      createFullVault(wikiPath);

      // Create a change that references a non-existent feature
      writeFile(
        path.join(wikiPath, '04-changes', 'broken-link.md'),
        `---
type: change
id: broken-link
status: proposed
created_at: "2026-04-05"
feature: "[[Feature: NonExistent Feature]]"
depends_on: []
touches:
  - "[[Feature: NonExistent Feature]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Broken Link

## Why

Testing broken wikilinks.

## Delta Summary

- ADDED requirement "Phantom" to [[Feature: NonExistent Feature]]

## Proposed Update

Nothing.

## Impact

- None.

## Tasks

- [ ] Do nothing

## Validation

- Nothing passes
`,
      );

      const index = buildIndex(vaultRoot);
      const report = verify(index);

      const unresolvedIssues = report.issues.filter(i => i.code === 'UNRESOLVED_WIKILINK');
      expect(unresolvedIssues.length).toBeGreaterThan(0);
      expect(report.pass).toBe(false);
    });

    it('should detect missing requirement referenced in Delta Summary', () => {
      createFullVault(wikiPath);

      // Create a change that references a requirement that doesn't exist for MODIFIED
      writeFile(
        path.join(wikiPath, '04-changes', 'bad-delta.md'),
        `---
type: change
id: bad-delta
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

# Change: Bad Delta

## Why

Testing delta mismatch detection.

## Delta Summary

- MODIFIED requirement "NonExistent Requirement" in [[Feature: User Auth]] [base: sha256:abc]

## Proposed Update

Nothing.

## Impact

- None.

## Tasks

- [ ] Do nothing

## Validation

- Nothing passes
`,
      );

      const index = buildIndex(vaultRoot);
      const report = verify(index);

      const deltaMismatchIssues = report.issues.filter(
        i => i.code === 'DELTA_MISMATCH_MODIFIED',
      );
      expect(deltaMismatchIssues.length).toBeGreaterThan(0);
      expect(deltaMismatchIssues[0].message).toContain('NonExistent Requirement');
      expect(report.pass).toBe(false);
    });

    it('should detect all three issues simultaneously', () => {
      createFullVault(wikiPath);

      // Issue 1: Duplicate ID
      writeFile(
        path.join(wikiPath, '03-features', 'user-auth-dup.md'),
        `---
type: feature
id: user-auth
status: active
systems:
  - "[[System: Auth System]]"
---

# Feature: User Auth Dup

## Purpose
Dup.

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

      // Issue 2: Unresolved wikilink
      writeFile(
        path.join(wikiPath, '04-changes', 'unresolved-ref.md'),
        `---
type: change
id: unresolved-ref
status: proposed
created_at: "2026-04-05"
feature: "[[Feature: Ghost Feature]]"
depends_on: []
touches:
  - "[[Feature: Ghost Feature]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: Unresolved Ref

## Why
Testing.

## Delta Summary

- ADDED requirement "Ghost Req" to [[Feature: Ghost Feature]]

## Proposed Update
None.

## Impact
None.

## Tasks

- [ ] Nothing

## Validation
None.
`,
      );

      // Issue 3: Missing requirement in delta (MODIFIED on non-existent)
      writeFile(
        path.join(wikiPath, '04-changes', 'missing-req-delta.md'),
        `---
type: change
id: missing-req-delta
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

# Change: Missing Req Delta

## Why
Testing.

## Delta Summary

- REMOVED requirement "Imaginary Requirement" from [[Feature: User Auth]] [base: sha256:xyz]

## Proposed Update
None.

## Impact
None.

## Tasks

- [ ] Nothing

## Validation
None.
`,
      );

      const index = buildIndex(vaultRoot);
      const report = verify(index);

      // Check all three issue types are detected
      const dupIssues = report.issues.filter(i => i.code === 'DUPLICATE_ID');
      const unresolvedIssues = report.issues.filter(i => i.code === 'UNRESOLVED_WIKILINK');
      const deltaMismatch = report.issues.filter(
        i => i.code === 'DELTA_MISMATCH_REMOVED',
      );

      expect(dupIssues.length).toBeGreaterThan(0);
      expect(unresolvedIssues.length).toBeGreaterThan(0);
      expect(deltaMismatch.length).toBeGreaterThan(0);
      expect(report.pass).toBe(false);
    });
  });

  // ── Test 5: ows archive ──

  describe('Test 5: ows archive', () => {
    it('should archive an applied change and preserve ID', () => {
      createFullVault(wikiPath);

      // Get base hash for removal
      const index1 = buildIndex(vaultRoot);
      const feat = index1.records.get('user-auth')!;
      const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
      const baseHash = computeRequirementHash(sessionReq);

      // Create a change and apply it
      writeFile(
        path.join(wikiPath, '04-changes', 'archive-test-change.md'),
        `---
type: change
id: archive-test-change
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

# Change: Archive Test Change

## Why

Testing archival.

## Delta Summary

- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]

## Proposed Update

Remove session management.

## Impact

- None.

## Tasks

- [x] Done

## Validation

- Check archival
`,
      );

      // Apply the change
      const indexForApply = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);
      const applyResult = applyChange(
        { changeId: 'archive-test-change', vaultRoot },
        indexForApply,
        deps,
      );
      expect(applyResult.success).toBe(true);
      expect(applyResult.statusTransitioned).toBe(true);

      // Verify the Feature file was programmatically updated
      const featurePath = path.join(wikiPath, '03-features', 'user-auth.md');
      const featureContent = readFile(featurePath);
      expect(featureContent).not.toContain('### Requirement: Session Management');

      // Verify the change file is now "applied"
      const changeContent = readFile(
        path.join(wikiPath, '04-changes', 'archive-test-change.md'),
      );
      expect(changeContent).toContain('status: applied');

      // Rebuild index for archive operation
      const indexForArchive = buildIndex(vaultRoot);
      const changeRecord = indexForArchive.records.get('archive-test-change');
      expect(changeRecord).toBeDefined();
      expect(changeRecord!.status).toBe('applied');

      // Archive the change
      const archiveResult = archiveChange(
        'archive-test-change',
        indexForArchive,
        vaultRoot,
        { force: true },
      );

      expect(archiveResult.changeId).toBe('archive-test-change');
      expect(archiveResult.newPath).toContain('99-archive');

      // Verify file moved
      const oldPath = path.join(wikiPath, '04-changes', 'archive-test-change.md');
      const newPath = path.join(wikiPath, '99-archive', 'archive-test-change.md');
      expect(fs.existsSync(oldPath)).toBe(false);
      expect(fs.existsSync(newPath)).toBe(true);

      // Verify ID is preserved in archived file
      const archivedContent = readFile(newPath);
      expect(archivedContent).toContain('id: archive-test-change');
      expect(archivedContent).toContain('status: applied');

      // Rebuild index after archive and verify wikilinks still valid
      const indexAfterArchive = buildIndex(vaultRoot);
      const archivedRecord = indexAfterArchive.records.get('archive-test-change');
      expect(archivedRecord).toBeDefined();
      expect(archivedRecord!.path).toContain('99-archive');
      expect(archivedRecord!.id).toBe('archive-test-change');
    });

    it('should reject archiving non-applied changes', () => {
      createFullVault(wikiPath);

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

## Proposed Update
None.

## Impact
None.

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

    it('should append to log.md on archive', () => {
      createFullVault(wikiPath);

      // Get base hash
      const index1 = buildIndex(vaultRoot);
      const feat = index1.records.get('user-auth')!;
      const sessionReq = feat.requirements.find(r => r.name === 'Session Management')!;
      const baseHash = computeRequirementHash(sessionReq);

      // Create, apply, then archive
      writeFile(
        path.join(wikiPath, '04-changes', 'log-test.md'),
        `---
type: change
id: log-test
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

# Change: Log Test

## Why

Test log entry.

## Delta Summary

- REMOVED requirement "Session Management" from [[Feature: User Auth]] [base: ${baseHash}]

## Proposed Update

Remove.

## Impact

None.

## Tasks

- [x] Done

## Validation

- Checked
`,
      );

      const indexForApply = buildIndex(vaultRoot);
      const deps = makeRealDeps(vaultRoot);
      applyChange({ changeId: 'log-test', vaultRoot }, indexForApply, deps);

      // Verify the Feature file was programmatically updated
      const featurePath = path.join(wikiPath, '03-features', 'user-auth.md');
      const fc = readFile(featurePath);
      expect(fc).not.toContain('### Requirement: Session Management');

      const indexForArchive = buildIndex(vaultRoot);
      archiveChange('log-test', indexForArchive, vaultRoot, { force: true });

      const logContent = readFile(path.join(wikiPath, '00-meta', 'log.md'));
      expect(logContent).toContain('archive');
      expect(logContent).toContain('log-test');
    });
  });

  // ── Helper: Create a full vault with all standard notes ──

  function createFullVault(wikiDir: string): void {
    // System note
    writeFile(
      path.join(wikiDir, '02-systems', 'auth-system.md'),
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

    // Feature note
    writeFile(
      path.join(wikiDir, '03-features', 'user-auth.md'),
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
`,
    );
  }
});
