import { describe, it, expect } from 'vitest';
import { generateId } from '../../src/utils/id-generator.js';

describe('generateId', () => {
  it('should generate feature id from title', () => {
    expect(generateId('feature', 'Auth Login')).toBe('feature-auth-login');
  });

  it('should generate change id from title', () => {
    expect(generateId('change', 'Add Passkey Login')).toBe('change-add-passkey-login');
  });

  it('should generate system id from title', () => {
    expect(generateId('system', 'Authentication')).toBe('system-authentication');
  });

  it('should generate decision id from title', () => {
    expect(generateId('decision', 'Use WebAuthn')).toBe('decision-use-webauthn');
  });

  it('should handle underscores', () => {
    expect(generateId('feature', 'user_profile')).toBe('feature-user-profile');
  });

  it('should strip special characters', () => {
    expect(generateId('feature', 'Auth (v2) Login!')).toBe('feature-auth-v2-login');
  });

  it('should collapse consecutive hyphens', () => {
    expect(generateId('feature', 'Auth  --  Login')).toBe('feature-auth-login');
  });

  it('should trim leading/trailing hyphens from slug', () => {
    expect(generateId('feature', '  Auth Login  ')).toBe('feature-auth-login');
  });

  it('should be deterministic', () => {
    const id1 = generateId('feature', 'Auth Login');
    const id2 = generateId('feature', 'Auth Login');
    expect(id1).toBe(id2);
  });

  it('should preserve Unicode characters in IDs', () => {
    expect(generateId('feature', 'Auth 로그인')).toBe('feature-auth-로그인');
  });

  it('should handle fully Korean titles', () => {
    expect(generateId('feature', '루틴 라우팅')).toBe('feature-루틴-라우팅');
  });
});
