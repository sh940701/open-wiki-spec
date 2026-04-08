import { describe, it, expect } from 'vitest';
import { SourceFrontmatterSchema } from '../../../src/core/schema/source.schema.js';

describe('SourceFrontmatterSchema', () => {
  const validSource = {
    type: 'source' as const,
    id: 'source-product-brief',
    status: 'active' as const,
    tags: ['source'],
  };

  it('should validate a well-formed source frontmatter', () => {
    const result = SourceFrontmatterSchema.safeParse(validSource);
    expect(result.success).toBe(true);
  });

  it('should accept optional source_type', () => {
    const result = SourceFrontmatterSchema.safeParse({
      ...validSource,
      source_type: 'prd',
    });
    expect(result.success).toBe(true);
  });

  it('should accept all source_type values', () => {
    for (const st of ['prd', 'issue', 'meeting', 'code_reading', 'research', 'other']) {
      const result = SourceFrontmatterSchema.safeParse({
        ...validSource,
        source_type: st,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid source_type', () => {
    const result = SourceFrontmatterSchema.safeParse({
      ...validSource,
      source_type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional url', () => {
    const result = SourceFrontmatterSchema.safeParse({
      ...validSource,
      url: 'https://example.com/doc',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid url', () => {
    const result = SourceFrontmatterSchema.safeParse({
      ...validSource,
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});
