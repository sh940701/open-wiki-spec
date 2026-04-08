import { describe, it, expect } from 'vitest';
import { verify } from '../../src/core/workflow/verify/verify.js';
import { createIndex, createFeature, createChange, createSystem, createDecision } from '../helpers/mock-index.js';

describe('verify orchestrator', () => {
  it('should return pass: true for a valid vault', () => {
    const feat = createFeature('feat-1', {
      headings: ['Purpose', 'Current Behavior', 'Requirements'],
      requirements: [
        { name: 'R1', key: 'feat-1::R1', normative: 'SHALL do X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' },
      ],
      links_out: ['sys-1'],
      links_in: ['chg-1'],
      systems: ['sys-1'],
    });
    const sys = createSystem('sys-1', {
      links_out: [],
      links_in: ['feat-1'],
    });
    const change = createChange('chg-1', {
      status: 'proposed',
      feature: 'feat-1',
      systems: ['sys-1'],
      touches: ['feat-1'],
      links_out: ['feat-1'],
      links_in: [],
      delta_summary: [
        { op: 'ADDED', target_type: 'requirement', target_name: 'R2', target_note_id: 'feat-1', base_fingerprint: null },
      ],
      tasks: [{ text: 'Add R2', done: false }],
    });
    const index = createIndex([feat, sys, change]);
    const report = verify(index);
    expect(report.pass).toBe(true);
    expect(report.total_notes).toBe(3);
    expect(report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('should return pass: false when errors exist', () => {
    const feat = createFeature('feat-1', {
      headings: ['Purpose'], // missing Requirements, Current Behavior
      requirements: [],
      links_out: [],
      links_in: [],
    });
    const index = createIndex([feat]);
    const report = verify(index);
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('should populate summary counts by dimension', () => {
    const feat = createFeature('feat-1', {
      headings: ['Purpose'],
      requirements: [],
      links_out: [],
      links_in: [],
    });
    const index = createIndex([feat]);
    const report = verify(index);
    expect(report.summary.completeness).toBeDefined();
    expect(report.summary.correctness).toBeDefined();
    expect(report.summary.coherence).toBeDefined();
    expect(report.summary.vault_integrity).toBeDefined();
  });

  it('should filter to specific change when changeId option is provided', () => {
    const feat = createFeature('feat-1', {
      links_out: ['sys-1'],
      links_in: ['chg-1', 'chg-2'],
      requirements: [
        { name: 'R1', key: 'feat-1::R1', normative: 'SHALL do X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' },
      ],
    });
    const sys = createSystem('sys-1', { links_in: ['feat-1'] });
    const change1 = createChange('chg-1', {
      status: 'proposed',
      feature: 'feat-1',
      systems: ['sys-1'],
      touches: ['feat-1'],
      links_out: ['feat-1'],
      delta_summary: [
        { op: 'ADDED', target_type: 'requirement', target_name: 'R2', target_note_id: 'feat-1', base_fingerprint: null },
      ],
      tasks: [{ text: 'Task 1', done: false }],
    });
    const change2 = createChange('chg-2', {
      status: 'proposed',
      feature: 'feat-1',
      headings: [], // deliberately broken -- missing Why etc
      delta_summary: [],
      tasks: [],
      links_out: ['feat-1'],
    });
    const index = createIndex([feat, sys, change1, change2]);

    // Verify chg-1 only -- should not include issues for chg-2
    const report = verify(index, { changeId: 'chg-1' });
    const changeIssues = report.issues.filter((i) => i.note_id !== undefined);
    for (const issue of changeIssues) {
      // All note-specific issues should be for chg-1 or notes related to chg-1
      expect(issue.note_id === 'chg-1' || issue.note_id === 'feat-1' || issue.note_id === 'sys-1').toBe(true);
    }
  });

  it('should include scanned_at timestamp', () => {
    const index = createIndex([]);
    const report = verify(index);
    expect(report.scanned_at).toBeDefined();
    expect(typeof report.scanned_at).toBe('string');
  });

  it('should handle empty vault (no notes)', () => {
    const index = createIndex([]);
    const report = verify(index);
    expect(report.pass).toBe(true);
    expect(report.total_notes).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it('should treat warnings as errors in strict mode', () => {
    const feat = createFeature('feat-1', {
      headings: ['Purpose', 'Current Behavior', 'Requirements'],
      requirements: [
        { name: 'R1', key: 'feat-1::R1', normative: 'SHALL do X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' },
      ],
      links_out: [],
      links_in: [],
    });
    const index = createIndex([feat]);
    // Orphan note is a warning
    const report = verify(index, { strict: true });
    expect(report.pass).toBe(false);
  });
});
