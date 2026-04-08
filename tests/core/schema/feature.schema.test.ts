import { describe, it, expect } from 'vitest';
import { FeatureFrontmatterSchema } from '../../../src/core/schema/feature.schema.js';

describe('FeatureFrontmatterSchema', () => {
  const validFeature = {
    type: 'feature' as const,
    id: 'feature-auth-login',
    status: 'active' as const,
    tags: ['feature'],
    systems: ['[[System: Authentication]]'],
    sources: [],
    decisions: [],
    changes: [],
  };

  it('should validate a well-formed feature frontmatter', () => {
    const result = FeatureFrontmatterSchema.safeParse(validFeature);
    expect(result.success).toBe(true);
  });

  it('should reject missing type', () => {
    const { type, ...rest } = validFeature;
    const result = FeatureFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should reject missing id', () => {
    const { id, ...rest } = validFeature;
    const result = FeatureFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should reject invalid id format (uppercase)', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      id: 'Feature-Auth',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty id', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      id: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid status for feature', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      status: 'proposed',
    });
    expect(result.success).toBe(false);
  });

  it('should accept deprecated status', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      status: 'deprecated',
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty systems array (skeleton features)', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      systems: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject systems with non-wikilink strings', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      systems: ['plain-text'],
    });
    expect(result.success).toBe(false);
  });

  it('should default tags to empty array when omitted', () => {
    const { tags, ...rest } = validFeature;
    const result = FeatureFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it('should default sources to empty array when omitted', () => {
    const { sources, ...rest } = validFeature;
    const result = FeatureFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources).toEqual([]);
    }
  });

  it('should allow extra fields to pass through', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      aliases: ['Auth', 'Login'],
      custom_field: 'extra',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).aliases).toEqual(['Auth', 'Login']);
    }
  });

  it('should reject wrong type literal', () => {
    const result = FeatureFrontmatterSchema.safeParse({
      ...validFeature,
      type: 'change',
    });
    expect(result.success).toBe(false);
  });
});
