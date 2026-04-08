import { describe, it, expect } from 'vitest';
import { getChangeStatus } from '../../src/cli/commands/status.js';
import { analyzeSequencing } from '../../src/core/sequencing/analyze.js';
import { createIndex, createChange, createFeature } from '../helpers/mock-index.js';

describe('getChangeStatus', () => {
  it('should return correct status for proposed change with all sections', () => {
    const change = createChange('chg-1', {
      status: 'proposed',
      feature: 'feat-1',
      headings: ['Why', 'Delta Summary', 'Tasks', 'Validation'],
      delta_summary: [
        { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
      ],
      tasks: [{ text: 'Task 1', done: false }],
      raw_text: [
        '## Why', '', 'This change is needed because...',
        '## Delta Summary', '', '- ADDED requirement "R1" to [[Feature: Foo]]',
        '## Tasks', '', '- [ ] Task 1',
        '## Validation', '', 'Verify the change works.',
      ].join('\n'),
    });
    const index = createIndex([change]);
    const result = getChangeStatus('chg-1', index);

    expect(result.status).toBe('proposed');
    expect(result.sectionCompleteness.why).toBe(true);
    expect(result.sectionCompleteness.deltaSummary).toBe(true);
    expect(result.sectionCompleteness.tasks).toBe(true);
    expect(result.sectionCompleteness.validation).toBe(true);
    expect(result.nextAction.action).toBe('transition');
    expect(result.nextAction.to).toBe('planned');
  });

  it('should return fill_section for proposed change missing Why', () => {
    const change = createChange('chg-1', {
      status: 'proposed',
      headings: ['Delta Summary', 'Tasks', 'Validation'],
      delta_summary: [
        { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
      ],
      tasks: [{ text: 'Task', done: false }],
    });
    const index = createIndex([change]);
    const result = getChangeStatus('chg-1', index);
    expect(result.nextAction.action).toBe('fill_section');
    expect(result.nextAction.target).toBe('Why');
  });

  it('should return continue_task for in_progress change with unchecked tasks', () => {
    const change = createChange('chg-1', {
      status: 'in_progress',
      tasks: [
        { text: 'Task 1', done: true },
        { text: 'Task 2', done: false },
      ],
    });
    const index = createIndex([change]);
    const result = getChangeStatus('chg-1', index);
    expect(result.nextAction.action).toBe('continue_task');
    expect(result.taskProgress.completed).toBe(1);
    expect(result.taskProgress.total).toBe(2);
  });

  it('should return verify_then_archive for applied change', () => {
    const change = createChange('chg-1', { status: 'applied' });
    const index = createIndex([change]);
    const result = getChangeStatus('chg-1', index);
    expect(result.nextAction.action).toBe('verify_then_archive');
  });

  it('should return blocked when depends_on target does not exist', () => {
    const change = createChange('chg-1', {
      status: 'planned',
      depends_on: ['dep-missing'],
      raw_text: [
        '## Why', '', 'Needed.',
        '## Delta Summary', '', '- ADDED requirement "R1" to [[Feature: Foo]]',
        '## Tasks', '', '- [ ] Task 1',
        '## Validation', '', 'Verify.',
      ].join('\n'),
      delta_summary: [
        { op: 'ADDED', target_type: 'requirement', target_name: 'R1', target_note_id: 'feat-1', base_fingerprint: null },
      ],
      tasks: [{ text: 'Task 1', done: false }],
    });
    const index = createIndex([change]);
    const result = getChangeStatus('chg-1', index, {
      analyzeSequencing: (records) => analyzeSequencing(records),
    });
    expect(result.nextAction.action).toBe('blocked');
  });

  it('should still track blockedBy even for proposed status', () => {
    const dep = createChange('dep-1', { status: 'proposed' });
    const change = createChange('chg-1', {
      status: 'proposed',
      depends_on: ['dep-1'],
    });
    const index = createIndex([change, dep]);
    const result = getChangeStatus('chg-1', index);
    // blockedBy is reported even though nextAction prioritizes fill_section for proposed
    expect(result.blockedBy).toContain('dep-1');
    expect(result.nextAction.action).toBe('fill_section');
  });

  it('should throw for non-existent change', () => {
    const index = createIndex([]);
    expect(() => getChangeStatus('nonexistent', index)).toThrow('not found');
  });

  it('should include features in result', () => {
    const change = createChange('chg-1', { feature: 'feat-1' });
    const index = createIndex([change]);
    const result = getChangeStatus('chg-1', index);
    expect(result.features).toContain('feat-1');
  });
});
