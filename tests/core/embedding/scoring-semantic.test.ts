import { describe, it, expect } from 'vitest';
import { scoreCandidates } from '../../../src/core/retrieval/scoring.js';
import { DEFAULT_WEIGHTS } from '../../../src/core/retrieval/constants.js';
import { createFeature, createIndex } from '../../helpers/mock-index.js';
import type { RetrievalQuery } from '../../../src/types/retrieval.js';

describe('scoreCandidates — Signal 10: semantic_similarity', () => {
  const baseQuery: RetrievalQuery = {
    intent: 'add',
    summary: 'user registration',
    feature_terms: ['signup'],
    system_terms: [],
    entity_terms: [],
    status_bias: ['active', 'proposed'],
  };

  it('adds semantic_similarity points when embeddingScores > 0.7', () => {
    const feat = createFeature('f-auth', { title: 'Auth Login', raw_text: 'auth' });
    const idx = createIndex([feat]);
    const candidates = new Set(['f-auth']);

    const embeddingScores = new Map([['f-auth', 0.85]]);
    const results = scoreCandidates(candidates, baseQuery, idx, DEFAULT_WEIGHTS, embeddingScores);

    expect(results.length).toBe(1);
    const reasons = results[0].reasons;
    expect(reasons.some((r) => r.includes('semantic match'))).toBe(true);
    // 0.85 * 30 = 25.5 → rounded to 26
    expect(results[0].score).toBeGreaterThanOrEqual(26);
  });

  it('does NOT add semantic points when similarity <= 0.7', () => {
    const feat = createFeature('f-auth', { title: 'Auth Login', raw_text: 'auth' });
    const idx = createIndex([feat]);
    const candidates = new Set(['f-auth']);

    const embeddingScores = new Map([['f-auth', 0.65]]);
    const results = scoreCandidates(candidates, baseQuery, idx, DEFAULT_WEIGHTS, embeddingScores);

    const reasons = results[0]?.reasons ?? [];
    expect(reasons.some((r) => r.includes('semantic match'))).toBe(false);
  });

  it('works without embeddingScores (backward compat)', () => {
    const feat = createFeature('f-auth', {
      title: 'signup',
      raw_text: 'signup flow',
      status: 'active',
    });
    const idx = createIndex([feat]);
    const candidates = new Set(['f-auth']);

    // No embeddingScores parameter — should work exactly as before
    const results = scoreCandidates(candidates, baseQuery, idx, DEFAULT_WEIGHTS);
    expect(results.length).toBe(1);
    expect(results[0].reasons.some((r) => r.includes('semantic match'))).toBe(false);
  });

  it('semantic signal combines with keyword signals', () => {
    const feat = createFeature('f-auth', {
      title: 'signup',
      raw_text: 'signup user registration',
      status: 'active',
    });
    const idx = createIndex([feat]);
    const candidates = new Set(['f-auth']);

    const withoutEmbed = scoreCandidates(candidates, baseQuery, idx, DEFAULT_WEIGHTS);
    const embeddingScores = new Map([['f-auth', 0.9]]);
    const withEmbed = scoreCandidates(candidates, baseQuery, idx, DEFAULT_WEIGHTS, embeddingScores);

    // Score with embedding should be higher than without
    expect(withEmbed[0].score).toBeGreaterThan(withoutEmbed[0].score);
    // Difference should be approximately 0.9 * 30 = 27
    const diff = withEmbed[0].score - withoutEmbed[0].score;
    expect(diff).toBe(27);
  });
});
