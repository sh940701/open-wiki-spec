import { describe, it, expect } from 'vitest';
import { lexicalRetrieval } from '../../../src/core/retrieval/lexical.js';
import { createFeature, createChange, createSystem, createSource, createDecision, createIndex } from '../../helpers/mock-index.js';
import type { RetrievalQuery } from '../../../src/types/retrieval.js';

function makeQuery(overrides: Partial<RetrievalQuery>): RetrievalQuery {
  return {
    intent: 'query',
    summary: '',
    feature_terms: [],
    system_terms: [],
    entity_terms: [],
    status_bias: [],
    ...overrides,
  };
}

describe('lexicalRetrieval', () => {
  it('finds by title match', () => {
    const feature = createFeature('feat-auth', { title: 'Auth Login' });
    const idx = createIndex([feature]);

    const candidates = lexicalRetrieval(makeQuery({ feature_terms: ['auth'] }), idx);
    expect(candidates.has('feat-auth')).toBe(true);
  });

  it('finds by alias match', () => {
    const feature = createFeature('feat-auth', { title: 'Authentication', aliases: ['login auth'] });
    const idx = createIndex([feature]);

    const candidates = lexicalRetrieval(makeQuery({ feature_terms: ['login'] }), idx);
    expect(candidates.has('feat-auth')).toBe(true);
  });

  it('finds via system match and includes referencing notes', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const feature = createFeature('feat-login', { title: 'Login Flow', systems: ['sys-auth'] });
    const idx = createIndex([sys, feature]);

    const candidates = lexicalRetrieval(makeQuery({ system_terms: ['authentication'] }), idx);
    expect(candidates.has('sys-auth')).toBe(true);
    expect(candidates.has('feat-login')).toBe(true);
  });

  it('finds Changes linked to candidate Features', () => {
    const feature = createFeature('feat-auth', { title: 'Auth Login' });
    const change = createChange('chg-passkey', { title: 'Add Passkey', feature: 'feat-auth' });
    const idx = createIndex([feature, change]);

    const candidates = lexicalRetrieval(makeQuery({ feature_terms: ['auth'] }), idx);
    expect(candidates.has('feat-auth')).toBe(true);
    expect(candidates.has('chg-passkey')).toBe(true);
  });

  it('finds Source/Decision by entity_terms and includes referencing notes', () => {
    const source = createSource('src-webauthn', { title: 'WebAuthn Spec' });
    const feature = createFeature('feat-passkey', { title: 'Passkey Feature', sources: ['src-webauthn'] });
    const idx = createIndex([source, feature]);

    const candidates = lexicalRetrieval(makeQuery({ entity_terms: ['webauthn'] }), idx);
    expect(candidates.has('src-webauthn')).toBe(true);
    expect(candidates.has('feat-passkey')).toBe(true);
  });

  it('finds by full-text match with 2+ terms', () => {
    const feature = createFeature('feat-hidden', {
      title: 'Hidden Feature',
      raw_text: 'This note discusses passkey and webauthn integration details',
    });
    const idx = createIndex([feature]);

    const candidates = lexicalRetrieval(
      makeQuery({ entity_terms: ['passkey', 'webauthn'] }),
      idx,
    );
    expect(candidates.has('feat-hidden')).toBe(true);
  });

  it('finds by full-text match with single term when only one search term', () => {
    const feature = createFeature('feat-hidden', {
      title: 'Something Else',
      raw_text: 'This note mentions passkey somewhere in the body',
    });
    const idx = createIndex([feature]);

    const candidates = lexicalRetrieval(
      makeQuery({ feature_terms: ['passkey'] }),
      idx,
    );
    expect(candidates.has('feat-hidden')).toBe(true);
  });

  it('returns empty set for empty query', () => {
    const feature = createFeature('feat-auth', { title: 'Auth' });
    const idx = createIndex([feature]);

    const candidates = lexicalRetrieval(makeQuery({}), idx);
    expect(candidates.size).toBe(0);
  });

  it('returns empty set when no notes match', () => {
    const feature = createFeature('feat-auth', { title: 'Auth Login' });
    const idx = createIndex([feature]);

    const candidates = lexicalRetrieval(makeQuery({ feature_terms: ['payment'] }), idx);
    expect(candidates.size).toBe(0);
  });

  it('finds Decision by entity_terms', () => {
    const decision = createDecision('dec-jwt', { title: 'Use JWT Tokens' });
    const feature = createFeature('feat-auth', { title: 'Auth', decisions: ['dec-jwt'] });
    const idx = createIndex([decision, feature]);

    const candidates = lexicalRetrieval(makeQuery({ entity_terms: ['jwt'] }), idx);
    expect(candidates.has('dec-jwt')).toBe(true);
    expect(candidates.has('feat-auth')).toBe(true);
  });
});
