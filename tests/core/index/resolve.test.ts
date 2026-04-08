import { describe, it, expect } from 'vitest';
import { buildLookupMaps, resolveWikilink, isResolved } from '../../../src/core/index/resolve.js';

describe('buildLookupMaps', () => {
  it('builds title map case-insensitively', () => {
    const records = [
      { id: 'auth-login', title: 'Feature: Auth Login', aliases: [], path: 'wiki/01-features/auth-login.md' },
    ];
    const maps = buildLookupMaps(records);
    expect(maps.title_to_ids.get('feature: auth login')).toEqual(['auth-login']);
  });

  it('indexes multiple aliases per note', () => {
    const records = [
      { id: 'test', title: 'Test', aliases: ['Alias1', 'Alias2'], path: 'wiki/test.md' },
    ];
    const maps = buildLookupMaps(records);
    expect(maps.alias_to_ids.get('alias1')).toEqual(['test']);
    expect(maps.alias_to_ids.get('alias2')).toEqual(['test']);
  });

  it('builds path-to-id map', () => {
    const records = [
      { id: 'test', title: 'Test', aliases: [], path: 'wiki/test.md' },
    ];
    const maps = buildLookupMaps(records);
    expect(maps.path_to_id.get('wiki/test.md')).toBe('test');
  });
});

describe('resolveWikilink', () => {
  const records = [
    { id: 'auth-login', title: 'Feature: Auth Login', aliases: ['Auth'], path: 'p1' },
    { id: 'identity', title: 'System: Identity', aliases: [], path: 'p2' },
  ];
  const lookups = buildLookupMaps(records);

  it('resolves by title match', () => {
    const result = resolveWikilink('[[Feature: Auth Login]]', lookups);
    expect(isResolved(result)).toBe(true);
    if (isResolved(result)) {
      expect(result.target_id).toBe('auth-login');
      expect(result.resolved_via).toBe('title');
    }
  });

  it('resolves case-insensitively', () => {
    const result = resolveWikilink('[[feature: auth login]]', lookups);
    expect(isResolved(result)).toBe(true);
    if (isResolved(result)) {
      expect(result.target_id).toBe('auth-login');
    }
  });

  it('resolves by alias when no title match', () => {
    const result = resolveWikilink('[[Auth]]', lookups);
    expect(isResolved(result)).toBe(true);
    if (isResolved(result)) {
      expect(result.target_id).toBe('auth-login');
      expect(result.resolved_via).toBe('alias');
    }
  });

  it('resolves by id when title does not match', () => {
    const result = resolveWikilink('[[auth-login]]', lookups);
    expect(isResolved(result)).toBe(true);
    if (isResolved(result)) {
      expect(result.target_id).toBe('auth-login');
      expect(result.resolved_via).toBe('id');
    }
  });

  it('prefers title match over id match', () => {
    // "Feature: Auth Login" matches by title; "auth-login" is the id
    const result = resolveWikilink('[[Feature: Auth Login]]', lookups);
    expect(isResolved(result)).toBe(true);
    if (isResolved(result)) {
      expect(result.resolved_via).toBe('title');
    }
  });

  it('returns no_match for unknown wikilink', () => {
    const result = resolveWikilink('[[Nonexistent]]', lookups);
    expect(isResolved(result)).toBe(false);
    if (!isResolved(result)) {
      expect(result.error).toBe('no_match');
    }
  });

  it('strips display text from wikilink', () => {
    const result = resolveWikilink('[[Feature: Auth Login|login feature]]', lookups);
    expect(isResolved(result)).toBe(true);
    if (isResolved(result)) {
      expect(result.target_id).toBe('auth-login');
    }
  });

  it('returns ambiguous when multiple titles match', () => {
    const ambiguousRecords = [
      { id: 'a1', title: 'Same Title', aliases: [], path: 'p1' },
      { id: 'a2', title: 'Same Title', aliases: [], path: 'p2' },
    ];
    const ambiguousLookups = buildLookupMaps(ambiguousRecords);
    const result = resolveWikilink('[[Same Title]]', ambiguousLookups);
    expect(isResolved(result)).toBe(false);
    if (!isResolved(result)) {
      expect(result.error).toBe('ambiguous_alias');
      expect(result.candidates).toContain('a1');
      expect(result.candidates).toContain('a2');
    }
  });

  it('returns ambiguous when multiple aliases match', () => {
    const ambiguousRecords = [
      { id: 'x1', title: 'Title X', aliases: ['shared'], path: 'p1' },
      { id: 'x2', title: 'Title Y', aliases: ['shared'], path: 'p2' },
    ];
    const ambiguousLookups = buildLookupMaps(ambiguousRecords);
    const result = resolveWikilink('[[shared]]', ambiguousLookups);
    expect(isResolved(result)).toBe(false);
    if (!isResolved(result)) {
      expect(result.error).toBe('ambiguous_alias');
    }
  });
});
