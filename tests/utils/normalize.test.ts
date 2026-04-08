import { describe, it, expect } from 'vitest';
import { normalizeString, normalizeForHash } from '../../src/utils/normalize.js';

describe('normalizeString', () => {
  it('should trim whitespace', () => {
    expect(normalizeString('  hello  ')).toBe('hello');
  });

  it('should collapse internal whitespace', () => {
    expect(normalizeString('hello   world')).toBe('hello world');
  });

  it('should lowercase', () => {
    expect(normalizeString('Hello World')).toBe('hello world');
  });

  it('should handle tabs and newlines', () => {
    expect(normalizeString('hello\t\nworld')).toBe('hello world');
  });
});

describe('normalizeForHash', () => {
  it('should trim leading/trailing whitespace', () => {
    expect(normalizeForHash('  hello  ')).toBe('hello');
  });

  it('should collapse internal whitespace to single space', () => {
    expect(normalizeForHash('hello   world')).toBe('hello world');
  });

  it('should preserve case (case-sensitive hashing)', () => {
    expect(normalizeForHash('Hello World')).toBe('Hello World');
  });

  it('should normalize tabs and newlines to single space', () => {
    expect(normalizeForHash('hello\t\nworld')).toBe('hello world');
  });

  it('should normalize CRLF line endings', () => {
    expect(normalizeForHash('hello\r\nworld')).toBe('hello world');
  });

  it('should produce identical output for semantically equal content', () => {
    const a = normalizeForHash('The system SHALL\n  do something');
    const b = normalizeForHash('The system SHALL do something');
    expect(a).toBe(b);
  });
});
