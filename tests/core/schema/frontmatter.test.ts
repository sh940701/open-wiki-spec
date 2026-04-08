import { describe, it, expect } from 'vitest';
import { FrontmatterSchema } from '../../../src/core/schema/frontmatter.js';

describe('FrontmatterSchema (discriminated union)', () => {
  it('should validate feature frontmatter', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature-auth',
      status: 'active',
      tags: [],
      systems: ['[[System: Auth]]'],
      sources: [],
      decisions: [],
      changes: [],
    });
    expect(result.success).toBe(true);
  });

  it('should validate change frontmatter', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'change',
      id: 'change-add-passkey',
      status: 'proposed',
      tags: [],
      created_at: '2026-04-06',
      feature: '[[Feature: Auth]]',
      depends_on: [],
      touches: [],
      systems: [],
      sources: [],
      decisions: [],
    });
    expect(result.success).toBe(true);
  });

  it('should validate system frontmatter', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'system',
      id: 'system-auth',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('should validate decision frontmatter', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'decision',
      id: 'decision-use-jwt',
      status: 'active',
      tags: [],
      features: [],
      changes: [],
    });
    expect(result.success).toBe(true);
  });

  it('should validate source frontmatter', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'source',
      id: 'source-prd',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('should validate query frontmatter', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'query',
      id: 'query-auth-flow',
      status: 'draft',
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject unknown type', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'unknown',
      id: 'test',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(false);
  });

  it('should validate feature frontmatter with Korean id', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature-루틴-라우팅',
      status: 'active',
      tags: [],
      systems: [],
      sources: [],
      decisions: [],
      changes: [],
    });
    expect(result.success).toBe(true);
  });

  it('should validate change frontmatter with Korean id', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'change',
      id: 'change-로그인-추가',
      status: 'proposed',
      tags: [],
      created_at: '2026-04-06',
      feature: '[[Feature: 루틴 라우팅]]',
      depends_on: [],
      touches: [],
      systems: [],
      sources: [],
      decisions: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject feature with change-only status', () => {
    const result = FrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature-auth',
      status: 'proposed',
      tags: [],
      systems: ['[[System: Auth]]'],
    });
    expect(result.success).toBe(false);
  });
});
