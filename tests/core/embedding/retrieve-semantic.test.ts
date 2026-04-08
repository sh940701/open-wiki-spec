import { describe, it, expect } from 'vitest';
import { retrieve } from '../../../src/core/retrieval/retrieve.js';
import { createFeature, createIndex } from '../../helpers/mock-index.js';

describe('retrieve — semantic candidate integration', () => {
  it('semantic-only candidates enter the pipeline via semanticScores', () => {
    // "회원가입" feature has no keyword overlap with the query terms
    const feat = createFeature('f-signup', {
      title: '회원가입',
      raw_text: '신규 사용자 회원가입 플로우',
      status: 'active',
    });
    const idx = createIndex([feat]);

    // Query with completely different keywords
    const result = retrieve(idx, {
      intent: 'add',
      summary: '새 사용자를 받고 싶어',
      feature_terms: ['사용자'],
      system_terms: [],
      entity_terms: [],
      status_bias: ['active'],
    }, {
      // Without semanticScores, this note would NOT be found
      semanticScores: new Map([['f-signup', 0.85]]),
    });

    // The semantic candidate should now appear in results
    const found = result.candidates.find((c) => c.id === 'f-signup');
    expect(found).toBeDefined();
    expect(found!.reasons.some((r) => r.includes('semantic match'))).toBe(true);
  });

  it('works normally without semanticScores (backward compat)', () => {
    const feat = createFeature('f-login', {
      title: 'Login',
      raw_text: 'user login flow',
      status: 'active',
    });
    const idx = createIndex([feat]);

    const result = retrieve(idx, {
      intent: 'add',
      summary: 'login',
      feature_terms: ['login'],
      system_terms: [],
      entity_terms: [],
      status_bias: ['active'],
    });

    // Should still work via lexical path
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].id).toBe('f-login');
  });

  it('semantic candidates get graph expansion — neighbors with signals score', () => {
    // f-auth links to f-login; query term "login" matches f-login lexically
    const fAuth = createFeature('f-auth', {
      title: 'Auth',
      raw_text: 'authentication system',
      status: 'active',
      links_out: ['f-login'],
    });
    const fLogin = createFeature('f-login', {
      title: 'Login',
      raw_text: 'login flow',
      status: 'active',
      links_in: ['f-auth'],
    });
    const idx = createIndex([fAuth, fLogin]);

    // f-auth found via semantic, f-login found via graph expansion
    // and "login" feature_term gives f-login scoring signal
    const result = retrieve(idx, {
      intent: 'query',
      summary: 'authentication login',
      feature_terms: ['login'],
      system_terms: [],
      entity_terms: [],
      status_bias: ['active'],
    }, {
      semanticScores: new Map([['f-auth', 0.9]]),
    });

    const ids = result.candidates.map((c) => c.id);
    expect(ids).toContain('f-auth');
    // f-login should appear: found via graph expansion from f-auth, scores via "login" match
    expect(ids).toContain('f-login');
  });
});
