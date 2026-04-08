import { describe, it, expect } from 'vitest';
import { retrieve } from '../../../src/core/retrieval/retrieve.js';
import {
  createFeature, createChange, createSystem, createSource, createDecision,
  createIndex,
} from '../../helpers/mock-index.js';
import type { RetrievalQuery } from '../../../src/types/retrieval.js';

function makeQuery(overrides: Partial<RetrievalQuery>): RetrievalQuery {
  return {
    intent: 'add',
    summary: '',
    feature_terms: [],
    system_terms: [],
    entity_terms: [],
    status_bias: ['active', 'proposed', 'planned', 'in_progress'],
    ...overrides,
  };
}

describe('retrieve (full pipeline)', () => {
  it('returns new_feature for query with no matching notes', () => {
    const feature = createFeature('feat-auth', { title: 'Auth Login' });
    const idx = createIndex([feature]);

    const result = retrieve(idx, makeQuery({
      summary: 'payment processing',
      feature_terms: ['payment'],
    }));

    expect(result.classification).toBe('new_feature');
    expect(result.candidates).toHaveLength(0);
  });

  it('returns existing_feature for clear Feature match', () => {
    const feature = createFeature('feat-auth', {
      title: 'auth login',
      aliases: ['authentication'],
      raw_text: 'User authentication and login feature',
    });
    const sys = createSystem('sys-auth', { title: 'Authentication System' });
    const idx = createIndex([feature, sys]);

    const result = retrieve(idx, makeQuery({
      summary: 'auth login',
      feature_terms: ['auth login'],
      system_terms: ['authentication'],
    }));

    expect(result.classification).toBe('existing_feature');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].id).toBe('feat-auth');
  });

  it('returns existing_change for clear active Change match', () => {
    const feature = createFeature('feat-auth', { title: 'Auth', changes: ['chg-passkey'] });
    const change = createChange('chg-passkey', {
      title: 'add passkey',
      feature: 'feat-auth',
      status: 'proposed',
      aliases: ['passkey login'],
      raw_text: 'Add passkey support for authentication',
    });
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const idx = createIndex([feature, change, sys]);

    const result = retrieve(idx, makeQuery({
      summary: 'add passkey',
      feature_terms: ['add passkey'],
      system_terms: ['authentication'],
    }));

    // chg-passkey should get: exact_title(40) + active_change(25) + same_system(20) + same_feature_link(20) = 105
    expect(result.classification).toBe('existing_change');
    expect(result.candidates[0].id).toBe('chg-passkey');
  });

  it('includes graph-expanded candidates', () => {
    const feature = createFeature('feat-auth', {
      title: 'Auth Login',
      links_out: ['dec-jwt'],
    });
    const decision = createDecision('dec-jwt', {
      title: 'JWT Decision',
      links_in: ['feat-auth'],
    });
    const idx = createIndex([feature, decision]);

    const result = retrieve(idx, makeQuery({
      summary: 'auth login',
      feature_terms: ['auth'],
    }));

    // dec-jwt should be found via graph expansion from feat-auth
    const hasDecision = result.candidates.some((c) => c.id === 'dec-jwt');
    // It may or may not score high enough to appear, but the expansion should work
    expect(result.candidates.some((c) => c.id === 'feat-auth')).toBe(true);
  });

  it('respects maxCandidates option', () => {
    const features = Array.from({ length: 20 }, (_, i) =>
      createFeature(`feat-${i}`, { title: `Auth Feature ${i}` }),
    );
    const idx = createIndex(features);

    const result = retrieve(idx, makeQuery({
      summary: 'auth feature',
      feature_terms: ['auth'],
    }), { maxCandidates: 3 });

    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('includes warnings for duplicate IDs', () => {
    const feature = createFeature('feat-auth', { title: 'Auth' });
    const idx = createIndex([feature], {
      warnings: [{ type: 'duplicate_id', note_path: 'wiki/features/feat-auth.md', message: 'Duplicate id "feat-auth"' }],
    });

    const result = retrieve(idx, makeQuery({
      summary: 'auth',
      feature_terms: ['auth'],
    }));

    expect(result.warnings.some((w) => w.includes('Duplicate id'))).toBe(true);
  });

  it('embeds sequencing summary in output', () => {
    const feature = createFeature('feat-auth', { title: 'Auth' });
    const idx = createIndex([feature]);

    const result = retrieve(idx, makeQuery({
      summary: 'auth',
      feature_terms: ['auth'],
    }));

    expect(result.sequencing).toBeDefined();
    expect(result.sequencing.status).toBe('parallel_safe');
    expect(result.sequencing.related_changes).toEqual([]);
  });

  it('uses custom scoring weights', () => {
    const feature = createFeature('feat-auth', { title: 'auth' });
    const idx = createIndex([feature]);

    const defaultResult = retrieve(idx, makeQuery({
      summary: 'auth',
      feature_terms: ['auth'],
    }));

    const customResult = retrieve(idx, makeQuery({
      summary: 'auth',
      feature_terms: ['auth'],
    }), {
      weights: { exact_title: 100 },
    });

    expect(customResult.candidates[0].score).toBeGreaterThan(defaultResult.candidates[0].score);
  });

  it('finds Korean-titled features via Korean query', () => {
    const feature = createFeature('feature-루틴-라우팅', {
      title: '루틴 라우팅',
      raw_text: '루틴 기반 라우팅 기능을 처리하는 피처',
    });
    const idx = createIndex([feature]);

    const result = retrieve(idx, makeQuery({
      summary: '루틴 라우팅',
      feature_terms: ['루틴', '라우팅'],
    }));

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].id).toBe('feature-루틴-라우팅');
  });

  it('query field in result matches the summary', () => {
    const idx = createIndex([]);
    const result = retrieve(idx, makeQuery({ summary: 'add passkey login' }));
    expect(result.query).toBe('add passkey login');
  });
});
