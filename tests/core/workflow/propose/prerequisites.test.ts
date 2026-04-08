import { describe, it, expect } from 'vitest';
import { checkPlannedPrerequisites } from '../../../../src/core/workflow/propose/prerequisites.js';
import type { ParseResult } from '../../../../src/core/parser/types.js';
import type { DeltaSummaryEntry } from '../../../../src/types/delta.js';

function makeParseResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    frontmatter: {
      type: 'change',
      id: 'change-test',
      status: 'proposed',
      created_at: '2026-01-01',
      depends_on: [],
      touches: [],
      systems: [],
      sources: [],
      decisions: [],
      tags: [],
    },
    rawFrontmatter: {},
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

function withSections(
  body: string,
  headings: string[],
  deltaSummary: DeltaSummaryEntry[] = [],
  tasks: Array<{ text: string; done: boolean; line: number }> = [],
): ParseResult {
  return makeParseResult({
    body,
    headings,
    deltaSummary,
    tasks,
    sections: headings.map((h, i) => ({
      level: 2,
      title: h,
      content: body,
      line: i * 10 + 1,
      children: [],
    })),
  });
}

describe('checkPlannedPrerequisites', () => {
  it('returns all_hard_met=true when all 4 hard prereqs are filled', () => {
    const parsed = withSections(
      'Some content',
      ['Why', 'Delta Summary', 'Tasks', 'Validation'],
      [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
      [{ text: 'do something', done: false, line: 1 }],
    );
    const result = checkPlannedPrerequisites(parsed);
    expect(result.all_hard_met).toBe(true);
    expect(result.hard.why_present).toBe(true);
    expect(result.hard.delta_summary_present).toBe(true);
    expect(result.hard.tasks_present).toBe(true);
    expect(result.hard.validation_present).toBe(true);
  });

  it('returns all_hard_met=false when Why is missing', () => {
    const parsed = withSections(
      'Some content',
      ['Delta Summary', 'Tasks', 'Validation'],
      [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
      [{ text: 'do something', done: false, line: 1 }],
    );
    const result = checkPlannedPrerequisites(parsed);
    expect(result.all_hard_met).toBe(false);
    expect(result.hard.why_present).toBe(false);
  });

  it('returns all_hard_met=false when Delta Summary has no entries', () => {
    const parsed = withSections(
      'Some content',
      ['Why', 'Delta Summary', 'Tasks', 'Validation'],
      [], // no entries
      [{ text: 'do something', done: false, line: 1 }],
    );
    const result = checkPlannedPrerequisites(parsed);
    expect(result.all_hard_met).toBe(false);
    expect(result.hard.delta_summary_present).toBe(false);
  });

  it('returns all_hard_met=false when Tasks has no items', () => {
    const parsed = withSections(
      'Some content',
      ['Why', 'Delta Summary', 'Tasks', 'Validation'],
      [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
      [], // no tasks
    );
    const result = checkPlannedPrerequisites(parsed);
    expect(result.all_hard_met).toBe(false);
    expect(result.hard.tasks_present).toBe(false);
  });

  it('returns all_hard_met=false when Validation section is missing', () => {
    const parsed = withSections(
      'Some content',
      ['Why', 'Delta Summary', 'Tasks'],
      [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
      [{ text: 'do something', done: false, line: 1 }],
    );
    const result = checkPlannedPrerequisites(parsed);
    expect(result.all_hard_met).toBe(false);
    expect(result.hard.validation_present).toBe(false);
  });

  it('reports soft warning when Design Approach is missing', () => {
    const parsed = withSections(
      'Some content',
      ['Why', 'Delta Summary', 'Tasks', 'Validation'],
      [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
      [{ text: 'do something', done: false, line: 1 }],
    );
    const result = checkPlannedPrerequisites(parsed);
    expect(result.soft.design_approach_present).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('Design Approach'))).toBe(true);
  });

  it('does not warn when Design Approach section exists', () => {
    const parsed = withSections(
      'Some content',
      ['Why', 'Delta Summary', 'Tasks', 'Validation', 'Design Approach'],
      [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
      [{ text: 'do something', done: false, line: 1 }],
    );
    const result = checkPlannedPrerequisites(parsed);
    expect(result.soft.design_approach_present).toBe(true);
  });

  it('reports all 4 missing when all sections are empty', () => {
    const parsed = makeParseResult();
    const result = checkPlannedPrerequisites(parsed);
    expect(result.all_hard_met).toBe(false);
    expect(result.hard.why_present).toBe(false);
    expect(result.hard.delta_summary_present).toBe(false);
    expect(result.hard.tasks_present).toBe(false);
    expect(result.hard.validation_present).toBe(false);
  });

  it('detects Decision link from frontmatter', () => {
    const parsed = makeParseResult({
      frontmatter: {
        type: 'change',
        id: 'change-test',
        status: 'proposed',
        created_at: '2026-01-01',
        depends_on: [],
        touches: [],
        systems: [],
        sources: [],
        decisions: ['[[Decision: Auth]]'],
        tags: [],
      },
      headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
      sections: [
        { level: 2, title: 'Why', content: 'content', line: 1, children: [] },
        { level: 2, title: 'Delta Summary', content: 'content', line: 5, children: [] },
        { level: 2, title: 'Tasks', content: 'content', line: 10, children: [] },
        { level: 2, title: 'Validation', content: 'content', line: 15, children: [] },
      ],
      deltaSummary: [{ op: 'ADDED', target_type: 'requirement', target_name: 'foo', target_note_id: 'f1', base_fingerprint: null }],
      tasks: [{ text: 'do something', done: false, line: 1 }],
    });
    const result = checkPlannedPrerequisites(parsed);
    expect(result.soft.decision_link_present).toBe(true);
  });
});
