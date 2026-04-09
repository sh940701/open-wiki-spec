import { describe, it, expect, vi } from 'vitest';
import { applyChange, archiveChange } from '../../../../src/core/workflow/apply/apply.js';
import { parseDeltaSummary, validateDeltaConflicts } from '../../../../src/core/workflow/apply/delta-parser.js';
import { detectStale, computeRequirementHash } from '../../../../src/core/workflow/apply/stale-checker.js';
import { applyDeltaToFeature } from '../../../../src/core/workflow/apply/feature-updater.js';
import { verifyApply } from '../../../../src/core/workflow/apply/verify-apply.js';
import type { ApplyDeps, DeltaEntry, PendingAgentOp } from '../../../../src/core/workflow/apply/types.js';
import type { VaultIndex, IndexRecord } from '../../../../src/types/index-record.js';
import type { ParseResult, Section } from '../../../../src/core/parser/types.js';
import type { Requirement } from '../../../../src/types/requirement.js';
import { computeHash } from '../../../../src/utils/hash.js';

// ── Test Helpers ──

function makeRecord(overrides: Partial<IndexRecord> = {}): IndexRecord {
  return {
    schema_version: '1', id: 'change-test', type: 'change', title: 'Test Change',
    aliases: [], path: 'wiki/04-changes/change-test.md', status: 'in_progress',
    created_at: '2026-01-01', tags: [], systems: [], sources: [], decisions: [],
    changes: [], feature: 'feature-auth', depends_on: [], touches: ['feature-auth'],
    links_out: [], links_in: [], headings: [], requirements: [],
    delta_summary: [], tasks: [], raw_text: '', content_hash: 'sha256:test',
    ...overrides,
  };
}

function makeIndex(records: IndexRecord[] = []): VaultIndex {
  const map = new Map<string, IndexRecord>();
  for (const r of records) map.set(r.id, r);
  return { schema_version: '1', scanned_at: new Date().toISOString(), vaultRoot: '/tmp/test-vault', records: map, warnings: [] };
}

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    frontmatter: null, rawFrontmatter: null, sections: [], headings: [],
    wikilinks: [], requirements: [], deltaSummary: [], tasks: [],
    body: '', contentHash: 'sha256:test', errors: [], ...overrides,
  };
}

function makeDeps(overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    parseNote: vi.fn().mockReturnValue(makeParsed()),
    writeFile: vi.fn(),
    readFile: vi.fn().mockReturnValue('---\nstatus: in_progress\n---\n# Change'),
    fileExists: vi.fn().mockReturnValue(false),
    moveFile: vi.fn(),
    ensureDir: vi.fn(),
    exclusiveCreateFile: vi.fn(),
    ...overrides,
  };
}

function makeReq(name: string, normative: string): Requirement {
  const normalized = [normative].join('\n').trim();
  return {
    name,
    key: `feature-auth::${name}`,
    normative,
    scenarios: [],
    content_hash: `sha256:${computeHash(normalized)}`,
  };
}

// ── Delta Parser Tests ──

describe('parseDeltaSummary', () => {
  it('parses ADDED requirement entry', () => {
    const parsed = makeParsed({
      sections: [{ level: 2, title: 'Delta Summary', content: '- ADDED requirement "Login" to [[Feature: Auth]]', line: 1, children: [] }],
    });
    const result = parseDeltaSummary(parsed, () => 'feature-auth');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].op).toBe('ADDED');
    expect(result.entries[0].targetName).toBe('Login');
    expect(result.entries[0].baseFingerprint).toBeNull();
  });

  it('parses MODIFIED with base fingerprint', () => {
    const parsed = makeParsed({
      sections: [{ level: 2, title: 'Delta Summary', content: '- MODIFIED requirement "Login" in [[Feature: Auth]] [base: sha256:abc123]', line: 1, children: [] }],
    });
    const result = parseDeltaSummary(parsed, () => 'feature-auth');
    expect(result.entries[0].op).toBe('MODIFIED');
    expect(result.entries[0].baseFingerprint).toBe('sha256:abc123');
  });

  it('parses RENAMED entry', () => {
    const parsed = makeParsed({
      sections: [{ level: 2, title: 'Delta Summary', content: '- RENAMED requirement "Old" to "New" in [[Feature: Auth]] [base: sha256:abc]', line: 1, children: [] }],
    });
    const result = parseDeltaSummary(parsed, () => 'feature-auth');
    expect(result.entries[0].op).toBe('RENAMED');
    expect(result.entries[0].targetName).toBe('Old');
    expect(result.entries[0].newName).toBe('New');
  });

  it('parses section operation', () => {
    const parsed = makeParsed({
      sections: [{ level: 2, title: 'Delta Summary', content: '- MODIFIED section "Current Behavior" in [[Feature: Auth]]: updated flow', line: 1, children: [] }],
    });
    const result = parseDeltaSummary(parsed, () => 'feature-auth');
    expect(result.entries[0].targetType).toBe('section');
    expect(result.entries[0].description).toBe('updated flow');
  });

  it('warns on unparseable entries', () => {
    const parsed = makeParsed({
      sections: [{ level: 2, title: 'Delta Summary', content: '- ADDED something weird here', line: 1, children: [] }],
    });
    const result = parseDeltaSummary(parsed, () => undefined);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns warning when no Delta Summary section', () => {
    const result = parseDeltaSummary(makeParsed(), () => undefined);
    expect(result.warnings).toContain('No Delta Summary section found');
  });
});

describe('validateDeltaConflicts', () => {
  it('detects MODIFIED + REMOVED conflict', () => {
    const plan = {
      entries: [
        { op: 'MODIFIED' as const, targetType: 'requirement' as const, targetName: 'Login', targetNote: 'F', targetNoteId: 'f1', baseFingerprint: null, rawLine: '' },
        { op: 'REMOVED' as const, targetType: 'requirement' as const, targetName: 'Login', targetNote: 'F', targetNoteId: 'f1', baseFingerprint: null, rawLine: '' },
      ],
      byTargetNote: new Map([['f1', [
        { op: 'MODIFIED' as const, targetType: 'requirement' as const, targetName: 'Login', targetNote: 'F', targetNoteId: 'f1', baseFingerprint: null, rawLine: '' },
        { op: 'REMOVED' as const, targetType: 'requirement' as const, targetName: 'Login', targetNote: 'F', targetNoteId: 'f1', baseFingerprint: null, rawLine: '' },
      ]]]),
      warnings: [],
    };
    const errors = validateDeltaConflicts(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('MODIFIED + REMOVED');
  });

  it('returns empty on no conflicts', () => {
    const plan = {
      entries: [
        { op: 'ADDED' as const, targetType: 'requirement' as const, targetName: 'New', targetNote: 'F', targetNoteId: 'f1', baseFingerprint: null, rawLine: '' },
      ],
      byTargetNote: new Map([['f1', [
        { op: 'ADDED' as const, targetType: 'requirement' as const, targetName: 'New', targetNote: 'F', targetNoteId: 'f1', baseFingerprint: null, rawLine: '' },
      ]]]),
      warnings: [],
    };
    const errors = validateDeltaConflicts(plan);
    expect(errors).toHaveLength(0);
  });
});

// ── Stale Detection Tests ──

describe('detectStale', () => {
  it('ADDED is always clean', () => {
    const plan = {
      entries: [{ op: 'ADDED' as const, targetType: 'requirement' as const, targetName: 'New', targetNote: 'F', rawLine: '' } as DeltaEntry],
      byTargetNote: new Map(), warnings: [],
    };
    const result = detectStale(plan, new Map());
    expect(result.hasStaleEntries).toBe(false);
    expect(result.cleanEntries).toHaveLength(1);
  });

  it('detects stale when hash mismatch', () => {
    const req = makeReq('Login', 'User SHALL log in');
    const plan = {
      entries: [{
        op: 'MODIFIED' as const, targetType: 'requirement' as const, targetName: 'Login',
        targetNote: 'F', targetNoteId: 'f1', baseFingerprint: 'sha256:wrong', rawLine: '',
      } as DeltaEntry],
      byTargetNote: new Map(), warnings: [],
    };
    const featureReqs = new Map([['f1', new Map([['Login', req]])]]);
    const result = detectStale(plan, featureReqs);
    expect(result.hasStaleEntries).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it('clean when hash matches', () => {
    const req = makeReq('Login', 'User SHALL log in');
    const hash = computeRequirementHash(req);
    const plan = {
      entries: [{
        op: 'MODIFIED' as const, targetType: 'requirement' as const, targetName: 'Login',
        targetNote: 'F', targetNoteId: 'f1', baseFingerprint: hash, rawLine: '',
      } as DeltaEntry],
      byTargetNote: new Map(), warnings: [],
    };
    const featureReqs = new Map([['f1', new Map([['Login', req]])]]);
    const result = detectStale(plan, featureReqs);
    expect(result.hasStaleEntries).toBe(false);
  });
});

// ── Feature Updater Tests ──

describe('applyDeltaToFeature', () => {
  it('RENAMED: old->new success', () => {
    const reqs = new Map([['Old', makeReq('Old', 'test')]]);
    const entries: DeltaEntry[] = [{
      op: 'RENAMED', targetType: 'requirement', targetName: 'Old', newName: 'New',
      targetNote: 'F', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries);
    expect(result.operations[0].success).toBe(true);
    expect(reqs.has('New')).toBe(true);
    expect(reqs.has('Old')).toBe(false);
  });

  it('REMOVED: removes requirement', () => {
    const reqs = new Map([['Login', makeReq('Login', 'test')]]);
    const entries: DeltaEntry[] = [{
      op: 'REMOVED', targetType: 'requirement', targetName: 'Login',
      targetNote: 'F', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries);
    expect(result.operations[0].success).toBe(true);
    expect(reqs.has('Login')).toBe(false);
  });

  it('applies in atomic order: RENAMED before REMOVED before ADDED', () => {
    const reqs = new Map([
      ['OldName', makeReq('OldName', 'test')],
      ['ToRemove', makeReq('ToRemove', 'test')],
    ]);
    const entries: DeltaEntry[] = [
      { op: 'ADDED', targetType: 'requirement', targetName: 'Brand New', targetNote: 'F', baseFingerprint: null, rawLine: '' },
      { op: 'REMOVED', targetType: 'requirement', targetName: 'ToRemove', targetNote: 'F', baseFingerprint: null, rawLine: '' },
      { op: 'RENAMED', targetType: 'requirement', targetName: 'OldName', newName: 'NewName', targetNote: 'F', baseFingerprint: null, rawLine: '' },
    ];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries);
    // All should succeed because of atomic ordering
    expect(result.operations.every(o => o.success)).toBe(true);
    expect(result.operations[0].entry.op).toBe('RENAMED'); // first
    expect(result.operations[1].entry.op).toBe('REMOVED'); // second
    expect(result.operations[2].entry.op).toBe('ADDED');   // last
  });

  it('RENAMED fails when old name not found', () => {
    const reqs = new Map<string, Requirement>();
    const entries: DeltaEntry[] = [{
      op: 'RENAMED', targetType: 'requirement', targetName: 'Missing', newName: 'New',
      targetNote: 'F', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries);
    expect(result.operations[0].success).toBe(false);
  });
});

// ── Feature Updater with file content ──

describe('applyDeltaToFeature with file content', () => {
  const sampleFeature = `---
type: feature
id: user-auth
status: active
---

# Feature: User Auth

## Purpose

User authentication via password login.

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
`;

  it('RENAMED changes heading text in file content', () => {
    const reqs = new Map([['Password Login', makeReq('Password Login', 'The system SHALL allow users to authenticate using email and password.')]]);
    const entries: DeltaEntry[] = [{
      op: 'RENAMED', targetType: 'requirement', targetName: 'Password Login', newName: 'Email Login',
      targetNote: 'F', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries, sampleFeature);
    expect(result.updatedContent).toContain('### Requirement: Email Login');
    expect(result.updatedContent).not.toContain('### Requirement: Password Login');
    // Other requirement untouched
    expect(result.updatedContent).toContain('### Requirement: Session Management');
  });

  it('REMOVED deletes entire requirement block', () => {
    const reqs = new Map([
      ['Password Login', makeReq('Password Login', 'test')],
      ['Session Management', makeReq('Session Management', 'test')],
    ]);
    const entries: DeltaEntry[] = [{
      op: 'REMOVED', targetType: 'requirement', targetName: 'Session Management',
      targetNote: 'F', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries, sampleFeature);
    expect(result.updatedContent).not.toContain('### Requirement: Session Management');
    expect(result.updatedContent).not.toContain('Token expiry');
    // Other requirement preserved
    expect(result.updatedContent).toContain('### Requirement: Password Login');
  });

  it('ADDED appends requirement skeleton', () => {
    const reqs = new Map([['Password Login', makeReq('Password Login', 'test')]]);
    const entries: DeltaEntry[] = [{
      op: 'ADDED', targetType: 'requirement', targetName: 'OAuth Login',
      targetNote: 'change-1', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries, sampleFeature);
    expect(result.updatedContent).toContain('### Requirement: OAuth Login');
    expect(result.updatedContent).toContain('<!-- ADDED by change:');
  });

  it('MODIFIED inserts marker comment', () => {
    const reqs = new Map([['Password Login', makeReq('Password Login', 'test')]]);
    const entries: DeltaEntry[] = [{
      op: 'MODIFIED', targetType: 'requirement', targetName: 'Password Login',
      targetNote: 'change-1', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries, sampleFeature);
    expect(result.updatedContent).toContain('<!-- MODIFIED by change:');
    // Heading still present
    expect(result.updatedContent).toContain('### Requirement: Password Login');
  });

  it('preserves content outside Requirements section', () => {
    const reqs = new Map([
      ['Password Login', makeReq('Password Login', 'test')],
      ['Session Management', makeReq('Session Management', 'test')],
    ]);
    const entries: DeltaEntry[] = [{
      op: 'REMOVED', targetType: 'requirement', targetName: 'Session Management',
      targetNote: 'F', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries, sampleFeature);
    // Content before Requirements must be preserved
    const reqIndex = sampleFeature.indexOf('## Requirements');
    const beforeOriginal = sampleFeature.slice(0, reqIndex);
    const reqIndexAfter = result.updatedContent.indexOf('## Requirements');
    const beforeAfter = result.updatedContent.slice(0, reqIndexAfter);
    expect(beforeAfter).toBe(beforeOriginal);
  });

  it('returns empty updatedContent when no fileContent provided (legacy)', () => {
    const reqs = new Map([['Old', makeReq('Old', 'test')]]);
    const entries: DeltaEntry[] = [{
      op: 'RENAMED', targetType: 'requirement', targetName: 'Old', newName: 'New',
      targetNote: 'F', baseFingerprint: null, rawLine: '',
    }];
    const result = applyDeltaToFeature('f1', 'path', reqs, entries);
    expect(result.updatedContent).toBe('');
  });
});

// ── Verify Apply Tests ──

describe('verifyApply', () => {
  it('succeeds when ADDED requirement exists after agent edit', () => {
    const pendingOps: PendingAgentOp[] = [{
      entry: { op: 'ADDED', targetType: 'requirement', targetName: 'NewReq', targetNote: 'F', baseFingerprint: null, rawLine: '' },
      featureId: 'f1',
      featurePath: 'path',
    }];
    const snapshots = new Map<string, Map<string, string>>();
    const getReqs = () => new Map([['NewReq', makeReq('NewReq', 'new normative')]]);

    const deps = makeDeps();
    const result = verifyApply('change-test', 'change-path', pendingOps, snapshots, getReqs, deps);
    expect(result.success).toBe(true);
    expect(result.statusTransitioned).toBe(true);
  });

  it('fails when ADDED requirement missing after agent edit', () => {
    const pendingOps: PendingAgentOp[] = [{
      entry: { op: 'ADDED', targetType: 'requirement', targetName: 'MissingReq', targetNote: 'F', baseFingerprint: null, rawLine: '' },
      featureId: 'f1',
      featurePath: 'path',
    }];
    const snapshots = new Map<string, Map<string, string>>();
    const getReqs = () => new Map<string, Requirement>(); // empty

    const deps = makeDeps();
    const result = verifyApply('change-test', 'change-path', pendingOps, snapshots, getReqs, deps);
    expect(result.success).toBe(false);
    expect(result.statusTransitioned).toBe(false);
  });

  it('detects MODIFIED no-op using preEditSnapshot comparison', () => {
    const req = makeReq('Login', 'User SHALL log in');
    const hash = computeRequirementHash(req);

    const pendingOps: PendingAgentOp[] = [{
      entry: { op: 'MODIFIED', targetType: 'requirement', targetName: 'Login', targetNote: 'F', baseFingerprint: hash, rawLine: '' },
      featureId: 'f1',
      featurePath: 'path',
    }];

    // Snapshot hash == current hash == base hash -> no-op
    const snapshots = new Map([['f1', new Map([['Login', hash]])]]);
    const getReqs = () => new Map([['Login', req]]);

    const deps = makeDeps();
    const result = verifyApply('change-test', 'change-path', pendingOps, snapshots, getReqs, deps);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('unchanged');
  });
});

// ── Main Apply Tests ──

describe('applyChange', () => {
  it('throws on non-in_progress status', () => {
    const change = makeRecord({ status: 'proposed' });
    const index = makeIndex([change]);
    expect(() => applyChange({ changeId: 'change-test', vaultRoot: '/tmp/test-vault' }, index, makeDeps()))
      .toThrow('Cannot apply change with status "proposed"');
  });

  it('throws when unchecked tasks remain', () => {
    const change = makeRecord({ status: 'in_progress' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        tasks: [
          { text: 'task1', done: true, line: 1 },
          { text: 'task2', done: false, line: 2 },
        ],
      })),
    });
    expect(() => applyChange({ changeId: 'change-test', vaultRoot: '/tmp/test-vault' }, index, deps))
      .toThrow('unchecked task');
  });

  it('returns success=false when no delta entries', () => {
    const change = makeRecord({ status: 'in_progress' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({ tasks: [{ text: 'done', done: true, line: 1 }] })),
    });
    const result = applyChange({ changeId: 'change-test', vaultRoot: '/tmp/test-vault' }, index, deps);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('No Delta Summary');
  });

  it('transitions to applied when only programmatic ops and all pass', () => {
    const change = makeRecord({ status: 'in_progress' });
    const feature = makeRecord({
      id: 'feature-auth', type: 'feature', title: 'Auth',
      path: 'wiki/03-features/feature-auth.md',
    });
    const index = makeIndex([change, feature]);

    const req = makeReq('OldLogin', 'User SHALL log in');
    const reqHash = computeRequirementHash(req);
    const parseResults = new Map<string, ParseResult>();
    const vaultRoot = '/tmp/test-vault';
    parseResults.set(`${vaultRoot}/${change.path}`, makeParsed({
      tasks: [{ text: 'done', done: true, line: 1 }],
      sections: [{
        level: 2, title: 'Delta Summary',
        content: `- REMOVED requirement "OldLogin" from [[Auth]] [base: ${reqHash}]`,
        line: 1, children: [],
      }],
    }));
    parseResults.set(`${vaultRoot}/${feature.path}`, makeParsed({
      requirements: [req],
    }));

    const deps = makeDeps({
      parseNote: vi.fn().mockImplementation((path: string) => parseResults.get(path) ?? makeParsed()),
      readFile: vi.fn().mockReturnValue('---\nstatus: in_progress\n---\n'),
    });

    const result = applyChange({ changeId: 'change-test', vaultRoot: '/tmp/test-vault' }, index, deps);
    expect(result.success).toBe(true);
    expect(result.statusTransitioned).toBe(true);
  });
});

// ── Section Operation Rejection Tests ──

describe('applyChange section ops', () => {
  it('rejects section-level operations with clear error message', () => {
    const change = makeRecord({ status: 'in_progress' });
    const feature = makeRecord({
      id: 'feature-auth', type: 'feature', title: 'Auth',
      path: 'wiki/03-features/feature-auth.md',
    });
    const index = makeIndex([change, feature]);

    const req = makeReq('Login', 'User SHALL log in');
    const reqHash = computeRequirementHash(req);
    const vaultRoot = '/tmp/test-vault';
    const parseResults = new Map<string, ParseResult>();
    parseResults.set(`${vaultRoot}/${change.path}`, makeParsed({
      tasks: [{ text: 'done', done: true, line: 1 }],
      sections: [{
        level: 2, title: 'Delta Summary',
        content: `- MODIFIED section "Current Behavior" in [[Auth]]: updated flow\n- REMOVED requirement "Login" from [[Auth]] [base: ${reqHash}]`,
        line: 1, children: [],
      }],
    }));
    parseResults.set(`${vaultRoot}/${feature.path}`, makeParsed({
      requirements: [req],
    }));

    const deps = makeDeps({
      parseNote: vi.fn().mockImplementation((path: string) => parseResults.get(path) ?? makeParsed()),
      readFile: vi.fn().mockReturnValue('---\nstatus: in_progress\n---\n'),
    });

    const result = applyChange({ changeId: 'change-test', vaultRoot }, index, deps);
    // Section ops should hard-fail the entire apply
    expect(result.sectionResults).toHaveLength(1);
    expect(result.sectionResults[0].success).toBe(false);
    expect(result.sectionResults[0].error).toContain('not yet supported');
    // Apply must fail when section ops are present
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('section-level operations'))).toBe(true);
  });
});

// ── Atomic Write Tests ──

describe('applyChange atomic writes', () => {
  it('writes to temp files then renames', () => {
    const change = makeRecord({ status: 'in_progress' });
    const feature = makeRecord({
      id: 'feature-auth', type: 'feature', title: 'Auth',
      path: 'wiki/03-features/feature-auth.md',
    });
    const index = makeIndex([change, feature]);

    const req = makeReq('OldLogin', 'User SHALL log in');
    const reqHash = computeRequirementHash(req);
    const vaultRoot = '/tmp/test-vault';
    const parseResults = new Map<string, ParseResult>();
    parseResults.set(`${vaultRoot}/${change.path}`, makeParsed({
      tasks: [{ text: 'done', done: true, line: 1 }],
      sections: [{
        level: 2, title: 'Delta Summary',
        content: `- REMOVED requirement "OldLogin" from [[Auth]] [base: ${reqHash}]`,
        line: 1, children: [],
      }],
    }));
    parseResults.set(`${vaultRoot}/${feature.path}`, makeParsed({
      requirements: [req],
    }));

    const writtenFiles: string[] = [];
    const movedFiles: { from: string; to: string }[] = [];
    const deps = makeDeps({
      parseNote: vi.fn().mockImplementation((path: string) => parseResults.get(path) ?? makeParsed()),
      readFile: vi.fn().mockReturnValue('---\nstatus: in_progress\n---\n'),
      writeFile: vi.fn().mockImplementation((path: string) => { writtenFiles.push(path); }),
      moveFile: vi.fn().mockImplementation((from: string, to: string) => { movedFiles.push({ from, to }); }),
    });

    const result = applyChange({ changeId: 'change-test', vaultRoot }, index, deps);
    expect(result.success).toBe(true);

    // Temp files should be written first (with timestamped suffix)
    expect(writtenFiles.some(f => f.includes('.ows-tmp-'))).toBe(true);
    // Then renamed to final paths
    expect(movedFiles.some(m => m.from.includes('.ows-tmp-'))).toBe(true);
  });

  it('cleans up temp files on rename failure', () => {
    const change = makeRecord({ status: 'in_progress' });
    const feature = makeRecord({
      id: 'feature-auth', type: 'feature', title: 'Auth',
      path: 'wiki/03-features/feature-auth.md',
    });
    const index = makeIndex([change, feature]);

    const req = makeReq('OldLogin', 'User SHALL log in');
    const reqHash = computeRequirementHash(req);
    const vaultRoot = '/tmp/test-vault';
    const parseResults = new Map<string, ParseResult>();
    parseResults.set(`${vaultRoot}/${change.path}`, makeParsed({
      tasks: [{ text: 'done', done: true, line: 1 }],
      sections: [{
        level: 2, title: 'Delta Summary',
        content: `- REMOVED requirement "OldLogin" from [[Auth]] [base: ${reqHash}]`,
        line: 1, children: [],
      }],
    }));
    parseResults.set(`${vaultRoot}/${feature.path}`, makeParsed({
      requirements: [req],
    }));

    const deletedFiles: string[] = [];
    const deps = makeDeps({
      parseNote: vi.fn().mockImplementation((path: string) => parseResults.get(path) ?? makeParsed()),
      readFile: vi.fn().mockReturnValue('---\nstatus: in_progress\n---\n'),
      writeFile: vi.fn(),
      moveFile: vi.fn().mockImplementation(() => { throw new Error('rename failed'); }),
      deleteFile: vi.fn().mockImplementation((path: string) => { deletedFiles.push(path); }),
    });

    const result = applyChange({ changeId: 'change-test', vaultRoot }, index, deps);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('rename'))).toBe(true);
    // Temp files should be cleaned up
    expect(deps.deleteFile).toHaveBeenCalled();
  });
});

// ── Archive Tests ──

describe('archiveChange', () => {
  it('archives applied change', () => {
    const change = makeRecord({ status: 'applied', path: 'wiki/04-changes/change-test.md' });
    const index = makeIndex([change]);
    const deps = makeDeps();

    const result = archiveChange({ changeId: 'change-test', vaultRoot: '/tmp/test-vault' }, index, deps);
    expect(result.success).toBe(true);
    expect(result.toPath).toContain('99-archive');
    expect(result.indexInvalidated).toBe(true);
    expect(deps.moveFile).toHaveBeenCalled();
  });

  it('rejects non-applied change', () => {
    const change = makeRecord({ status: 'in_progress' });
    const index = makeIndex([change]);
    const result = archiveChange({ changeId: 'change-test', vaultRoot: '/tmp/test-vault' }, index, makeDeps());
    expect(result.success).toBe(false);
    expect(result.error).toContain('in_progress');
  });

  it('rejects when archive target exists', () => {
    const change = makeRecord({ status: 'applied' });
    const index = makeIndex([change]);
    const deps = makeDeps({ fileExists: vi.fn().mockReturnValue(true) });
    const result = archiveChange({ changeId: 'change-test', vaultRoot: '/tmp/test-vault' }, index, deps);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});
