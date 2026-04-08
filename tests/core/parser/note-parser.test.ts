import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseNote } from '../../../src/core/parser/note-parser.js';

const FIXTURES = join(__dirname, '../../fixtures/vault/wiki');

describe('parseNote', () => {
  it('parses Feature note with requirements and wikilinks', () => {
    const result = parseNote(join(FIXTURES, '01-features/auth-login.md'));

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('feature');
    expect(result.frontmatter!.id).toBe('auth-login');

    // Requirements
    expect(result.requirements).toHaveLength(2);
    expect(result.requirements[0].name).toBe('Password Login');
    expect(result.requirements[0].scenarios).toHaveLength(2);
    expect(result.requirements[1].name).toBe('Session Management');
    expect(result.requirements[1].scenarios).toHaveLength(1);
    expect(result.requirements[0].key).toBe(''); // placeholder

    // Wikilinks extracted from both frontmatter and body
    expect(result.wikilinks.length).toBeGreaterThan(0);
    const fmWikilinks = result.wikilinks.filter(w => w.location === 'frontmatter');
    const bodyWikilinks = result.wikilinks.filter(w => w.location === 'body');
    expect(fmWikilinks.length).toBeGreaterThan(0);
    expect(bodyWikilinks.length).toBeGreaterThan(0);

    // Headings
    expect(result.headings).toContain('Feature: Auth Login');
    expect(result.headings).toContain('Requirements');

    // Content hash
    expect(result.contentHash).toMatch(/^sha256:[0-9a-f]+$/);

    // No delta summary or tasks for feature
    expect(result.deltaSummary).toHaveLength(0);
    expect(result.tasks).toHaveLength(0);
  });

  it('parses Change note with delta summary and tasks', () => {
    const result = parseNote(join(FIXTURES, '02-changes/add-passkey-support.md'));

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('change');
    expect(result.frontmatter!.id).toBe('add-passkey-support');

    // Delta summary
    expect(result.deltaSummary).toHaveLength(3);
    expect(result.deltaSummary[0].op).toBe('ADDED');
    expect(result.deltaSummary[1].op).toBe('MODIFIED');
    expect(result.deltaSummary[2].op).toBe('MODIFIED');
    expect(result.deltaSummary[2].target_type).toBe('section');

    // Tasks
    expect(result.tasks).toHaveLength(4);
    expect(result.tasks[0].done).toBe(true);
    expect(result.tasks[1].done).toBe(false);

    // No requirements for change
    expect(result.requirements).toHaveLength(0);
  });

  it('parses System note', () => {
    const result = parseNote(join(FIXTURES, '03-systems/identity.md'));

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('system');
    expect(result.frontmatter!.id).toBe('identity-system');
    expect(result.headings).toContain('System: Identity');
  });

  it('parses Decision note', () => {
    const result = parseNote(join(FIXTURES, '04-decisions/use-passkeys.md'));

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('decision');
    expect(result.frontmatter!.id).toBe('use-passkeys');
  });

  it('parses Source note', () => {
    const result = parseNote(join(FIXTURES, '05-sources/webauthn-spec.md'));

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('source');
  });

  it('parses Query note', () => {
    const result = parseNote(join(FIXTURES, '06-queries/passkey-adoption.md'));

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.type).toBe('query');
  });

  it('handles file without valid frontmatter gracefully', () => {
    const result = parseNote(join(FIXTURES, '00-meta/schema.md'));

    // schema.md has frontmatter but won't validate as a note type
    // since it doesn't match any of the note type schemas
    // but it should still parse without crashing
    expect(result.body).toBeDefined();
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it('content hash is deterministic', () => {
    const r1 = parseNote(join(FIXTURES, '01-features/auth-login.md'));
    const r2 = parseNote(join(FIXTURES, '01-features/auth-login.md'));
    expect(r1.contentHash).toBe(r2.contentHash);
  });
});
