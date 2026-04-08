import { describe, it, expect } from 'vitest';
import { computeHash } from '../../src/utils/hash.js';

describe('computeHash', () => {
  it('should return consistent hash for same input', () => {
    const hash1 = computeHash('hello world');
    const hash2 = computeHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('should return different hash for different input', () => {
    const hash1 = computeHash('hello');
    const hash2 = computeHash('world');
    expect(hash1).not.toBe(hash2);
  });

  it('should return a hex string', () => {
    const hash = computeHash('test');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should handle empty string', () => {
    const hash = computeHash('');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
