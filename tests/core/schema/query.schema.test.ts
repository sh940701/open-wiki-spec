import { describe, it, expect } from 'vitest';
import { QueryFrontmatterSchema } from '../../../src/core/schema/query.schema.js';

describe('QueryFrontmatterSchema', () => {
  const validQuery = {
    type: 'query' as const,
    id: 'query-auth-flow',
    status: 'draft' as const,
    tags: ['query'],
  };

  it('should validate a well-formed query frontmatter', () => {
    const result = QueryFrontmatterSchema.safeParse(validQuery);
    expect(result.success).toBe(true);
  });

  it('should accept optional question field', () => {
    const result = QueryFrontmatterSchema.safeParse({
      ...validQuery,
      question: 'How does the auth flow work?',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty question string', () => {
    const result = QueryFrontmatterSchema.safeParse({
      ...validQuery,
      question: '',
    });
    expect(result.success).toBe(false);
  });

  it('should accept all GeneralStatus values', () => {
    for (const status of ['active', 'draft', 'archived']) {
      const result = QueryFrontmatterSchema.safeParse({
        ...validQuery,
        status,
      });
      expect(result.success).toBe(true);
    }
  });
});
