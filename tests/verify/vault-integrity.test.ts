import { describe, it, expect } from 'vitest';
import {
  duplicateIdCheck,
  unresolvedWikilinkCheck,
  orphanNoteCheck,
  archivePlacementCheck,
  missingIdCheck,
  ambiguousAliasCheck,
  invalidFrontmatterTypeCheck,
  titleIdCollisionCheck,
} from '../../src/core/workflow/verify/vault-integrity.js';
import { createIndex, createFeature, createChange, createSystem, createDecision } from '../helpers/mock-index.js';

describe('vault-integrity', () => {
  describe('duplicateIdCheck', () => {
    it('should return no issues when no duplicate ids exist', () => {
      const index = createIndex([createFeature('feat-1'), createChange('chg-1')]);
      const issues = duplicateIdCheck(index);
      expect(issues).toHaveLength(0);
    });

    it('should convert index warnings of type duplicate_id to VerifyIssues', () => {
      const index = createIndex([createFeature('feat-1')], {
        warnings: [
          {
            type: 'duplicate_id',
            note_path: 'wiki/03-features/feat-1-dup.md',
            message: 'Duplicate id "feat-1" found in wiki/03-features/feat-1-dup.md',
          },
        ],
      });
      const issues = duplicateIdCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].dimension).toBe('vault_integrity');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].code).toBe('DUPLICATE_ID');
      expect(issues[0].note_path).toBe('wiki/03-features/feat-1-dup.md');
    });

    it('should ignore non-duplicate_id warnings', () => {
      const index = createIndex([createFeature('feat-1')], {
        warnings: [
          {
            type: 'unresolved_wikilink',
            note_path: 'wiki/03-features/feat-1.md',
            message: 'Unresolved wikilink',
          },
        ],
      });
      const issues = duplicateIdCheck(index);
      expect(issues).toHaveLength(0);
    });
  });

  describe('unresolvedWikilinkCheck', () => {
    it('should return no issues when all wikilinks resolve', () => {
      const feat = createFeature('feat-1', { links_out: ['sys-1'] });
      const sys = createSystem('sys-1', { links_in: ['feat-1'] });
      const index = createIndex([feat, sys]);
      const issues = unresolvedWikilinkCheck(index);
      expect(issues).toHaveLength(0);
    });

    it('should report unresolved wikilinks from index warnings', () => {
      const feat = createFeature('feat-1');
      const index = createIndex([feat], {
        warnings: [
          { type: 'unresolved_wikilink', note_path: feat.path, message: 'Unresolved wikilink "nonexistent-note" in feat-1' },
        ],
      });
      const issues = unresolvedWikilinkCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('UNRESOLVED_WIKILINK');
      expect(issues[0].severity).toBe('error');
    });

    it('should return no issues when no unresolved wikilink warnings exist', () => {
      const feat = createFeature('feat-1', { links_out: ['sys-1'] });
      const sys = createSystem('sys-1');
      const index = createIndex([feat, sys]);
      const issues = unresolvedWikilinkCheck(index);
      expect(issues).toHaveLength(0);
    });
  });

  describe('orphanNoteCheck', () => {
    it('should return no issues for notes with links', () => {
      const feat = createFeature('feat-1', { links_out: ['sys-1'], links_in: ['chg-1'] });
      const index = createIndex([feat]);
      const issues = orphanNoteCheck(index);
      expect(issues).toHaveLength(0);
    });

    it('should report notes with no incoming or outgoing links', () => {
      const feat = createFeature('feat-1', { links_out: [], links_in: [] });
      const index = createIndex([feat]);
      const issues = orphanNoteCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('ORPHAN_NOTE');
      expect(issues[0].severity).toBe('warning');
    });

    it('should skip meta files', () => {
      const meta = createFeature('meta-index', {
        path: 'wiki/00-meta/index.md',
        links_out: [],
        links_in: [],
      });
      const index = createIndex([meta]);
      const issues = orphanNoteCheck(index);
      expect(issues).toHaveLength(0);
    });
  });

  describe('archivePlacementCheck', () => {
    it('should return no issues for correctly placed archives', () => {
      const change = createChange('chg-1', {
        status: 'applied',
        path: 'wiki/99-archive/chg-1.md',
      });
      const index = createIndex([change]);
      const issues = archivePlacementCheck(index);
      expect(issues).toHaveLength(0);
    });

    it('should report non-applied notes in archive', () => {
      const change = createChange('chg-1', {
        status: 'proposed',
        path: 'wiki/99-archive/chg-1.md',
      });
      const index = createIndex([change]);
      const issues = archivePlacementCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('ARCHIVE_PLACEMENT_ERROR');
      expect(issues[0].severity).toBe('error');
    });
  });

  describe('missingIdCheck', () => {
    it('should convert index warnings of type missing_id to VerifyIssues', () => {
      const index = createIndex([], {
        warnings: [
          {
            type: 'missing_id',
            note_path: 'wiki/03-features/no-id.md',
            message: 'Note at wiki/03-features/no-id.md has no id field',
          },
        ],
      });
      const issues = missingIdCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('MISSING_ID');
      expect(issues[0].severity).toBe('error');
    });
  });

  describe('ambiguousAliasCheck', () => {
    it('should convert index warnings of type ambiguous_alias to VerifyIssues', () => {
      const index = createIndex([], {
        warnings: [
          {
            type: 'ambiguous_alias',
            note_path: 'wiki/03-features/feat-1.md',
            message: 'Alias "auth" matches multiple notes',
          },
        ],
      });
      const issues = ambiguousAliasCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('AMBIGUOUS_ALIAS');
      expect(issues[0].severity).toBe('error');
    });
  });

  describe('invalidFrontmatterTypeCheck', () => {
    it('should convert index warnings of type invalid_frontmatter to VerifyIssues', () => {
      const index = createIndex([], {
        warnings: [
          {
            type: 'invalid_frontmatter',
            note_path: 'wiki/03-features/bad.md',
            message: 'Invalid frontmatter in wiki/03-features/bad.md',
            severity: 'error',
          },
        ],
      });
      const issues = invalidFrontmatterTypeCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('TYPED_FOLDER_FRONTMATTER_ERROR');
      expect(issues[0].severity).toBe('error');
    });

    it('should treat typed-folder frontmatter errors as verify errors', () => {
      const index = createIndex([], {
        warnings: [
          {
            type: 'invalid_frontmatter',
            severity: 'error',
            note_path: 'wiki/04-changes/broken.md',
            message: 'Typed note at "wiki/04-changes/broken.md" has corrupted frontmatter and was dropped from the index',
          },
        ],
      });
      const issues = invalidFrontmatterTypeCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].code).toBe('TYPED_FOLDER_FRONTMATTER_ERROR');
    });

    it('should treat non-typed-folder frontmatter warnings as verify warnings', () => {
      const index = createIndex([], {
        warnings: [
          {
            type: 'invalid_frontmatter',
            note_path: 'wiki/misc/notes.md',
            message: 'File has frontmatter delimiters but YAML could not be parsed',
          },
        ],
      });
      const issues = invalidFrontmatterTypeCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].code).toBe('INVALID_FRONTMATTER_TYPE');
    });
  });

  describe('titleIdCollisionCheck', () => {
    it('should return no issues when no title/id collisions exist', () => {
      const feat = createFeature('feat-1', { title: 'Feature: Auth' });
      const sys = createSystem('sys-1', { title: 'System: Identity' });
      const index = createIndex([feat, sys]);
      const issues = titleIdCollisionCheck(index);
      expect(issues).toHaveLength(0);
    });

    it('should detect when a note title matches another note id', () => {
      const feat = createFeature('feat-1', { title: 'sys-1' });
      const sys = createSystem('sys-1', { title: 'System: Identity' });
      const index = createIndex([feat, sys]);
      const issues = titleIdCollisionCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('TITLE_ID_COLLISION');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].note_id).toBe('feat-1');
      expect(issues[0].message).toContain('sys-1');
    });

    it('should not flag a note whose title matches its own id', () => {
      const feat = createFeature('feat-1', { title: 'feat-1' });
      const index = createIndex([feat]);
      const issues = titleIdCollisionCheck(index);
      expect(issues).toHaveLength(0);
    });

    it('should detect collision case-insensitively', () => {
      const feat = createFeature('feat-1', { title: 'SYS-1' });
      const sys = createSystem('sys-1', { title: 'System: Identity' });
      const index = createIndex([feat, sys]);
      const issues = titleIdCollisionCheck(index);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('TITLE_ID_COLLISION');
    });
  });
});
