import { describe, it, expect } from 'vitest';
import { parseSections, findSection } from '../../../src/core/parser/section-parser.js';

describe('parseSections', () => {
  it('parses a single H1 heading', () => {
    const body = '# Title\n\nSome content.';
    const { sections, headings } = parseSections(body);

    expect(sections).toHaveLength(1);
    expect(sections[0].level).toBe(1);
    expect(sections[0].title).toBe('Title');
    expect(sections[0].content).toBe('Some content.');
    expect(headings).toEqual(['Title']);
  });

  it('parses nested headings into tree', () => {
    const body = `# H1
Content 1

## H2a
Content 2a

### H3
Content 3

## H2b
Content 2b`;

    const { sections, headings } = parseSections(body);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('H1');
    expect(sections[0].children).toHaveLength(2);
    expect(sections[0].children[0].title).toBe('H2a');
    expect(sections[0].children[0].children).toHaveLength(1);
    expect(sections[0].children[0].children[0].title).toBe('H3');
    expect(sections[0].children[1].title).toBe('H2b');
    expect(headings).toEqual(['H1', 'H2a', 'H3', 'H2b']);
  });

  it('treats multiple same-level headings as siblings', () => {
    const body = `## Section A
A content

## Section B
B content

## Section C
C content`;

    const { sections } = parseSections(body);
    expect(sections).toHaveLength(3);
    expect(sections[0].title).toBe('Section A');
    expect(sections[1].title).toBe('Section B');
    expect(sections[2].title).toBe('Section C');
  });

  it('handles empty section content', () => {
    const body = `## A
## B
Content B`;

    const { sections } = parseSections(body);
    expect(sections).toHaveLength(2);
    expect(sections[0].content).toBe('');
    expect(sections[1].content).toBe('Content B');
  });

  it('returns empty array for body with no headings', () => {
    const body = 'Just some text without headings.';
    const { sections, headings } = parseSections(body);
    expect(sections).toHaveLength(0);
    expect(headings).toHaveLength(0);
  });

  it('tracks line numbers correctly with offset', () => {
    const body = `# Title
content`;

    const { sections } = parseSections(body, 5);
    expect(sections[0].line).toBe(5);
  });

  it('skips headings inside code fences', () => {
    const body = `# Real Heading

Some text

\`\`\`markdown
# Not a heading
## Also not
\`\`\`

## Another Real Heading
Content here`;

    const { sections, headings } = parseSections(body);
    expect(headings).toEqual(['Real Heading', 'Another Real Heading']);
    expect(sections).toHaveLength(1);
    expect(sections[0].children).toHaveLength(1);
  });

  it('skips headings inside tilde code fences', () => {
    const body = `# Title

~~~
# Fake heading
~~~

## Real Sub
content`;

    const { headings } = parseSections(body);
    expect(headings).toEqual(['Title', 'Real Sub']);
  });

  it('handles deeply nested headings', () => {
    const body = `# L1
## L2
### L3
#### L4
##### L5
###### L6
Content at L6`;

    const { sections } = parseSections(body);
    expect(sections).toHaveLength(1);
    let current = sections[0];
    for (let i = 0; i < 5; i++) {
      expect(current.children).toHaveLength(1);
      current = current.children[0];
    }
    expect(current.level).toBe(6);
    expect(current.content).toBe('Content at L6');
  });
});

describe('findSection', () => {
  it('finds a section by title case-insensitively', () => {
    const body = `# Title
## Requirements
Req content`;

    const { sections } = parseSections(body);
    const found = findSection(sections, 'requirements');
    expect(found).toBeDefined();
    expect(found!.title).toBe('Requirements');
  });

  it('finds nested sections', () => {
    const body = `# Root
## Parent
### Target
target content`;

    const { sections } = parseSections(body);
    const found = findSection(sections, 'Target');
    expect(found).toBeDefined();
    expect(found!.content).toBe('target content');
  });

  it('returns undefined when not found', () => {
    const body = '# Title\n## Other';
    const { sections } = parseSections(body);
    expect(findSection(sections, 'Nonexistent')).toBeUndefined();
  });
});
