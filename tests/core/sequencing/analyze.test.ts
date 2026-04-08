import { describe, it, expect } from 'vitest';
import { analyzeSequencing, summarizeForRetrieval } from '../../../src/core/sequencing/analyze.js';
import { createChange, createFeature, createSystem, createIndex } from '../../helpers/mock-index.js';

describe('analyzeSequencing', () => {
  it('returns parallel_safe for empty active changes', () => {
    const idx = createIndex([]);
    const result = analyzeSequencing(idx.records);

    expect(result.status).toBe('parallel_safe');
    expect(result.pairwise_severities).toHaveLength(0);
    expect(result.requirement_conflicts).toHaveLength(0);
    expect(result.ordering).toHaveLength(0);
    expect(result.cycles).toHaveLength(0);
    expect(result.stale_bases).toHaveLength(0);
    expect(result.out_of_order_errors).toHaveLength(0);
    expect(result.reasons).toHaveLength(0);
    expect(result.related_changes).toHaveLength(0);
  });

  it('computes correct status for multiple overlapping changes', () => {
    const feature = createFeature('feat-auth');
    const changeA = createChange('chg-a', {
      touches: ['feat-auth'],
      status: 'proposed',
      created_at: '2026-01-01',
    });
    const changeB = createChange('chg-b', {
      touches: ['feat-auth'],
      status: 'proposed',
      created_at: '2026-01-02',
    });
    const idx = createIndex([feature, changeA, changeB]);

    const result = analyzeSequencing(idx.records);
    expect(result.status).toBe('conflict_candidate');
    expect(result.pairwise_severities).toHaveLength(1);
    expect(result.related_changes).toContain('chg-a');
    expect(result.related_changes).toContain('chg-b');
  });

  it('conflict_critical overrides other severities', () => {
    const feature = createFeature('feat-x');
    const changeA = createChange('chg-a', {
      touches: ['feat-x'],
      status: 'proposed',
      created_at: '2026-01-01',
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: 'hash',
      }],
    });
    const changeB = createChange('chg-b', {
      touches: ['feat-x'],
      status: 'proposed',
      created_at: '2026-01-02',
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: 'hash',
      }],
    });
    const idx = createIndex([feature, changeA, changeB]);

    const result = analyzeSequencing(idx.records);
    expect(result.status).toBe('conflict_critical');
    expect(result.requirement_conflicts).toHaveLength(1);
  });

  it('ordering includes conflict annotations', () => {
    const feature = createFeature('feat-x');
    const changeA = createChange('chg-a', {
      status: 'proposed',
      created_at: '2026-01-01',
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: 'hash',
      }],
    });
    const changeB = createChange('chg-b', {
      status: 'proposed',
      created_at: '2026-01-02',
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: 'hash',
      }],
    });
    const idx = createIndex([feature, changeA, changeB]);

    const result = analyzeSequencing(idx.records);
    const entryA = result.ordering.find((o) => o.id === 'chg-a');
    const entryB = result.ordering.find((o) => o.id === 'chg-b');
    expect(entryA?.conflicts_with).toContain('chg-b');
    expect(entryB?.conflicts_with).toContain('chg-a');
  });

  it('excludes applied changes from active analysis', () => {
    const changeA = createChange('chg-a', { status: 'applied', created_at: '2026-01-01' });
    const changeB = createChange('chg-b', { status: 'proposed', created_at: '2026-01-02' });
    const idx = createIndex([changeA, changeB]);

    const result = analyzeSequencing(idx.records);
    // Only chg-b is active
    expect(result.ordering).toHaveLength(1);
    expect(result.ordering[0].id).toBe('chg-b');
  });

  it('detects out-of-order errors for applied changes with behind dependencies', () => {
    const x = createChange('x', { status: 'in_progress', depends_on: ['y'], created_at: '2026-01-02' });
    const y = createChange('y', { status: 'proposed', created_at: '2026-01-01' });
    const idx = createIndex([x, y]);

    const result = analyzeSequencing(idx.records);
    expect(result.out_of_order_errors).toHaveLength(1);
    expect(result.reasons.some((r) => r.includes('out-of-order'))).toBe(true);
  });
});

describe('summarizeForRetrieval', () => {
  it('extracts status, related_changes, and reasons', () => {
    const feature = createFeature('feat-auth');
    const changeA = createChange('chg-a', {
      touches: ['feat-auth'],
      status: 'proposed',
      created_at: '2026-01-01',
    });
    const changeB = createChange('chg-b', {
      touches: ['feat-auth'],
      status: 'proposed',
      created_at: '2026-01-02',
    });
    const idx = createIndex([feature, changeA, changeB]);

    const full = analyzeSequencing(idx.records);
    const summary = summarizeForRetrieval(full);

    expect(summary.status).toBe(full.status);
    expect(summary.related_changes).toEqual(full.related_changes);
    expect(summary.reasons).toEqual(full.reasons);
  });
});
