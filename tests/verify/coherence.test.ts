import { describe, it, expect, vi } from 'vitest';
import {
  checkConflictsViaSequencing,
  checkDescriptionConsistency,
  checkDecisionConsistency,
  checkDependsOnConsistency,
} from '../../src/core/workflow/verify/coherence.js';
import { createIndex, createFeature, createChange, createDecision, createSystem } from '../helpers/mock-index.js';

describe('coherence', () => {
  describe('checkConflictsViaSequencing', () => {
    it('should return no issues for changes with no shared surfaces', () => {
      const changeA = createChange('chg-a', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['feat-1'],
      });
      const changeB = createChange('chg-b', {
        status: 'proposed',
        feature: 'feat-2',
        touches: ['feat-2'],
      });
      const index = createIndex([changeA, changeB]);
      const issues = checkConflictsViaSequencing([changeA, changeB], index);
      expect(issues).toHaveLength(0);
    });

    it('should report warning for changes sharing a system touch surface', () => {
      const sys = createSystem('sys-1');
      const changeA = createChange('chg-a', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['sys-1'],
        systems: ['sys-1'],
      });
      const changeB = createChange('chg-b', {
        status: 'proposed',
        feature: 'feat-2',
        touches: ['sys-1'],
        systems: ['sys-1'],
      });
      const index = createIndex([sys, changeA, changeB]);
      const issues = checkConflictsViaSequencing([changeA, changeB], index);
      expect(issues.some((i) => i.code === 'TOUCHES_OVERLAP_NEEDS_REVIEW')).toBe(true);
    });

    it('should report error for changes sharing a feature touch surface', () => {
      const feat = createFeature('feat-1');
      const changeA = createChange('chg-a', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['feat-1'],
      });
      const changeB = createChange('chg-b', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['feat-1'],
      });
      const index = createIndex([feat, changeA, changeB]);
      const issues = checkConflictsViaSequencing([changeA, changeB], index);
      expect(issues.some((i) => i.code === 'TOUCHES_OVERLAP_CONFLICT')).toBe(true);
    });

    it('should report requirement-level conflict for same requirement targeted by two changes', () => {
      const feat = createFeature('feat-1');
      const changeA = createChange('chg-a', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['feat-1'],
        delta_summary: [
          { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
        ],
      });
      const changeB = createChange('chg-b', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['feat-1'],
        delta_summary: [
          { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
        ],
      });
      const index = createIndex([feat, changeA, changeB]);
      const issues = checkConflictsViaSequencing([changeA, changeB], index);
      expect(issues.some((i) => i.code === 'REQUIREMENT_CONFLICT_CRITICAL')).toBe(true);
    });

    it('should not check same pair twice', () => {
      const feat = createFeature('feat-1');
      const changeA = createChange('chg-a', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['feat-1'],
      });
      const changeB = createChange('chg-b', {
        status: 'proposed',
        feature: 'feat-1',
        touches: ['feat-1'],
      });
      const index = createIndex([feat, changeA, changeB]);
      const issues = checkConflictsViaSequencing([changeA, changeB], index);
      // Should only report one conflict, not two (A-B and B-A)
      const conflictIssues = issues.filter((i) => i.code === 'TOUCHES_OVERLAP_CONFLICT');
      expect(conflictIssues).toHaveLength(1);
    });
  });

  describe('checkDescriptionConsistency', () => {
    it('should warn when change removes all requirements but feature is still active', () => {
      const feat = createFeature('feat-1', {
        status: 'active',
        requirements: [
          { name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' },
        ],
      });
      const change = createChange('chg-1', {
        status: 'proposed',
        feature: 'feat-1',
        delta_summary: [
          { op: 'REMOVED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
        ],
      });
      const allNotes = [feat, change];
      const issues = checkDescriptionConsistency(allNotes);
      expect(issues.some((i) => i.code === 'CONFLICTING_DESCRIPTIONS')).toBe(true);
    });

    it('should not warn when change removes some but not all requirements', () => {
      const feat = createFeature('feat-1', {
        status: 'active',
        requirements: [
          { name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' },
          { name: 'R2', key: 'feat-1::R2', normative: 'SHALL Y', scenarios: [{ name: 'S2', raw_text: 'WHEN Y THEN Z' }], content_hash: 'def' },
        ],
      });
      const change = createChange('chg-1', {
        status: 'proposed',
        feature: 'feat-1',
        delta_summary: [
          { op: 'REMOVED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
        ],
      });
      const allNotes = [feat, change];
      const issues = checkDescriptionConsistency(allNotes);
      expect(issues.filter((i) => i.code === 'CONFLICTING_DESCRIPTIONS')).toHaveLength(0);
    });

    it('should skip applied changes', () => {
      const feat = createFeature('feat-1', {
        status: 'active',
        requirements: [
          { name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' },
        ],
      });
      const change = createChange('chg-1', {
        status: 'applied',
        feature: 'feat-1',
        delta_summary: [
          { op: 'REMOVED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
        ],
      });
      const allNotes = [feat, change];
      const issues = checkDescriptionConsistency(allNotes);
      expect(issues).toHaveLength(0);
    });
  });

  describe('checkDecisionConsistency', () => {
    it('should warn when two active decisions share a feature and have overlapping topics', () => {
      const dec1 = createDecision('dec-1', {
        status: 'active',
        features: ['feat-1'],
        headings: ['Context', 'Decision', 'Session Handling'],
        tags: ['auth', 'session'],
      });
      const dec2 = createDecision('dec-2', {
        status: 'active',
        features: ['feat-1'],
        headings: ['Context', 'Decision', 'Session Handling'],
        tags: ['auth', 'session'],
      });
      const allFeatures = [createFeature('feat-1', { decisions: ['dec-1', 'dec-2'] })];
      const issues = checkDecisionConsistency([dec1, dec2], allFeatures);
      expect(issues.some((i) => i.code === 'INCONSISTENT_DECISION')).toBe(true);
    });

    it('should not warn for decisions on different features', () => {
      const dec1 = createDecision('dec-1', {
        status: 'active',
        features: ['feat-1'],
        headings: ['Context', 'Decision', 'Session Handling'],
      });
      const dec2 = createDecision('dec-2', {
        status: 'active',
        features: ['feat-2'],
        headings: ['Context', 'Decision', 'Session Handling'],
      });
      const allFeatures = [
        createFeature('feat-1', { decisions: ['dec-1'] }),
        createFeature('feat-2', { decisions: ['dec-2'] }),
      ];
      const issues = checkDecisionConsistency([dec1, dec2], allFeatures);
      expect(issues).toHaveLength(0);
    });

    it('should report info when decision references feature that does not link back', () => {
      const dec = createDecision('dec-1', {
        status: 'active',
        features: ['feat-1'],
      });
      const feat = createFeature('feat-1', { decisions: [] }); // no backlink
      const issues = checkDecisionConsistency([dec], [feat]);
      expect(issues.some((i) => i.code === 'INCONSISTENT_DECISION' && i.severity === 'info')).toBe(true);
    });
  });

  describe('checkDependsOnConsistency', () => {
    it('should report error when depends_on target does not exist', () => {
      const change = createChange('chg-1', {
        depends_on: ['nonexistent'],
      });
      const index = createIndex([change]);
      const issues = checkDependsOnConsistency([change], index);
      expect(issues.some((i) => i.code === 'BROKEN_DEPENDS_ON')).toBe(true);
    });

    it('should not report when depends_on target exists', () => {
      const dep = createChange('dep-1', { status: 'proposed' });
      const change = createChange('chg-1', { depends_on: ['dep-1'] });
      const index = createIndex([change, dep]);
      const issues = checkDependsOnConsistency([change], index);
      expect(issues).toHaveLength(0);
    });
  });
});
