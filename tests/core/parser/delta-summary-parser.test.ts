import { describe, it, expect } from 'vitest';
import { parseDeltaSummary } from '../../../src/core/parser/delta-summary-parser.js';
import { parseSections } from '../../../src/core/parser/section-parser.js';

describe('parseDeltaSummary', () => {
  it('parses ADDED requirement line', () => {
    const body = `## Delta Summary
- ADDED requirement "Passkey Auth" to [[Feature: Auth Login]] [base: n/a]`;

    const { sections } = parseSections(body);
    const { entries, errors } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('ADDED');
    expect(entries[0].target_type).toBe('requirement');
    expect(entries[0].target_name).toBe('Passkey Auth');
    expect(entries[0].target_note_id).toBe('Feature: Auth Login');
    expect(entries[0].base_fingerprint).toBeNull();
    expect(errors.filter(e => e.level === 'error')).toHaveLength(0);
  });

  it('parses MODIFIED requirement with base fingerprint', () => {
    const body = `## Delta Summary
- MODIFIED requirement "Password Login" in [[Feature: Auth Login]] [base: sha256:abc123]`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('MODIFIED');
    expect(entries[0].base_fingerprint).toBe('sha256:abc123');
  });

  it('parses REMOVED requirement', () => {
    const body = `## Delta Summary
- REMOVED requirement "Remember Me" from [[Feature: Auth Login]] [base: sha256:def456]`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('REMOVED');
    expect(entries[0].target_name).toBe('Remember Me');
  });

  it('parses RENAMED requirement', () => {
    const body = `## Delta Summary
- RENAMED requirement "Login Auth" to "Password Login" in [[Feature: Auth Login]] [base: sha256:789abc]`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('RENAMED');
    expect(entries[0].target_name).toBe('Login Auth');
    expect(entries[0].new_name).toBe('Password Login');
    expect(entries[0].base_fingerprint).toBe('sha256:789abc');
  });

  it('parses section operations', () => {
    const body = `## Delta Summary
- MODIFIED section "Current Behavior" in [[Feature: Auth Login]]`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
    expect(entries[0].target_type).toBe('section');
    expect(entries[0].target_name).toBe('Current Behavior');
  });

  it('normalizes n/a fingerprint to null', () => {
    const body = `## Delta Summary
- ADDED requirement "Test" to [[Feature: X]] [base: n/a]`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries[0].base_fingerprint).toBeNull();
  });

  it('warns when MODIFIED lacks base fingerprint', () => {
    const body = `## Delta Summary
- MODIFIED requirement "Test" in [[Feature: X]]`;

    const { sections } = parseSections(body);
    const { entries, errors } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
    expect(errors.some(e => e.message.includes('base_fingerprint'))).toBe(true);
  });

  it('warns on unparseable delta line', () => {
    const body = `## Delta Summary
- ADDED requirement badly formatted`;

    const { sections } = parseSections(body);
    const { entries, errors } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(0);
    expect(errors.some(e => e.message.includes('grammar'))).toBe(true);
  });

  it('ignores lines without delta op prefix', () => {
    const body = `## Delta Summary
Some prose text.
- ADDED requirement "Test" to [[Feature: X]] [base: n/a]
Another prose line.`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
  });

  it('parses description after colon', () => {
    const body = `## Delta Summary
- MODIFIED requirement "Password Login" in [[Feature: Auth Login]]: updated to reflect passkey support [base: sha256:abc]`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(1);
    expect(entries[0].description).toContain('updated to reflect passkey support');
  });

  it('parses multiple entries', () => {
    const body = `## Delta Summary
- ADDED requirement "A" to [[Feature: X]] [base: n/a]
- MODIFIED requirement "B" in [[Feature: X]] [base: sha256:abc]
- REMOVED requirement "C" from [[Feature: X]] [base: sha256:def]`;

    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);

    expect(entries).toHaveLength(3);
    expect(entries[0].op).toBe('ADDED');
    expect(entries[1].op).toBe('MODIFIED');
    expect(entries[2].op).toBe('REMOVED');
  });

  it('returns empty array when no Delta Summary section', () => {
    const body = `## Other\ncontent`;
    const { sections } = parseSections(body);
    const { entries } = parseDeltaSummary(sections);
    expect(entries).toHaveLength(0);
  });
});
