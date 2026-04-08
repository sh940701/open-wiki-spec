/**
 * E2E tests for query workflow, sequencing analysis, and edge cases.
 * Uses real file I/O with isolated temp directories.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { initVault } from '../../src/cli/init/init-engine.js';
import { buildIndex } from '../../src/core/index/build.js';
import { queryWorkflow } from '../../src/core/workflow/query/query.js';
import { createQueryNote } from '../../src/core/workflow/query/query-note-creator.js';
import { analyzeSequencing } from '../../src/core/sequencing/analyze.js';
import { verify } from '../../src/core/workflow/verify/verify.js';
import { applyChange } from '../../src/core/workflow/apply/apply.js';
import { computeHash } from '../../src/utils/hash.js';
import { parseNote } from '../../src/core/parser/note-parser.js';
import type { ApplyDeps } from '../../src/core/workflow/apply/types.js';

// ── Helpers ──

function writeNote(vaultRoot: string, relativePath: string, content: string): string {
  const fullPath = path.join(vaultRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

function computeReqHash(normative: string): string {
  const normalized = [normative].join('\n').trim();
  return `sha256:${computeHash(normalized)}`;
}

/** Write the common System note that features reference */
function writeSystemNote(vaultRoot: string): void {
  writeNote(vaultRoot, 'wiki/02-systems/identity.md', `---
type: system
id: identity-system
status: active
tags:
  - auth
  - identity
---

# System: Identity

## Purpose

Manages user authentication, authorization, and session lifecycle.
`);
}

function makeApplyDeps(vaultRoot: string): ApplyDeps {
  return {
    parseNote: (filePath: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(vaultRoot, filePath);
      return parseNote(absPath);
    },
    writeFile: (filePath: string, content: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(vaultRoot, filePath);
      fs.writeFileSync(absPath, content, 'utf-8');
    },
    readFile: (filePath: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(vaultRoot, filePath);
      return fs.readFileSync(absPath, 'utf-8');
    },
    fileExists: (filePath: string) => {
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(vaultRoot, filePath);
      return fs.existsSync(absPath);
    },
    moveFile: (from: string, to: string) => {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
    },
    ensureDir: (dirPath: string) =>
      fs.mkdirSync(dirPath, { recursive: true }),
  };
}

// ── Test Suite ──

describe('E2E: Query workflow, Sequencing, and Edge cases', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-edge-'));
    await initVault({ path: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────
  // Test 1: Query Workflow
  // ─────────────────────────────────────────────

  describe('Test 1: Query workflow', () => {
    it('should search vault notes, assess noteworthiness, and create query note', () => {
      writeSystemNote(tempDir);

      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags:
  - auth
  - security
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Provides authentication for users via password and passkey methods.

## Current Behavior

Users can log in with email and password. Sessions are managed via JWT tokens.

## Constraints

Must support TOTP 2FA.

## Known Gaps

No passkey support yet.

## Requirements

### Requirement: Password Login

The system SHALL allow users to authenticate using email and password credentials.

#### Scenario: Successful login

WHEN a user submits valid email and password
THEN the system returns a JWT session token
AND the user is redirected to the dashboard
`);

      writeNote(tempDir, 'wiki/05-decisions/use-passkeys.md', `---
type: decision
id: use-passkeys
status: active
features:
  - "[[Feature: Auth Login]]"
changes: []
tags:
  - auth
---

# Decision: Use Passkeys

## Context

Passwords are a weak authentication factor.

## Decision

We will adopt WebAuthn passkeys as a primary authentication method.
`);

      writeNote(tempDir, 'wiki/01-sources/webauthn-spec.md', `---
type: source
id: webauthn-spec
status: active
tags:
  - reference
  - auth
---

# Source: WebAuthn Specification

## Summary

The W3C Web Authentication specification defines a standard web API.
`);

      writeNote(tempDir, 'wiki/04-changes/add-passkey-support.md', `---
type: change
id: add-passkey-support
status: proposed
created_at: "2024-03-15"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
  - "[[System: Identity]]"
systems:
  - "[[System: Identity]]"
sources: []
decisions:
  - "[[Decision: Use Passkeys]]"
tags:
  - auth
  - passkey
---

# Change: Add Passkey Support

## Why

Users need passwordless authentication via WebAuthn passkeys.

## Delta Summary

- ADDED requirement "Passkey Authentication" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Add WebAuthn passkey flows.

## Impact

Identity system needs WebAuthn endpoint.

## Tasks

- [ ] Implement WebAuthn endpoint

## Validation

- All scenarios pass
`);

      // Build index and run query workflow
      const index = buildIndex(tempDir);
      expect(index.records.size).toBeGreaterThanOrEqual(4);

      const result = queryWorkflow(
        { question: 'How does authentication work?' },
        index,
      );

      // Retrieval finds related notes
      expect(result.searchResult.candidates.length).toBeGreaterThan(0);
      const candidateIds = result.searchResult.candidates.map((c) => c.id);
      expect(candidateIds.some((id) => id === 'auth-login')).toBe(true);

      // Noteworthiness assessment works
      expect(result.assessment).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(result.assessment.confidence);

      // Context document is built
      expect(result.contextDocument).toContain('Vault Search Results');

      // When noteworthiness says create, verify query note creation
      if (result.assessment.shouldCreate) {
        const queryNote = createQueryNote({
          question: 'How does authentication work?',
          title: 'Authentication Architecture',
          context: 'Investigation of auth patterns.',
          findings: 'Auth is handled via JWT with passkey migration planned.',
          conclusion: 'System supports password + planned passkey.',
          consultedNotes: candidateIds,
          relatedFeatures: ['[[Feature: Auth Login]]'],
          relatedSystems: ['[[System: Identity]]'],
          tags: ['auth'],
        });

        expect(queryNote.path).toMatch(/^wiki\/06-queries\//);
        expect(queryNote.content).toContain('type: query');
        expect(queryNote.content).toContain('status: active');
        expect(queryNote.content).toContain('question:');

        // Write it and verify it appears in a rebuilt index
        writeNote(tempDir, queryNote.path, queryNote.content);
        const newIndex = buildIndex(tempDir);
        const queryRecords = Array.from(newIndex.records.values()).filter(
          (r) => r.type === 'query',
        );
        expect(queryRecords.length).toBeGreaterThan(0);
      }
    });

    it('should always create a query note for complex cross-type questions', () => {
      // Create System for billing
      writeNote(tempDir, 'wiki/02-systems/payments.md', `---
type: system
id: payments-system
status: active
tags: [billing, payments]
---

# System: Payments

## Purpose

Processes payments and manages payment methods.
`);

      writeNote(tempDir, 'wiki/03-features/billing.md', `---
type: feature
id: billing
status: active
tags: [billing]
systems:
  - "[[System: Payments]]"
sources: []
decisions:
  - "[[Decision: Stripe Integration]]"
changes: []
---

# Feature: Billing

## Purpose

Handles user billing and invoicing.

## Current Behavior

Users are billed monthly via Stripe.

## Constraints

PCI compliance required.

## Known Gaps

No annual billing option.

## Requirements

### Requirement: Monthly Billing

The system SHALL generate invoices on the first of each month.

#### Scenario: Invoice generation

WHEN the first of the month arrives
THEN the system generates an invoice for each active subscription
`);

      writeNote(tempDir, 'wiki/05-decisions/stripe-integration.md', `---
type: decision
id: stripe-integration
status: active
features:
  - "[[Feature: Billing]]"
tags: [billing]
---

# Decision: Stripe Integration

## Context

We need a payment processor.

## Decision

We will use Stripe for payment processing.
`);

      const index = buildIndex(tempDir);
      const result = queryWorkflow(
        { question: 'How does billing interact with payments and why did we choose Stripe?' },
        index,
      );

      // Complex cross-type question should recommend creation
      expect(result.assessment.shouldCreate).toBe(true);
      expect(result.assessment.confidence).toBe('high');
      expect(result.searchResult.candidates.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ─────────────────────────────────────────────
  // Test 2: Parallel change sequencing
  // ─────────────────────────────────────────────

  describe('Test 2: Parallel change sequencing', () => {
    it('should detect conflict_candidate when 2 changes touch the same feature', () => {
      writeSystemNote(tempDir);

      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags: [auth]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Authentication feature.

## Current Behavior

Password-based login.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Password Login

The system SHALL allow password login.

#### Scenario: Basic login

WHEN a user submits valid credentials
THEN the system authenticates the user
`);

      writeNote(tempDir, 'wiki/04-changes/chg-a.md', `---
type: change
id: chg-a
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
tags: []
---

# Change: Add MFA

## Why

Security improvement.

## Delta Summary

- ADDED requirement "MFA Support" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Add MFA flow.

## Impact

Identity system changes.

## Tasks

- [ ] Implement MFA

## Validation

- All scenarios pass
`);

      writeNote(tempDir, 'wiki/04-changes/chg-b.md', `---
type: change
id: chg-b
status: proposed
created_at: "2026-01-02"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
tags: []
---

# Change: Add OAuth

## Why

Third-party login support.

## Delta Summary

- ADDED requirement "OAuth Login" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Add OAuth flow.

## Impact

Identity system changes.

## Tasks

- [ ] Implement OAuth

## Validation

- All scenarios pass
`);

      const index = buildIndex(tempDir);
      const result = analyzeSequencing(index.records);

      // Both touch the same feature -> conflict_candidate
      expect(result.status).toBe('conflict_candidate');
      expect(result.pairwise_severities).toHaveLength(1);

      // Deterministic ordering: earlier created_at first
      expect(result.ordering.length).toBeGreaterThanOrEqual(2);
      const posA = result.ordering.find((o) => o.id === 'chg-a')!;
      const posB = result.ordering.find((o) => o.id === 'chg-b')!;
      expect(posA.position).toBeLessThan(posB.position);
    });

    it('should detect blocked when dependency is not applied', () => {
      writeSystemNote(tempDir);

      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags: [auth]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Auth feature.

## Current Behavior

Password login.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Password Login

The system SHALL allow password login.

#### Scenario: Basic login

WHEN credentials submitted
THEN user authenticated
`);

      writeNote(tempDir, 'wiki/04-changes/chg-base.md', `---
type: change
id: chg-base
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Base Change

## Why

Foundation work.

## Delta Summary

- ADDED requirement "Base Req" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Add base requirement.

## Impact

None.

## Tasks

- [ ] Do base work

## Validation

- Passes
`);

      writeNote(tempDir, 'wiki/04-changes/chg-dependent.md', `---
type: change
id: chg-dependent
status: proposed
created_at: "2026-01-02"
feature: "[[Feature: Auth Login]]"
depends_on:
  - "[[Change: Base Change]]"
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Dependent Change

## Why

Builds on base.

## Delta Summary

- ADDED requirement "Dependent Req" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Add dependent requirement.

## Impact

None.

## Tasks

- [ ] Do dependent work

## Validation

- Passes
`);

      const index = buildIndex(tempDir);
      const result = analyzeSequencing(index.records);

      // chg-dependent depends on chg-base which is not applied -> blocked
      expect(result.status).toBe('blocked');
      expect(result.pairwise_severities.some((s) => s.severity === 'blocked')).toBe(true);
    });

    it('should detect parallel_safe when dependency is already applied', () => {
      writeSystemNote(tempDir);

      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags: [auth]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Auth feature.

## Current Behavior

Password login.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Password Login

The system SHALL allow password login.

#### Scenario: Basic login

WHEN credentials submitted
THEN user authenticated
`);

      // Base change is already applied
      writeNote(tempDir, 'wiki/04-changes/chg-base.md', `---
type: change
id: chg-base
status: applied
created_at: "2026-01-01"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Base Change

## Why

Foundation work.

## Delta Summary

- ADDED requirement "Base Req" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Add base requirement.

## Impact

None.

## Tasks

- [x] Do base work

## Validation

- Passes
`);

      writeNote(tempDir, 'wiki/04-changes/chg-dependent.md', `---
type: change
id: chg-dependent
status: proposed
created_at: "2026-01-02"
feature: "[[Feature: Auth Login]]"
depends_on:
  - "[[Change: Base Change]]"
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Dependent Change

## Why

Builds on base.

## Delta Summary

- ADDED requirement "Dependent Req" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Add dependent requirement.

## Impact

None.

## Tasks

- [ ] Do dependent work

## Validation

- Passes
`);

      const index = buildIndex(tempDir);
      const result = analyzeSequencing(index.records);

      // Only 1 active change (chg-dependent), dependency is applied -> parallel_safe
      expect(result.status).toBe('parallel_safe');
      const depEntry = result.ordering.find((o) => o.id === 'chg-dependent');
      expect(depEntry).toBeDefined();
      expect(depEntry!.blocked_by).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────
  // Test 3: Requirement-level conflict
  // ─────────────────────────────────────────────

  describe('Test 3: Requirement-level conflict', () => {
    it('should detect conflict_critical when 2 changes MODIFY the same requirement', () => {
      writeSystemNote(tempDir);

      const reqHash = computeReqHash('The system SHALL allow password login.');

      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags: [auth]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Auth feature.

## Current Behavior

Password login.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Password Login

The system SHALL allow password login.

#### Scenario: Basic login

WHEN credentials submitted
THEN user authenticated
`);

      writeNote(tempDir, 'wiki/04-changes/chg-modify-a.md', `---
type: change
id: chg-modify-a
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Modify Password Login A

## Why

Tighten password requirements.

## Delta Summary

- MODIFIED requirement "Password Login" in [[Feature: Auth Login]] [base: ${reqHash}]

## Proposed Update

Update password policy.

## Impact

None.

## Tasks

- [ ] Update password policy

## Validation

- Passes
`);

      writeNote(tempDir, 'wiki/04-changes/chg-modify-b.md', `---
type: change
id: chg-modify-b
status: proposed
created_at: "2026-01-02"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Modify Password Login B

## Why

Add rate limiting to login.

## Delta Summary

- MODIFIED requirement "Password Login" in [[Feature: Auth Login]] [base: ${reqHash}]

## Proposed Update

Implement rate limiting.

## Impact

None.

## Tasks

- [ ] Implement rate limiting

## Validation

- Passes
`);

      const index = buildIndex(tempDir);
      const result = analyzeSequencing(index.records);

      expect(result.status).toBe('conflict_critical');
      expect(result.requirement_conflicts).toHaveLength(1);
      expect(result.requirement_conflicts[0].requirement_name).toBe('Password Login');
      expect(result.requirement_conflicts[0].this_op).toBe('MODIFIED');
      expect(result.requirement_conflicts[0].other_op).toBe('MODIFIED');
    });
  });

  // ─────────────────────────────────────────────
  // Test 4: Stale base detection
  // ─────────────────────────────────────────────

  describe('Test 4: Stale base detection', () => {
    it('should detect stale base and block apply when feature requirement changes', () => {
      writeSystemNote(tempDir);

      const originalNormative = 'The system SHALL allow password login.';
      const originalHash = computeReqHash(originalNormative);

      // Step 1: Create feature with known requirement hash
      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags: [auth]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Auth feature.

## Current Behavior

Password login.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Password Login

${originalNormative}

#### Scenario: Basic login

WHEN credentials submitted
THEN user authenticated
`);

      // Step 2: Create change with base_fingerprint matching original hash
      writeNote(tempDir, 'wiki/04-changes/chg-modify.md', `---
type: change
id: chg-modify
status: in_progress
created_at: "2026-01-01"
feature: "[[Feature: Auth Login]]"
depends_on: []
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Modify Password Login

## Why

Update password policy.

## Delta Summary

- MODIFIED requirement "Password Login" in [[Feature: Auth Login]] [base: ${originalHash}]

## Proposed Update

New password rules.

## Impact

None.

## Tasks

- [x] Update password policy

## Validation

- Passes
`);

      // Step 3: Modify the feature requirement directly (simulating another change)
      const modifiedNormative = 'The system SHALL allow password login with MFA.';
      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags: [auth]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Auth feature.

## Current Behavior

Password login with MFA.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Password Login

${modifiedNormative}

#### Scenario: Basic login

WHEN credentials submitted
THEN user authenticated
`);

      // Step 4: Build index and attempt apply
      const index = buildIndex(tempDir);
      const deps = makeApplyDeps(tempDir);
      const result = applyChange(
        { changeId: 'chg-modify', vaultRoot: tempDir },
        index,
        deps,
      );

      // Should be blocked due to stale base
      expect(result.success).toBe(false);
      expect(result.staleReport.blocked).toBe(true);
      expect(result.staleReport.hasStaleEntries).toBe(true);

      // Sequencing-level stale detection
      const seqResult = analyzeSequencing(index.records);
      expect(seqResult.stale_bases.length).toBeGreaterThan(0);
      expect(seqResult.stale_bases[0].change_id).toBe('chg-modify');
    });
  });

  // ─────────────────────────────────────────────
  // Test 5: Edge cases
  // ─────────────────────────────────────────────

  describe('Test 5: Edge cases', () => {
    it('empty vault: verify passes for semantic notes (no notes = no errors)', () => {
      // initVault creates schema.md which has non-typed frontmatter.
      // The build index correctly skips meta-type notes.
      // Verify on an empty records set passes (no semantic note issues).
      const index = buildIndex(tempDir);

      // Filter only semantic issues (ignore vault_integrity warnings from meta files)
      const semanticErrors = index.warnings.filter(
        (w) => !w.note_path.includes('00-meta'),
      );
      expect(semanticErrors).toHaveLength(0);

      // Seed notes (source-seed-context + system-default) are present after init
      expect(index.records.size).toBe(2);
    });

    it('orphan Change with no Feature: verify detects issues', () => {
      writeNote(tempDir, 'wiki/04-changes/orphan-change.md', `---
type: change
id: orphan-change
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: Nonexistent]]"
depends_on: []
touches: []
systems: []
sources: []
decisions: []
tags: []
---

# Change: Orphan Change

## Why

No feature link.

## Delta Summary

- ADDED requirement "Something" to [[Feature: Nonexistent]] [base: n/a]

## Proposed Update

Add something.

## Impact

None.

## Tasks

- [ ] Do work

## Validation

- Passes
`);

      const index = buildIndex(tempDir);

      // Unresolved wikilink warning for the missing feature
      expect(index.warnings.some((w) => w.type === 'unresolved_wikilink')).toBe(true);

      const report = verify(index);
      // Should have vault integrity issues
      const integrityIssues = report.issues.filter(
        (i) => i.dimension === 'vault_integrity',
      );
      expect(integrityIssues.length).toBeGreaterThan(0);
    });

    it('circular depends_on: sequencing should detect cycle', () => {
      writeSystemNote(tempDir);

      writeNote(tempDir, 'wiki/03-features/auth-login.md', `---
type: feature
id: auth-login
status: active
tags: [auth]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Auth Login

## Purpose

Auth feature.

## Current Behavior

Password login.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Password Login

The system SHALL allow password login.

#### Scenario: Basic login

WHEN credentials submitted
THEN user authenticated
`);

      writeNote(tempDir, 'wiki/04-changes/cycle-a.md', `---
type: change
id: cycle-a
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: Auth Login]]"
depends_on:
  - "[[Change: Cycle B]]"
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Cycle A

## Why

Part of a cycle.

## Delta Summary

- ADDED requirement "Cycle A Req" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Cycle A update.

## Impact

None.

## Tasks

- [ ] Work A

## Validation

- Passes
`);

      writeNote(tempDir, 'wiki/04-changes/cycle-b.md', `---
type: change
id: cycle-b
status: proposed
created_at: "2026-01-02"
feature: "[[Feature: Auth Login]]"
depends_on:
  - "[[Change: Cycle A]]"
touches:
  - "[[Feature: Auth Login]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Cycle B

## Why

Part of a cycle.

## Delta Summary

- ADDED requirement "Cycle B Req" to [[Feature: Auth Login]] [base: n/a]

## Proposed Update

Cycle B update.

## Impact

None.

## Tasks

- [ ] Work B

## Validation

- Passes
`);

      const index = buildIndex(tempDir);
      const result = analyzeSequencing(index.records);

      expect(result.cycles.length).toBeGreaterThan(0);
      const cycleIds = result.cycles[0].cycle;
      expect(cycleIds).toContain('cycle-a');
      expect(cycleIds).toContain('cycle-b');
      expect(result.reasons.some((r) => r.includes('cycle'))).toBe(true);
    });

    it('Unicode in all fields: notes with Korean/emoji in titles and requirements', () => {
      writeSystemNote(tempDir);

      writeNote(tempDir, 'wiki/03-features/korean-feature.md', `---
type: feature
id: korean-feature
status: active
tags:
  - "\uD55C\uAD6D\uC5B4"
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: \uC0AC\uC6A9\uC790 \uC778\uC99D

## Purpose

\uC0AC\uC6A9\uC790 \uC778\uC99D \uBC0F \uAD8C\uD55C \uAD00\uB9AC \uAE30\uB2A5\uC744 \uC81C\uACF5\uD569\uB2C8\uB2E4.

## Current Behavior

\uBE44\uBC00\uBC88\uD638 \uAE30\uBC18 \uB85C\uADF8\uC778\uC744 \uC9C0\uC6D0\uD569\uB2C8\uB2E4.

## Constraints

\uC5C6\uC74C.

## Known Gaps

\uC5C6\uC74C.

## Requirements

### Requirement: \uBE44\uBC00\uBC88\uD638 \uB85C\uADF8\uC778

\uC2DC\uC2A4\uD15C\uC740 \uC774\uBA54\uC77C\uACFC \uBE44\uBC00\uBC88\uD638\uB85C \uC778\uC99D\uC744 \uD5C8\uC6A9\uD574\uC57C \uD569\uB2C8\uB2E4(SHALL).

#### Scenario: \uC131\uACF5\uC801\uC778 \uB85C\uADF8\uC778

WHEN \uC0AC\uC6A9\uC790\uAC00 \uC720\uD6A8\uD55C \uC774\uBA54\uC77C\uACFC \uBE44\uBC00\uBC88\uD638\uB97C \uC81C\uCD9C
THEN \uC2DC\uC2A4\uD15C\uC740 JWT \uC138\uC158 \uD1A0\uD070\uC744 \uBC18\uD658
`);

      writeNote(tempDir, 'wiki/04-changes/emoji-change.md', `---
type: change
id: emoji-change
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: \uC0AC\uC6A9\uC790 \uC778\uC99D]]"
depends_on: []
touches:
  - "[[Feature: \uC0AC\uC6A9\uC790 \uC778\uC99D]]"
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
tags:
  - "\uD83D\uDD12"
---

# Change: \uD328\uC2A4\uD0A4 \uC9C0\uC6D0 \uCD94\uAC00 \uD83D\uDD11

## Why

\uD328\uC2A4\uC6CC\uB4DC\uB9AC\uC2A4 \uC778\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.

## Delta Summary

- ADDED requirement "\uD328\uC2A4\uD0A4 \uC778\uC99D" to [[Feature: \uC0AC\uC6A9\uC790 \uC778\uC99D]] [base: n/a]

## Proposed Update

WebAuthn \uD328\uC2A4\uD0A4 \uD50C\uB85C\uC6B0 \uCD94\uAC00.

## Impact

\uC778\uC99D \uC2DC\uC2A4\uD15C \uBCC0\uACBD.

## Tasks

- [ ] WebAuthn \uAD6C\uD604

## Validation

- \uD1B5\uACFC
`);

      const index = buildIndex(tempDir);

      // Korean feature should be indexed
      expect(index.records.has('korean-feature')).toBe(true);
      const feat = index.records.get('korean-feature')!;
      expect(feat.title).toContain('\uC0AC\uC6A9\uC790 \uC778\uC99D');
      expect(feat.requirements.length).toBeGreaterThan(0);
      expect(feat.requirements[0].name).toBe('\uBE44\uBC00\uBC88\uD638 \uB85C\uADF8\uC778');

      // Emoji change should be indexed
      expect(index.records.has('emoji-change')).toBe(true);
      const chg = index.records.get('emoji-change')!;
      expect(chg.title).toContain('\uD328\uC2A4\uD0A4');

      // Verify should not crash on Unicode content
      const report = verify(index);
      expect(report).toBeDefined();
      expect(report.scanned_at).toBeDefined();
    });

    it('very large vault: index build performance should be acceptable (<2s)', () => {
      writeSystemNote(tempDir);

      const noteCount = 55;

      for (let i = 0; i < noteCount; i++) {
        if (i < 20) {
          // Features
          writeNote(tempDir, `wiki/03-features/feat-${i}.md`, `---
type: feature
id: feat-${i}
status: active
tags: [perf-test]
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Performance Test ${i}

## Purpose

Test feature ${i} for performance testing.

## Current Behavior

Standard behavior ${i}.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Req ${i}

The system SHALL handle requirement ${i}.

#### Scenario: Basic scenario ${i}

WHEN action ${i} is triggered
THEN result ${i} is produced
`);
        } else if (i < 35) {
          // Changes
          const featIdx = i % 20;
          writeNote(tempDir, `wiki/04-changes/chg-${i}.md`, `---
type: change
id: chg-${i}
status: proposed
created_at: "2026-01-${String((i % 28) + 1).padStart(2, '0')}"
feature: "[[Feature: Performance Test ${featIdx}]]"
depends_on: []
touches:
  - "[[Feature: Performance Test ${featIdx}]]"
systems: []
sources: []
decisions: []
tags: [perf-test]
---

# Change: Perf Change ${i}

## Why

Performance test change ${i}.

## Delta Summary

- ADDED requirement "Perf Req ${i}" to [[Feature: Performance Test ${featIdx}]] [base: n/a]

## Proposed Update

Perf update ${i}.

## Impact

None.

## Tasks

- [ ] Task ${i}

## Validation

- Passes
`);
        } else if (i < 45) {
          // Systems
          writeNote(tempDir, `wiki/02-systems/sys-${i}.md`, `---
type: system
id: sys-${i}
status: active
tags: [perf-test]
---

# System: Perf System ${i}

## Purpose

Performance test system ${i}.
`);
        } else {
          // Decisions
          writeNote(tempDir, `wiki/05-decisions/dec-${i}.md`, `---
type: decision
id: dec-${i}
status: active
tags: [perf-test]
---

# Decision: Perf Decision ${i}

## Context

Performance test decision ${i}.

## Decision

Decided option ${i}.
`);
        }
      }

      const start = performance.now();
      const index = buildIndex(tempDir);
      const elapsed = performance.now() - start;

      // 20 features + 15 changes + 10 systems + 10 decisions + 1 identity-system = 56
      expect(index.records.size).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(2000); // Must complete under 2 seconds

      // Also verify the large vault
      const report = verify(index);
      expect(report.total_notes).toBeGreaterThanOrEqual(50);
      expect(report).toBeDefined();
    });

    it('change with missing feature wikilink: index warning produced', () => {
      writeNote(tempDir, 'wiki/04-changes/broken-ref.md', `---
type: change
id: broken-ref
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: Does Not Exist]]"
depends_on: []
touches: []
systems: []
sources: []
decisions: []
tags: []
---

# Change: Broken Reference

## Why

Testing broken wikilinks.

## Delta Summary

- ADDED requirement "Ghost" to [[Feature: Does Not Exist]] [base: n/a]

## Proposed Update

Fix reference.

## Impact

None.

## Tasks

- [ ] Fix reference

## Validation

- Passes
`);

      const index = buildIndex(tempDir);

      // Should have warnings about unresolved wikilinks
      expect(index.warnings.some((w) => w.type === 'unresolved_wikilink')).toBe(true);
    });

    it('query workflow with empty question throws error', () => {
      const index = buildIndex(tempDir);
      expect(() => queryWorkflow({ question: '' }, index)).toThrow('must not be empty');
      expect(() => queryWorkflow({ question: '   ' }, index)).toThrow('must not be empty');
    });

    it('sequencing with single active change returns parallel_safe', () => {
      writeSystemNote(tempDir);

      writeNote(tempDir, 'wiki/03-features/solo-feat.md', `---
type: feature
id: solo-feat
status: active
tags: []
systems:
  - "[[System: Identity]]"
sources: []
decisions: []
changes: []
---

# Feature: Solo Feature

## Purpose

Single feature.

## Current Behavior

Standard behavior.

## Constraints

None.

## Known Gaps

None.

## Requirements

### Requirement: Solo Req

The system SHALL handle solo operations.

#### Scenario: Solo scenario

WHEN solo action triggered
THEN solo result produced
`);

      writeNote(tempDir, 'wiki/04-changes/solo-change.md', `---
type: change
id: solo-change
status: proposed
created_at: "2026-01-01"
feature: "[[Feature: Solo Feature]]"
depends_on: []
touches:
  - "[[Feature: Solo Feature]]"
systems: []
sources: []
decisions: []
tags: []
---

# Change: Solo Change

## Why

Only one change.

## Delta Summary

- ADDED requirement "New Solo Req" to [[Feature: Solo Feature]] [base: n/a]

## Proposed Update

Add solo requirement.

## Impact

None.

## Tasks

- [ ] Single task

## Validation

- Passes
`);

      const index = buildIndex(tempDir);
      const result = analyzeSequencing(index.records);

      expect(result.status).toBe('parallel_safe');
      expect(result.ordering).toHaveLength(1);
      expect(result.ordering[0].id).toBe('solo-change');
      expect(result.cycles).toHaveLength(0);
      expect(result.requirement_conflicts).toHaveLength(0);
    });
  });
});
