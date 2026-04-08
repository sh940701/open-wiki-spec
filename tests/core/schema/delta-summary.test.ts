import { describe, it, expect } from 'vitest';
import {
  DeltaSummaryEntrySchema,
  DeltaOpEnum,
  DELTA_APPLY_ORDER,
  DELTA_REQUIREMENT_PATTERN,
  DELTA_RENAMED_PATTERN,
  DELTA_SECTION_PATTERN,
} from '../../../src/core/schema/delta-summary.js';

describe('DeltaSummaryEntrySchema', () => {
  it('should validate an ADDED requirement entry', () => {
    const result = DeltaSummaryEntrySchema.safeParse({
      op: 'ADDED',
      target_type: 'requirement',
      target_name: 'Passkey Authentication',
      target_note_id: 'feature-auth-login',
      base_fingerprint: null,
    });
    expect(result.success).toBe(true);
  });

  it('should validate a MODIFIED requirement entry', () => {
    const result = DeltaSummaryEntrySchema.safeParse({
      op: 'MODIFIED',
      target_type: 'requirement',
      target_name: 'Password Login',
      target_note_id: 'feature-auth-login',
      base_fingerprint: 'sha256:abc123',
    });
    expect(result.success).toBe(true);
  });

  it('should validate a RENAMED requirement entry', () => {
    const result = DeltaSummaryEntrySchema.safeParse({
      op: 'RENAMED',
      target_type: 'requirement',
      target_name: 'Login Auth',
      new_name: 'Password Login',
      target_note_id: 'feature-auth-login',
      base_fingerprint: 'sha256:def456',
    });
    expect(result.success).toBe(true);
  });

  it('should validate a section entry', () => {
    const result = DeltaSummaryEntrySchema.safeParse({
      op: 'MODIFIED',
      target_type: 'section',
      target_name: 'Current Behavior',
      target_note_id: 'feature-auth-login',
      base_fingerprint: null,
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid op', () => {
    const result = DeltaSummaryEntrySchema.safeParse({
      op: 'DELETED',
      target_type: 'requirement',
      target_name: 'test',
      target_note_id: 'id',
      base_fingerprint: null,
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty target_name', () => {
    const result = DeltaSummaryEntrySchema.safeParse({
      op: 'ADDED',
      target_type: 'requirement',
      target_name: '',
      target_note_id: 'id',
      base_fingerprint: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('DeltaOpEnum', () => {
  it('should accept all valid ops', () => {
    for (const op of ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']) {
      expect(DeltaOpEnum.safeParse(op).success).toBe(true);
    }
  });
});

describe('DELTA_APPLY_ORDER', () => {
  it('should have correct order: RENAMED, REMOVED, MODIFIED, ADDED', () => {
    expect(DELTA_APPLY_ORDER).toEqual(['RENAMED', 'REMOVED', 'MODIFIED', 'ADDED']);
  });
});

describe('DELTA_REQUIREMENT_PATTERN', () => {
  it('should match ADDED requirement line', () => {
    const line = '- ADDED requirement "Passkey Authentication" to [[Feature: Auth Login]] [base: n/a]';
    const match = line.match(DELTA_REQUIREMENT_PATTERN);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('ADDED');
    expect(match![2]).toBe('Passkey Authentication');
    expect(match![3]).toBe('to');
    expect(match![4]).toBe('Feature: Auth Login');
    expect(match![5]).toBe('n/a');
  });

  it('should match MODIFIED requirement line', () => {
    const line = '- MODIFIED requirement "Password Login" in [[Feature: Auth Login]] [base: sha256:def456]';
    const match = line.match(DELTA_REQUIREMENT_PATTERN);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('MODIFIED');
    expect(match![2]).toBe('Password Login');
    expect(match![4]).toBe('Feature: Auth Login');
    expect(match![5]).toBe('sha256:def456');
  });

  it('should match REMOVED requirement line', () => {
    const line = '- REMOVED requirement "Remember Me" from [[Feature: Auth Login]] [base: sha256:abc123]';
    const match = line.match(DELTA_REQUIREMENT_PATTERN);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('REMOVED');
    expect(match![3]).toBe('from');
  });
});

describe('DELTA_RENAMED_PATTERN', () => {
  it('should match RENAMED requirement line', () => {
    const line = '- RENAMED requirement "Login Auth" to "Password Login" in [[Feature: Auth Login]] [base: sha256:789abc]';
    const match = line.match(DELTA_RENAMED_PATTERN);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('Login Auth');
    expect(match![2]).toBe('Password Login');
    expect(match![3]).toBe('Feature: Auth Login');
    expect(match![4]).toBe('sha256:789abc');
  });
});

describe('DELTA_SECTION_PATTERN', () => {
  it('should match section modification line', () => {
    const line = '- MODIFIED section "Current Behavior" in [[Feature: Auth Login]]';
    const match = line.match(DELTA_SECTION_PATTERN);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('MODIFIED');
    expect(match![2]).toBe('Current Behavior');
    expect(match![4]).toBe('Feature: Auth Login');
  });
});
