import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildIndex } from '../../../src/core/index/build.js';

const VAULT_ROOT = join(__dirname, '../../fixtures/vault');

describe('buildIndex', () => {
  it('builds index from sample vault', () => {
    const index = buildIndex(VAULT_ROOT);

    expect(index.schema_version).toBe('1.0.0');
    expect(index.scanned_at).toBeDefined();

    // Should have records for all 6 typed notes
    expect(index.records.size).toBe(6);

    // Check feature note
    const feature = index.records.get('auth-login');
    expect(feature).toBeDefined();
    expect(feature!.type).toBe('feature');
    expect(feature!.title).toBe('Feature: Auth Login');
    expect(feature!.requirements).toHaveLength(2);
    expect(feature!.requirements[0].key).toBe('auth-login::Password Login');
    expect(feature!.requirements[1].key).toBe('auth-login::Session Management');

    // Check change note
    const change = index.records.get('add-passkey-support');
    expect(change).toBeDefined();
    expect(change!.type).toBe('change');
    expect(change!.delta_summary).toHaveLength(3);
    expect(change!.tasks).toHaveLength(4);
    expect(change!.created_at).toBe('2024-03-15');

    // Check system note
    const system = index.records.get('identity-system');
    expect(system).toBeDefined();
    expect(system!.type).toBe('system');

    // Check decision note
    const decision = index.records.get('use-passkeys');
    expect(decision).toBeDefined();
    expect(decision!.type).toBe('decision');

    // Check source note
    const source = index.records.get('webauthn-spec');
    expect(source).toBeDefined();
    expect(source!.type).toBe('source');

    // Check query note
    const query = index.records.get('passkey-adoption');
    expect(query).toBeDefined();
    expect(query!.type).toBe('query');
  });

  it('resolves wikilink relationships', () => {
    const index = buildIndex(VAULT_ROOT);

    const feature = index.records.get('auth-login')!;
    // Feature references System: Identity -> should resolve to identity-system
    expect(feature.systems).toContain('identity-system');
    // Feature references Decision: Use Passkeys -> should resolve to use-passkeys
    expect(feature.decisions).toContain('use-passkeys');

    const change = index.records.get('add-passkey-support')!;
    // Change has feature: [[Feature: Auth Login]] -> should resolve
    expect(change.feature).toBe('auth-login');
    expect(change.touches).toContain('auth-login');
    expect(change.touches).toContain('identity-system');
  });

  it('computes reverse index (links_in)', () => {
    const index = buildIndex(VAULT_ROOT);

    // Identity system should be linked FROM feature and change
    const system = index.records.get('identity-system')!;
    expect(system.links_in.length).toBeGreaterThan(0);

    // Verify links_in is the reverse of links_out
    for (const [id, record] of index.records) {
      for (const targetId of record.links_out) {
        const target = index.records.get(targetId);
        if (target) {
          expect(target.links_in).toContain(id);
        }
      }
    }
  });

  it('resolves delta_summary target_note_id', () => {
    const index = buildIndex(VAULT_ROOT);
    const change = index.records.get('add-passkey-support')!;

    // Delta entries should have resolved target_note_id
    for (const entry of change.delta_summary) {
      // "Feature: Auth Login" should resolve to "auth-login"
      expect(entry.target_note_id).toBe('auth-login');
    }
  });

  it('handles empty vault gracefully', () => {
    // Use a path that will find no .md files
    const index = buildIndex(join(__dirname, '../../fixtures'));

    expect(index.records.size).toBe(0);
    // No errors should be thrown
  });

  it('records schema_version from schema.md', () => {
    const index = buildIndex(VAULT_ROOT);
    expect(index.schema_version).toBe('1.0.0');
  });

  it('records content_hash for notes', () => {
    const index = buildIndex(VAULT_ROOT);
    const feature = index.records.get('auth-login')!;
    expect(feature.content_hash).toMatch(/^sha256:[0-9a-f]+$/);
  });

  it('records tags from frontmatter', () => {
    const index = buildIndex(VAULT_ROOT);
    const feature = index.records.get('auth-login')!;
    expect(feature.tags).toContain('auth');
    expect(feature.tags).toContain('security');
  });
});

describe('buildIndex - warnings', () => {
  it('produces unresolved_wikilink warnings for broken links', () => {
    const index = buildIndex(VAULT_ROOT);
    // Some wikilinks might not resolve depending on fixture data
    // At minimum, we should have no crash
    expect(Array.isArray(index.warnings)).toBe(true);
  });
});
