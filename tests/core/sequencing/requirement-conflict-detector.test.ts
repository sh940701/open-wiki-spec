import { describe, it, expect } from 'vitest';
import { detectRequirementConflicts } from '../../../src/core/sequencing/requirement-conflict-detector.js';
import { createChange } from '../../helpers/mock-index.js';
import type { DeltaSummaryEntry } from '../../../src/types/delta.js';

function makeDelta(overrides: Partial<DeltaSummaryEntry> & { op: DeltaSummaryEntry['op']; target_name: string; target_note_id: string }): DeltaSummaryEntry {
  return {
    target_type: 'requirement',
    base_fingerprint: 'hash-base',
    ...overrides,
  };
}

describe('detectRequirementConflicts', () => {
  it('detects MODIFY+MODIFY on same requirement as conflict_critical', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-1', target_note_id: 'feat-auth' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-1', target_note_id: 'feat-auth' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].this_op).toBe('MODIFIED');
    expect(conflicts[0].other_op).toBe('MODIFIED');
    expect(conflicts[0].feature_id).toBe('feat-auth');
    expect(conflicts[0].requirement_name).toBe('req-1');
  });

  it('detects MODIFY+REMOVE as conflict_critical', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-1', target_note_id: 'feat-x' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'REMOVED', target_name: 'req-1', target_note_id: 'feat-x' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(1);
  });

  it('detects RENAME+MODIFY on same requirement (old name) as conflict', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'RENAMED', target_name: 'req-old', new_name: 'req-new', target_note_id: 'feat-x' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-old', target_note_id: 'feat-x' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].this_op).toBe('RENAMED');
    expect(conflicts[0].other_op).toBe('MODIFIED');
  });

  it('detects ADD+ADD on same requirement name as conflict', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'ADDED', target_name: 'req-new', target_note_id: 'feat-x' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'ADDED', target_name: 'req-new', target_note_id: 'feat-x' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(1);
  });

  it('does not conflict when two changes MODIFY different requirements in same Feature', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-1', target_note_id: 'feat-x' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-2', target_note_id: 'feat-x' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(0);
  });

  it('does not conflict when two changes MODIFY same requirement name in different Features', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-1', target_note_id: 'feat-a' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-1', target_note_id: 'feat-b' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(0);
  });

  it('does not conflict when ADD and MODIFIED are on different requirements', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'ADDED', target_name: 'req-new', target_note_id: 'feat-x' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-old', target_note_id: 'feat-x' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(0);
  });

  it('does not conflict when only one change touches a requirement', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'MODIFIED', target_name: 'req-1', target_note_id: 'feat-x' })],
    });
    const changeB = createChange('chg-b', { delta_summary: [] });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(0);
  });

  it('skips non-requirement delta entries', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [{
        op: 'MODIFIED', target_type: 'section', target_name: 'Purpose',
        target_note_id: 'feat-x', base_fingerprint: 'hash',
      }],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [{
        op: 'MODIFIED', target_type: 'section', target_name: 'Purpose',
        target_note_id: 'feat-x', base_fingerprint: 'hash',
      }],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(0);
  });

  it('detects RENAMED_TO+ADDED conflict on new name', () => {
    const changeA = createChange('chg-a', {
      delta_summary: [makeDelta({ op: 'RENAMED', target_name: 'req-old', new_name: 'req-new', target_note_id: 'feat-x' })],
    });
    const changeB = createChange('chg-b', {
      delta_summary: [makeDelta({ op: 'ADDED', target_name: 'req-new', target_note_id: 'feat-x' })],
    });

    const conflicts = detectRequirementConflicts([changeA, changeB]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].this_op).toBe('RENAMED_TO');
    expect(conflicts[0].other_op).toBe('ADDED');
  });
});
