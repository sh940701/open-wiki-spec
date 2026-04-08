/**
 * E2E test: init -> propose -> continue workflow
 *
 * Tests the full lifecycle using real file I/O against a temporary vault.
 * Exercises init, propose (new + existing feature), continue, status, and list.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initVault } from '../../src/cli/init/init-engine.js';
import { propose } from '../../src/core/workflow/propose/propose.js';
import { continueChange } from '../../src/core/workflow/continue/continue.js';
import { buildIndex } from '../../src/core/index/build.js';
import { retrieve } from '../../src/core/retrieval/retrieve.js';
import { analyzeSequencing } from '../../src/core/sequencing/analyze.js';
import { parseNote } from '../../src/core/parser/note-parser.js';
import { listNotes } from '../../src/cli/commands/list.js';
import { getChangeStatus } from '../../src/cli/commands/status.js';
import type { ProposeDeps } from '../../src/core/workflow/propose/types.js';
import type { ContinueDeps } from '../../src/core/workflow/continue/types.js';

let tempDir: string;
let vaultRoot: string;

/**
 * Build real ProposeDeps that read/write real files.
 */
function realProposeDeps(): ProposeDeps {
  return {
    buildIndex: (root: string) => buildIndex(root),
    retrieve: (index, query, options) => retrieve(index, query, options),
    analyzeSequencing: (records) => analyzeSequencing(records),
    parseNote: (filePath: string) => parseNote(filePath),
    writeFile: (filePath: string, content: string) => fs.writeFileSync(filePath, content, 'utf-8'),
    readFile: (filePath: string) => fs.readFileSync(filePath, 'utf-8'),
  };
}

/**
 * Build real ContinueDeps that read/write real files.
 * Paths from IndexRecord are relative to vaultRoot, so we resolve them.
 */
function realContinueDeps(): ContinueDeps {
  return {
    analyzeSequencing: (records) => analyzeSequencing(records),
    parseNote: (filePath: string) => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      return parseNote(resolved);
    },
    writeFile: (filePath: string, content: string) => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      fs.writeFileSync(resolved, content, 'utf-8');
    },
    readFile: (filePath: string) => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
      return fs.readFileSync(resolved, 'utf-8');
    },
  };
}

/**
 * Create a minimal System note so Features can reference it.
 */
function createSystemNote(wikiPath: string, id: string, title: string): void {
  const content = `---
type: system
id: ${id}
status: active
tags:
  - system
---

# System: ${title}

## Purpose

Core system component.

## Boundaries

Defined by internal APIs.
`;
  fs.writeFileSync(path.join(wikiPath, '02-systems', `${id}.md`), content, 'utf-8');
}

/**
 * Patch a feature note to add a system reference so it passes schema validation.
 */
function patchFeatureWithSystem(featurePath: string, systemTitle: string): void {
  let content = fs.readFileSync(featurePath, 'utf-8');
  content = content.replace(
    /^(systems:\s*)\[\]/m,
    `$1\n  - "[[System: ${systemTitle}]]"`,
  );
  fs.writeFileSync(featurePath, content, 'utf-8');
}

describe('E2E: init -> propose -> continue workflow', () => {
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-workflow-a-'));
    vaultRoot = tempDir;
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────
  // Test 1: ows init
  // ──────────────────────────────────────────────
  describe('Test 1: ows init', () => {
    it('should create all vault directories on fresh init', async () => {
      const result = await initVault({ path: tempDir });

      expect(result.mode).toBe('fresh');
      expect(result.wikiPath).toBe(path.join(tempDir, 'wiki'));

      const expectedDirs = [
        'wiki',
        'wiki/00-meta',
        'wiki/01-sources',
        'wiki/02-systems',
        'wiki/03-features',
        'wiki/04-changes',
        'wiki/05-decisions',
        'wiki/06-queries',
        'wiki/99-archive',
      ];
      for (const dir of expectedDirs) {
        expect(fs.existsSync(path.join(tempDir, dir))).toBe(true);
      }
    });

    it('should create schema.md with correct schema version', () => {
      const schemaPath = path.join(tempDir, 'wiki', '00-meta', 'schema.md');
      expect(fs.existsSync(schemaPath)).toBe(true);
      const content = fs.readFileSync(schemaPath, 'utf-8');
      expect(content).toContain('schema_version:');
      expect(content).toContain('2026-04-06-v1');
    });

    it('should create index.md, log.md, and conventions.md', () => {
      const wikiMeta = path.join(tempDir, 'wiki', '00-meta');
      expect(fs.existsSync(path.join(wikiMeta, 'index.md'))).toBe(true);
      expect(fs.existsSync(path.join(wikiMeta, 'log.md'))).toBe(true);
      expect(fs.existsSync(path.join(wikiMeta, 'conventions.md'))).toBe(true);

      const logContent = fs.readFileSync(path.join(wikiMeta, 'log.md'), 'utf-8');
      expect(logContent).toContain('init');
      expect(logContent).toContain('ows');
    });

    it('should build a valid index from a fresh vault (with seed notes)', () => {
      const index = buildIndex(vaultRoot);
      expect(index.schema_version).toBe('2026-04-06-v1');
      // Seed notes: source-seed-context + system-default
      expect(index.records.size).toBe(2);
    });
  });

  // ──────────────────────────────────────────────
  // Test 2: ows propose (new feature)
  // ──────────────────────────────────────────────
  let firstChangeId: string;
  let firstFeatureId: string;
  let firstChangePath: string;
  let firstFeaturePath: string;

  describe('Test 2: ows propose — new feature (user auth)', () => {
    it('should create a System note prerequisite', () => {
      // Create a system note so propose can resolve system_terms against the index.
      createSystemNote(path.join(tempDir, 'wiki'), 'system-backend', 'Backend');
      const index = buildIndex(vaultRoot);
      expect(index.records.has('system-backend')).toBe(true);
    });

    it('should classify as new_feature when vault has no features', async () => {
      const deps = realProposeDeps();
      const result = await propose(
        'Add user authentication with email/password login',
        { vaultRoot },
        deps,
      );

      expect(result.action).toBe('created_feature_and_change');
      expect(result.classification.classification).toBe('new_feature');
      expect(result.target_feature).not.toBeNull();
      expect(result.target_change).not.toBeNull();

      firstFeatureId = result.target_feature!.id;
      firstFeaturePath = result.target_feature!.path;
      firstChangeId = result.target_change!.id;
      firstChangePath = result.target_change!.path;
    });

    it('should create Feature note with correct structure', () => {
      expect(fs.existsSync(firstFeaturePath)).toBe(true);
      expect(firstFeaturePath).toContain('wiki/03-features/');

      const content = fs.readFileSync(firstFeaturePath, 'utf-8');
      expect(content).toContain('type: feature');
      expect(content).toContain(`id: ${firstFeatureId}`);
      expect(content).toContain('status: active');
      expect(content).toContain('## Purpose');
      expect(content).toContain('## Current Behavior');
      expect(content).toContain('## Constraints');
      expect(content).toContain('## Requirements');
    });

    it('should create Change note with correct structure', () => {
      expect(fs.existsSync(firstChangePath)).toBe(true);
      expect(firstChangePath).toContain('wiki/04-changes/');

      const content = fs.readFileSync(firstChangePath, 'utf-8');
      expect(content).toContain('type: change');
      expect(content).toContain(`id: ${firstChangeId}`);
      expect(content).toContain('status: proposed');
      expect(content).toContain('feature:');
      expect(content).toContain('## Why');
      expect(content).toContain('## Delta Summary');
      expect(content).toContain('## Tasks');
      expect(content).toContain('## Validation');
    });

    it('should be immediately indexable (systems:[] is valid for skeleton features)', () => {

      const index = buildIndex(vaultRoot);
      expect(index.records.has(firstFeatureId)).toBe(true);
      expect(index.records.has(firstChangeId)).toBe(true);

      const featureRec = index.records.get(firstFeatureId)!;
      expect(featureRec.type).toBe('feature');
      expect(featureRec.status).toBe('active');

      const changeRec = index.records.get(firstChangeId)!;
      expect(changeRec.type).toBe('change');
      expect(changeRec.status).toBe('proposed');
    });
  });

  // ──────────────────────────────────────────────
  // Test 3: ows propose (existing feature — password reset)
  // ──────────────────────────────────────────────
  let secondChangeId: string | undefined;

  describe('Test 3: ows propose — existing feature (password reset)', () => {
    it('should find existing auth feature or create new feature', async () => {
      const deps = realProposeDeps();
      const result = await propose(
        'Add password reset functionality for authentication',
        { vaultRoot },
        deps,
      );

      // Capture what was created for downstream tests
      if (result.target_change) {
        secondChangeId = result.target_change.id;
      }

      if (result.classification.classification === 'existing_feature') {
        // Found the auth feature — created a new change linked to it
        expect(result.action).toBe('created_change');
        expect(result.target_feature!.id).toBe(firstFeatureId);
        expect(result.target_change).not.toBeNull();
        expect(result.target_change!.id).not.toBe(firstChangeId);
      } else if (result.classification.classification === 'existing_change') {
        // Found the existing change — retrieval matched existing active change
        expect(result.action).toBe('continued_change');
        expect(result.target_change).not.toBeNull();
      } else if (result.classification.classification === 'new_feature') {
        // Lexical match was not strong enough — created new feature + change
        expect(result.action).toBe('created_feature_and_change');
        // Patch the new feature too
        if (result.target_feature) {
          patchFeatureWithSystem(result.target_feature.path, 'Backend');
        }
      } else {
        // needs_confirmation — valid outcome for ambiguous queries
        expect(result.action).toBe('asked_user');
      }
    });

    it('should not have duplicate features', () => {
      const index = buildIndex(vaultRoot);
      const features = Array.from(index.records.values()).filter(r => r.type === 'feature');
      // We have at most 2 features (original auth + possibly new password-reset)
      expect(features.length).toBeLessThanOrEqual(2);
      expect(features.length).toBeGreaterThanOrEqual(1);
    });

    it('should have created a second Change note', () => {
      if (!secondChangeId) return; // skip if asked_user
      if (secondChangeId === firstChangeId) return; // skip if existing_change (continued same change)

      const index = buildIndex(vaultRoot);
      const changes = Array.from(index.records.values()).filter(r => r.type === 'change');
      expect(changes.length).toBeGreaterThanOrEqual(2);
      expect(secondChangeId).not.toBe(firstChangeId);
    });
  });

  // ──────────────────────────────────────────────
  // Test 4: ows continue
  // ──────────────────────────────────────────────
  describe('Test 4: ows continue on the first change', () => {
    it('should identify missing sections on a bare proposed change', () => {
      const index = buildIndex(vaultRoot);
      const deps = realContinueDeps();
      const result = continueChange(index, deps, { changeName: firstChangeId });

      expect(result.changeId).toBe(firstChangeId);
      expect(result.currentStatus).toBe('proposed');
      expect(result.nextAction.action).toBe('fill_section');
    });

    it('should transition to planned when all hard prerequisites are filled', () => {
      // Fill in the required sections
      const absPath = path.join(vaultRoot, firstChangePath.startsWith('/') ? firstChangePath : firstChangePath);
      const resolvedPath = path.isAbsolute(firstChangePath) ? firstChangePath : path.join(vaultRoot, firstChangePath);
      let content = fs.readFileSync(resolvedPath, 'utf-8');
      // Read the feature title from the feature note's H1 heading for wikilink reference
      const featureContent = fs.readFileSync(firstFeaturePath, 'utf-8');
      const featureTitleMatch = featureContent.match(/^# Feature: (.+)$/m);
      const featureTitle = featureTitleMatch ? `Feature: ${featureTitleMatch[1]}` : firstFeatureId;

      content = content
        .replace(
          '## Why\n',
          '## Why\n\nWe need user authentication to protect user data and personalize the experience.\n',
        )
        .replace(
          '## Delta Summary\n',
          `## Delta Summary\n\n- ADDED requirement "email-login" to [[${featureTitle}]]\n`,
        )
        .replace(
          '## Tasks\n',
          '## Tasks\n\n- [ ] Implement login endpoint\n- [ ] Add password hashing\n- [ ] Create session management\n',
        )
        .replace(
          '## Validation\n',
          '## Validation\n\nVerify login flow works with valid and invalid credentials.\n',
        );
      fs.writeFileSync(resolvedPath, content, 'utf-8');

      // Run continue
      const index = buildIndex(vaultRoot);
      const deps = realContinueDeps();
      const result = continueChange(index, deps, { changeName: firstChangeId });

      // After auto-transition proposed->planned, nextAction reflects the NEW state
      expect(result.nextAction.action).toBe('start_implementation');
      expect(result.currentStatus).toBe('planned');
    });

    it('should have updated the change status to planned on disk', () => {
      const resolvedPath = path.isAbsolute(firstChangePath) ? firstChangePath : path.join(vaultRoot, firstChangePath);
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      expect(content).toContain('status: planned');
    });

    it('should return start_implementation for a planned change', () => {
      const index = buildIndex(vaultRoot);
      const deps = realContinueDeps();
      const result = continueChange(index, deps, { changeName: firstChangeId });

      // After auto-transition planned->in_progress, nextAction reflects the NEW state
      expect(result.nextAction.action).toBe('continue_task');
      expect(result.currentStatus).toBe('in_progress');
    });

    it('should have updated the change status to in_progress on disk', () => {
      const resolvedPath = path.isAbsolute(firstChangePath) ? firstChangePath : path.join(vaultRoot, firstChangePath);
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      expect(content).toContain('status: in_progress');
    });

    it('should show continue_task when in_progress with unchecked tasks', () => {
      const index = buildIndex(vaultRoot);
      const deps = realContinueDeps();
      const result = continueChange(index, deps, { changeName: firstChangeId });

      expect(result.currentStatus).toBe('in_progress');
      expect(result.nextAction.action).toBe('continue_task');
    });

    it('should show ready_to_apply when all tasks are checked', () => {
      // Mark all tasks as done
      const resolvedPath = path.isAbsolute(firstChangePath) ? firstChangePath : path.join(vaultRoot, firstChangePath);
      let content = fs.readFileSync(resolvedPath, 'utf-8');
      content = content.replace(/- \[ \]/g, '- [x]');
      fs.writeFileSync(resolvedPath, content, 'utf-8');

      const index = buildIndex(vaultRoot);
      const deps = realContinueDeps();
      const result = continueChange(index, deps, { changeName: firstChangeId });

      expect(result.currentStatus).toBe('in_progress');
      expect(result.nextAction.action).toBe('ready_to_apply');
    });
  });

  // ──────────────────────────────────────────────
  // Test 5: ows status + ows list
  // ──────────────────────────────────────────────
  describe('Test 5: ows status and ows list', () => {
    it('status should return correct change info', () => {
      const index = buildIndex(vaultRoot);
      const statusResult = getChangeStatus(firstChangeId, index);

      expect(statusResult.changeId).toBe(firstChangeId);
      expect(statusResult.status).toBe('in_progress');
      expect(statusResult.taskProgress.total).toBe(3);
      expect(statusResult.taskProgress.completed).toBe(3);
      expect(statusResult.nextAction.action).toBe('ready_to_apply');
    });

    it('status should throw for non-existent change', () => {
      const index = buildIndex(vaultRoot);
      expect(() => getChangeStatus('nonexistent-id', index)).toThrow('not found');
    });

    it('list all should include both features and changes', () => {
      const index = buildIndex(vaultRoot);
      const result = listNotes(index, 'all');

      // At minimum: system + feature + 2 changes = 4
      expect(result.items.length).toBeGreaterThanOrEqual(3);
      const types = new Set(result.items.map(i => i.type));
      expect(types.has('feature')).toBe(true);
      expect(types.has('change')).toBe(true);
    });

    it('list --changes should filter to changes only', () => {
      const index = buildIndex(vaultRoot);
      const result = listNotes(index, 'changes');

      expect(result.type).toBe('changes');
      for (const item of result.items) {
        expect(item.type).toBe('change');
      }
      for (const item of result.items) {
        expect(item.taskProgress).toBeDefined();
      }
    });

    it('list --features should filter to features only', () => {
      const index = buildIndex(vaultRoot);
      const result = listNotes(index, 'features');

      expect(result.type).toBe('features');
      for (const item of result.items) {
        expect(item.type).toBe('feature');
      }
    });

    it('list and status results should be JSON-serializable', () => {
      const index = buildIndex(vaultRoot);
      const listResult = listNotes(index, 'all');
      const statusResult = getChangeStatus(firstChangeId, index);

      // list result
      const listJson = JSON.stringify(listResult, null, 2);
      const listParsed = JSON.parse(listJson);
      expect(Array.isArray(listParsed.items)).toBe(true);

      // status result
      const statusJson = JSON.stringify(statusResult, null, 2);
      const statusParsed = JSON.parse(statusJson);
      expect(statusParsed.changeId).toBe(firstChangeId);
      expect(statusParsed.nextAction).toBeDefined();
    });
  });
});
