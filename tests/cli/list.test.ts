import { describe, it, expect } from 'vitest';
import { listNotes } from '../../src/cli/commands/list.js';
import { createIndex, createFeature, createChange, createSystem } from '../helpers/mock-index.js';

describe('listNotes', () => {
  it('should list all notes when type is all', () => {
    const index = createIndex([
      createFeature('feat-1'),
      createFeature('feat-2'),
      createChange('chg-1'),
    ]);
    const result = listNotes(index, 'all');
    expect(result.items).toHaveLength(3);
  });

  it('should filter to changes only', () => {
    const index = createIndex([
      createFeature('feat-1'),
      createChange('chg-1'),
      createChange('chg-2'),
    ]);
    const result = listNotes(index, 'changes');
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.type === 'change')).toBe(true);
  });

  it('should filter to features only', () => {
    const index = createIndex([
      createFeature('feat-1'),
      createFeature('feat-2'),
      createChange('chg-1'),
    ]);
    const result = listNotes(index, 'features');
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.type === 'feature')).toBe(true);
  });

  it('should include task progress for changes', () => {
    const change = createChange('chg-1', {
      tasks: [
        { text: 'Task 1', done: true },
        { text: 'Task 2', done: false },
      ],
    });
    const index = createIndex([change]);
    const result = listNotes(index, 'all');
    const item = result.items[0];
    expect(item.taskProgress).toEqual({ total: 2, completed: 1 });
  });

  it('should sort by status priority', () => {
    const index = createIndex([
      createChange('chg-applied', { status: 'applied' }),
      createChange('chg-progress', { status: 'in_progress' }),
      createChange('chg-proposed', { status: 'proposed' }),
    ]);
    const result = listNotes(index, 'all');
    expect(result.items[0].status).toBe('in_progress');
    expect(result.items[1].status).toBe('proposed');
    expect(result.items[2].status).toBe('applied');
  });

  it('should return empty for empty vault', () => {
    const index = createIndex([]);
    const result = listNotes(index, 'all');
    expect(result.items).toHaveLength(0);
  });
});
