import { describe, it, expect } from 'vitest';
import { computeDeterministicOrder } from '../../../src/core/sequencing/ordering.js';
import { createChange } from '../../helpers/mock-index.js';

describe('computeDeterministicOrder', () => {
  it('orders a linear chain A -> B -> C correctly', () => {
    const a = createChange('a', { depends_on: [], created_at: '2026-01-01' });
    const b = createChange('b', { depends_on: ['a'], created_at: '2026-01-02' });
    const c = createChange('c', { depends_on: ['b'], created_at: '2026-01-03' });

    const { ordering, cycles } = computeDeterministicOrder([a, b, c]);
    expect(cycles).toHaveLength(0);
    expect(ordering.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(ordering[0].depth).toBe(0);
    expect(ordering[1].depth).toBe(1);
    expect(ordering[2].depth).toBe(2);
  });

  it('handles diamond dependency with tiebreak by (created_at, id)', () => {
    const a = createChange('a', { depends_on: [], created_at: '2026-01-01' });
    const b = createChange('b', { depends_on: ['a'], created_at: '2026-01-03' });
    const c = createChange('c', { depends_on: ['a'], created_at: '2026-01-02' });
    const d = createChange('d', { depends_on: ['b', 'c'], created_at: '2026-01-04' });

    const { ordering, cycles } = computeDeterministicOrder([a, b, c, d]);
    expect(cycles).toHaveLength(0);

    const ids = ordering.map((o) => o.id);
    expect(ids[0]).toBe('a'); // depth 0
    // c (2026-01-02) comes before b (2026-01-03) at depth 1
    expect(ids[1]).toBe('c');
    expect(ids[2]).toBe('b');
    expect(ids[3]).toBe('d'); // depth 2
  });

  it('detects A -> B -> A cycle', () => {
    const a = createChange('a', { depends_on: ['b'], created_at: '2026-01-01' });
    const b = createChange('b', { depends_on: ['a'], created_at: '2026-01-02' });

    const { ordering, cycles } = computeDeterministicOrder([a, b]);
    expect(cycles.length).toBeGreaterThan(0);
    // Both should appear in ordering but marked as blocked by CYCLE
    const cycleEntries = ordering.filter((o) => o.blocked_by.includes('CYCLE'));
    expect(cycleEntries).toHaveLength(2);
  });

  it('orders by (created_at, id) when no dependencies', () => {
    const a = createChange('a', { depends_on: [], created_at: '2026-01-03' });
    const b = createChange('b', { depends_on: [], created_at: '2026-01-01' });
    const c = createChange('c', { depends_on: [], created_at: '2026-01-02' });

    const { ordering, cycles } = computeDeterministicOrder([a, b, c]);
    expect(cycles).toHaveLength(0);
    // b (01-01) -> c (01-02) -> a (01-03)
    expect(ordering.map((o) => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('tiebreaks by id when created_at is the same', () => {
    const a = createChange('alpha', { depends_on: [], created_at: '2026-01-01' });
    const b = createChange('beta', { depends_on: [], created_at: '2026-01-01' });

    const { ordering } = computeDeterministicOrder([a, b]);
    // alpha < beta lexicographically
    expect(ordering.map((o) => o.id)).toEqual(['alpha', 'beta']);
  });

  it('handles single change trivially', () => {
    const a = createChange('a', { depends_on: [], created_at: '2026-01-01' });
    const { ordering, cycles } = computeDeterministicOrder([a]);
    expect(cycles).toHaveLength(0);
    expect(ordering).toHaveLength(1);
    expect(ordering[0].id).toBe('a');
    expect(ordering[0].depth).toBe(0);
    expect(ordering[0].position).toBe(0);
  });

  it('handles empty input', () => {
    const { ordering, cycles } = computeDeterministicOrder([]);
    expect(ordering).toHaveLength(0);
    expect(cycles).toHaveLength(0);
  });

  it('marks external dependencies (not in active set) as blocked_by', () => {
    const a = createChange('a', { depends_on: ['external-dep'], created_at: '2026-01-01' });
    const { ordering, cycles } = computeDeterministicOrder([a]);
    expect(cycles).toHaveLength(0);
    expect(ordering[0].blocked_by).toContain('external-dep');
  });

  it('handles self-dependency as cycle', () => {
    const a = createChange('a', { depends_on: ['a'], created_at: '2026-01-01' });
    const { cycles } = computeDeterministicOrder([a]);
    expect(cycles.length).toBeGreaterThan(0);
  });
});
