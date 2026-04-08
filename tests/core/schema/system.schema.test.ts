import { describe, it, expect } from 'vitest';
import { SystemFrontmatterSchema } from '../../../src/core/schema/system.schema.js';

describe('SystemFrontmatterSchema', () => {
  const validSystem = {
    type: 'system' as const,
    id: 'system-authentication',
    status: 'active' as const,
    tags: ['system'],
  };

  it('should validate a well-formed system frontmatter', () => {
    const result = SystemFrontmatterSchema.safeParse(validSystem);
    expect(result.success).toBe(true);
  });

  it('should accept draft status', () => {
    const result = SystemFrontmatterSchema.safeParse({
      ...validSystem,
      status: 'draft',
    });
    expect(result.success).toBe(true);
  });

  it('should accept archived status', () => {
    const result = SystemFrontmatterSchema.safeParse({
      ...validSystem,
      status: 'archived',
    });
    expect(result.success).toBe(true);
  });

  it('should reject change-specific status', () => {
    const result = SystemFrontmatterSchema.safeParse({
      ...validSystem,
      status: 'proposed',
    });
    expect(result.success).toBe(false);
  });

  it('should reject wrong type literal', () => {
    const result = SystemFrontmatterSchema.safeParse({
      ...validSystem,
      type: 'feature',
    });
    expect(result.success).toBe(false);
  });
});
