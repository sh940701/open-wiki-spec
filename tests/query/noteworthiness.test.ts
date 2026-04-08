import { describe, it, expect } from 'vitest';
import { assessNoteworthiness } from '../../src/core/workflow/query/noteworthiness.js';
import type { QuerySearchResult, QueryCandidate } from '../../src/core/workflow/query/types.js';

function makeCandidate(overrides: Partial<QueryCandidate> & { id: string }): QueryCandidate {
  return {
    id: overrides.id,
    type: overrides.type ?? 'feature',
    title: overrides.title ?? `Note: ${overrides.id}`,
    path: overrides.path ?? `wiki/03-features/${overrides.id}.md`,
    status: overrides.status ?? 'active',
    matchReasons: overrides.matchReasons ?? ['title match'],
    score: overrides.score ?? 50,
    relevantSections: overrides.relevantSections ?? [],
  };
}

function makeSearchResult(overrides?: Partial<QuerySearchResult>): QuerySearchResult {
  return {
    question: overrides?.question ?? 'How does auth work?',
    candidates: overrides?.candidates ?? [],
    graphContext: overrides?.graphContext ?? [],
    existingQueries: overrides?.existingQueries ?? [],
    warnings: overrides?.warnings ?? [],
  };
}

describe('assessNoteworthiness', () => {
  it('should recommend creation for complex questions spanning 3+ notes', () => {
    const result = makeSearchResult({
      candidates: [
        makeCandidate({ id: 'feat-1' }),
        makeCandidate({ id: 'sys-1', type: 'system' }),
        makeCandidate({ id: 'dec-1', type: 'decision' }),
      ],
    });
    const assessment = assessNoteworthiness('How does authentication interact with session management?', result);
    expect(assessment.shouldCreate).toBe(true);
    expect(assessment.confidence).toBe('high');
  });

  it('should not recommend creation for simple lookups', () => {
    const result = makeSearchResult({
      candidates: [makeCandidate({ id: 'feat-1' })],
    });
    const assessment = assessNoteworthiness('what is the status of auth login', result);
    expect(assessment.shouldCreate).toBe(false);
    expect(assessment.confidence).toBe('high');
  });

  it('should not recommend creation for "list all" queries', () => {
    const result = makeSearchResult({
      candidates: [makeCandidate({ id: 'feat-1' }), makeCandidate({ id: 'feat-2' }), makeCandidate({ id: 'feat-3' })],
    });
    const assessment = assessNoteworthiness('list all features', result);
    expect(assessment.shouldCreate).toBe(false);
  });

  it('should not recommend creation for "how many" queries', () => {
    const result = makeSearchResult({
      candidates: [makeCandidate({ id: 'feat-1' }), makeCandidate({ id: 'feat-2' }), makeCandidate({ id: 'feat-3' })],
    });
    const assessment = assessNoteworthiness('how many systems do we have', result);
    expect(assessment.shouldCreate).toBe(false);
  });

  it('should recommend creation when related to active changes', () => {
    const result = makeSearchResult({
      candidates: [
        makeCandidate({ id: 'chg-1', type: 'change', status: 'in_progress' }),
      ],
    });
    const assessment = assessNoteworthiness('What impact does the passkey change have?', result);
    expect(assessment.shouldCreate).toBe(true);
  });

  it('should not recommend creation when existing resolved query covers topic', () => {
    const result = makeSearchResult({
      candidates: [makeCandidate({ id: 'feat-1' }), makeCandidate({ id: 'feat-2' }), makeCandidate({ id: 'feat-3' })],
      existingQueries: [
        makeCandidate({ id: 'query-auth', type: 'query', status: 'archived', title: 'Query: Auth Behavior' }),
      ],
    });
    const assessment = assessNoteworthiness('How does auth work?', result);
    expect(assessment.shouldCreate).toBe(false);
    expect(assessment.reasons.some((r) => r.includes('Existing resolved Query'))).toBe(true);
  });

  it('should note when no existing query covers the topic', () => {
    const result = makeSearchResult({
      candidates: [makeCandidate({ id: 'feat-1' })],
      existingQueries: [],
    });
    const assessment = assessNoteworthiness('How does auth work?', result);
    expect(assessment.reasons.some((r) => r.includes('No existing Query'))).toBe(true);
  });

  it('should return medium confidence for borderline cases', () => {
    const result = makeSearchResult({
      candidates: [
        makeCandidate({ id: 'feat-1' }),
        makeCandidate({ id: 'feat-2' }),
      ],
    });
    const assessment = assessNoteworthiness('What are the auth patterns?', result);
    // 2 candidates = not enough for high confidence synthesis
    // Not a simple lookup = not negative signal
    expect(assessment.confidence).toBe('medium');
  });
});
