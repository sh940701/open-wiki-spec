import { describe, it, expect } from 'vitest';
import { extractFrontmatter, validateFrontmatter } from '../../../src/core/parser/frontmatter-parser.js';

describe('extractFrontmatter', () => {
  it('extracts valid frontmatter', () => {
    const content = `---
type: feature
id: auth-login
status: active
tags: []
---

# Feature: Auth Login`;

    const { raw, errors } = extractFrontmatter(content);
    expect(errors).toHaveLength(0);
    expect(raw).not.toBeNull();
    expect(raw!.data.type).toBe('feature');
    expect(raw!.data.id).toBe('auth-login');
    expect(raw!.body.trim()).toBe('# Feature: Auth Login');
    expect(raw!.bodyStartLine).toBe(7);
  });

  it('returns null with error when no opening ---', () => {
    const content = `type: feature
id: auth-login`;

    const { raw, errors } = extractFrontmatter(content);
    expect(raw).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].level).toBe('error');
    expect(errors[0].source).toBe('frontmatter');
  });

  it('returns null with error when no closing ---', () => {
    const content = `---
type: feature
id: auth-login`;

    const { raw, errors } = extractFrontmatter(content);
    expect(raw).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('closing');
  });

  it('returns null with error for invalid YAML', () => {
    const content = `---
type: feature
id: [invalid yaml
---

body`;

    const { raw, errors } = extractFrontmatter(content);
    expect(raw).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Invalid YAML');
  });

  it('returns null with error for non-object YAML (array)', () => {
    const content = `---
- item1
- item2
---

body`;

    const { raw, errors } = extractFrontmatter(content);
    expect(raw).toBeNull();
    expect(errors.some(e => e.message.includes('object'))).toBe(true);
  });

  it('handles frontmatter with wikilink string values', () => {
    const content = `---
type: feature
id: test
systems:
  - "[[System: Identity]]"
---

body`;

    const { raw, errors } = extractFrontmatter(content);
    expect(errors).toHaveLength(0);
    expect(raw).not.toBeNull();
    expect(raw!.data.systems).toEqual(['[[System: Identity]]']);
  });

  it('normalizes CRLF line endings', () => {
    const content = '---\r\ntype: feature\r\nid: test\r\n---\r\n\r\nbody';

    const { raw, errors } = extractFrontmatter(content);
    expect(errors).toHaveLength(0);
    expect(raw).not.toBeNull();
    expect(raw!.data.type).toBe('feature');
    expect(raw!.body).toContain('body');
  });

  it('handles empty body after frontmatter', () => {
    const content = `---
type: feature
id: test
---`;

    const { raw, errors } = extractFrontmatter(content);
    expect(errors).toHaveLength(0);
    expect(raw).not.toBeNull();
    expect(raw!.body.trim()).toBe('');
  });
});

describe('validateFrontmatter', () => {
  it('validates valid Feature frontmatter', () => {
    const data = {
      type: 'feature',
      id: 'auth-login',
      status: 'active',
      tags: ['auth'],
      systems: ['[[System: Identity]]'],
      sources: [],
      decisions: [],
      changes: [],
    };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(errors).toHaveLength(0);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!.type).toBe('feature');
  });

  it('validates valid Change frontmatter', () => {
    const data = {
      type: 'change',
      id: 'add-passkey',
      status: 'proposed',
      tags: [],
      created_at: '2024-03-15',
      feature: '[[Feature: Auth Login]]',
      depends_on: [],
      touches: ['[[Feature: Auth Login]]'],
      systems: [],
      sources: [],
      decisions: [],
    };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(errors).toHaveLength(0);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!.type).toBe('change');
  });

  it('validates valid System frontmatter', () => {
    const data = {
      type: 'system',
      id: 'identity',
      status: 'active',
      tags: [],
    };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(errors).toHaveLength(0);
    expect(frontmatter!.type).toBe('system');
  });

  it('validates valid Decision frontmatter', () => {
    const data = {
      type: 'decision',
      id: 'use-passkeys',
      status: 'active',
      tags: [],
      features: [],
      changes: [],
    };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(errors).toHaveLength(0);
    expect(frontmatter!.type).toBe('decision');
  });

  it('validates valid Source frontmatter', () => {
    const data = {
      type: 'source',
      id: 'webauthn-spec',
      status: 'active',
      tags: [],
    };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(errors).toHaveLength(0);
    expect(frontmatter!.type).toBe('source');
  });

  it('validates valid Query frontmatter', () => {
    const data = {
      type: 'query',
      id: 'passkey-adoption',
      status: 'active',
      tags: [],
      question: 'What is the state of passkey adoption?',
    };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(errors).toHaveLength(0);
    expect(frontmatter!.type).toBe('query');
  });

  it('returns errors for missing type field', () => {
    const data = { id: 'test', status: 'active', tags: [] };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(frontmatter).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns errors for invalid id format', () => {
    const data = {
      type: 'feature',
      id: 'INVALID_ID',
      status: 'active',
      tags: [],
      systems: ['[[System: Test]]'],
    };

    const { frontmatter, errors } = validateFrontmatter(data);
    expect(frontmatter).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});
