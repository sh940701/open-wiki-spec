import { describe, it, expect, vi } from 'vitest';
import { continueChange } from '../../../../src/core/workflow/continue/continue.js';
import type { ContinueDeps } from '../../../../src/core/workflow/continue/types.js';
import type { VaultIndex, IndexRecord } from '../../../../src/types/index-record.js';
import type { SequencingResult } from '../../../../src/types/sequencing.js';
import type { ParseResult, Section } from '../../../../src/core/parser/types.js';

function makeRecord(overrides: Partial<IndexRecord> = {}): IndexRecord {
  return {
    schema_version: '1',
    id: 'change-test',
    type: 'change',
    title: 'Test Change',
    aliases: [],
    path: 'wiki/04-changes/change-test.md',
    status: 'proposed',
    created_at: '2026-01-01',
    tags: [],
    systems: [],
    sources: [],
    decisions: [],
    changes: [],
    feature: 'feature-auth',
    depends_on: [],
    touches: ['feature-auth'],
    links_out: [],
    links_in: [],
    headings: [],
    requirements: [],
    delta_summary: [],
    tasks: [],
    raw_text: '',
    content_hash: 'sha256:test',
    ...overrides,
  };
}

function makeIndex(records: IndexRecord[] = []): VaultIndex {
  const map = new Map<string, IndexRecord>();
  for (const r of records) map.set(r.id, r);
  return {
    schema_version: '1',
    scanned_at: new Date().toISOString(),
    vaultRoot: '/tmp/test-vault',
    records: map,
    warnings: [],
  };
}

function makeSequencingResult(): SequencingResult {
  return {
    status: 'parallel_safe',
    pairwise_severities: [],
    requirement_conflicts: [],
    ordering: [],
    cycles: [],
    stale_bases: [],
    out_of_order_errors: [],
    reasons: [],
    related_changes: [],
  };
}

function makeSections(names: string[], content = 'Some content'): Section[] {
  return names.map((name, i) => ({
    level: 2,
    title: name,
    content,
    line: i * 10 + 3,
    children: [],
  }));
}

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    frontmatter: null,
    rawFrontmatter: null,
    sections: [],
    headings: [],
    wikilinks: [],
    requirements: [],
    deltaSummary: [],
    tasks: [],
    body: '',
    contentHash: 'sha256:test',
    errors: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ContinueDeps> = {}): ContinueDeps {
  return {
    analyzeSequencing: vi.fn().mockReturnValue(makeSequencingResult()),
    parseNote: vi.fn().mockReturnValue(makeParsed()),
    writeFile: vi.fn(),
    readFile: vi.fn().mockReturnValue('---\nstatus: proposed\n---\n# Change'),
    ...overrides,
  };
}

describe('continueChange', () => {
  it('throws when no active changes exist', () => {
    const index = makeIndex();
    expect(() => continueChange(index, makeDeps())).toThrow('No active changes');
  });

  it('returns fill_section when proposed change has empty Why', () => {
    const change = makeRecord({ status: 'proposed' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: makeSections(['Delta Summary', 'Tasks', 'Validation']),
        headings: ['Delta Summary', 'Tasks', 'Validation'],
        deltaSummary: [],
        tasks: [],
      })),
    });

    const result = continueChange(index, deps);
    expect(result.nextAction.action).toBe('fill_section');
    expect(result.nextAction.target).toBe('Why');
  });

  it('returns transition to planned when all hard prereqs met', () => {
    const change = makeRecord({ status: 'proposed' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: makeSections(['Why', 'Delta Summary', 'Tasks', 'Validation']),
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
        tasks: [{ text: 'task1', done: false, line: 1 }],
      })),
      readFile: vi.fn().mockReturnValue('---\nstatus: proposed\n---\n# Change'),
    });

    const result = continueChange(index, deps);
    // After auto-transition proposed->planned, nextAction reflects the NEW state
    expect(result.nextAction.action).toBe('start_implementation');
    expect(result.currentStatus).toBe('planned');
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it('returns blocked when planned change has unresolved depends_on', () => {
    const change = makeRecord({
      status: 'planned',
      depends_on: ['change-other'],
    });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: makeSections(['Why', 'Delta Summary', 'Tasks', 'Validation']),
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
        tasks: [{ text: 'task1', done: false, line: 1 }],
      })),
      analyzeSequencing: vi.fn().mockReturnValue({
        ...makeSequencingResult(),
        ordering: [{ id: 'change-test', depth: 1, position: 1, blocked_by: ['change-other'], conflicts_with: [] }],
      }),
    });

    const result = continueChange(index, deps);
    expect(result.nextAction.action).toBe('blocked');
  });

  it('returns start_implementation when planned with tasks available', () => {
    const change = makeRecord({ status: 'planned' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: makeSections(['Why', 'Delta Summary', 'Tasks', 'Validation']),
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
        tasks: [{ text: 'task1', done: false, line: 1 }],
      })),
      readFile: vi.fn().mockReturnValue('---\nstatus: planned\n---\n# Change'),
    });

    const result = continueChange(index, deps);
    // After auto-transition planned->in_progress, nextAction reflects the NEW state
    expect(result.nextAction.action).toBe('continue_task');
    expect(result.currentStatus).toBe('in_progress');
    // Should also transition to in_progress
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it('returns continue_task when in_progress with unchecked tasks', () => {
    const change = makeRecord({ status: 'in_progress' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: makeSections(['Why', 'Delta Summary', 'Tasks', 'Validation']),
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
        tasks: [
          { text: 'task1', done: true, line: 1 },
          { text: 'task2', done: false, line: 2 },
        ],
      })),
    });

    const result = continueChange(index, deps);
    expect(result.nextAction.action).toBe('continue_task');
  });

  it('returns ready_to_apply when in_progress with all tasks complete', () => {
    const change = makeRecord({ status: 'in_progress' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: makeSections(['Why', 'Delta Summary', 'Tasks', 'Validation']),
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
        tasks: [
          { text: 'task1', done: true, line: 1 },
          { text: 'task2', done: true, line: 2 },
        ],
      })),
    });

    const result = continueChange(index, deps);
    expect(result.nextAction.action).toBe('ready_to_apply');
  });

  it('returns verify_then_archive for applied status', () => {
    const change = makeRecord({ status: 'applied' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed()),
    });

    const result = continueChange(index, deps);
    expect(result.nextAction.action).toBe('verify_then_archive');
  });

  it('selects change by explicit name', () => {
    const change1 = makeRecord({ id: 'change-one', title: 'First Change' });
    const change2 = makeRecord({ id: 'change-two', title: 'Second Change' });
    const index = makeIndex([change1, change2]);
    const deps = makeDeps();

    const result = continueChange(index, deps, { changeName: 'change-one' });
    expect(result.changeId).toBe('change-one');
  });

  it('throws when explicit name not found', () => {
    const change = makeRecord({ id: 'change-one' });
    const index = makeIndex([change]);
    expect(() => continueChange(index, makeDeps(), { changeName: 'nonexistent' }))
      .toThrow('not found');
  });

  it('gathers real section content from linked Feature notes', () => {
    const featureRecord = makeRecord({
      id: 'feature-auth',
      type: 'feature',
      title: 'Auth Login',
      status: 'active',
      headings: ['Purpose', 'Current Behavior', 'Requirements'],
      path: 'wiki/03-features/feature-auth.md',
    });
    const change = makeRecord({
      status: 'proposed',
      feature: 'feature-auth',
    });
    const index = makeIndex([change, featureRecord]);

    const featureParsed = makeParsed({
      sections: [
        { level: 2, title: 'Purpose', content: 'Handle user authentication and session management.', line: 3, children: [] },
        { level: 2, title: 'Current Behavior', content: 'Username/password login only.', line: 10, children: [] },
        { level: 2, title: 'Requirements', content: 'Must support MFA.', line: 20, children: [] },
      ],
      headings: ['Purpose', 'Current Behavior', 'Requirements'],
    });

    const deps = makeDeps({
      parseNote: vi.fn().mockImplementation((filePath: string) => {
        if (filePath.includes('feature-auth')) return featureParsed;
        return makeParsed();
      }),
    });

    const result = continueChange(index, deps);
    expect(result.context.features).toHaveLength(1);
    const featureCtx = result.context.features[0];
    expect(featureCtx.relevantSections['Purpose']).toBe('Handle user authentication and session management.');
    expect(featureCtx.relevantSections['Purpose']).not.toBe('(content from section)');
  });

  it('truncates long section content to 500 chars', () => {
    const longContent = 'A'.repeat(600);
    const featureRecord = makeRecord({
      id: 'feature-auth',
      type: 'feature',
      title: 'Auth Login',
      status: 'active',
      headings: ['Purpose'],
      path: 'wiki/03-features/feature-auth.md',
    });
    const change = makeRecord({
      status: 'proposed',
      feature: 'feature-auth',
    });
    const index = makeIndex([change, featureRecord]);

    const deps = makeDeps({
      parseNote: vi.fn().mockImplementation((filePath: string) => {
        if (filePath.includes('feature-auth')) {
          return makeParsed({
            sections: [{ level: 2, title: 'Purpose', content: longContent, line: 3, children: [] }],
            headings: ['Purpose'],
          });
        }
        return makeParsed();
      }),
    });

    const result = continueChange(index, deps);
    const purposeContent = result.context.features[0].relevantSections['Purpose'];
    expect(purposeContent.length).toBeLessThanOrEqual(503); // 500 + '...'
    expect(purposeContent.endsWith('...')).toBe(true);
  });

  it('throws with change list when multiple active changes and no changeName', () => {
    const change1 = makeRecord({ id: 'change-one', title: 'First Change', status: 'proposed' });
    const change2 = makeRecord({ id: 'change-two', title: 'Second Change', status: 'planned' });
    const index = makeIndex([change1, change2]);
    expect(() => continueChange(index, makeDeps())).toThrow('Multiple active changes');
  });

  it('does not execute transitions when dryRun is true', () => {
    const change = makeRecord({ status: 'proposed' });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: makeSections(['Why', 'Delta Summary', 'Tasks', 'Validation']),
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
        tasks: [{ text: 'task1', done: false, line: 1 }],
      })),
      readFile: vi.fn().mockReturnValue('---\nstatus: proposed\n---\n# Change'),
    });

    const result = continueChange(index, deps, { dryRun: true });
    // Should compute the transition action but NOT execute it
    expect(result.nextAction.action).toBe('transition');
    expect(result.currentStatus).toBe('proposed'); // status should NOT change
    expect(deps.writeFile).not.toHaveBeenCalled(); // no file writes
  });

  it('includes Decision promotion warning when Design Approach has durable rationale', () => {
    const change = makeRecord({ status: 'in_progress', touches: ['feature-auth', 'system-db'] });
    const index = makeIndex([change]);
    const deps = makeDeps({
      parseNote: vi.fn().mockReturnValue(makeParsed({
        sections: [
          ...makeSections(['Why', 'Delta Summary', 'Tasks', 'Validation']),
          { level: 2, title: 'Design Approach', content: 'We chose X over Y due to trade-off considerations', line: 50, children: [] },
        ],
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation', 'Design Approach'],
        deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
        tasks: [{ text: 'task1', done: false, line: 1 }],
      })),
    });

    const result = continueChange(index, deps);
    expect(result.context.softWarnings.some(w => w.includes('Decision note'))).toBe(true);
  });
});
