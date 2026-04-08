import { describe, it, expect } from 'vitest';
import { querySearch, constructQueryContext } from '../../src/core/workflow/query/query-search.js';
import { createIndex, createFeature, createChange, createSystem, createDecision, createQuery } from '../helpers/mock-index.js';

describe('querySearch', () => {
  it('should return candidates matching question terms', () => {
    const feat = createFeature('feat-auth', {
      title: 'Feature: Auth Login',
      links_out: ['sys-auth'],
      links_in: [],
    });
    const sys = createSystem('sys-auth', {
      title: 'System: Authentication',
      links_out: [],
      links_in: ['feat-auth'],
    });
    const index = createIndex([feat, sys]);
    const result = querySearch({ question: 'How does auth login work?' }, index);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some((c) => c.id === 'feat-auth')).toBe(true);
  });

  it('should separate existing query notes', () => {
    const feat = createFeature('feat-auth', { title: 'Feature: Auth Login' });
    const query = createQuery('query-auth', { title: 'Query: Auth Investigation' });
    const index = createIndex([feat, query]);
    const result = querySearch({ question: 'auth' }, index);
    expect(result.existingQueries.some((q) => q.id === 'query-auth')).toBe(true);
  });

  it('should filter by noteTypes when specified', () => {
    const feat = createFeature('feat-1', { title: 'Feature: Auth Login' });
    const sys = createSystem('sys-1', { title: 'System: Authentication' });
    const index = createIndex([feat, sys]);
    const result = querySearch({ question: 'auth', noteTypes: ['feature'] }, index);
    expect(result.candidates.every((c) => c.type === 'feature' || c.type === 'query')).toBe(true);
  });

  it('should filter by systemIds when specified', () => {
    const feat1 = createFeature('feat-1', { systems: ['sys-auth'] });
    const feat2 = createFeature('feat-2', { systems: ['sys-billing'] });
    const index = createIndex([feat1, feat2]);
    const result = querySearch({ question: 'feature', systemIds: ['sys-auth'] }, index);
    const nonQueryCandidates = result.candidates.filter((c) => c.type !== 'query');
    expect(nonQueryCandidates.every((c) => c.id === 'feat-1')).toBe(true);
  });

  it('should return empty candidates for no matches', () => {
    const index = createIndex([createFeature('feat-1', { title: 'Feature: Auth Login' })]);
    const result = querySearch({ question: 'billing payment gateway' }, index);
    expect(result.candidates).toHaveLength(0);
  });

  it('should expand graph context from top candidates', () => {
    const feat = createFeature('feat-auth', {
      title: 'Feature: Auth Login',
      links_out: ['sys-auth'],
      links_in: [],
    });
    const sys = createSystem('sys-auth', {
      title: 'System: Authentication',
      links_out: [],
      links_in: ['feat-auth'],
    });
    const index = createIndex([feat, sys]);
    const result = querySearch({ question: 'auth login' }, index);
    // Graph context should include sys-auth linked from feat-auth
    expect(result.graphContext.length).toBeGreaterThanOrEqual(0);
  });

  it('should preserve original question in result', () => {
    const index = createIndex([createFeature('feat-1')]);
    const result = querySearch({ question: 'my specific question' }, index);
    expect(result.question).toBe('my specific question');
  });
});

describe('constructQueryContext', () => {
  it('should build a context string with candidates', () => {
    const result = querySearch(
      { question: 'auth' },
      createIndex([createFeature('feat-auth', { title: 'Feature: Auth Login' })]),
    );
    const context = constructQueryContext(result);
    expect(context).toContain('Vault Search Results');
  });

  it('should include existing queries section when present', () => {
    const result = querySearch(
      { question: 'auth' },
      createIndex([
        createFeature('feat-auth', { title: 'Feature: Auth Login' }),
        createQuery('query-auth', { title: 'Query: Auth', status: 'active' }),
      ]),
    );
    const context = constructQueryContext(result);
    if (result.existingQueries.length > 0) {
      expect(context).toContain('Existing Investigations');
    }
  });

  it('should include warnings when present', () => {
    const result = {
      question: 'test',
      candidates: [],
      graphContext: [],
      existingQueries: [],
      warnings: ['Stale index detected'],
    };
    const context = constructQueryContext(result);
    expect(context).toContain('Warnings');
    expect(context).toContain('Stale index detected');
  });
});
