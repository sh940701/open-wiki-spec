import { describe, it, expect } from 'vitest';
import { checkBaseFingerprints } from '../../../src/core/sequencing/stale-detector.js';
import { createChange, createFeature, createIndex } from '../../helpers/mock-index.js';
import type { Requirement } from '../../../src/types/requirement.js';

function makeReq(name: string, featureId: string, contentHash: string): Requirement {
  return {
    name,
    key: `${featureId}::${name}`,
    normative: `The system SHALL do ${name}`,
    scenarios: [],
    content_hash: contentHash,
  };
}

describe('checkBaseFingerprints', () => {
  it('returns no stale entries when fingerprints match', () => {
    const feature = createFeature('feat-x', {
      requirements: [makeReq('req-1', 'feat-x', 'hash-abc')],
    });
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: 'hash-abc',
      }],
    });
    const idx = createIndex([feature, change]);

    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(0);
  });

  it('returns stale entry when fingerprint does not match', () => {
    const feature = createFeature('feat-x', {
      requirements: [makeReq('req-1', 'feat-x', 'hash-current')],
    });
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: 'hash-old',
      }],
    });
    const idx = createIndex([feature, change]);

    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(1);
    expect(stale[0].expected_hash).toBe('hash-old');
    expect(stale[0].actual_hash).toBe('hash-current');
  });

  it('skips ADDED entries (no base to compare)', () => {
    const feature = createFeature('feat-x');
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'ADDED', target_type: 'requirement', target_name: 'req-new',
        target_note_id: 'feat-x', base_fingerprint: null,
      }],
    });
    const idx = createIndex([feature, change]);

    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(0);
  });

  it('returns stale with MISSING when requirement does not exist for MODIFIED', () => {
    const feature = createFeature('feat-x', { requirements: [] });
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-gone',
        target_note_id: 'feat-x', base_fingerprint: 'hash-old',
      }],
    });
    const idx = createIndex([feature, change]);

    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(1);
    expect(stale[0].actual_hash).toBe('MISSING');
  });

  it('skips when feature not in index (broken reference)', () => {
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-missing', base_fingerprint: 'hash-old',
      }],
    });
    const idx = createIndex([change]);

    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(0);
  });

  it('skips entries with null base_fingerprint', () => {
    const feature = createFeature('feat-x', {
      requirements: [makeReq('req-1', 'feat-x', 'hash-abc')],
    });
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'MODIFIED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: null,
      }],
    });
    const idx = createIndex([feature, change]);

    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(0);
  });

  it('checks REMOVED entry fingerprint', () => {
    const feature = createFeature('feat-x', {
      requirements: [makeReq('req-1', 'feat-x', 'hash-current')],
    });
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'REMOVED', target_type: 'requirement', target_name: 'req-1',
        target_note_id: 'feat-x', base_fingerprint: 'hash-old',
      }],
    });
    const idx = createIndex([feature, change]);

    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(1);
  });

  it('checks RENAMED entry fingerprint', () => {
    const feature = createFeature('feat-x', {
      requirements: [makeReq('req-old', 'feat-x', 'hash-abc')],
    });
    const change = createChange('chg-a', {
      delta_summary: [{
        op: 'RENAMED', target_type: 'requirement', target_name: 'req-old',
        new_name: 'req-new', target_note_id: 'feat-x', base_fingerprint: 'hash-abc',
      }],
    });
    const idx = createIndex([feature, change]);

    // Fingerprint matches -> no stale
    const stale = checkBaseFingerprints(change, idx.records);
    expect(stale).toHaveLength(0);
  });
});
