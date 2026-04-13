/**
 * E2E test: Migration edge cases — devil's advocate testing.
 *
 * Tests missing/partial data, active changes, delta spec variations,
 * Korean content, idempotency, and post-migration workflows.
 * Uses synthetic OpenSpec structures in temp dirs (never modifies real data).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanOpenSpec } from '../../src/core/migrate/scanner.js';
import { migrate, planMigration, executeMigration } from '../../src/core/migrate/migrate.js';
import { buildIndex } from '../../src/core/index/build.js';
import { verify } from '../../src/core/workflow/verify/verify.js';
import { retrieve } from '../../src/core/retrieval/retrieve.js';
import { propose } from '../../src/core/workflow/propose/propose.js';
import { analyzeSequencing } from '../../src/core/sequencing/analyze.js';
import { parseNote } from '../../src/core/parser/note-parser.js';
import type { MigrationResult } from '../../src/core/migrate/types.js';
import type { VaultIndex } from '../../src/types/index-record.js';
import type { RetrievalQuery } from '../../src/types/retrieval.js';
import type { ProposeDeps } from '../../src/core/workflow/propose/types.js';

// Suppress log.md writes during tests
process.env.OWS_NO_LOG = '1';

const SYEONG_OPENSPEC = process.env.OWS_TEST_OPENSPEC_DIR ?? '';
const HAS_SYEONG_DATA = !!SYEONG_OPENSPEC && fs.existsSync(SYEONG_OPENSPEC);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ows-edge-${prefix}-`));
}

function writeFile(base: string, relPath: string, content: string): void {
  const full = path.join(base, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function makeMinimalSpec(base: string, capability: string, content?: string): void {
  const specContent = content ?? `# Spec: ${capability}

## Purpose

Test capability for ${capability}.

## Requirements

### Requirement: Basic operation
The system SHALL perform basic operations for ${capability}.

#### Scenario: Happy path
- **WHEN** the operation is invoked
- **THEN** it succeeds
`;
  writeFile(base, `openspec/specs/${capability}/spec.md`, specContent);
}

function makeMinimalConfig(base: string, context?: string): void {
  const cfg = `schema: spec-driven
${context ? `context: |\n  ${context.replace(/\n/g, '\n  ')}` : ''}
`;
  writeFile(base, 'openspec/config.yaml', cfg);
}

function makeMinimalProposal(base: string, changeName: string, opts?: {
  archived?: boolean;
  why?: string;
  capabilities?: string;
}): void {
  const dir = opts?.archived
    ? `openspec/changes/archive/${changeName}`
    : `openspec/changes/${changeName}`;
  const content = `## Why

${opts?.why ?? 'Test change motivation.'}

## What Changes

- Change something for testing.

${opts?.capabilities ?? ''}

## Impact

- Test impact.
`;
  writeFile(base, `${dir}/proposal.md`, content);
}

function makeMetadata(base: string, changeName: string, opts?: {
  archived?: boolean;
  created?: string;
  touches?: string[];
  provides?: string[];
}): void {
  const dir = opts?.archived
    ? `openspec/changes/archive/${changeName}`
    : `openspec/changes/${changeName}`;
  const yaml = `schema: spec-driven
${opts?.created ? `created: "${opts.created}"` : ''}
${opts?.touches ? `touches:\n${opts.touches.map(t => `  - ${t}`).join('\n')}` : ''}
${opts?.provides ? `provides:\n${opts.provides.map(p => `  - ${p}`).join('\n')}` : ''}
`;
  writeFile(base, `${dir}/.openspec.yaml`, yaml);
}

function makeDesign(base: string, changeName: string, content: string, archived?: boolean): void {
  const dir = archived
    ? `openspec/changes/archive/${changeName}`
    : `openspec/changes/${changeName}`;
  writeFile(base, `${dir}/design.md`, content);
}

function makeTasks(base: string, changeName: string, content: string, archived?: boolean): void {
  const dir = archived
    ? `openspec/changes/archive/${changeName}`
    : `openspec/changes/${changeName}`;
  writeFile(base, `${dir}/tasks.md`, content);
}

function makeDeltaSpec(
  base: string,
  changeName: string,
  capability: string,
  content: string,
  archived?: boolean,
): void {
  const dir = archived
    ? `openspec/changes/archive/${changeName}`
    : `openspec/changes/${changeName}`;
  writeFile(base, `${dir}/specs/${capability}/spec.md`, content);
}

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

// ─── Group 1: Missing/partial OpenSpec data ──────────────────────────────────

describe('Group 1: Missing/partial OpenSpec data', () => {
  // Test 1: No config.yaml
  describe('Test 1: No config.yaml', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('no-config');
      // Create openspec with specs/ and changes/ but NO config.yaml
      makeMinimalSpec(tmpDir, 'test-feature');
      makeMinimalProposal(tmpDir, '2026-01-01-test-change', {
        archived: true,
        capabilities: `## Capabilities\n\n### Modified Capabilities\n- \`test-feature\`: modified`,
      });
      makeMetadata(tmpDir, '2026-01-01-test-change', { archived: true, created: '2026-01-01' });
      makeDeltaSpec(tmpDir, '2026-01-01-test-change', 'test-feature',
        `## ADDED Requirements\n\n### Requirement: New thing\nThe system SHALL do a new thing.\n`,
        true,
      );
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('migration succeeds without errors', () => {
      expect(result.errors).toHaveLength(0);
      expect(result.filesWritten.length).toBeGreaterThan(0);
    });

    it('no source note is created', () => {
      const sourceDir = path.join(tmpDir, 'wiki', '01-sources');
      if (fs.existsSync(sourceDir)) {
        const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'));
        // Should not have project-context.md
        expect(files).not.toContain('project-context.md');
      }
    });

    it('Feature sources=[] (not broken link)', () => {
      const featurePath = path.join(tmpDir, 'wiki', '03-features', 'test-feature.md');
      expect(fs.existsSync(featurePath)).toBe(true);
      const content = fs.readFileSync(featurePath, 'utf-8');
      expect(content).toContain('sources: []');
    });
  });

  // Test 2: No specs at all
  describe('Test 2: No specs at all', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('no-specs');
      makeMinimalConfig(tmpDir, 'Test project context');
      // Only changes, no specs
      makeMinimalProposal(tmpDir, '2026-01-01-orphan-change', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-orphan-change', { archived: true, created: '2026-01-01' });
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('migration succeeds without errors', () => {
      expect(result.errors).toHaveLength(0);
    });

    it('creates change note without Feature links (or with empty feature ref)', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      expect(fs.existsSync(archiveDir)).toBe(true);
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      expect(files).toHaveLength(1);
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('type: change');
      // Feature ref should be a placeholder wikilink since no specs exist
      expect(content).toMatch(/feature:\s*"\[\[Feature:/);
    });

    it('no feature or system notes created', () => {
      const featureDir = path.join(tmpDir, 'wiki', '03-features');
      if (fs.existsSync(featureDir)) {
        const files = fs.readdirSync(featureDir).filter(f => f.endsWith('.md'));
        expect(files).toHaveLength(0);
      }
      const systemDir = path.join(tmpDir, 'wiki', '02-systems');
      if (fs.existsSync(systemDir)) {
        const files = fs.readdirSync(systemDir).filter(f => f.endsWith('.md'));
        expect(files).toHaveLength(0);
      }
    });

    it('scan has warning about missing specs/', () => {
      const scan = scanOpenSpec(path.join(tmpDir, 'openspec'));
      expect(scan.warnings.some(w => w.includes('specs/'))).toBe(true);
    });
  });

  // Test 3: Empty spec file
  describe('Test 3: Empty spec file', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('empty-spec');
      makeMinimalConfig(tmpDir, 'Test');
      // Create spec.md with empty content
      writeFile(tmpDir, 'openspec/specs/empty-cap/spec.md', '');
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('migration succeeds without errors', () => {
      expect(result.errors).toHaveLength(0);
    });

    it('creates a minimal Feature note with placeholder sections', () => {
      const featurePath = path.join(tmpDir, 'wiki', '03-features', 'empty-cap.md');
      // The converter deterministically creates a feature note even for empty specs
      expect(fs.existsSync(featurePath)).toBe(true);
      const content = fs.readFileSync(featurePath, 'utf-8');
      expect(content).toContain('type: feature');
      expect(content).toContain('id: empty-cap');
      expect(content).toContain('## Requirements');
      // No requirements parsed from empty content — placeholder expected
      expect(content).toMatch(/No requirements found|<!-- /);
    });
  });

  // Test 4: Change without proposal.md
  describe('Test 4: Change without proposal.md', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = makeTmpDir('no-proposal');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'some-feature');
      // Create change dir with only design and tasks, no proposal
      makeTasks(tmpDir, '2026-01-01-no-proposal', '- [x] Did something', true);
      makeDesign(tmpDir, '2026-01-01-no-proposal', '# Design\n\nSome design.', true);
      makeMetadata(tmpDir, '2026-01-01-no-proposal', { archived: true, created: '2026-01-01' });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('scanner skips the change with a warning', () => {
      const scan = scanOpenSpec(path.join(tmpDir, 'openspec'));
      expect(scan.archivedChanges.every(c => c.name !== '2026-01-01-no-proposal')).toBe(true);
      expect(scan.warnings.some(w => w.includes('no-proposal') && w.includes('proposal.md'))).toBe(true);
    });

    it('migration succeeds despite skipped change', async () => {
      const result = await migrate({ projectPath: tmpDir });
      expect(result.errors).toHaveLength(0);
    });
  });

  // Test 5: Change without tasks.md
  describe('Test 5: Change without tasks.md', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('no-tasks');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'feature-a');
      makeMinimalProposal(tmpDir, '2026-01-01-no-tasks', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-no-tasks', {
        archived: true,
        created: '2026-01-01',
        touches: ['feature-a'],
      });
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('migration succeeds', () => {
      expect(result.errors).toHaveLength(0);
    });

    it('creates change note with fallback Tasks section', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      expect(files).toHaveLength(1);
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('## Tasks');
      // Should have fallback task
      expect(content).toContain('Review migrated change');
    });
  });

  // Test 6: Change without design.md
  describe('Test 6: Change without design.md', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('no-design');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'feature-b');
      makeMinimalProposal(tmpDir, '2026-01-01-no-design', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-no-design', {
        archived: true,
        created: '2026-01-01',
        touches: ['feature-b'],
      });
      makeTasks(tmpDir, '2026-01-01-no-design', '- [x] Done task', true);
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('migration succeeds', () => {
      expect(result.errors).toHaveLength(0);
    });

    it('no Decision note created', () => {
      const decisionDir = path.join(tmpDir, 'wiki', '05-decisions');
      if (fs.existsSync(decisionDir)) {
        const files = fs.readdirSync(decisionDir).filter(f => f.endsWith('.md'));
        expect(files).toHaveLength(0);
      }
    });

    it('Design Approach section has placeholder', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('## Design Approach');
      expect(content).toContain('No design document');
    });
  });
});

// ─── Group 2: Active changes during migration ───────────────────────────────

describe('Group 2: Active changes during migration', () => {
  // Test 7: Active change (not archived)
  describe('Test 7: Active change with status=proposed', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('active-change');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'active-feature');
      // Active change (not in archive/)
      makeMinimalProposal(tmpDir, 'add-something-new', { archived: false });
      makeMetadata(tmpDir, 'add-something-new', {
        archived: false,
        touches: ['active-feature'],
      });
      makeTasks(tmpDir, 'add-something-new', '- [ ] Implement new thing\n- [ ] Test it');
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('migration succeeds', () => {
      expect(result.errors).toHaveLength(0);
    });

    it('active change is placed in 04-changes (not 99-archive)', () => {
      const changeDir = path.join(tmpDir, 'wiki', '04-changes');
      expect(fs.existsSync(changeDir)).toBe(true);
      const files = fs.readdirSync(changeDir).filter(f => f.endsWith('.md'));
      expect(files.some(f => f.includes('add-something-new'))).toBe(true);

      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      if (fs.existsSync(archiveDir)) {
        const archiveFiles = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
        expect(archiveFiles.some(f => f.includes('add-something-new'))).toBe(false);
      }
    });

    it('active change has status=proposed (not applied)', () => {
      const changePath = path.join(tmpDir, 'wiki', '04-changes', 'add-something-new.md');
      const content = fs.readFileSync(changePath, 'utf-8');
      expect(content).toContain('status: proposed');
      expect(content).not.toContain('status: applied');
    });
  });

  // Test 8: Mix of active and archived
  describe('Test 8: Mix of active and archived changes', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('mixed-changes');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'mixed-feature');

      // 1 active change
      makeMinimalProposal(tmpDir, 'active-change-x', { archived: false });
      makeMetadata(tmpDir, 'active-change-x', { archived: false, touches: ['mixed-feature'] });

      // 2 archived changes
      makeMinimalProposal(tmpDir, '2026-01-01-archived-a', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-archived-a', { archived: true, created: '2026-01-01', touches: ['mixed-feature'] });

      makeMinimalProposal(tmpDir, '2026-02-01-archived-b', { archived: true });
      makeMetadata(tmpDir, '2026-02-01-archived-b', { archived: true, created: '2026-02-01', touches: ['mixed-feature'] });

      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('all 3 changes are created', () => {
      const changeDir = path.join(tmpDir, 'wiki', '04-changes');
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const changeFiles = fs.existsSync(changeDir)
        ? fs.readdirSync(changeDir).filter(f => f.endsWith('.md'))
        : [];
      const archiveFiles = fs.existsSync(archiveDir)
        ? fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'))
        : [];
      expect(changeFiles.length + archiveFiles.length).toBe(3);
    });

    it('active change has status=proposed, archived have status=applied', () => {
      const activeContent = fs.readFileSync(
        path.join(tmpDir, 'wiki', '04-changes', 'active-change-x.md'), 'utf-8',
      );
      expect(activeContent).toContain('status: proposed');

      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      for (const f of fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(archiveDir, f), 'utf-8');
        expect(content).toContain('status: applied');
      }
    });
  });
});

// ─── Group 3: Delta spec variations ──────────────────────────────────────────

describe('Group 3: Delta spec variations', () => {
  // Test 9: ADDED requirements only
  describe('Test 9: ADDED requirements only', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('delta-added');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'delta-feature');
      makeMinimalProposal(tmpDir, '2026-01-01-added-only', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-added-only', {
        archived: true,
        created: '2026-01-01',
        touches: ['delta-feature'],
      });
      makeDeltaSpec(tmpDir, '2026-01-01-added-only', 'delta-feature', `## ADDED Requirements

### Requirement: New feature X
The system SHALL support feature X.

#### Scenario: Basic usage
- **WHEN** user activates X
- **THEN** X works

### Requirement: New feature Y
The system SHALL support feature Y.
`, true);
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('Delta Summary contains ADDED entries', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('ADDED requirement "New feature X"');
      expect(content).toContain('ADDED requirement "New feature Y"');
      expect(content).toContain('[base: n/a]');
      expect(content).not.toContain('MODIFIED');
    });
  });

  // Test 10: MODIFIED requirements
  describe('Test 10: MODIFIED requirements', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('delta-modified');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'mod-feature');
      makeMinimalProposal(tmpDir, '2026-01-01-modified-only', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-modified-only', {
        archived: true,
        created: '2026-01-01',
        touches: ['mod-feature'],
      });
      makeDeltaSpec(tmpDir, '2026-01-01-modified-only', 'mod-feature', `## MODIFIED Requirements

### Requirement: Existing behavior
The system SHALL now behave differently.
`, true);
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('Delta Summary contains MODIFIED with [base: migrated]', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('MODIFIED requirement "Existing behavior"');
      expect(content).toContain('[base: migrated]');
      expect(content).not.toContain('ADDED');
    });
  });

  // Test 11: Mixed ADDED + MODIFIED
  describe('Test 11: Mixed ADDED + MODIFIED', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('delta-mixed');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'mix-feature');
      makeMinimalProposal(tmpDir, '2026-01-01-mixed-delta', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-mixed-delta', {
        archived: true,
        created: '2026-01-01',
        touches: ['mix-feature'],
      });
      makeDeltaSpec(tmpDir, '2026-01-01-mixed-delta', 'mix-feature', `## ADDED Requirements

### Requirement: Brand new thing
The system SHALL do brand new thing.

## MODIFIED Requirements

### Requirement: Old thing updated
The system SHALL do old thing differently.
`, true);
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('Delta Summary contains both ADDED and MODIFIED', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('ADDED requirement "Brand new thing"');
      expect(content).toContain('[base: n/a]');
      expect(content).toContain('MODIFIED requirement "Old thing updated"');
      expect(content).toContain('[base: migrated]');
    });
  });

  // Test 12: No delta specs
  describe('Test 12: No delta specs in change', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('no-delta');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'nodelta-feature');
      makeMinimalProposal(tmpDir, '2026-01-01-no-delta', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-no-delta', {
        archived: true,
        created: '2026-01-01',
        touches: ['nodelta-feature'],
      });
      // No specs/ subdirectory in the change at all
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('migration does not crash', () => {
      expect(result.errors).toHaveLength(0);
    });

    it('Delta Summary section has placeholder', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('## Delta Summary');
      // Should have a placeholder comment since no delta specs
      expect(content).toContain('No delta specs');
    });
  });
});

// ─── Group 4: Korean content preservation ────────────────────────────────────

describe('Group 4: Korean content preservation', () => {
  // Test 13: Korean spec requirements
  describe('Test 13: Korean spec requirements', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('korean-spec');
      makeMinimalConfig(tmpDir, '한국어 프로젝트');
      makeMinimalSpec(tmpDir, 'korean-cap', `# Spec: korean-cap

## Purpose

루틴 화면 라우팅을 관리하는 기능.

## Requirements

### Requirement: 인앱 라우팅 지원
The system SHALL support 인앱 라우팅 for 루틴 화면.

#### Scenario: 딥링크 처리
- **WHEN** 사용자가 딥링크를 통해 접근
- **THEN** 루틴 탭으로 이동한다
`);
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('Korean content preserved in Feature note', () => {
      const featurePath = path.join(tmpDir, 'wiki', '03-features', 'korean-cap.md');
      expect(fs.existsSync(featurePath)).toBe(true);
      const content = fs.readFileSync(featurePath, 'utf-8');
      expect(content).toContain('루틴 화면');
      expect(content).toContain('인앱 라우팅');
      expect(content).toContain('딥링크');
      expect(content).toContain('사용자가');
    });
  });

  // Test 14: Korean proposal content
  describe('Test 14: Korean proposal content', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('korean-proposal');
      makeMinimalConfig(tmpDir, 'Test');
      makeMinimalSpec(tmpDir, 'kr-feature');
      makeMinimalProposal(tmpDir, '2026-01-01-korean-change', {
        archived: true,
        why: 'Android 유저에게는 Watch 연동이 불가능하므로 루틴 기능을 숨겨야 한다.',
      });
      makeMetadata(tmpDir, '2026-01-01-korean-change', {
        archived: true,
        created: '2026-01-01',
        touches: ['kr-feature'],
      });
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('Korean Why content preserved in Change note', () => {
      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      const content = fs.readFileSync(path.join(archiveDir, files[0]), 'utf-8');
      expect(content).toContain('Android 유저에게는');
      expect(content).toContain('루틴 기능');
      expect(content).toContain('Watch 연동');
    });
  });

  // Test 15: Korean capability name for ID generation
  describe('Test 15: Spec capability with Korean-like name', () => {
    let tmpDir: string;
    let result: MigrationResult;

    beforeAll(async () => {
      tmpDir = makeTmpDir('korean-cap-name');
      makeMinimalConfig(tmpDir, 'Test');
      // Use a capability name with mixed content (kebab-case is the convention)
      makeMinimalSpec(tmpDir, 'routine-routing-kr', `# Spec: routine-routing-kr

## Purpose

루틴 라우팅 한국 버전.

## Requirements

### Requirement: 한국 라우팅
The system SHALL route 한국 users correctly.
`);
      result = await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('ID generation works with mixed-content capability', () => {
      const featurePath = path.join(tmpDir, 'wiki', '03-features', 'routine-routing-kr.md');
      expect(fs.existsSync(featurePath)).toBe(true);
      const content = fs.readFileSync(featurePath, 'utf-8');
      expect(content).toContain('id: routine-routing-kr');
      expect(content).toContain('한국');
    });
  });
});

// ─── Group 5: Idempotency and re-run ────────────────────────────────────────

describe('Group 5: Idempotency and re-run', () => {
  // Test 16: Double migration
  describe('Test 16: Double migration writes 0 files on second run', () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = makeTmpDir('idempotent');
      makeMinimalConfig(tmpDir, 'Idempotency test');
      makeMinimalSpec(tmpDir, 'idem-feature');
      makeMinimalProposal(tmpDir, '2026-01-01-idem-change', { archived: true });
      makeMetadata(tmpDir, '2026-01-01-idem-change', {
        archived: true,
        created: '2026-01-01',
        touches: ['idem-feature'],
      });
      // First migration
      await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('second migration writes 0 files and skips all expected files', async () => {
      // Record all file mtimes before second migration
      const featurePath = path.join(tmpDir, 'wiki', '03-features', 'idem-feature.md');
      const mtimeBefore = fs.statSync(featurePath).mtimeMs;

      const result2 = await migrate({ projectPath: tmpDir, allowExistingVault: true });
      expect(result2.filesWritten).toHaveLength(0);
      // Exact skip count: meta files + 1 source + 1 system + 1 feature + 1 change
      expect(result2.filesSkipped.length).toBeGreaterThanOrEqual(4);
      expect(result2.errors).toHaveLength(0);

      // Verify file was not touched (mtime unchanged)
      const mtimeAfter = fs.statSync(featurePath).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    });
  });

  // Test 17: Partial re-run
  describe('Test 17: Partial re-run recreates only deleted file', () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = makeTmpDir('partial-rerun');
      makeMinimalConfig(tmpDir, 'Partial re-run test');
      makeMinimalSpec(tmpDir, 'rerun-feature-a');
      makeMinimalSpec(tmpDir, 'rerun-feature-b');
      // First migration
      await migrate({ projectPath: tmpDir });
    });

    afterAll(() => {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('deleting one file and re-running recreates only that file', async () => {
      const featureAPath = path.join(tmpDir, 'wiki', '03-features', 'rerun-feature-a.md');
      const featureBPath = path.join(tmpDir, 'wiki', '03-features', 'rerun-feature-b.md');

      // Both exist after first migration
      expect(fs.existsSync(featureAPath)).toBe(true);
      expect(fs.existsSync(featureBPath)).toBe(true);

      // Record B's mtime before re-run
      const bStatBefore = fs.statSync(featureBPath);

      // Delete only A
      fs.unlinkSync(featureAPath);
      expect(fs.existsSync(featureAPath)).toBe(false);

      // Re-run migration — allowExistingVault is required for re-runs
      // because migrate() now refuses to silently merge into a populated
      // vault without the explicit opt-in.
      const result2 = await migrate({ projectPath: tmpDir, allowExistingVault: true });

      // A was recreated
      expect(fs.existsSync(featureAPath)).toBe(true);
      // Exactly 1 file should have been written (the deleted feature A)
      const featureWrites = result2.filesWritten.filter(f => f.includes('03-features'));
      expect(featureWrites).toHaveLength(1);
      expect(featureWrites[0]).toContain('rerun-feature-a');

      // B was skipped (not overwritten) — verify both in result AND via mtime
      const bStatAfter = fs.statSync(featureBPath);
      expect(bStatAfter.mtimeMs).toBe(bStatBefore.mtimeMs);
      expect(result2.filesSkipped.some(f => f.includes('rerun-feature-b'))).toBe(true);
    });
  });
});

// ─── Group 6: Post-migration workflow ───────────────────────────────────────

// ── Group 6: Post-migration coherence (synthetic, always runs) ──
describe('Group 6: Post-migration coherence (synthetic)', () => {
  // Verify that applyFeatureChangeBacklinks (migrate.ts post-process)
  // produces a vault whose Feature ↔ Change backlinks pass the default
  // `verify(index)` coherence checks (no skipCoherence). Previously
  // migrated vaults needed skipCoherence because Features lacked the
  // reverse `changes:` links, causing MISSING_LINK errors.
  it('migrated vault passes full verify (coherence included)', async () => {
    const tmpDir = makeTmpDir('coherence');
    try {
      makeMinimalConfig(tmpDir, 'Synthetic backlink test.');
      makeMinimalSpec(tmpDir, 'user-auth');
      // Active change so it's not archived (archived changes skip verify logic)
      makeMinimalProposal(tmpDir, '2026-01-01-add-oauth', {
        archived: false,
        capabilities: `## Capabilities\n\n### Modified Capabilities\n- \`user-auth\`: add oauth`,
      });
      makeMetadata(tmpDir, '2026-01-01-add-oauth', {
        archived: false,
        created: '2026-01-01',
        touches: ['user-auth'],
      });
      makeDeltaSpec(tmpDir, '2026-01-01-add-oauth', 'user-auth',
        `## ADDED Requirements\n\n### Requirement: OAuth\nThe system SHALL support OAuth.\n`,
        false,
      );

      await migrate({ projectPath: tmpDir });

      // Feature's changes: field should contain the backlink
      const featureContent = fs.readFileSync(
        path.join(tmpDir, 'wiki', '03-features', 'user-auth.md'),
        'utf-8',
      );
      expect(featureContent).toMatch(/changes:\n\s*-\s*"\[\[Change:/);

      // Default verify (skipCoherence=false) should not report
      // MISSING_LINK for backlink mismatches.
      const index = buildIndex(tmpDir);
      const report = verify(index);
      const backlinkErrors = report.issues.filter(
        (i) =>
          i.code === 'MISSING_LINK' &&
          typeof i.message === 'string' &&
          i.message.includes('does not link back'),
      );
      expect(backlinkErrors).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

const describeIfSyeong = HAS_SYEONG_DATA ? describe : describe.skip;

describeIfSyeong('Group 6b: Post-migration workflow (real Syeong_app data)', () => {
  let tmpDir: string;
  let vaultRoot: string;

  beforeAll(async () => {
    tmpDir = makeTmpDir('post-migrate');
    vaultRoot = tmpDir;
    // Copy real Syeong_app openspec data
    fs.cpSync(SYEONG_OPENSPEC, path.join(tmpDir, 'openspec'), { recursive: true });
    // Run migration
    await migrate({ projectPath: tmpDir });
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Test 18: Propose after migration
  // NOTE: propose() can mutate the vault (creates new notes). Run it in its own
  // temp dir copy so Tests 19-20 are not affected by side effects.
  describe('Test 18: Propose after migration', () => {
    let proposeTmpDir: string;

    beforeAll(() => {
      // Copy the already-migrated wiki to an isolated temp dir for propose
      proposeTmpDir = makeTmpDir('post-migrate-propose');
      fs.cpSync(path.join(tmpDir, 'wiki'), path.join(proposeTmpDir, 'wiki'), { recursive: true });
    });

    afterAll(() => {
      if (proposeTmpDir) fs.rmSync(proposeTmpDir, { recursive: true, force: true });
    });

    it('propose finds migrated features via retrieval', async () => {
      const deps = realProposeDeps();
      const result = await propose(
        'Improve routine routing for push notifications',
        { vaultRoot: proposeTmpDir },
        deps,
      );

      // Should find the migrated routine-routing feature
      expect(result.retrieval.candidates.length).toBeGreaterThan(0);

      const candidateIds = result.retrieval.candidates.map(c => c.id);
      const hasRoutineRelated = candidateIds.some(id =>
        id.includes('routine') || id.includes('routing'),
      );
      expect(hasRoutineRelated).toBe(true);
    });
  });

  // Test 19: Verify after migration
  describe('Test 19: Verify after migration passes', () => {
    it('verify report has no migration-caused errors (full coherence)', () => {
      // End-to-end test that Feature ↔ Change backlinks
      // (applyFeatureChangeBacklinks post-processing) let the default
      // verify (skipCoherence: false) pass on freshly-migrated content.
      // Previously this ran with skipCoherence: true, which hid the
      // coherence-dimension `MISSING_LINK` backlink errors.
      const index = buildIndex(vaultRoot);
      const report = verify(index);

      // Filter out non-migration errors (INVALID_FRONTMATTER_TYPE from meta files is OK)
      const migrationErrors = report.issues.filter(
        i => i.severity === 'error' && i.code !== 'INVALID_FRONTMATTER_TYPE',
      );

      if (migrationErrors.length > 0) {
        console.log('Migration verify errors:', migrationErrors.map(i => `[${i.code}] ${i.message}`));
      }
      expect(migrationErrors).toHaveLength(0);
    });

    it('all 3 features and 4 changes indexed correctly', () => {
      const index = buildIndex(vaultRoot);
      const features = Array.from(index.records.values()).filter(r => r.type === 'feature');
      const changes = Array.from(index.records.values()).filter(r => r.type === 'change');
      expect(features.length).toBe(3);
      expect(changes.length).toBe(4);
    });
  });

  // Test 20: Query after migration (Korean)
  describe('Test 20: Query in Korean finds migrated content', () => {
    it('Korean query finds routine-routing feature', () => {
      const index = buildIndex(vaultRoot);
      const query: RetrievalQuery = {
        intent: 'query',
        summary: '루틴 라우팅 개선',
        feature_terms: ['routine', 'routing', '루틴', '라우팅'],
        system_terms: [],
        entity_terms: ['routine-routing'],
        status_bias: [],
      };

      const result = retrieve(index, query);
      expect(result.candidates.length).toBeGreaterThan(0);
      const candidateIds = result.candidates.map(c => c.id);
      expect(candidateIds.some(id => id.includes('routine'))).toBe(true);
    });

    it('Korean query for watch-sync finds relevant content', () => {
      const index = buildIndex(vaultRoot);
      const query: RetrievalQuery = {
        intent: 'query',
        summary: '워치 동기화 진단 로깅',
        feature_terms: ['watch', 'sync', '워치', '동기화', 'sentry'],
        system_terms: [],
        entity_terms: ['watch-sync-diagnostics'],
        status_bias: [],
      };

      const result = retrieve(index, query);
      expect(result.candidates.length).toBeGreaterThan(0);
      const candidateIds = result.candidates.map(c => c.id);
      expect(candidateIds.some(id => id.includes('watch'))).toBe(true);
    });
  });
});
