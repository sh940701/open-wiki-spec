import { describe, it, expect } from 'vitest';
import { parseTasks } from '../../../src/core/parser/task-parser.js';
import { parseSections } from '../../../src/core/parser/section-parser.js';

describe('parseTasks', () => {
  it('parses unchecked task', () => {
    const body = `## Tasks\n- [ ] Write tests`;
    const { sections } = parseSections(body);
    const { tasks } = parseTasks(sections);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('Write tests');
    expect(tasks[0].done).toBe(false);
  });

  it('parses checked task with lowercase x', () => {
    const body = `## Tasks\n- [x] Done task`;
    const { sections } = parseSections(body);
    const { tasks } = parseTasks(sections);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].done).toBe(true);
  });

  it('parses checked task with uppercase X', () => {
    const body = `## Tasks\n- [X] Also done`;
    const { sections } = parseSections(body);
    const { tasks } = parseTasks(sections);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].done).toBe(true);
  });

  it('parses multiple tasks', () => {
    const body = `## Tasks
- [x] Task A
- [ ] Task B
- [x] Task C`;
    const { sections } = parseSections(body);
    const { tasks } = parseTasks(sections);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].done).toBe(true);
    expect(tasks[1].done).toBe(false);
    expect(tasks[2].done).toBe(true);
  });

  it('ignores non-task list items', () => {
    const body = `## Tasks
- Regular list item
- [ ] Real task
- Another regular item`;
    const { sections } = parseSections(body);
    const { tasks } = parseTasks(sections);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('Real task');
  });

  it('returns empty array when no Tasks section', () => {
    const body = `## Other Section\n- [ ] Not found`;
    const { sections } = parseSections(body);
    const { tasks } = parseTasks(sections);
    expect(tasks).toHaveLength(0);
  });

  it('finds tasks in nested subsections', () => {
    const body = `## Tasks
### Phase 1
- [ ] Task in sub
### Phase 2
- [x] Another sub task`;
    const { sections } = parseSections(body);
    const { tasks } = parseTasks(sections);
    expect(tasks).toHaveLength(2);
  });
});
