/**
 * Regression for GitHub issue #2.
 *
 * `ows verify` reported STALE_BASE on Changes that were already applied
 * (and on the archived copy under wiki/99-archive/). The Change's own apply
 * rewrites the requirement, so base_fingerprint (pre-apply hash) no longer
 * matches the live content_hash. That mismatch is the successful outcome of
 * MODIFIED, not a stale base. A later Change that edits the same requirement
 * must not re-flag the earlier applied Change either.
 *
 * Active changes (proposed / planned / in_progress) still report STALE_BASE
 * when another Change has moved the base out from under them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildIndex } from '../../src/core/index/index.js';
import { verify } from '../../src/core/workflow/verify/verify.js';
import type { VerifyIssue } from '../../src/types/verify.js';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function featureNote(requirementBody: string, changeLinks: string[]): string {
  const changes =
    changeLinks.length === 0
      ? '[]'
      : `\n${changeLinks.map((link) => `  - "${link}"`).join('\n')}`;
  return `---
type: feature
id: user-auth
status: active
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
changes: ${changes}
---

# Feature: User Auth

## Purpose

User authentication via password login.

## Current Behavior

Users log in with email and password.

## Constraints

- Must rate limit login attempts.

## Known Gaps

- No OAuth support.

## Requirements

### Requirement: Password Login

${requirementBody}
`;
}

const ORIGINAL_REQUIREMENT = `The system SHALL allow users to authenticate using email and password.

#### Scenario: Successful login

WHEN a user submits valid email and password
THEN the system returns a JWT token`;

const AFTER_FIRST_APPLY = `The system SHALL reject passwords shorter than 12 characters.

#### Scenario: Short password

WHEN a user submits a password shorter than 12 characters
THEN the system refuses the login`;

const AFTER_SECOND_APPLY = `The system SHALL reject passwords shorter than 15 characters.

#### Scenario: Short password

WHEN a user submits a password shorter than 15 characters
THEN the system refuses the login`;

function changeNote(opts: {
  id: string;
  title: string;
  status: string;
  base: string;
  op?: 'MODIFIED' | 'REMOVED' | 'RENAMED';
  newName?: string;
}): string {
  const op = opts.op ?? 'MODIFIED';
  const delta =
    op === 'RENAMED'
      ? `- RENAMED requirement "Password Login" to "${opts.newName ?? 'Credential Login'}" in [[Feature: User Auth]] [base: ${opts.base}]`
      : `- ${op} requirement "Password Login" ${op === 'REMOVED' ? 'from' : 'in'} [[Feature: User Auth]] [base: ${opts.base}]`;

  return `---
type: change
id: ${opts.id}
status: ${opts.status}
created_at: "2026-04-06"
feature: "[[Feature: User Auth]]"
depends_on: []
touches:
  - "[[Feature: User Auth]]"
systems:
  - "[[System: Auth System]]"
sources: []
decisions: []
---

# Change: ${opts.title}

## Why

Password policy needs to move forward with the product.

## Delta Summary

${delta}

## Proposed Update

Update the Password Login requirement text.

## Impact

- Login form validation.

## Tasks

- [x] Update the requirement

## Validation

- Requirement text matches the new policy.
`;
}

function scaffold(wikiPath: string): void {
  writeFile(
    path.join(wikiPath, '00-meta', 'schema.md'),
    `---
type: meta
schema_version: "2026-04-06-v1"
---

# Schema
`,
  );
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

## Interfaces

- REST API
`,
  );
}

function staleIssues(issues: VerifyIssue[]): VerifyIssue[] {
  return issues.filter((issue) => issue.code === 'STALE_BASE');
}

describe('issue #2: STALE_BASE on applied and archived changes', () => {
  let vaultRoot: string;
  let wikiPath: string;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-stale-base-'));
    wikiPath = path.join(vaultRoot, 'wiki');
    scaffold(wikiPath);
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('does not report STALE_BASE after an applied MODIFIED change rewrites the requirement', () => {
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(ORIGINAL_REQUIREMENT, ['[[Change: Tighten Login]]']),
    );
    const before = buildIndex(vaultRoot);
    const baseHash = before.records.get('user-auth')!.requirements.find((r) => r.name === 'Password Login')!
      .content_hash;

    writeFile(
      path.join(wikiPath, '04-changes', 'tighten-login.md'),
      changeNote({
        id: 'tighten-login',
        title: 'Tighten Login',
        status: 'applied',
        base: baseHash,
      }),
    );
    // Apply rewrote the requirement. The Change keeps the pre-apply fingerprint.
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(AFTER_FIRST_APPLY, ['[[Change: Tighten Login]]']),
    );

    const report = verify(buildIndex(vaultRoot));
    const stale = staleIssues(report.issues);

    expect(stale).toEqual([]);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.pass).toBe(true);

    const after = buildIndex(vaultRoot);
    const currentHash = after.records.get('user-auth')!.requirements.find((r) => r.name === 'Password Login')!
      .content_hash;
    expect(currentHash).not.toBe(baseHash);
  });

  it('does not report STALE_BASE for the archived copy of an applied MODIFIED change', () => {
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(ORIGINAL_REQUIREMENT, ['[[Change: Tighten Login]]']),
    );
    const baseHash = buildIndex(vaultRoot)
      .records.get('user-auth')!
      .requirements.find((r) => r.name === 'Password Login')!.content_hash;

    writeFile(
      path.join(wikiPath, '99-archive', 'tighten-login.md'),
      changeNote({
        id: 'tighten-login',
        title: 'Tighten Login',
        status: 'applied',
        base: baseHash,
      }),
    );
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(AFTER_FIRST_APPLY, ['[[Change: Tighten Login]]']),
    );

    const report = verify(buildIndex(vaultRoot));

    expect(staleIssues(report.issues)).toEqual([]);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.pass).toBe(true);
  });

  it('does not report STALE_BASE on an earlier applied change when a later change modifies the same requirement', () => {
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(ORIGINAL_REQUIREMENT, []),
    );
    const originalHash = buildIndex(vaultRoot)
      .records.get('user-auth')!
      .requirements.find((r) => r.name === 'Password Login')!.content_hash;

    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(AFTER_FIRST_APPLY, []),
    );
    const afterFirstHash = buildIndex(vaultRoot)
      .records.get('user-auth')!
      .requirements.find((r) => r.name === 'Password Login')!.content_hash;

    writeFile(
      path.join(wikiPath, '04-changes', 'tighten-login.md'),
      changeNote({
        id: 'tighten-login',
        title: 'Tighten Login',
        status: 'applied',
        base: originalHash,
      }),
    );
    writeFile(
      path.join(wikiPath, '04-changes', 'tighten-login-again.md'),
      changeNote({
        id: 'tighten-login-again',
        title: 'Tighten Login Again',
        status: 'applied',
        base: afterFirstHash,
      }),
    );
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(AFTER_SECOND_APPLY, [
        '[[Change: Tighten Login]]',
        '[[Change: Tighten Login Again]]',
      ]),
    );

    const report = verify(buildIndex(vaultRoot));
    const stale = staleIssues(report.issues);

    expect(stale.map((issue) => issue.note_id)).toEqual([]);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.pass).toBe(true);
  });

  it('still reports STALE_BASE for an active change whose base was moved by another change', () => {
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(ORIGINAL_REQUIREMENT, ['[[Change: Tighten Login]]']),
    );
    const originalHash = buildIndex(vaultRoot)
      .records.get('user-auth')!
      .requirements.find((r) => r.name === 'Password Login')!.content_hash;

    writeFile(
      path.join(wikiPath, '04-changes', 'tighten-login.md'),
      changeNote({
        id: 'tighten-login',
        title: 'Tighten Login',
        status: 'applied',
        base: originalHash,
      }),
    );
    writeFile(
      path.join(wikiPath, '04-changes', 'still-drafting.md'),
      changeNote({
        id: 'still-drafting',
        title: 'Still Drafting',
        status: 'in_progress',
        base: originalHash,
      }),
    );
    writeFile(
      path.join(wikiPath, '03-features', 'user-auth.md'),
      featureNote(AFTER_FIRST_APPLY, [
        '[[Change: Tighten Login]]',
        '[[Change: Still Drafting]]',
      ]),
    );

    const report = verify(buildIndex(vaultRoot));
    const stale = staleIssues(report.issues);

    expect(stale.map((issue) => issue.note_id)).toEqual(['still-drafting']);
    expect(stale[0].severity).toBe('error');
    expect(report.pass).toBe(false);
    expect(staleIssues(report.issues).some((issue) => issue.note_id === 'tighten-login')).toBe(false);
  });
});
