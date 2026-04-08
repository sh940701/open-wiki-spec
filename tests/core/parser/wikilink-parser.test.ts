import { describe, it, expect } from 'vitest';
import {
  extractWikilinks,
  stripWikilinkSyntax,
  uniqueWikilinkTargets,
} from '../../../src/core/parser/wikilink-parser.js';

describe('extractWikilinks', () => {
  it('extracts simple wikilink', () => {
    const text = 'See [[Feature: Auth Login]] for details.';
    const { wikilinks, errors } = extractWikilinks(text, 'body');
    expect(errors).toHaveLength(0);
    expect(wikilinks).toHaveLength(1);
    expect(wikilinks[0].target).toBe('Feature: Auth Login');
    expect(wikilinks[0].alias).toBeNull();
    expect(wikilinks[0].location).toBe('body');
  });

  it('extracts wikilink with alias', () => {
    const text = '[[Feature: Auth Login|Auth]]';
    const { wikilinks } = extractWikilinks(text, 'body');
    expect(wikilinks).toHaveLength(1);
    expect(wikilinks[0].target).toBe('Feature: Auth Login');
    expect(wikilinks[0].alias).toBe('Auth');
  });

  it('extracts multiple wikilinks on one line', () => {
    const text = '[[Feature: A]] and [[Feature: B]] are related.';
    const { wikilinks } = extractWikilinks(text, 'body');
    expect(wikilinks).toHaveLength(2);
    expect(wikilinks[0].target).toBe('Feature: A');
    expect(wikilinks[1].target).toBe('Feature: B');
  });

  it('extracts wikilinks from frontmatter strings', () => {
    const text = '"[[System: Identity]]"';
    const { wikilinks } = extractWikilinks(text, 'frontmatter');
    expect(wikilinks).toHaveLength(1);
    expect(wikilinks[0].location).toBe('frontmatter');
  });

  it('warns on empty wikilink', () => {
    const text = 'See [[]] here.';
    const { wikilinks, errors } = extractWikilinks(text, 'body');
    expect(wikilinks).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].level).toBe('warning');
    expect(errors[0].message).toContain('Empty');
  });

  it('skips wikilinks inside code fences', () => {
    const text = `Some text [[Real Link]]

\`\`\`
[[Not a link]]
\`\`\`

More text [[Another Real Link]]`;

    const { wikilinks } = extractWikilinks(text, 'body');
    expect(wikilinks).toHaveLength(2);
    expect(wikilinks[0].target).toBe('Real Link');
    expect(wikilinks[1].target).toBe('Another Real Link');
  });

  it('skips wikilinks inside tilde code fences', () => {
    const text = `~~~
[[Not a link]]
~~~
[[Real Link]]`;

    const { wikilinks } = extractWikilinks(text, 'body');
    expect(wikilinks).toHaveLength(1);
    expect(wikilinks[0].target).toBe('Real Link');
  });

  it('tracks line numbers correctly', () => {
    const text = `line1
[[Link A]]
line3
[[Link B]]`;

    const { wikilinks } = extractWikilinks(text, 'body', 5);
    expect(wikilinks[0].line).toBe(6); // line 2 in text, offset 5
    expect(wikilinks[1].line).toBe(8); // line 4 in text, offset 5
  });

  it('handles special characters in targets', () => {
    const text = '[[Feature: Auth-Login (v2)]]';
    const { wikilinks } = extractWikilinks(text, 'body');
    expect(wikilinks).toHaveLength(1);
    expect(wikilinks[0].target).toBe('Feature: Auth-Login (v2)');
  });
});

describe('stripWikilinkSyntax', () => {
  it('strips brackets from wikilink', () => {
    expect(stripWikilinkSyntax('[[Feature: Auth Login]]')).toBe('Feature: Auth Login');
  });

  it('strips brackets and drops display text', () => {
    expect(stripWikilinkSyntax('[[Feature: Auth Login|Auth]]')).toBe('Feature: Auth Login');
  });

  it('handles already-stripped text', () => {
    expect(stripWikilinkSyntax('Feature: Auth Login')).toBe('Feature: Auth Login');
  });

  it('trims whitespace', () => {
    expect(stripWikilinkSyntax('  [[Feature: Auth]]  ')).toBe('Feature: Auth');
  });
});

describe('uniqueWikilinkTargets', () => {
  it('deduplicates wikilink targets', () => {
    const wikilinks = [
      { target: 'A', alias: null, location: 'body' as const, line: 1 },
      { target: 'B', alias: null, location: 'body' as const, line: 2 },
      { target: 'A', alias: 'alias', location: 'body' as const, line: 3 },
    ];
    const targets = uniqueWikilinkTargets(wikilinks);
    expect(targets).toHaveLength(2);
    expect(targets).toContain('A');
    expect(targets).toContain('B');
  });
});
