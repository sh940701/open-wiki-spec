import { describe, it, expect } from 'vitest';
import {
  checkFeatureCompleteness,
  checkChangeCompleteness,
  checkMinimumSections,
} from '../../src/core/workflow/verify/completeness.js';
import { createIndex, createFeature, createChange, createSystem, createDecision } from '../helpers/mock-index.js';

describe('completeness', () => {
  describe('checkFeatureCompleteness', () => {
    it('should return no issues for feature with all required sections and requirements', () => {
      const feat = createFeature('feat-1', {
        headings: ['Purpose', 'Current Behavior', 'Constraints', 'Known Gaps', 'Requirements', 'Change Log'],
        requirements: [
          {
            name: 'Auth Login',
            key: 'feat-1::Auth Login',
            normative: 'The system SHALL authenticate users via passkey',
            scenarios: [{ name: 'Successful login', raw_text: 'WHEN user submits passkey THEN session is created' }],
            content_hash: 'abc123',
          },
        ],
      });
      const index = createIndex([feat]);
      const issues = checkFeatureCompleteness(feat, index);
      expect(issues).toHaveLength(0);
    });

    it('should report missing Purpose section', () => {
      const feat = createFeature('feat-1', {
        headings: ['Current Behavior', 'Requirements'],
        requirements: [
          {
            name: 'R1',
            key: 'feat-1::R1',
            normative: 'SHALL do X',
            scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }],
            content_hash: 'abc',
          },
        ],
      });
      const index = createIndex([feat]);
      const issues = checkFeatureCompleteness(feat, index);
      expect(issues.some((i) => i.code === 'MISSING_SECTION' && i.message.includes('Purpose'))).toBe(true);
    });

    it('should report missing Requirements section', () => {
      const feat = createFeature('feat-1', {
        headings: ['Purpose', 'Current Behavior'],
        requirements: [],
      });
      const index = createIndex([feat]);
      const issues = checkFeatureCompleteness(feat, index);
      expect(issues.some((i) => i.code === 'MISSING_SECTION' && i.message.includes('Requirements'))).toBe(true);
    });

    it('should report feature with no requirements', () => {
      const feat = createFeature('feat-1', {
        headings: ['Purpose', 'Current Behavior', 'Constraints', 'Known Gaps', 'Requirements', 'Change Log'],
        requirements: [],
      });
      const index = createIndex([feat]);
      const issues = checkFeatureCompleteness(feat, index);
      expect(issues.some((i) => i.code === 'MISSING_REQUIREMENTS')).toBe(true);
    });

    it('should report requirement without SHALL/MUST', () => {
      const feat = createFeature('feat-1', {
        headings: ['Purpose', 'Current Behavior', 'Constraints', 'Known Gaps', 'Requirements', 'Change Log'],
        requirements: [
          {
            name: 'R1',
            key: 'feat-1::R1',
            normative: 'The system does something',
            scenarios: [{ name: 'S1', raw_text: 'WHEN X THEN Y' }],
            content_hash: 'abc',
          },
        ],
      });
      const index = createIndex([feat]);
      const issues = checkFeatureCompleteness(feat, index);
      expect(issues.some((i) => i.severity === 'error' && i.message.includes('SHALL') && i.message.includes('MUST'))).toBe(true);
    });

    it('should report requirement with no scenarios', () => {
      const feat = createFeature('feat-1', {
        headings: ['Purpose', 'Current Behavior', 'Constraints', 'Known Gaps', 'Requirements', 'Change Log'],
        requirements: [
          {
            name: 'R1',
            key: 'feat-1::R1',
            normative: 'The system SHALL do X',
            scenarios: [],
            content_hash: 'abc',
          },
        ],
      });
      const index = createIndex([feat]);
      const issues = checkFeatureCompleteness(feat, index);
      expect(issues.some((i) => i.severity === 'error' && i.message.includes('scenario'))).toBe(true);
    });
  });

  describe('checkChangeCompleteness', () => {
    it('should return no issues for change with all required sections', () => {
      const change = createChange('chg-1', {
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        feature: 'feat-1',
        systems: ['sys-1'],
        raw_text: [
          '## Why',
          'We need to add the R1 requirement for security.',
          '## Delta Summary',
          '- ADDED requirement "R1" to [[feat-1]]',
          '## Tasks',
          '- [ ] Add R1 to Feature note',
          '## Validation',
          'Run the full test suite and verify pass.',
        ].join('\n'),
        delta_summary: [
          {
            op: 'ADDED',
            target_type: 'requirement',
            target_name: 'R1',
            target_note_id: 'feat-1',
            base_fingerprint: null,
          },
        ],
        tasks: [{ text: 'Add R1 to Feature', done: false }],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues).toHaveLength(0);
    });

    it('should report missing Why section', () => {
      const change = createChange('chg-1', {
        headings: ['Delta Summary', 'Tasks', 'Validation'],
        feature: 'feat-1',
        delta_summary: [
          {
            op: 'ADDED',
            target_type: 'requirement',
            target_name: 'R1',
            target_note_id: 'feat-1',
            base_fingerprint: null,
          },
        ],
        tasks: [{ text: 'Task', done: false }],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues.some((i) => i.code === 'MISSING_SECTION' && i.message.includes('Why'))).toBe(true);
    });

    it('should report missing Delta Summary', () => {
      const change = createChange('chg-1', {
        headings: ['Why', 'Tasks', 'Validation'],
        feature: 'feat-1',
        delta_summary: [],
        tasks: [{ text: 'Task', done: false }],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues.some((i) => i.code === 'MISSING_DELTA_SUMMARY')).toBe(true);
    });

    it('should report missing Tasks', () => {
      const change = createChange('chg-1', {
        headings: ['Why', 'Delta Summary', 'Validation'],
        feature: 'feat-1',
        delta_summary: [
          {
            op: 'ADDED',
            target_type: 'requirement',
            target_name: 'R1',
            target_note_id: 'feat-1',
            base_fingerprint: null,
          },
        ],
        tasks: [],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues.some((i) => i.code === 'MISSING_TASKS')).toBe(true);
    });

    it('should report missing Validation section', () => {
      const change = createChange('chg-1', {
        headings: ['Why', 'Delta Summary', 'Tasks'],
        feature: 'feat-1',
        delta_summary: [
          {
            op: 'ADDED',
            target_type: 'requirement',
            target_name: 'R1',
            target_note_id: 'feat-1',
            base_fingerprint: null,
          },
        ],
        tasks: [{ text: 'Task', done: false }],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues.some((i) => i.code === 'MISSING_VALIDATION')).toBe(true);
    });

    it('should report change with no linked feature', () => {
      const change = createChange('chg-1', {
        feature: undefined,
        features: undefined,
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues.some((i) => i.code === 'MISSING_LINK' && i.message.includes('Feature'))).toBe(true);
    });

    it('should warn when required sections exist but have empty body', () => {
      const change = createChange('chg-1', {
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        feature: 'feat-1',
        systems: ['sys-1'],
        raw_text: [
          '## Why',
          '',
          '## Delta Summary',
          '- ADDED requirement "R1" to [[feat-1]]',
          '## Tasks',
          '- [ ] Add the R1 requirement to the Feature note',
          '## Validation',
          'Run the test suite and verify all pass.',
        ].join('\n'),
        delta_summary: [
          {
            op: 'ADDED',
            target_type: 'requirement',
            target_name: 'R1',
            target_note_id: 'feat-1',
            base_fingerprint: null,
          },
        ],
        tasks: [{ text: 'Add R1', done: false }],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      // Why section is empty → should produce EMPTY_REQUIRED_SECTION warning
      expect(issues.some((i) => i.code === 'EMPTY_REQUIRED_SECTION' && i.message.includes('Why'))).toBe(true);
      // Delta Summary, Tasks, Validation have content → should NOT produce EMPTY_REQUIRED_SECTION
      expect(issues.filter((i) => i.code === 'EMPTY_REQUIRED_SECTION')).toHaveLength(1);
    });

    it('should not warn when required sections have sufficient content', () => {
      const change = createChange('chg-1', {
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        feature: 'feat-1',
        systems: ['sys-1'],
        raw_text: [
          '## Why',
          'We need to add authentication to improve security.',
          '## Delta Summary',
          '- ADDED requirement "R1" to [[feat-1]]',
          '## Tasks',
          '- [ ] Add R1 to Feature',
          '## Validation',
          'Run tests and verify all pass.',
        ].join('\n'),
        delta_summary: [
          {
            op: 'ADDED',
            target_type: 'requirement',
            target_name: 'R1',
            target_note_id: 'feat-1',
            base_fingerprint: null,
          },
        ],
        tasks: [{ text: 'Add R1', done: false }],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues.filter((i) => i.code === 'EMPTY_REQUIRED_SECTION')).toHaveLength(0);
    });

    it('should warn about missing Design Approach for complex changes', () => {
      const change = createChange('chg-1', {
        headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
        feature: 'feat-1',
        delta_summary: Array.from({ length: 5 }, (_, i) => ({
          op: 'MODIFIED' as const,
          target_type: 'requirement' as const,
          target_name: `R${i}`,
          target_note_id: 'feat-1',
          base_fingerprint: `hash-${i}`,
        })),
        tasks: [{ text: 'Task', done: false }],
      });
      const index = createIndex([change]);
      const issues = checkChangeCompleteness(change, index);
      expect(issues.some((i) => i.code === 'MISSING_DESIGN_APPROACH' && i.severity === 'warning')).toBe(true);
    });
  });

  describe('checkMinimumSections', () => {
    it('should return no issues for system with Purpose heading', () => {
      const sys = createSystem('sys-1', { headings: ['Purpose', 'Overview'], raw_text: '## Purpose\nThis system handles authentication and identity management for the platform.' });
      const issues = checkMinimumSections(sys);
      expect(issues).toHaveLength(0);
    });

    it('should return no issues for decision with Summary heading', () => {
      const dec = createDecision('dec-1', { headings: ['Summary', 'Context', 'Decision'], raw_text: '## Summary\nWe decided to use passkeys for authentication going forward.' });
      const issues = checkMinimumSections(dec);
      expect(issues).toHaveLength(0);
    });

    it('should warn when system has no Purpose or Summary heading', () => {
      const sys = createSystem('sys-1', { headings: ['Overview'] });
      const issues = checkMinimumSections(sys);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].code).toBe('MISSING_SECTION');
    });

    it('should warn when decision has no Purpose or Summary heading', () => {
      const dec = createDecision('dec-1', { headings: ['Context', 'Decision'] });
      const issues = checkMinimumSections(dec);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].code).toBe('MISSING_SECTION');
    });
  });
});
