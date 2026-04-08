import { describe, it, expect } from 'vitest';
import { classify } from '../../../src/core/retrieval/classify.js';
import { createFeature, createChange, createIndex } from '../../helpers/mock-index.js';
import type { ScoredCandidate, SequencingSummary } from '../../../src/types/retrieval.js';

function makeCandidate(overrides: Partial<ScoredCandidate> & { id: string; score: number }): ScoredCandidate {
  return {
    type: 'feature',
    title: `Title ${overrides.id}`,
    reasons: [],
    ...overrides,
  };
}

describe('classify', () => {
  it('returns existing_change for high-scoring active Change with clear gap', () => {
    const change = createChange('chg-a', { status: 'proposed' });
    const idx = createIndex([change]);

    const result = classify(
      [makeCandidate({ id: 'chg-a', type: 'change', score: 80 }), makeCandidate({ id: 'other', score: 60 })],
      undefined,
      idx,
    );
    expect(result.classification).toBe('existing_change');
    expect(result.confidence).toBe('high');
  });

  it('returns existing_feature for high-scoring Feature without strong active Change', () => {
    const feature = createFeature('feat-auth');
    const idx = createIndex([feature]);

    const result = classify(
      [makeCandidate({ id: 'feat-auth', type: 'feature', score: 75 })],
      undefined,
      idx,
    );
    expect(result.classification).toBe('existing_feature');
  });

  it('returns high confidence for Feature score >= 85', () => {
    const feature = createFeature('feat-auth');
    const idx = createIndex([feature]);

    const result = classify(
      [makeCandidate({ id: 'feat-auth', type: 'feature', score: 90 })],
      undefined,
      idx,
    );
    expect(result.classification).toBe('existing_feature');
    expect(result.confidence).toBe('high');
  });

  it('returns medium confidence for Feature score 70-84', () => {
    const feature = createFeature('feat-auth');
    const idx = createIndex([feature]);

    const result = classify(
      [makeCandidate({ id: 'feat-auth', type: 'feature', score: 75 })],
      undefined,
      idx,
    );
    expect(result.confidence).toBe('medium');
  });

  it('returns new_feature when top score is below 45', () => {
    const result = classify(
      [makeCandidate({ id: 'feat-x', score: 40 })],
    );
    expect(result.classification).toBe('new_feature');
    expect(result.confidence).toBe('high');
  });

  it('returns new_feature with high confidence for empty candidates', () => {
    const result = classify([]);
    expect(result.classification).toBe('new_feature');
    expect(result.confidence).toBe('high');
  });

  it('returns needs_confirmation when top two scores are close', () => {
    const result = classify([
      makeCandidate({ id: 'a', score: 65 }),
      makeCandidate({ id: 'b', score: 62 }),
    ]);
    expect(result.classification).toBe('needs_confirmation');
    expect(result.confidence).toBe('low');
  });

  it('returns needs_confirmation when Feature and active Change both match strongly', () => {
    const feature = createFeature('feat-auth');
    const change = createChange('chg-a', { status: 'proposed' });
    const idx = createIndex([feature, change]);

    const result = classify(
      [
        makeCandidate({ id: 'feat-auth', type: 'feature', score: 75 }),
        makeCandidate({ id: 'chg-a', type: 'change', score: 70 }),
      ],
      undefined,
      idx,
    );
    expect(result.classification).toBe('needs_confirmation');
  });

  it('returns needs_confirmation for ambiguous middle ground (45-70)', () => {
    const result = classify([
      makeCandidate({ id: 'feat-x', type: 'feature', score: 55 }),
    ]);
    expect(result.classification).toBe('needs_confirmation');
    expect(result.confidence).toBe('low');
  });

  it('escalates to needs_confirmation on index quality issues for top candidates', () => {
    const feature = createFeature('feat-auth');
    const idx = createIndex([feature], {
      warnings: [{ type: 'duplicate_id', note_path: feature.path, message: 'dup id' }],
    });

    const result = classify(
      [makeCandidate({ id: 'feat-auth', type: 'feature', score: 80 })],
      undefined,
      idx,
    );
    expect(result.classification).toBe('needs_confirmation');
    expect(result.confidence).toBe('low');
  });

  it('escalates on sequencing conflict_candidate', () => {
    const seq: SequencingSummary = {
      status: 'conflict_candidate',
      related_changes: ['chg-a'],
      reasons: ['overlap'],
    };
    const result = classify(
      [makeCandidate({ id: 'feat-auth', type: 'feature', score: 80 })],
      undefined,
      undefined,
      seq,
    );
    expect(result.classification).toBe('needs_confirmation');
  });

  it('escalates on sequencing conflict_critical', () => {
    const seq: SequencingSummary = {
      status: 'conflict_critical',
      related_changes: [],
      reasons: [],
    };
    const result = classify(
      [makeCandidate({ id: 'chg-a', type: 'change', score: 80 })],
      undefined,
      undefined,
      seq,
    );
    expect(result.classification).toBe('needs_confirmation');
  });

  it('does not escalate on sequencing parallel_safe', () => {
    const change = createChange('chg-a', { status: 'proposed' });
    const idx = createIndex([change]);
    const seq: SequencingSummary = {
      status: 'parallel_safe',
      related_changes: [],
      reasons: [],
    };
    const result = classify(
      [
        makeCandidate({ id: 'chg-a', type: 'change', score: 80 }),
        makeCandidate({ id: 'other', score: 50 }),
      ],
      undefined,
      idx,
      seq,
    );
    expect(result.classification).toBe('existing_change');
  });
});
