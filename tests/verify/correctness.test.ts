import { describe, it, expect } from 'vitest';
import {
  runOperationValidationMatrix,
  checkStaleBase,
  checkStatusTransition,
  checkSchemaVersionMatch,
  checkDriftForStatus,
  checkUnfilledApplyMarkers,
} from '../../src/core/workflow/verify/correctness.js';
import { createIndex, createFeature, createChange } from '../helpers/mock-index.js';

describe('correctness', () => {
  describe('runOperationValidationMatrix', () => {
    describe('pre-apply (proposed/planned/in_progress)', () => {
      it('ADDED: should pass when requirement does not exist in Feature', () => {
        const feat = createFeature('feat-1', { requirements: [] });
        const change = createChange('chg-1', {
          status: 'proposed',
          feature: 'feat-1',
          delta_summary: [
            { op: 'ADDED', target_type: 'requirement', target_name: 'NewReq', target_note_id: 'feat-1', base_fingerprint: null },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(0);
      });

      it('ADDED: should error when requirement already exists', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'ExistingReq', key: 'feat-1::ExistingReq', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
        });
        const change = createChange('chg-1', {
          status: 'proposed',
          feature: 'feat-1',
          delta_summary: [
            { op: 'ADDED', target_type: 'requirement', target_name: 'ExistingReq', target_note_id: 'feat-1', base_fingerprint: null },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('DELTA_MISMATCH_ADDED');
      });

      it('MODIFIED: should pass when requirement exists', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
        });
        const change = createChange('chg-1', {
          status: 'planned',
          feature: 'feat-1',
          delta_summary: [
            { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(0);
      });

      it('MODIFIED: should error when requirement does not exist', () => {
        const feat = createFeature('feat-1', { requirements: [] });
        const change = createChange('chg-1', {
          status: 'in_progress',
          feature: 'feat-1',
          delta_summary: [
            { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('DELTA_MISMATCH_MODIFIED');
      });

      it('REMOVED: should pass when requirement exists', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
        });
        const change = createChange('chg-1', {
          status: 'planned',
          feature: 'feat-1',
          delta_summary: [
            { op: 'REMOVED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(0);
      });

      it('REMOVED: should error when requirement does not exist', () => {
        const feat = createFeature('feat-1', { requirements: [] });
        const change = createChange('chg-1', {
          status: 'planned',
          feature: 'feat-1',
          delta_summary: [
            { op: 'REMOVED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('DELTA_MISMATCH_REMOVED');
      });

      it('RENAMED: should pass when old exists and new does not', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'OldName', key: 'feat-1::OldName', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
        });
        const change = createChange('chg-1', {
          status: 'planned',
          feature: 'feat-1',
          delta_summary: [
            { op: 'RENAMED', target_type: 'requirement', target_name: 'OldName', new_name: 'NewName', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(0);
      });

      it('RENAMED: should error when old does not exist', () => {
        const feat = createFeature('feat-1', { requirements: [] });
        const change = createChange('chg-1', {
          status: 'planned',
          feature: 'feat-1',
          delta_summary: [
            { op: 'RENAMED', target_type: 'requirement', target_name: 'OldName', new_name: 'NewName', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues.some((i) => i.code === 'DELTA_MISMATCH_RENAMED')).toBe(true);
      });

      it('RENAMED: should error when new name already exists', () => {
        const feat = createFeature('feat-1', {
          requirements: [
            { name: 'OldName', key: 'feat-1::OldName', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' },
            { name: 'NewName', key: 'feat-1::NewName', normative: 'SHALL Y', scenarios: [{ name: 'S2', raw_text: 'WHEN Y THEN Z' }], content_hash: 'def' },
          ],
        });
        const change = createChange('chg-1', {
          status: 'planned',
          feature: 'feat-1',
          delta_summary: [
            { op: 'RENAMED', target_type: 'requirement', target_name: 'OldName', new_name: 'NewName', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues.some((i) => i.code === 'DELTA_MISMATCH_RENAMED')).toBe(true);
      });
    });

    describe('post-apply (applied)', () => {
      it('ADDED: should pass when requirement exists after apply', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'NewReq', key: 'feat-1::NewReq', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
        });
        const change = createChange('chg-1', {
          status: 'applied',
          feature: 'feat-1',
          delta_summary: [
            { op: 'ADDED', target_type: 'requirement', target_name: 'NewReq', target_note_id: 'feat-1', base_fingerprint: null },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(0);
      });

      it('ADDED: should error when requirement missing after apply', () => {
        const feat = createFeature('feat-1', { requirements: [] });
        const change = createChange('chg-1', {
          status: 'applied',
          feature: 'feat-1',
          delta_summary: [
            { op: 'ADDED', target_type: 'requirement', target_name: 'NewReq', target_note_id: 'feat-1', base_fingerprint: null },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('DELTA_MISMATCH_ADDED');
      });

      it('MODIFIED: should warn when content_hash unchanged after apply', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'same-hash' }],
        });
        const change = createChange('chg-1', {
          status: 'applied',
          feature: 'feat-1',
          delta_summary: [
            { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'same-hash' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('MODIFIED_NO_CHANGE');
        expect(issues[0].severity).toBe('warning');
      });

      it('REMOVED: should error when requirement still exists after apply', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
        });
        const change = createChange('chg-1', {
          status: 'applied',
          feature: 'feat-1',
          delta_summary: [
            { op: 'REMOVED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('DELTA_MISMATCH_REMOVED');
      });

      it('RENAMED: should pass when old gone and new exists', () => {
        const feat = createFeature('feat-1', {
          requirements: [{ name: 'NewName', key: 'feat-1::NewName', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
        });
        const change = createChange('chg-1', {
          status: 'applied',
          feature: 'feat-1',
          delta_summary: [
            { op: 'RENAMED', target_type: 'requirement', target_name: 'OldName', new_name: 'NewName', target_note_id: 'feat-1', base_fingerprint: 'abc' },
          ],
        });
        const index = createIndex([feat, change]);
        const issues = runOperationValidationMatrix(change, index);
        expect(issues).toHaveLength(0);
      });
    });

    it('should error when delta references non-existent Feature', () => {
      const change = createChange('chg-1', {
        status: 'proposed',
        feature: 'feat-nonexistent',
        delta_summary: [
          { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-nonexistent', base_fingerprint: null },
        ],
      });
      const index = createIndex([change]);
      const issues = runOperationValidationMatrix(change, index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('INVALID_FRONTMATTER_REF');
    });
  });

  describe('checkStaleBase', () => {
    it('should return no issues when base_fingerprint matches', () => {
      const feat = createFeature('feat-1', {
        requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc123' }],
      });
      const change = createChange('chg-1', {
        feature: 'feat-1',
        delta_summary: [
          { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc123' },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkStaleBase(change, index);
      expect(issues).toHaveLength(0);
    });

    it('should error when base_fingerprint mismatches', () => {
      const feat = createFeature('feat-1', {
        requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'current-hash' }],
      });
      const change = createChange('chg-1', {
        feature: 'feat-1',
        delta_summary: [
          { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'old-hash' },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkStaleBase(change, index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('STALE_BASE');
      expect(issues[0].severity).toBe('error');
    });

    it('should skip ADDED entries (no base_fingerprint expected)', () => {
      const feat = createFeature('feat-1', { requirements: [] });
      const change = createChange('chg-1', {
        feature: 'feat-1',
        delta_summary: [
          { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkStaleBase(change, index);
      expect(issues).toHaveLength(0);
    });

    it('should warn when MODIFIED has no base_fingerprint', () => {
      const feat = createFeature('feat-1', {
        requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
      });
      const change = createChange('chg-1', {
        feature: 'feat-1',
        delta_summary: [
          { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkStaleBase(change, index);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
    });
  });

  describe('checkStatusTransition', () => {
    it('should return no issues for proposed change with missing prerequisites', () => {
      const change = createChange('chg-1', { status: 'proposed' });
      const index = createIndex([change]);
      const issues = checkStatusTransition(change, index);
      expect(issues).toHaveLength(0);
    });

    it('should error for planned change missing prerequisites', () => {
      const change = createChange('chg-1', {
        status: 'planned',
        headings: [], // missing Why, Delta Summary, etc.
        delta_summary: [],
        tasks: [],
      });
      const index = createIndex([change]);
      const issues = checkStatusTransition(change, index);
      expect(issues.some((i) => i.code === 'INVALID_STATUS_TRANSITION')).toBe(true);
    });

    it('should error for in_progress change with unresolved depends_on', () => {
      const dep = createChange('dep-1', { status: 'proposed' });
      const change = createChange('chg-1', {
        status: 'in_progress',
        depends_on: ['dep-1'],
      });
      const index = createIndex([change, dep]);
      const issues = checkStatusTransition(change, index);
      expect(issues.some((i) => i.code === 'BROKEN_DEPENDS_ON')).toBe(true);
    });

    it('should pass for in_progress change with applied depends_on', () => {
      const dep = createChange('dep-1', { status: 'applied' });
      const change = createChange('chg-1', {
        status: 'in_progress',
        depends_on: ['dep-1'],
      });
      const index = createIndex([change, dep]);
      const issues = checkStatusTransition(change, index);
      expect(issues.filter((i) => i.code === 'BROKEN_DEPENDS_ON')).toHaveLength(0);
    });
  });

  describe('checkSchemaVersionMatch', () => {
    it('should return no issues when no schema warnings exist', () => {
      const feat = createFeature('feat-1');
      const index = createIndex([feat]);
      const issues = checkSchemaVersionMatch(feat, '2026-04-06-v1', index);
      expect(issues).toHaveLength(0);
    });

    it('should error when index has schema_mismatch warning', () => {
      const feat = createFeature('feat-1');
      const index = createIndex([feat], {
        warnings: [
          { type: 'schema_mismatch', note_path: 'wiki/00-meta/schema.md', message: 'No schema.md found or schema_version is missing' },
        ],
      });
      const issues = checkSchemaVersionMatch(feat, '2026-04-06-v1', index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('SCHEMA_MISMATCH');
    });
  });

  describe('checkUnfilledApplyMarkers', () => {
    it('should error when Feature body contains unfilled ADDED marker after apply', () => {
      const feat = createFeature('feat-1', {
        raw_text: '## Requirements\n\n### Requirement: NewReq\n\n<!-- ADDED by change: chg-1. Fill in normative statement (SHALL/MUST) and scenarios (WHEN/THEN). -->\n',
        requirements: [{ name: 'NewReq', key: 'feat-1::NewReq', normative: '', scenarios: [], content_hash: 'abc' }],
      });
      const change = createChange('chg-1', {
        status: 'applied',
        feature: 'feat-1',
        delta_summary: [
          { op: 'ADDED', target_type: 'requirement', target_name: 'NewReq', target_note_id: 'feat-1', base_fingerprint: null },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkUnfilledApplyMarkers(change, index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('UNFILLED_APPLY_MARKER');
    });

    it('should error when Feature body contains unfilled MODIFIED marker after apply', () => {
      const feat = createFeature('feat-1', {
        raw_text: '## Requirements\n\n### Requirement: R1\n<!-- MODIFIED by change: chg-1 -->\nOld content here.\n',
        requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
      });
      const change = createChange('chg-1', {
        status: 'applied',
        feature: 'feat-1',
        delta_summary: [
          { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'old-hash' },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkUnfilledApplyMarkers(change, index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('UNFILLED_APPLY_MARKER');
    });

    it('should pass when Feature body has no markers', () => {
      const feat = createFeature('feat-1', {
        raw_text: '## Requirements\n\n### Requirement: R1\n\nThe system SHALL do X.\n',
        requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
      });
      const change = createChange('chg-1', {
        status: 'applied',
        feature: 'feat-1',
        delta_summary: [
          { op: 'MODIFIED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'old-hash' },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkUnfilledApplyMarkers(change, index);
      expect(issues).toHaveLength(0);
    });

    it('should skip non-applied changes', () => {
      const feat = createFeature('feat-1', {
        raw_text: '<!-- ADDED by change: chg-1 -->\n',
      });
      const change = createChange('chg-1', {
        status: 'in_progress',
        feature: 'feat-1',
        delta_summary: [
          { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkUnfilledApplyMarkers(change, index);
      expect(issues).toHaveLength(0);
    });
  });

  describe('checkDriftForStatus', () => {
    it('should not report drift for proposed changes', () => {
      const feat = createFeature('feat-1', { requirements: [] });
      const change = createChange('chg-1', {
        status: 'proposed',
        feature: 'feat-1',
        delta_summary: [
          { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkDriftForStatus(change, index);
      expect(issues).toHaveLength(0);
    });

    it('should error for applied change where ADDED requirement is missing', () => {
      const feat = createFeature('feat-1', { requirements: [] });
      const change = createChange('chg-1', {
        status: 'applied',
        feature: 'feat-1',
        delta_summary: [
          { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkDriftForStatus(change, index);
      expect(issues.some((i) => i.code === 'EXCESSIVE_DRIFT')).toBe(true);
    });

    it('should skip entries covered by operation validation matrix', () => {
      const feat = createFeature('feat-1', { requirements: [] });
      const change = createChange('chg-1', {
        status: 'applied',
        feature: 'feat-1',
        delta_summary: [
          { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
        ],
      });
      const index = createIndex([feat, change]);
      const coveredByMatrix = new Set(['feat-1::R1']);
      const issues = checkDriftForStatus(change, index, coveredByMatrix);
      expect(issues).toHaveLength(0);
    });

    it('should error for applied change where REMOVED requirement still exists', () => {
      const feat = createFeature('feat-1', {
        requirements: [{ name: 'R1', key: 'feat-1::R1', normative: 'SHALL X', scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }], content_hash: 'abc' }],
      });
      const change = createChange('chg-1', {
        status: 'applied',
        feature: 'feat-1',
        delta_summary: [
          { op: 'REMOVED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: 'abc' },
        ],
      });
      const index = createIndex([feat, change]);
      const issues = checkDriftForStatus(change, index);
      expect(issues.some((i) => i.code === 'EXCESSIVE_DRIFT')).toBe(true);
    });
  });
});
