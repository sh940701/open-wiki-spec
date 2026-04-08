import { describe, it, expect } from 'vitest';
import { BaseFrontmatterSchema } from '../../../src/core/schema/base.schema.js';

describe('BaseFrontmatterSchema', () => {
  it('accepts ASCII lowercase id', () => {
    const result = BaseFrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature-auth-login',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts Korean id (Unicode letters)', () => {
    const result = BaseFrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature-루틴-라우팅',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts mixed Korean and ASCII id', () => {
    const result = BaseFrontmatterSchema.safeParse({
      type: 'change',
      id: 'change-auth-로그인-flow',
      status: 'proposed',
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts Japanese id (Unicode letters)', () => {
    const result = BaseFrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature-認証',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects id with spaces', () => {
    const result = BaseFrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature auth login',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects id with special characters', () => {
    const result = BaseFrontmatterSchema.safeParse({
      type: 'feature',
      id: 'feature@auth!login',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = BaseFrontmatterSchema.safeParse({
      type: 'feature',
      id: '',
      status: 'active',
      tags: [],
    });
    expect(result.success).toBe(false);
  });
});
