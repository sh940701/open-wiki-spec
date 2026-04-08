import { describe, it, expect } from 'vitest';
import { ChangeFrontmatterSchema, CHANGE_STATUS_TRANSITIONS } from '../../../src/core/schema/change.schema.js';

describe('ChangeFrontmatterSchema', () => {
  const validChange = {
    type: 'change' as const,
    id: 'change-add-passkey',
    status: 'proposed' as const,
    tags: ['change'],
    created_at: '2026-04-06',
    feature: '[[Feature: Auth Login]]',
    depends_on: [],
    touches: ['[[Feature: Auth Login]]'],
    systems: ['[[System: Authentication]]'],
    sources: [],
    decisions: [],
  };

  it('should validate a well-formed change frontmatter', () => {
    const result = ChangeFrontmatterSchema.safeParse(validChange);
    expect(result.success).toBe(true);
  });

  it('should reject missing created_at', () => {
    const { created_at, ...rest } = validChange;
    const result = ChangeFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should reject invalid created_at format', () => {
    const result = ChangeFrontmatterSchema.safeParse({
      ...validChange,
      created_at: '2026/04/06',
    });
    expect(result.success).toBe(false);
  });

  it('should accept features array (multi-feature, min 2)', () => {
    const { feature, ...rest } = validChange;
    const result = ChangeFrontmatterSchema.safeParse({
      ...rest,
      features: ['[[Feature: Auth Login]]', '[[Feature: User Profile]]'],
    });
    expect(result.success).toBe(true);
  });

  it('should reject both feature and features present', () => {
    const result = ChangeFrontmatterSchema.safeParse({
      ...validChange,
      features: ['[[Feature: Auth Login]]', '[[Feature: User Profile]]'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject neither feature nor features present', () => {
    const { feature, ...rest } = validChange;
    const result = ChangeFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should reject features array with only 1 element', () => {
    const { feature, ...rest } = validChange;
    const result = ChangeFrontmatterSchema.safeParse({
      ...rest,
      features: ['[[Feature: Auth Login]]'],
    });
    expect(result.success).toBe(false);
  });

  it('should accept all valid change statuses', () => {
    for (const status of ['proposed', 'planned', 'in_progress', 'applied']) {
      const result = ChangeFrontmatterSchema.safeParse({
        ...validChange,
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid status for change', () => {
    const result = ChangeFrontmatterSchema.safeParse({
      ...validChange,
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('should reject feature with non-wikilink value', () => {
    const result = ChangeFrontmatterSchema.safeParse({
      ...validChange,
      feature: 'plain-text',
    });
    expect(result.success).toBe(false);
  });
});

describe('CHANGE_STATUS_TRANSITIONS', () => {
  it('proposed can transition to planned', () => {
    expect(CHANGE_STATUS_TRANSITIONS['proposed']).toContain('planned');
  });

  it('planned can transition to in_progress', () => {
    expect(CHANGE_STATUS_TRANSITIONS['planned']).toContain('in_progress');
  });

  it('in_progress can transition to applied', () => {
    expect(CHANGE_STATUS_TRANSITIONS['in_progress']).toContain('applied');
  });

  it('applied is terminal (no transitions)', () => {
    expect(CHANGE_STATUS_TRANSITIONS['applied']).toEqual([]);
  });

  it('proposed cannot skip to in_progress', () => {
    expect(CHANGE_STATUS_TRANSITIONS['proposed']).not.toContain('in_progress');
  });
});
