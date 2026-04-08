import { describe, it, expect } from 'vitest';
import { graphExpand } from '../../../src/core/retrieval/graph-expand.js';
import { createFeature, createChange, createSystem, createIndex } from '../../helpers/mock-index.js';

describe('graphExpand', () => {
  it('adds one-hop-out targets', () => {
    const a = createFeature('a', { links_out: ['b'], links_in: [] });
    const b = createFeature('b', { links_out: [], links_in: ['a'] });
    const idx = createIndex([a, b]);

    const expanded = graphExpand(new Set(['a']), idx);
    expect(expanded.has('a')).toBe(true);
    expect(expanded.has('b')).toBe(true);
  });

  it('adds one-hop-in targets', () => {
    const a = createFeature('a', { links_out: [], links_in: ['c'] });
    const c = createFeature('c', { links_out: ['a'], links_in: [] });
    const idx = createIndex([a, c]);

    const expanded = graphExpand(new Set(['a']), idx);
    expect(expanded.has('a')).toBe(true);
    expect(expanded.has('c')).toBe(true);
  });

  it('does NOT add two-hop targets', () => {
    const a = createFeature('a', { links_out: ['b'], links_in: [] });
    const b = createFeature('b', { links_out: ['c'], links_in: ['a'] });
    const c = createFeature('c', { links_out: [], links_in: ['b'] });
    const idx = createIndex([a, b, c]);

    const expanded = graphExpand(new Set(['a']), idx);
    expect(expanded.has('a')).toBe(true);
    expect(expanded.has('b')).toBe(true);
    expect(expanded.has('c')).toBe(false); // two hops
  });

  it('handles self-links without duplication', () => {
    const a = createFeature('a', { links_out: ['a'], links_in: ['a'] });
    const idx = createIndex([a]);

    const expanded = graphExpand(new Set(['a']), idx);
    expect(expanded.size).toBe(1);
    expect(expanded.has('a')).toBe(true);
  });

  it('returns empty set for empty first pass', () => {
    const idx = createIndex([createFeature('a')]);
    const expanded = graphExpand(new Set(), idx);
    expect(expanded.size).toBe(0);
  });

  it('handles missing records gracefully', () => {
    const idx = createIndex([]);
    const expanded = graphExpand(new Set(['nonexistent']), idx);
    // Just contains the original ID
    expect(expanded.has('nonexistent')).toBe(true);
    expect(expanded.size).toBe(1);
  });
});
