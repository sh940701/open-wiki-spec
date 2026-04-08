import { describe, it, expect } from 'vitest';
import { scoreCandidates } from '../../../src/core/retrieval/scoring.js';
import { createFeature, createChange, createSystem, createSource, createDecision, createIndex } from '../../helpers/mock-index.js';
import type { RetrievalQuery } from '../../../src/types/retrieval.js';
import { DEFAULT_WEIGHTS } from '../../../src/core/retrieval/constants.js';

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

describe('scoreCandidates', () => {
  it('awards +40 for exact title match', () => {
    const feature = createFeature('feat-auth', { title: 'auth login' });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({ summary: 'auth login', feature_terms: ['auth login'] }),
      idx,
    );
    expect(scored[0].score).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.exact_title);
    expect(scored[0].reasons.some((r) => r.includes('exact title'))).toBe(true);
  });

  it('awards alias match at most once per candidate', () => {
    const feature = createFeature('feat-auth', {
      title: 'Authentication',
      aliases: ['auth', 'login', 'sign in'],
    });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({ feature_terms: ['auth', 'login'] }),
      idx,
    );
    const aliasReasons = scored[0].reasons.filter((r) => r.includes('alias match'));
    expect(aliasReasons).toHaveLength(1);
  });

  it('awards +20 for same system match', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const feature = createFeature('feat-login', { title: 'Login Flow', systems: ['sys-auth'] });
    const idx = createIndex([sys, feature]);

    const scored = scoreCandidates(
      new Set(['feat-login']),
      makeQuery({ system_terms: ['authentication'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('same system'))).toBe(true);
  });

  it('awards +25 for active change overlap on Feature', () => {
    const change = createChange('chg-a', { title: 'Add Passkey', status: 'proposed' });
    const feature = createFeature('feat-auth', { title: 'Auth', changes: ['chg-a'] });
    const idx = createIndex([feature, change]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({ feature_terms: ['auth'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('active change overlap'))).toBe(true);
  });

  it('awards +25 for active change itself', () => {
    const change = createChange('chg-a', { title: 'Add Passkey', status: 'proposed' });
    const idx = createIndex([change]);

    const scored = scoreCandidates(
      new Set(['chg-a']),
      makeQuery({ feature_terms: ['passkey'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('active change'))).toBe(true);
  });

  it('does not award active change for applied changes', () => {
    const change = createChange('chg-a', { title: 'Add Passkey', status: 'applied' });
    const idx = createIndex([change]);

    const scored = scoreCandidates(
      new Set(['chg-a']),
      makeQuery({ feature_terms: ['passkey'] }),
      idx,
    );
    expect(scored[0]?.reasons.some((r) => r.includes('active change'))).toBeFalsy();
  });

  it('stacks multiple signals correctly', () => {
    const sys = createSystem('sys-auth', { title: 'Authentication' });
    const source = createSource('src-webauthn', { title: 'WebAuthn' });
    const feature = createFeature('feat-auth', {
      title: 'auth login',
      systems: ['sys-auth'],
      sources: ['src-webauthn'],
    });
    const idx = createIndex([sys, source, feature]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({
        summary: 'auth login',
        feature_terms: ['auth login'],
        system_terms: ['authentication'],
        entity_terms: ['webauthn'],
      }),
      idx,
    );
    // exact_title (40) + same_system (20) + shared_source (10) = 70
    expect(scored[0].score).toBeGreaterThanOrEqual(70);
  });

  it('awards full-text match for 2+ terms in body', () => {
    const feature = createFeature('feat-hidden', {
      title: 'Other',
      raw_text: 'This discusses passkey and webauthn integration',
    });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-hidden']),
      makeQuery({ entity_terms: ['passkey', 'webauthn'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('full-text'))).toBe(true);
  });

  it('excludes zero-score candidates', () => {
    const feature = createFeature('feat-auth', { title: 'Auth' });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({ feature_terms: ['payment'] }), // no match
      idx,
    );
    expect(scored).toHaveLength(0);
  });

  it('sorts by score descending, then by title ascending', () => {
    const a = createFeature('feat-a', { title: 'Alpha Auth', aliases: ['auth'] });
    const b = createFeature('feat-b', { title: 'Beta Auth', aliases: ['auth'] });
    const idx = createIndex([a, b]);

    const scored = scoreCandidates(
      new Set(['feat-a', 'feat-b']),
      makeQuery({ feature_terms: ['auth'] }),
      idx,
    );
    // Same score -> Alpha < Beta by title
    expect(scored[0].title).toBe('Alpha Auth');
    expect(scored[1].title).toBe('Beta Auth');
  });

  it('awards status bias bonus', () => {
    const featureActive = createFeature('feat-active', { title: 'Auth Feature', status: 'active' });
    const featureDeprecated = createFeature('feat-dep', { title: 'Auth Old', status: 'deprecated' });
    const idx = createIndex([featureActive, featureDeprecated]);

    const scoredWithBias = scoreCandidates(
      new Set(['feat-active', 'feat-dep']),
      makeQuery({ feature_terms: ['auth'], status_bias: ['active'] }),
      idx,
    );
    // feat-active gets +5 bias bonus
    const activeScore = scoredWithBias.find((c) => c.id === 'feat-active')?.score ?? 0;
    const depScore = scoredWithBias.find((c) => c.id === 'feat-dep')?.score ?? 0;
    expect(activeScore).toBeGreaterThan(depScore);
  });

  it('awards same_feature_link for Change targeting candidate Feature', () => {
    const feature = createFeature('feat-auth', { title: 'Auth' });
    const change = createChange('chg-a', { title: 'Add Passkey', feature: 'feat-auth' });
    const idx = createIndex([feature, change]);

    const scored = scoreCandidates(
      new Set(['feat-auth', 'chg-a']),
      makeQuery({ feature_terms: ['auth', 'passkey'] }),
      idx,
    );
    const changeScore = scored.find((c) => c.id === 'chg-a');
    expect(changeScore?.reasons.some((r) => r.includes('same feature link'))).toBe(true);
  });

  it('awards +20 for partial title match', () => {
    const feature = createFeature('feat-auth', { title: 'Auth Login System' });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({ feature_terms: ['auth'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('partial title match'))).toBe(true);
    expect(scored[0].score).toBeGreaterThanOrEqual(20);
  });

  it('awards +30 for prefix-stripped title match', () => {
    const feature = createFeature('feat-auth', { title: 'Feature: Auth Login' });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({ feature_terms: ['auth login'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('prefix-stripped title match'))).toBe(true);
  });

  it('awards full_text_weak (+8) for single term hit in body', () => {
    const feature = createFeature('feat-hidden', {
      title: 'Other Feature',
      raw_text: 'This discusses passkey integration only',
    });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-hidden']),
      makeQuery({ feature_terms: ['passkey', 'webauthn'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('weak full-text hit'))).toBe(true);
    expect(scored[0].score).toBeGreaterThanOrEqual(8);
  });

  it('awards alias_match for derived alias from title prefix strip', () => {
    const feature = createFeature('feat-auth', {
      title: 'Feature: Auth Login',
      aliases: ['Auth Login'],
    });
    const idx = createIndex([feature]);

    const scored = scoreCandidates(
      new Set(['feat-auth']),
      makeQuery({ feature_terms: ['auth'] }),
      idx,
    );
    expect(scored[0].reasons.some((r) => r.includes('alias match'))).toBe(true);
  });

  it('awards backlink_proximity for 2+ shared links', () => {
    const feature = createFeature('feat-auth', {
      title: 'Auth',
      links_out: ['shared-1', 'shared-2'],
      links_in: [],
    });
    const idx = createIndex([feature]);

    // Both shared-1 and shared-2 are in candidateIds
    const scored = scoreCandidates(
      new Set(['feat-auth', 'shared-1', 'shared-2']),
      makeQuery({ feature_terms: ['auth'] }),
      idx,
    );
    const authCandidate = scored.find((c) => c.id === 'feat-auth');
    expect(authCandidate?.reasons.some((r) => r.includes('backlink proximity'))).toBe(true);
  });
});
