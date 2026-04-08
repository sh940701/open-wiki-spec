import { describe, it, expect } from 'vitest';
import { isActiveChangeStatus, findSystemByTerm, titleSimilarity } from '../../../src/core/retrieval/helpers.js';
import { createSystem, createIndex } from '../../helpers/mock-index.js';

describe('isActiveChangeStatus', () => {
  it('returns true for proposed, planned, in_progress', () => {
    expect(isActiveChangeStatus('proposed')).toBe(true);
    expect(isActiveChangeStatus('planned')).toBe(true);
    expect(isActiveChangeStatus('in_progress')).toBe(true);
  });

  it('returns false for applied and other statuses', () => {
    expect(isActiveChangeStatus('applied')).toBe(false);
    expect(isActiveChangeStatus('active')).toBe(false);
    expect(isActiveChangeStatus('archived')).toBe(false);
    expect(isActiveChangeStatus('')).toBe(false);
  });
});

describe('findSystemByTerm', () => {
  it('finds system by title match', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const idx = createIndex([sys]);

    const results = findSystemByTerm('auth', idx);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('sys-auth');
  });

  it('finds system by alias match', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication', aliases: ['login system'] });
    const idx = createIndex([sys]);

    const results = findSystemByTerm('login', idx);
    expect(results).toHaveLength(1);
  });

  it('returns empty for no match', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const idx = createIndex([sys]);

    const results = findSystemByTerm('payment', idx);
    expect(results).toHaveLength(0);
  });

  it('is case insensitive', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const idx = createIndex([sys]);

    const results = findSystemByTerm('AUTH', idx);
    expect(results).toHaveLength(1);
  });
});

describe('titleSimilarity', () => {
  it('returns true for 80%+ word overlap', () => {
    expect(titleSimilarity('user auth login', 'implementing user auth login flow')).toBe(true);
  });

  it('returns false for low overlap', () => {
    expect(titleSimilarity('user auth login flow', 'payment processing system')).toBe(false);
  });

  it('returns false for empty title', () => {
    expect(titleSimilarity('', 'some summary')).toBe(false);
  });

  it('strips type prefixes', () => {
    expect(titleSimilarity('feature: user auth', 'user auth')).toBe(true);
  });
});
