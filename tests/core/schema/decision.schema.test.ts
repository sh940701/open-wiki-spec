import { describe, it, expect } from 'vitest';
import { DecisionFrontmatterSchema } from '../../../src/core/schema/decision.schema.js';

describe('DecisionFrontmatterSchema', () => {
  const validDecision = {
    type: 'decision' as const,
    id: 'decision-use-webauthn',
    status: 'active' as const,
    tags: ['decision'],
    features: [],
    changes: [],
  };

  it('should validate a well-formed decision frontmatter', () => {
    const result = DecisionFrontmatterSchema.safeParse(validDecision);
    expect(result.success).toBe(true);
  });

  it('should accept features and changes with wikilinks', () => {
    const result = DecisionFrontmatterSchema.safeParse({
      ...validDecision,
      features: ['[[Feature: Auth Login]]'],
      changes: ['[[Change: Add Passkey]]'],
    });
    expect(result.success).toBe(true);
  });

  it('should default features to empty array', () => {
    const { features, ...rest } = validDecision;
    const result = DecisionFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.features).toEqual([]);
    }
  });

  it('should reject non-wikilink in features', () => {
    const result = DecisionFrontmatterSchema.safeParse({
      ...validDecision,
      features: ['plain-text'],
    });
    expect(result.success).toBe(false);
  });
});
