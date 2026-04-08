import { describe, it, expect } from 'vitest';
import { createQueryNote } from '../../src/core/workflow/query/query-note-creator.js';
import type { QueryNoteInput } from '../../src/core/workflow/query/types.js';

function makeInput(overrides?: Partial<QueryNoteInput>): QueryNoteInput {
  return {
    question: overrides?.question ?? 'How does session management interact with passkey login?',
    title: overrides?.title ?? 'Session Management and Passkey Login',
    context: overrides?.context ?? 'Investigation arose from passkey change.',
    findings: overrides?.findings ?? 'Sessions are independent of auth method.',
    conclusion: overrides?.conclusion ?? 'System tolerates mixed auth methods.',
    consultedNotes: overrides?.consultedNotes ?? ['feat-auth', 'dec-session'],
    relatedFeatures: overrides?.relatedFeatures ?? ['[[Feature: Auth Login]]'],
    relatedSystems: overrides?.relatedSystems ?? ['[[System: Authentication]]'],
    relatedChanges: overrides?.relatedChanges,
    relatedDecisions: overrides?.relatedDecisions ?? ['[[Decision: Session Strategy]]'],
    relatedSources: overrides?.relatedSources,
    relatedQueries: overrides?.relatedQueries,
    tags: overrides?.tags ?? ['auth'],
    recommendation: overrides?.recommendation,
    openQuestions: overrides?.openQuestions,
  };
}

describe('createQueryNote', () => {
  it('should create valid frontmatter with all required fields', () => {
    const { content } = createQueryNote(makeInput());
    expect(content).toContain('type: query');
    expect(content).toContain('status: active');
    expect(content).toMatch(/id: query-/);
    expect(content).toContain('question:');
  });

  it('should generate deterministic id from slug + date', () => {
    const { path } = createQueryNote(makeInput({ title: 'Auth Session Behavior' }));
    expect(path).toMatch(/^wiki\/06-queries\/\d{4}-\d{2}-\d{2}-auth-session-behavior\.md$/);
  });

  it('should place file in wiki/06-queries/', () => {
    const { path } = createQueryNote(makeInput());
    expect(path).toMatch(/^wiki\/06-queries\//);
  });

  it('should include all minimum sections', () => {
    const { content } = createQueryNote(makeInput());
    expect(content).toContain('## Question');
    expect(content).toContain('## Context');
    expect(content).toContain('## Findings');
    expect(content).toContain('## Conclusion');
    expect(content).toContain('## Consulted Notes');
    expect(content).toContain('## Related Notes');
  });

  it('should include Recommendation section when provided', () => {
    const { content } = createQueryNote(makeInput({ recommendation: 'Add a new requirement.' }));
    expect(content).toContain('## Recommendation');
    expect(content).toContain('Add a new requirement.');
  });

  it('should not include Recommendation section when not provided', () => {
    const { content } = createQueryNote(makeInput({ recommendation: undefined }));
    expect(content).not.toContain('## Recommendation');
  });

  it('should include Open Questions section when provided', () => {
    const { content } = createQueryNote(makeInput({ openQuestions: 'Should we re-authenticate?' }));
    expect(content).toContain('## Open Questions');
    expect(content).toContain('Should we re-authenticate?');
  });

  it('should render consulted notes as wikilinks', () => {
    const { content } = createQueryNote(makeInput({ consultedNotes: ['feat-auth', 'dec-session'] }));
    expect(content).toContain('[[feat-auth]]');
    expect(content).toContain('[[dec-session]]');
  });

  it('should group related notes by type', () => {
    const { content } = createQueryNote(
      makeInput({
        relatedFeatures: ['[[Feature: Auth Login]]'],
        relatedSystems: ['[[System: Authentication]]'],
        relatedDecisions: ['[[Decision: Session Strategy]]'],
      }),
    );
    expect(content).toContain('### Features');
    expect(content).toContain('### Systems');
    expect(content).toContain('### Decisions');
  });

  it('should handle empty optional fields without error', () => {
    const { content } = createQueryNote(
      makeInput({
        relatedFeatures: [],
        relatedSystems: [],
        relatedChanges: undefined,
        relatedDecisions: [],
        relatedSources: undefined,
        relatedQueries: undefined,
      }),
    );
    expect(content).toBeDefined();
    expect(content).not.toContain('### Features');
    expect(content).not.toContain('### Systems');
  });

  it('should handle special characters in title for slug', () => {
    const { path } = createQueryNote(makeInput({ title: "What's the Auth Login? (v2)" }));
    // Slug should be kebab-case, no special chars
    expect(path).toMatch(/^wiki\/06-queries\/\d{4}-\d{2}-\d{2}-whats-the-auth-login-v2\.md$/);
  });

  it('should include tags in frontmatter', () => {
    const { content } = createQueryNote(makeInput({ tags: ['auth', 'session'] }));
    expect(content).toContain('tags:');
    expect(content).toContain('- query');
    expect(content).toContain('- auth');
    expect(content).toContain('- session');
  });
});
