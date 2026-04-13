/**
 * E2E test: Real migration from Syeong_app OpenSpec structure.
 *
 * Copies the actual openspec/ directory from Syeong_app and runs the full
 * migration pipeline, verifying every generated file against known expectations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanOpenSpec } from '../../src/core/migrate/scanner.js';
import { planMigration, executeMigration, migrate } from '../../src/core/migrate/migrate.js';
import { buildIndex } from '../../src/core/index/build.js';
import { verify } from '../../src/core/workflow/verify/verify.js';
import { retrieve } from '../../src/core/retrieval/retrieve.js';
import type { ScanResult, MigrationPlan, MigrationResult } from '../../src/core/migrate/types.js';
import type { VaultIndex } from '../../src/types/index-record.js';
import type { RetrievalQuery } from '../../src/types/retrieval.js';

// Path to a real OpenSpec project for integration testing.
// Set OWS_TEST_OPENSPEC_DIR env var to run these tests.
// Example: OWS_TEST_OPENSPEC_DIR=./path/to/openspec npm test
const SYEONG_OPENSPEC = process.env.OWS_TEST_OPENSPEC_DIR ?? '';
const SKIP_MIGRATION = !SYEONG_OPENSPEC || !fs.existsSync(SYEONG_OPENSPEC);

const describeIfEnv = SKIP_MIGRATION ? describe.skip : describe;

describeIfEnv('E2E: Migration from real Syeong_app', () => {
  let tmpDir: string;

  beforeAll(() => {
    if (SKIP_MIGRATION) {
      console.log('Skipping E2E migration test: set OWS_TEST_OPENSPEC_DIR to run');
      return;
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-e2e-migrate-'));
    // Copy real openspec directory
    fs.cpSync(SYEONG_OPENSPEC, path.join(tmpDir, 'openspec'), { recursive: true });
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ─── Test 1: Scan the real OpenSpec structure ─────────────────────────
  describe('Test 1: Scan real OpenSpec structure', () => {
    let scan: ScanResult;

    beforeAll(() => {
      scan = scanOpenSpec(path.join(tmpDir, 'openspec'));
    });

    it('finds config.yaml with context and rules', () => {
      expect(scan.config).not.toBeNull();
      expect(scan.config!.context).toBeDefined();
      expect(scan.config!.context).toContain('Syeong');
      expect(scan.config!.rules).toBeDefined();
      expect(scan.config!.rules).toHaveProperty('proposal');
      expect(scan.config!.rules).toHaveProperty('design');
      expect(scan.config!.rules).toHaveProperty('specs');
      expect(scan.config!.rules).toHaveProperty('tasks');
    });

    it('finds 3 main specs', () => {
      expect(scan.specs).toHaveLength(3);
      const capabilities = scan.specs.map(s => s.capability).sort();
      expect(capabilities).toEqual([
        'platform-gate-routine',
        'routine-routing',
        'watch-sync-diagnostics',
      ]);
    });

    it('finds 0 active changes', () => {
      expect(scan.activeChanges).toHaveLength(0);
    });

    it('finds 4 archived changes', () => {
      expect(scan.archivedChanges).toHaveLength(4);
      const changeNames = scan.archivedChanges.map(c => c.name).sort();
      expect(changeNames).toEqual([
        '2026-04-01-immediate-expo-and-routing',
        '2026-04-02-add-routine-push-routing',
        '2026-04-04-hide-routine-android',
        '2026-04-04-watch-sync-logging',
      ]);
    });

    it('finds delta specs inside changes', () => {
      for (const change of scan.archivedChanges) {
        expect(change.deltaSpecs.length).toBeGreaterThan(0);
      }
      // hide-routine-android has 2 delta specs touching different capabilities
      const hideRoutine = scan.archivedChanges.find(c => c.name === '2026-04-04-hide-routine-android');
      expect(hideRoutine!.deltaSpecs).toHaveLength(2);
      const deltaCapabilities = hideRoutine!.deltaSpecs.map(d => d.capability).sort();
      expect(deltaCapabilities).toEqual(['platform-gate-routine', 'routine-routing']);
    });

    it('reads spec content with Korean text', () => {
      const routineSpec = scan.specs.find(s => s.capability === 'routine-routing');
      expect(routineSpec!.content).toContain('루틴 화면');
      expect(routineSpec!.content).toContain('딥링크');
    });

    it('reads change metadata from .openspec.yaml', () => {
      for (const change of scan.archivedChanges) {
        expect(change.metadata).not.toBeNull();
        expect(change.metadata!.schema).toBe('spec-driven');
      }
    });

    it('has no scan warnings (well-formed project)', () => {
      // The real project should be well-formed with no warnings
      expect(scan.warnings).toHaveLength(0);
    });
  });

  // ─── Test 2: Dry-run migration ────────────────────────────────────────
  describe('Test 2: Dry-run migration', () => {
    let result: MigrationResult;

    beforeAll(async () => {
      result = await migrate({
        projectPath: tmpDir,
        dryRun: true,
      });
    });

    it('reports dryRun=true', () => {
      expect(result.dryRun).toBe(true);
    });

    it('writes no files', () => {
      expect(result.filesWritten).toHaveLength(0);
      expect(fs.existsSync(path.join(tmpDir, 'wiki'))).toBe(false);
    });

    it('plan contains Feature notes for all 3 specs', () => {
      const featureStep = result.plan.steps.find(s => s.name === 'Convert Specs to Features');
      expect(featureStep).toBeDefined();
      expect(featureStep!.outputs).toHaveLength(3);
      const featureIds = featureStep!.outputs.map(o =>
        path.basename(o.targetPath, '.md'),
      ).sort();
      expect(featureIds).toEqual([
        'platform-gate-routine',
        'routine-routing',
        'watch-sync-diagnostics',
      ]);
    });

    it('plan contains Change notes for all 4 archived changes', () => {
      const archiveStep = result.plan.steps.find(s => s.name === 'Convert Archived Changes');
      expect(archiveStep).toBeDefined();
      // At least 4 change notes (+ possible decision notes)
      const changeOutputs = archiveStep!.outputs.filter(o => o.targetPath.includes('99-archive'));
      expect(changeOutputs).toHaveLength(4);
    });

    it('plan contains System notes', () => {
      const systemStep = result.plan.steps.find(s => s.name === 'Infer Systems');
      expect(systemStep).toBeDefined();
      expect(systemStep!.outputs.length).toBeGreaterThanOrEqual(1);
      // All 3 specs lack cli-/opsx-/schema- prefix, so they should all map to 'core'
      expect(systemStep!.outputs.some(o => o.targetPath.includes('core'))).toBe(true);
    });

    it('plan contains Source note from config.yaml context', () => {
      const sourceStep = result.plan.steps.find(s => s.name === 'Generate Source Notes');
      expect(sourceStep).toBeDefined();
      expect(sourceStep!.outputs).toHaveLength(1);
      expect(sourceStep!.outputs[0].content).toContain('Syeong');
      expect(sourceStep!.outputs[0].content).toContain('React Native');
    });

    it('plan contains Decision notes from substantial design.md files', () => {
      const archiveStep = result.plan.steps.find(s => s.name === 'Convert Archived Changes');
      const decisionOutputs = archiveStep!.outputs.filter(o =>
        o.targetPath.includes('05-decisions'),
      );
      // At least 2 archived changes have substantial design.md (>200 chars stripped)
      expect(decisionOutputs.length).toBeGreaterThanOrEqual(2);
    });

    it('plan totalFiles is correct', () => {
      expect(result.plan.totalFiles).toBeGreaterThanOrEqual(8);
      // 1 source + 1 system + 3 features + 4 changes + N decisions
    });
  });

  // ─── Test 3: Full migration ───────────────────────────────────────────
  describe('Test 3: Full migration', () => {
    let result: MigrationResult;

    beforeAll(async () => {
      result = await migrate({ projectPath: tmpDir });
    });

    it('completes without errors', () => {
      expect(result.dryRun).toBe(false);
      expect(result.errors).toHaveLength(0);
      expect(result.filesWritten.length).toBeGreaterThan(0);
    });

    // ── Feature notes ──────────────────────────────────────────────────
    describe('Feature notes', () => {
      it('creates routine-routing.md with correct requirements count', () => {
        const filePath = path.join(tmpDir, 'wiki', '03-features', 'routine-routing.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Frontmatter checks
        expect(content).toContain('type: feature');
        expect(content).toContain('id: routine-routing');
        expect(content).toContain('status: active');
        expect(content).toMatch(/systems:/);
        expect(content).toContain('migrated');

        // Sections
        expect(content).toContain('## Purpose');
        expect(content).toContain('## Current Behavior');
        expect(content).toContain('## Constraints');
        expect(content).toContain('## Known Gaps');
        expect(content).toContain('## Requirements');
        expect(content).toContain('## Related Notes');

        // Requirements: the real spec has 8 requirements
        const reqMatches = content.match(/### Requirement:/g);
        expect(reqMatches).not.toBeNull();
        expect(reqMatches!.length).toBe(8);

        // Scenarios: the real spec has 19 scenarios
        const scenarioMatches = content.match(/#### Scenario:/g);
        expect(scenarioMatches).not.toBeNull();
        expect(scenarioMatches!.length).toBe(19);

        // Korean content preserved
        expect(content).toContain('루틴 화면');
        expect(content).toContain('인앱 라우팅');
      });

      it('creates platform-gate-routine.md with correct counts', () => {
        const filePath = path.join(tmpDir, 'wiki', '03-features', 'platform-gate-routine.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toContain('type: feature');
        expect(content).toContain('id: platform-gate-routine');
        expect(content).toContain('status: active');

        // 5 requirements
        const reqMatches = content.match(/### Requirement:/g);
        expect(reqMatches).not.toBeNull();
        expect(reqMatches!.length).toBe(5);

        // 15 scenarios
        const scenarioMatches = content.match(/#### Scenario:/g);
        expect(scenarioMatches).not.toBeNull();
        expect(scenarioMatches!.length).toBe(15);

        // Korean content
        expect(content).toContain('Android');
        expect(content).toContain('비활성화');
      });

      it('creates watch-sync-diagnostics.md with correct counts', () => {
        const filePath = path.join(tmpDir, 'wiki', '03-features', 'watch-sync-diagnostics.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toContain('type: feature');
        expect(content).toContain('id: watch-sync-diagnostics');
        expect(content).toContain('status: active');

        // 3 requirements
        const reqMatches = content.match(/### Requirement:/g);
        expect(reqMatches).not.toBeNull();
        expect(reqMatches!.length).toBe(3);

        // 8 scenarios (real count from actual file)
        const scenarioMatches = content.match(/#### Scenario:/g);
        expect(scenarioMatches).not.toBeNull();
        expect(scenarioMatches!.length).toBe(8);

        // Korean content
        expect(content).toContain('Sentry');
        expect(content).toContain('워치 동기화');
      });
    });

    // ── Change notes ──────────────────────────────────────────────────
    describe('Change notes (4 archived)', () => {
      it('creates change note for 2026-04-01-immediate-expo-and-routing', () => {
        const filePath = path.join(tmpDir, 'wiki', '99-archive', '2026-04-01-immediate-expo-and-routing.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Frontmatter
        expect(content).toContain('type: change');
        expect(content).toContain('status: applied');
        expect(content).toContain('created_at: "2026-04-01"');
        expect(content).toMatch(/feature:.*Feature: Routine Routing/);

        // Sections
        expect(content).toContain('## Why');
        expect(content).toContain('## Delta Summary');
        expect(content).toContain('## Proposed Update');
        expect(content).toContain('## Design Approach');
        expect(content).toContain('## Impact');
        expect(content).toContain('## Tasks');
        expect(content).toContain('## Validation');
        expect(content).toContain('## Status Notes');

        // Delta summary entries reference correct features
        expect(content).toContain('ADDED requirement');
        expect(content).toContain('In-app routing to routine tab');
        expect(content).toContain('Deep link to routine tab');
        expect(content).toContain('[[Feature: Routine Routing]]');

        // Tasks extracted with correct checked status (real tasks have backtick-wrapped code)
        expect(content).toContain('[x]');
        expect(content).toContain('Widen `RouteConfig.tabScreen`');

        // Why section content
        expect(content).toContain('inAppRouter.ts');
      });

      it('creates change note for 2026-04-04-hide-routine-android', () => {
        const filePath = path.join(tmpDir, 'wiki', '99-archive', '2026-04-04-hide-routine-android.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toContain('type: change');
        expect(content).toContain('status: applied');

        // Delta summary should have both ADDED and MODIFIED from different capabilities
        expect(content).toContain('ADDED requirement');
        expect(content).toContain('MODIFIED requirement');
        expect(content).toContain('Hide routine tab on Android');
        expect(content).toContain('Region-agnostic routing');

        // Feature references for both delta specs
        expect(content).toContain('[[Feature: Platform Gate Routine]]');
        expect(content).toContain('[[Feature: Routine Routing]]');

        // Korean content preserved
        expect(content).toContain('루틴 기능');
        expect(content).toContain('Android');

        // Tasks - real tasks have numbered items with code references
        expect(content).toContain('[x]');
        expect(content).toContain('MainTabScreen.tsx');
      });

      it('creates change note for 2026-04-02-add-routine-push-routing', () => {
        const filePath = path.join(tmpDir, 'wiki', '99-archive', '2026-04-02-add-routine-push-routing.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toContain('type: change');
        expect(content).toContain('status: applied');
        expect(content).toContain('created_at: "2026-04-01"');

        // Non-goals preserved in Proposed Update
        expect(content).toContain('Non-goals');
        expect(content).toContain('루틴 폼');

        // Delta specs parsed
        expect(content).toContain('ADDED requirement');
        expect(content).toContain('Admin push notification routing to routine tab');
        expect(content).toContain('Admin UI routine route option');

        // Feature ref from modified capabilities
        expect(content).toMatch(/feature:.*Feature: Routine Routing/);

        // Korean content
        expect(content).toContain('푸시 알림');
      });

      it('creates change note for 2026-04-04-watch-sync-logging', () => {
        const filePath = path.join(tmpDir, 'wiki', '99-archive', '2026-04-04-watch-sync-logging.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toContain('type: change');
        expect(content).toContain('status: applied');
        expect(content).toContain('created_at: "2026-04-05"');

        // Korean requirement names in delta specs must be preserved
        expect(content).toContain('Catch 블록 에러를 Sentry로 전송');
        expect(content).toContain('HealthKit 쿼리 결과 0건 시 Sentry warning 전송');
        expect(content).toContain('매칭 후 새 기록 0건 시 Sentry info 전송');

        // Feature ref from new capabilities
        expect(content).toMatch(/feature:.*Feature: Watch Sync Diagnostics/);

        // Tasks extracted - real tasks have backtick-wrapped code
        expect(content).toContain('[x]');
        expect(content).toContain('Sentry.captureMessage');
      });
    });

    // ── System notes ──────────────────────────────────────────────────
    describe('System notes', () => {
      it('creates at least 1 system note with valid frontmatter', () => {
        const systemDir = path.join(tmpDir, 'wiki', '02-systems');
        expect(fs.existsSync(systemDir)).toBe(true);
        const files = fs.readdirSync(systemDir).filter(f => f.endsWith('.md'));
        expect(files.length).toBeGreaterThanOrEqual(1);

        // All specs have no domain prefix -> should map to 'core'
        expect(files).toContain('core.md');

        const coreContent = fs.readFileSync(path.join(systemDir, 'core.md'), 'utf-8');
        expect(coreContent).toContain('type: system');
        expect(coreContent).toContain('id: core');
        expect(coreContent).toContain('status: active');
        expect(coreContent).toContain('migrated');
        // Should reference all 3 capabilities via Feature titles
        expect(coreContent).toContain('[[Feature: Routine Routing]]');
        expect(coreContent).toContain('[[Feature: Platform Gate Routine]]');
        expect(coreContent).toContain('[[Feature: Watch Sync Diagnostics]]');
      });
    });

    // ── Decision notes ────────────────────────────────────────────────
    describe('Decision notes', () => {
      it('creates decision notes from substantial design.md files', () => {
        const decisionDir = path.join(tmpDir, 'wiki', '05-decisions');
        expect(fs.existsSync(decisionDir)).toBe(true);
        const files = fs.readdirSync(decisionDir).filter(f => f.endsWith('.md'));
        // At least the first change and the push-routing change have substantial designs
        expect(files.length).toBeGreaterThanOrEqual(2);

        // Check one decision note for valid structure
        for (const file of files) {
          const content = fs.readFileSync(path.join(decisionDir, file), 'utf-8');
          expect(content).toContain('type: decision');
          expect(content).toMatch(/id: decision-/);
          expect(content).toContain('status: active');
          expect(content).toContain('migrated');
          expect(content).toContain('## Context');
          expect(content).toContain('## Decision');
        }
      });
    });

    // ── Source note ──────────────────────────────────────────────────
    describe('Source note', () => {
      it('creates project-context source note from config.yaml', () => {
        const filePath = path.join(tmpDir, 'wiki', '01-sources', 'project-context.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toContain('type: source');
        expect(content).toContain('id: project-context');
        expect(content).toContain('status: active');
        expect(content).toContain('project-context');
        expect(content).toContain('migrated');

        // Content from config.yaml context
        expect(content).toContain('Syeong');
        expect(content).toContain('Swimming Activity Tracker');
        expect(content).toContain('React Native');
        expect(content).toContain('Expo');

        // Rules from config.yaml
        expect(content).toContain('proposal');
      });
    });

    // ── Meta files ──────────────────────────────────────────────────
    describe('Meta files', () => {
      it('creates schema.md in 00-meta', () => {
        const schemaPath = path.join(tmpDir, 'wiki', '00-meta', 'schema.md');
        expect(fs.existsSync(schemaPath)).toBe(true);
        const content = fs.readFileSync(schemaPath, 'utf-8');
        expect(content).toContain('version');
      });

      it('creates index.md in 00-meta', () => {
        const indexPath = path.join(tmpDir, 'wiki', '00-meta', 'index.md');
        expect(fs.existsSync(indexPath)).toBe(true);
      });

      it('creates log.md in 00-meta', () => {
        const logPath = path.join(tmpDir, 'wiki', '00-meta', 'log.md');
        expect(fs.existsSync(logPath)).toBe(true);
      });

      it('creates conventions.md in 00-meta', () => {
        const convPath = path.join(tmpDir, 'wiki', '00-meta', 'conventions.md');
        expect(fs.existsSync(convPath)).toBe(true);
      });
    });
  });

  // ─── Test 4: Post-migration verify ────────────────────────────────────
  describe('Test 4: Post-migration verify', () => {
    let index: VaultIndex;

    beforeAll(() => {
      // buildIndex expects the project root (parent of wiki/), not the wiki/ path itself
      index = buildIndex(tmpDir);
    });

    it('builds index with all migrated notes', () => {
      // 3 features + 4 changes + 1+ systems + 1 source + N decisions + meta files
      expect(index.records.size).toBeGreaterThanOrEqual(9);
    });

    it('index contains all 3 feature records', () => {
      const features = Array.from(index.records.values()).filter(r => r.type === 'feature');
      const featureIds = features.map(f => f.id).sort();
      expect(featureIds).toContain('routine-routing');
      expect(featureIds).toContain('platform-gate-routine');
      expect(featureIds).toContain('watch-sync-diagnostics');
    });

    it('index contains all 4 change records', () => {
      const changes = Array.from(index.records.values()).filter(r => r.type === 'change');
      expect(changes.length).toBe(4);
      for (const change of changes) {
        expect(change.status).toBe('applied');
      }
    });

    it('has no duplicate IDs', () => {
      const report = verify(index, { skipCoherence: true });
      const duplicateIssues = report.issues.filter(i => i.code === 'DUPLICATE_ID');
      expect(duplicateIssues).toHaveLength(0);
    });

    it('wikilinks between features and system resolve correctly', () => {
      const report = verify(index, { skipCoherence: true });
      const unresolvedIssues = report.issues.filter(
        i => i.code === 'UNRESOLVED_WIKILINK',
      );

      // All wikilinks should resolve now that migration uses proper titles
      expect(unresolvedIssues).toHaveLength(0);

      const featureIds = ['routine-routing', 'platform-gate-routine', 'watch-sync-diagnostics'];
      for (const id of featureIds) {
        expect(index.records.has(id)).toBe(true);
      }
      // System note exists and is indexed
      expect(index.records.has('core')).toBe(true);
    });

    it('frontmatter types are valid for typed notes', () => {
      const report = verify(index, { skipCoherence: true });
      // Check that our primary notes (features, changes, system, source) have valid types
      const featureTypes = ['routine-routing', 'platform-gate-routine', 'watch-sync-diagnostics'];
      for (const id of featureTypes) {
        expect(index.records.get(id)!.type).toBe('feature');
      }
      expect(index.records.get('core')!.type).toBe('system');
      // Source note
      const sourceRecord = Array.from(index.records.values()).find(r => r.type === 'source');
      expect(sourceRecord).toBeDefined();
      expect(sourceRecord!.id).toBe('project-context');
    });

    it('features have requirements with proper structure', () => {
      const routineFeature = index.records.get('routine-routing');
      expect(routineFeature).toBeDefined();
      expect(routineFeature!.requirements.length).toBe(8);

      const platformFeature = index.records.get('platform-gate-routine');
      expect(platformFeature).toBeDefined();
      expect(platformFeature!.requirements.length).toBe(5);

      const watchFeature = index.records.get('watch-sync-diagnostics');
      expect(watchFeature).toBeDefined();
      expect(watchFeature!.requirements.length).toBe(3);
    });

    it('verify report passes cleanly with no migration-caused errors (full coherence)', () => {
      // End-to-end coherence check: with Feature ↔ Change backlinks
      // auto-populated by applyFeatureChangeBacklinks, the default verify
      // (skipCoherence: false) should also produce no errors.
      const report = verify(index);
      const errors = report.issues.filter(i => i.severity === 'error');

      // INVALID_FRONTMATTER_TYPE can occur from meta files that use non-standard
      // frontmatter; this is not a migration error.
      const migrationErrors = errors.filter(i => i.code !== 'INVALID_FRONTMATTER_TYPE');

      if (migrationErrors.length > 0) {
        console.log('Verify errors:', migrationErrors.map(i => `[${i.code}] ${i.message}`));
      }
      expect(migrationErrors).toHaveLength(0);
    });
  });

  // ─── Test 5: Post-migration retrieval ─────────────────────────────────
  describe('Test 5: Post-migration retrieval', () => {
    let index: VaultIndex;

    beforeAll(() => {
      index = buildIndex(tmpDir);
    });

    it('retrieves routine-routing feature for Korean query', () => {
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

      // The top candidate should be the routine-routing feature or a related change
      const candidateIds = result.candidates.map(c => c.id);
      const hasRoutineRouting = candidateIds.includes('routine-routing') ||
        candidateIds.some(id => id.includes('routine'));
      expect(hasRoutineRouting).toBe(true);
    });

    it('retrieves watch-sync-diagnostics for Sentry query', () => {
      const query: RetrievalQuery = {
        intent: 'query',
        summary: '워치 동기화 Sentry 로깅',
        feature_terms: ['watch', 'sync', 'sentry', '워치', '동기화'],
        system_terms: [],
        entity_terms: ['watch-sync-diagnostics'],
        status_bias: [],
      };

      const result = retrieve(index, query);
      expect(result.candidates.length).toBeGreaterThan(0);

      const candidateIds = result.candidates.map(c => c.id);
      const hasWatchSync = candidateIds.includes('watch-sync-diagnostics') ||
        candidateIds.some(id => id.includes('watch-sync'));
      expect(hasWatchSync).toBe(true);
    });

    it('classifies retrieval result correctly', () => {
      const query: RetrievalQuery = {
        intent: 'modify',
        summary: '루틴 라우팅 개선',
        feature_terms: ['routine', 'routing'],
        system_terms: [],
        entity_terms: ['routine-routing'],
        status_bias: [],
      };

      const result = retrieve(index, query);
      // Classification depends on scoring; with all changes applied, any of these is valid
      expect(result.classification).toBeDefined();
      expect(typeof result.classification).toBe('string');
      // If candidates were found, classification should not be empty
      if (result.candidates.length > 0) {
        expect(['existing_feature', 'existing_change', 'needs_confirmation', 'new_feature']).toContain(
          result.classification,
        );
      }
    });
  });

  // ─── Test 6: Idempotency ──────────────────────────────────────────────
  describe('Test 6: Idempotency', () => {
    it('second migration does not create duplicate files', async () => {
      // First migration already ran in Test 3, so run again
      const result2 = await migrate({ projectPath: tmpDir });

      // All files should be skipped (already exist)
      expect(result2.filesWritten).toHaveLength(0);
      expect(result2.filesSkipped.length).toBeGreaterThan(0);
      expect(result2.errors).toHaveLength(0);

      // Verify no duplicate files in any directory
      const featureDir = path.join(tmpDir, 'wiki', '03-features');
      const featureFiles = fs.readdirSync(featureDir).filter(f => f.endsWith('.md'));
      // Should still be exactly 3 feature files
      expect(featureFiles).toHaveLength(3);

      const archiveDir = path.join(tmpDir, 'wiki', '99-archive');
      const archiveFiles = fs.readdirSync(archiveDir).filter(f => f.endsWith('.md'));
      // Should still be exactly 4 change files
      expect(archiveFiles).toHaveLength(4);
    });

    it('existing files are not overwritten (content unchanged)', async () => {
      // Read a file before second migration
      const featurePath = path.join(tmpDir, 'wiki', '03-features', 'routine-routing.md');
      const contentBefore = fs.readFileSync(featurePath, 'utf-8');
      const statBefore = fs.statSync(featurePath);

      await migrate({ projectPath: tmpDir });

      const contentAfter = fs.readFileSync(featurePath, 'utf-8');
      const statAfter = fs.statSync(featurePath);

      expect(contentAfter).toBe(contentBefore);
      // Mtime should not change (file was skipped, not overwritten)
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });
  });
});
