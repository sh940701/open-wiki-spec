import { describe, it, expect } from 'vitest';
import { normalizeQuery, enrichSystemTerms } from '../../../../src/core/workflow/propose/query-normalizer.js';
import { createSystem, createIndex } from '../../../helpers/mock-index.js';

describe('normalizeQuery', () => {
  it('detects "add" intent by default', () => {
    const q = normalizeQuery('add passkey login');
    expect(q.intent).toBe('add');
    expect(q.feature_terms).toContain('passkey');
    expect(q.feature_terms).toContain('login');
  });

  it('detects "fix" intent from bug-related keywords', () => {
    const q = normalizeQuery('fix authentication bug');
    expect(q.intent).toBe('fix');
    expect(q.feature_terms).toContain('authentication');
  });

  it('detects "remove" intent', () => {
    const q = normalizeQuery('remove deprecated OAuth flow');
    expect(q.intent).toBe('remove');
    expect(q.feature_terms).toContain('oauth');
    expect(q.feature_terms).toContain('flow');
  });

  it('detects "investigate" intent', () => {
    const q = normalizeQuery('investigate session management');
    expect(q.intent).toBe('investigate');
    expect(q.feature_terms).toContain('session');
    expect(q.feature_terms).toContain('management');
  });

  it('detects "modify" intent from refactor/update keywords', () => {
    const q = normalizeQuery('refactor auth middleware');
    expect(q.intent).toBe('modify');
    expect(q.feature_terms).toContain('auth');
    expect(q.feature_terms).toContain('middleware');
  });

  it('defaults to "add" when no keyword matches', () => {
    const q = normalizeQuery('passkey login for mobile');
    expect(q.intent).toBe('add');
  });

  it('preserves summary as trimmed input', () => {
    const q = normalizeQuery('  add passkey login  ');
    expect(q.summary).toBe('add passkey login');
  });

  it('throws on empty string', () => {
    expect(() => normalizeQuery('')).toThrow();
    expect(() => normalizeQuery('   ')).toThrow();
  });

  it('filters common stop words from feature_terms', () => {
    const q = normalizeQuery('add the new login to system');
    expect(q.feature_terms).not.toContain('the');
    expect(q.feature_terms).not.toContain('to');
    expect(q.feature_terms).toContain('login');
  });

  it('detects entity_terms from camelCase/snake_case tokens', () => {
    const q = normalizeQuery('add authMiddleware to user_session');
    expect(q.entity_terms).toContain('authMiddleware');
    expect(q.entity_terms).toContain('user_session');
  });

  it('sets default status_bias', () => {
    const q = normalizeQuery('add passkey login');
    expect(q.status_bias).toEqual(['active', 'proposed', 'planned', 'in_progress']);
  });

  it('handles very long input', () => {
    const longInput = 'add ' + 'word '.repeat(300);
    const q = normalizeQuery(longInput);
    expect(q.summary.length).toBeLessThanOrEqual(500);
    expect(q.feature_terms.length).toBeGreaterThan(0);
  });

  describe('override keywords', () => {
    it('uses override keywords as feature_terms when provided', () => {
      const q = normalizeQuery(
        'HealthKit 워치 동기화 실패 Sentry 추적',
        ['워치 동기화', 'HealthKit', 'Sentry', '에러 추적'],
      );
      expect(q.feature_terms).toEqual(['워치 동기화', 'healthkit', 'sentry', '에러 추적']);
    });

    it('still detects intent from original request when override keywords provided', () => {
      const q = normalizeQuery('fix the broken auth flow', ['auth', 'login']);
      expect(q.intent).toBe('fix');
      expect(q.feature_terms).toEqual(['auth', 'login']);
    });

    it('preserves original summary when override keywords provided', () => {
      const q = normalizeQuery('add passkey login for mobile', ['passkey', 'mobile']);
      expect(q.summary).toBe('add passkey login for mobile');
    });

    it('classifies camelCase/snake_case override keywords as entity_terms', () => {
      const q = normalizeQuery('add auth', ['authMiddleware', 'user_session', 'login']);
      expect(q.entity_terms).toContain('authMiddleware');
      expect(q.entity_terms).toContain('user_session');
      expect(q.feature_terms).toContain('login');
    });

    it('ignores empty override keywords array', () => {
      const q = normalizeQuery('add passkey login', []);
      expect(q.feature_terms).toContain('passkey');
      expect(q.feature_terms).toContain('login');
    });

    it('stores override_keywords on QueryObject', () => {
      const q = normalizeQuery('add auth', ['auth', 'login']);
      expect(q.override_keywords).toEqual(['auth', 'login']);
    });

    it('does not set override_keywords when not provided', () => {
      const q = normalizeQuery('add auth');
      expect(q.override_keywords).toBeUndefined();
    });
  });
});

describe('enrichSystemTerms', () => {
  it('populates system_terms when feature_terms match system titles', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const idx = createIndex([sys]);
    const query = normalizeQuery('add auth login');
    const enriched = enrichSystemTerms(query, idx);
    expect(enriched.system_terms).toContain('auth');
  });

  it('populates system_terms when feature_terms match system aliases', () => {
    const sys = createSystem('sys-auth', {
      title: 'Authentication System',
      aliases: ['auth', 'login service'],
    });
    const idx = createIndex([sys]);
    const query = normalizeQuery('add login service integration');
    const enriched = enrichSystemTerms(query, idx);
    expect(enriched.system_terms).toContain('login');
  });

  it('returns empty system_terms when no systems match', () => {
    const sys = createSystem('sys-payment', { title: 'Payment' });
    const idx = createIndex([sys]);
    const query = normalizeQuery('add auth login');
    const enriched = enrichSystemTerms(query, idx);
    expect(enriched.system_terms).toHaveLength(0);
  });

  it('does not mutate the original query', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const idx = createIndex([sys]);
    const query = normalizeQuery('add auth login');
    const enriched = enrichSystemTerms(query, idx);
    expect(query.system_terms).toHaveLength(0);
    expect(enriched.system_terms.length).toBeGreaterThan(0);
  });
});
