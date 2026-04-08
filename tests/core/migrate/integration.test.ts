/**
 * Integration test using a structure mirroring a real OpenSpec project.
 * Based on the actual Syeong_app openspec/ directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { planMigration, executeMigration, migrate } from '../../../src/core/migrate/migrate.js';

function setupSyeongLikeProject(tmpDir: string): string {
  const openspecDir = path.join(tmpDir, 'openspec');

  // config.yaml with rich context (real-world format)
  fs.mkdirSync(openspecDir, { recursive: true });
  fs.writeFileSync(path.join(openspecDir, 'config.yaml'), `schema: spec-driven

context: |
  # Syeong - Swimming Activity Tracker
  ## Stack
  - React Native 0.81.5 (Fabric / New Architecture)
  - Expo 54, TypeScript 5.9
  - Navigation: @react-navigation/native-stack v6 + bottom-tabs v7
  ## Architecture
  Boot: index.js → RootApp.tsx → App.tsx → Root/ → Screens.tsx

rules:
  proposal:
    - Keep proposals concise
    - Always specify affected regions (KR/US/JP)
  specs:
    - Reference actual interface types
    - Include API endpoint specs
`, 'utf-8');

  // Specs: no H1, start directly with ## Purpose (real-world format)
  const routineRoutingSpec = path.join(openspecDir, 'specs', 'routine-routing');
  fs.mkdirSync(routineRoutingSpec, { recursive: true });
  fs.writeFileSync(path.join(routineRoutingSpec, 'spec.md'), `## Purpose

루틴 화면에 대한 인앱 라우팅, 딥링크, 푸시 알림 라우팅을 정의한다.

## Requirements

### Requirement: In-app routing to routine tab
The system SHALL support programmatic navigation to the RoutineMainScreen tab via routeToScreen('RoutineMainScreen').

#### Scenario: Navigate to routine tab via inAppRouter
- **WHEN** routeToScreen('RoutineMainScreen') is called
- **THEN** the app navigates to MainTabScreen with the RoutineMainScreen tab selected

### Requirement: Deep link to routine tab
The PATH_TO_SCREEN_MAP SHALL map path 'routine' to 'RoutineMainScreen'.

#### Scenario: Open routine tab via deep link
- **WHEN** the app receives deep link syeong://routine
- **THEN** routeToScreen('RoutineMainScreen') is called and the routine tab is displayed
`, 'utf-8');

  const platformGateSpec = path.join(openspecDir, 'specs', 'platform-gate-routine');
  fs.mkdirSync(platformGateSpec, { recursive: true });
  fs.writeFileSync(path.join(platformGateSpec, 'spec.md'), `## Purpose

Android에서 루틴 관련 UI, 네비게이션을 비활성화하는 플랫폼 게이팅 규칙을 정의한다.

## Requirements

### Requirement: Hide routine tab on Android
The MainTabScreen component SHALL NOT render the RoutineMainScreen Tab.Screen when Platform.OS is 'android'.

#### Scenario: iOS user sees routine tab
- **WHEN** the app is running on iOS
- **THEN** the bottom tab bar includes the RoutineMainScreen tab

#### Scenario: Android user does not see routine tab
- **WHEN** the app is running on Android
- **THEN** the bottom tab bar does NOT include the RoutineMainScreen tab
`, 'utf-8');

  const watchSyncSpec = path.join(openspecDir, 'specs', 'watch-sync-diagnostics');
  fs.mkdirSync(watchSyncSpec, { recursive: true });
  fs.writeFileSync(path.join(watchSyncSpec, 'spec.md'), `## Purpose

워치 동기화 파이프라인의 실패 지점을 Sentry로 수집하는 진단 로깅 규칙을 정의한다.

## Requirements

### Requirement: Catch 블록 에러를 Sentry로 전송
워치 동기화 catch 블록에서 발생하는 에러를 Sentry.captureException으로 전송 SHALL.

#### Scenario: HealthKit Authorization not determined 에러 발생
- **WHEN** HealthKit 권한이 요청된 적 없는 상태에서 syncWatchRecords가 호출됨
- **THEN** Sentry에 error 레벨 이벤트가 전송됨
`, 'utf-8');

  // Archived changes (no active changes, like real project)
  const archiveDir = path.join(openspecDir, 'changes', 'archive');

  // Change 1: with delta specs
  const change1Dir = path.join(archiveDir, '2026-04-01-immediate-expo-and-routing');
  const change1DeltaDir = path.join(change1Dir, 'specs', 'routine-routing');
  fs.mkdirSync(change1DeltaDir, { recursive: true });
  fs.writeFileSync(path.join(change1Dir, '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-04-01\n', 'utf-8');
  fs.writeFileSync(path.join(change1Dir, 'proposal.md'), `## Why

The RoutineMainScreen tab exists but inAppRouter.ts has no route for it. Push notifications cannot navigate to routines.

## What Changes

- **Add RoutineMainScreen to inAppRouter.ts** — Register in RoutableScreen type
- **Add routine paths to deep link config** — Update PATH_TO_SCREEN_MAP

## Capabilities

### New Capabilities
- routine-routing: In-app routing and deep link support for routine screens

## Impact

- src/helpers/inAppRouter.ts: Add RoutineMainScreen and RoutineFormScreen
- src/config/deepLinking.ts: Add routine paths
`, 'utf-8');
  fs.writeFileSync(path.join(change1Dir, 'design.md'), `## Context

RoutineListScreen is registered as bottom tab RoutineMainScreen in MainTabScreen. RoutineFormScreen is a root stack screen. Neither is in inAppRouter.ts or deepLinking.ts.

## Goals / Non-Goals

**Goals:**
- Add RoutineMainScreen and RoutineFormScreen to inAppRouter.ts and deepLinking.ts
- Follow existing routing patterns exactly

**Non-Goals:**
- Expo OTA update changes
- Edit-mode routing for RoutineFormScreen

## Decisions

### 1. Extend existing inAppRouter pattern

Add two entries to ROUTE_CONFIG_MAP:
- RoutineMainScreen: tab route
- RoutineFormScreen: stack route (create-only)

### 2. Deep link paths

Add to PATH_TO_SCREEN_MAP:
- routine → RoutineMainScreen
- routine/form → RoutineFormScreen
`, 'utf-8');
  fs.writeFileSync(path.join(change1Dir, 'tasks.md'), `## 1. inAppRouter — Type & Config Updates [Nav]

- [x] 1.1 Widen RouteConfig.tabScreen union type to include RoutineMainScreen
- [x] 1.2 Add RoutineMainScreen and RoutineFormScreen to RoutableScreen type union
- [x] 1.3 Add RoutineMainScreen entry to ROUTE_CONFIG_MAP
- [x] 1.4 Add RoutineFormScreen entry to ROUTE_CONFIG_MAP
- [x] 1.5 Verify: yarn lint passes

## 2. Deep Link Config [Nav]

- [x] 2.1 Add routine to PATH_TO_SCREEN_MAP
- [x] 2.2 Add routine/form to PATH_TO_SCREEN_MAP
- [ ] 2.3 Verify: xcrun simctl openurl
`, 'utf-8');
  fs.writeFileSync(path.join(change1DeltaDir, 'spec.md'), `## ADDED Requirements

### Requirement: In-app routing to routine tab
The system SHALL support programmatic navigation to the RoutineMainScreen tab.

#### Scenario: Navigate to routine tab via inAppRouter
- **WHEN** routeToScreen('RoutineMainScreen') is called
- **THEN** the app navigates to the RoutineMainScreen tab

### Requirement: Deep link to routine tab
The PATH_TO_SCREEN_MAP SHALL map path 'routine' to 'RoutineMainScreen'.

#### Scenario: Open routine tab via deep link
- **WHEN** the app receives deep link syeong://routine
- **THEN** the routine tab is displayed
`, 'utf-8');

  // Change 2: with multiple delta specs touching different capabilities
  const change2Dir = path.join(archiveDir, '2026-04-04-hide-routine-android');
  const change2Delta1 = path.join(change2Dir, 'specs', 'platform-gate-routine');
  const change2Delta2 = path.join(change2Dir, 'specs', 'routine-routing');
  fs.mkdirSync(change2Delta1, { recursive: true });
  fs.mkdirSync(change2Delta2, { recursive: true });
  fs.writeFileSync(path.join(change2Dir, '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-04-03\n', 'utf-8');
  fs.writeFileSync(path.join(change2Dir, 'proposal.md'), `## Why

루틴 기능은 Apple Watch 가이드가 핵심이므로 Android에서 노출 불필요.

## What Changes

- 루틴 탭 숨김: MainTabScreen에서 Android일 때 RoutineMainScreen 탭 미렌더링
- 딥링크 차단: Android에서 routine 경로 제외
- 인앱 라우팅 차단: Android에서 silent no-op

## Capabilities

### New Capabilities
- platform-gate-routine: Android에서 루틴 비활성화

### Modified Capabilities
- routine-routing: Region-agnostic routing에 플랫폼 조건 추가

## Impact

- MainTabScreen.tsx, Screens.tsx, deepLinking.ts, inAppRouter.ts
`, 'utf-8');
  fs.writeFileSync(path.join(change2Dir, 'design.md'), '## Context\nShort design.', 'utf-8');
  fs.writeFileSync(path.join(change2Dir, 'tasks.md'), `- [x] Hide routine tab on Android
- [x] Exclude RoutineFormScreen from Android nav stack
- [x] Exclude routine deep links on Android
- [x] Block routine in-app routing on Android
`, 'utf-8');
  fs.writeFileSync(path.join(change2Delta1, 'spec.md'), `## ADDED Requirements

### Requirement: Hide routine tab on Android
The MainTabScreen component SHALL NOT render RoutineMainScreen Tab.Screen on Android.

#### Scenario: iOS user sees routine tab
- **WHEN** iOS
- **THEN** tab is visible
`, 'utf-8');
  fs.writeFileSync(path.join(change2Delta2, 'spec.md'), `## MODIFIED Requirements

### Requirement: Region-agnostic routing
Routine routing SHALL work on iOS in all regions. Android SHALL be blocked.

#### Scenario: Navigate on iOS
- **WHEN** iOS US region
- **THEN** routing works
`, 'utf-8');

  // Change 3: with Non-goals, Modified Capabilities, substantial design.md
  const change3Dir = path.join(archiveDir, '2026-04-02-add-routine-push-routing');
  const change3DeltaDir = path.join(change3Dir, 'specs', 'routine-routing');
  fs.mkdirSync(change3DeltaDir, { recursive: true });
  fs.writeFileSync(path.join(change3Dir, '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-04-01\n', 'utf-8');
  fs.writeFileSync(path.join(change3Dir, 'proposal.md'), `## Why

Admin 푸시 알림의 페이지 라우팅 드롭다운에 루틴 화면이 없다.

## What Changes

- **Admin**: RouteTargetOption 타입에 "routine" 옵션 추가
- **Server**: DeepLinkRoutine 상수 추가, routeTargetToDeepLink() switch 문에 매핑

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- routine-routing: 서버 및 어드민에서 푸시 알림 라우팅 타겟으로 루틴 화면 지원 추가

## Impact

- syeong_admin/src/services/pushService.ts
- Syeong_server/internal/core/services/alert_service.go

## Non-goals

- 루틴 폼(syeong://routine/form) 푸시 라우팅은 이번 스코프에 포함하지 않음
- 실시간 푸시(유저 간 알림)의 루틴 라우팅은 별도 스코프
- 앱 사이드 코드 변경 없음
`, 'utf-8');
  fs.writeFileSync(path.join(change3Dir, 'design.md'), `## Context

현재 admin 푸시 알림의 라우팅 타겟은 4개이며, 각각 서버에서 딥링크로 변환된다.

## Goals / Non-Goals

**Goals:**
- Admin에서 루틴 탭을 라우팅 대상으로 선택 가능
- 서버에서 "routine" route target을 syeong://routine 딥링크로 변환

**Non-Goals:**
- routine/form 라우팅은 이번 스코프 외
- DB 스키마 변경 없음

## Decisions

### 1. Route target 값으로 "routine" 사용

기존 패턴과 동일하게 화면 이름의 소문자 단수형을 사용한다.

### 2. 서버 배포 → 어드민 배포 순서

서버에 "routine" case를 먼저 추가해야 한다.

## Risks / Trade-offs

- [낮음] 앱 버전 호환성: 오래된 앱에서 딥링크 처리 불가
`, 'utf-8');
  fs.writeFileSync(path.join(change3Dir, 'tasks.md'), `## 1. Server — 딥링크 상수 및 변환 로직

- [x] 1.1 DeepLinkRoutine 상수 추가
- [x] 1.2 routeTargetToDeepLink() switch 문에 case 추가
- [x] 1.3 서버 로컬 빌드 확인

## 2. Admin — 라우팅 타겟 옵션 추가

- [x] 2.1 RouteTargetOption 타입에 "routine" 추가
- [x] 2.2 ROUTE_TARGET_OPTIONS 배열에 옵션 추가
- [ ] 2.3 Admin 로컬 확인
`, 'utf-8');
  fs.writeFileSync(path.join(change3DeltaDir, 'spec.md'), `## ADDED Requirements

### Requirement: Admin push notification routing to routine tab

The admin push system SHALL support "routine" as a valid routeTarget value.

#### Scenario: Admin selects routine as push routing target
- **WHEN** an admin selects from the dropdown
- **THEN** the routeTarget SHALL be set to "routine"

### Requirement: Admin UI routine route option

The admin UI SHALL include an option in the ROUTE_TARGET_OPTIONS dropdown.

#### Scenario: Routine option visible in push management
- **WHEN** an admin opens the push composition dialog
- **THEN** the option SHALL appear as selectable
`, 'utf-8');

  // Change 4: with Korean requirement names in delta specs
  const change4Dir = path.join(archiveDir, '2026-04-04-watch-sync-logging');
  const change4DeltaDir = path.join(change4Dir, 'specs', 'watch-sync-diagnostics');
  fs.mkdirSync(change4DeltaDir, { recursive: true });
  fs.writeFileSync(path.join(change4Dir, '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-04-05\n', 'utf-8');
  fs.writeFileSync(path.join(change4Dir, 'proposal.md'), `## Why

워치 자동 동기화가 실패해도 앱에서 진단 정보를 수집하지 않아 원인 파악이 불가능하다.

## What Changes

- watchSyncUtils.ts의 syncWatchRecords 함수에 Sentry 로깅 추가
- catch 블록에서 console.error → Sentry.captureException 변경

## Capabilities

### New Capabilities
- watch-sync-diagnostics: 워치 동기화 파이프라인의 실패 지점을 Sentry로 수집

### Modified Capabilities
(없음)

## Impact

- src/helpers/watchSyncUtils.ts
- src/screens/home/components/HomeRecordCalendar.tsx
`, 'utf-8');
  fs.writeFileSync(path.join(change4Dir, 'design.md'), '## Context\nShort design for watch sync.', 'utf-8');
  fs.writeFileSync(path.join(change4Dir, 'tasks.md'), `## 1. watchSyncUtils.ts 로깅 추가

- [x] 1.1 HealthKit 쿼리 결과 0건 시 Sentry warning 추가
- [x] 1.2 매칭 후 새 기록 0건 시 Sentry info 추가

## 2. 화면 catch 블록 Sentry 전송

- [x] 2.1 HomeRecordCalendar.tsx catch 블록에 Sentry.captureException 추가
- [x] 2.2 RecordDashboardScreen/index.tsx catch 블록에 Sentry.captureException 추가
`, 'utf-8');
  fs.writeFileSync(path.join(change4DeltaDir, 'spec.md'), `## ADDED Requirements

### Requirement: Catch 블록 에러를 Sentry로 전송
워치 동기화 catch 블록에서 발생하는 에러를 Sentry.captureException으로 전송 SHALL.

#### Scenario: HealthKit Authorization not determined 에러 발생
- **WHEN** HealthKit 권한이 요청된 적 없는 상태에서 syncWatchRecords가 호출됨
- **THEN** Sentry에 error 레벨 이벤트가 전송됨

### Requirement: HealthKit 쿼리 결과 0건 시 Sentry warning 전송
syncWatchRecords에서 HealthKit 쿼리 결과가 0건일 때 Sentry.captureMessage를 warning 레벨로 전송 SHALL.

#### Scenario: HealthKit 권한 거부로 빈 배열 반환
- **WHEN** 유저가 HealthKit 수영 읽기 권한을 거부
- **THEN** Sentry에 warning 레벨 메시지가 전송됨

### Requirement: 매칭 후 새 기록 0건 시 Sentry info 전송
syncWatchRecords에서 3단계 매칭 후 새 기록이 0건일 때 Sentry.captureMessage를 info 레벨로 전송 SHALL.

#### Scenario: 전부 이미 동기화된 상태
- **WHEN** HealthKit에 워크아웃이 있지만 모두 DB에 이미 매칭됨
- **THEN** Sentry에 info 레벨 메시지가 전송됨
`, 'utf-8');

  return openspecDir;
}

describe('Integration: Real-world OpenSpec migration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ows-migrate-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('plans migration from Syeong-like structure', () => {
    setupSyeongLikeProject(tmpDir);
    const plan = planMigration({ projectPath: tmpDir });

    // Should have all steps
    const stepNames = plan.steps.map(s => s.name);
    expect(stepNames).toContain('Scan OpenSpec');
    expect(stepNames).toContain('Generate Source Notes');
    expect(stepNames).toContain('Infer Systems');
    expect(stepNames).toContain('Convert Specs to Features');
    expect(stepNames).toContain('Convert Archived Changes');

    // Should have found 3 specs
    const scanStep = plan.steps.find(s => s.name === 'Scan OpenSpec')!;
    expect(scanStep.description).toContain('3 specs');
    expect(scanStep.description).toContain('0 active changes');
    expect(scanStep.description).toContain('4 archived changes');

    // Should generate source note from config context
    const sourceStep = plan.steps.find(s => s.name === 'Generate Source Notes')!;
    expect(sourceStep.outputs).toHaveLength(1);
    expect(sourceStep.outputs[0].targetPath).toContain('01-sources');

    // Should infer at least 1 system (core, since no cli-/opsx-/schema- prefixes)
    const systemStep = plan.steps.find(s => s.name === 'Infer Systems')!;
    expect(systemStep.outputs.length).toBeGreaterThanOrEqual(1);

    // Should convert 3 specs to features
    const featureStep = plan.steps.find(s => s.name === 'Convert Specs to Features')!;
    expect(featureStep.outputs).toHaveLength(3);
    const featurePaths = featureStep.outputs.map(o => o.targetPath);
    expect(featurePaths.some(p => p.includes('routine-routing'))).toBe(true);
    expect(featurePaths.some(p => p.includes('platform-gate-routine'))).toBe(true);
    expect(featurePaths.some(p => p.includes('watch-sync-diagnostics'))).toBe(true);

    // Total files should be substantial
    expect(plan.totalFiles).toBeGreaterThanOrEqual(6);
  });

  it('executes migration from Syeong-like structure', async () => {
    setupSyeongLikeProject(tmpDir);
    const result = await migrate({ projectPath: tmpDir });

    expect(result.dryRun).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.filesWritten.length).toBeGreaterThan(0);

    // Verify wiki directory structure
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '00-meta'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '01-sources'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '02-systems'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '03-features'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '04-changes'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'wiki', '99-archive'))).toBe(true);

    // Verify feature files contain correct content
    const routineFeature = fs.readFileSync(
      path.join(tmpDir, 'wiki', '03-features', 'routine-routing.md'), 'utf-8',
    );
    expect(routineFeature).toContain('type: feature');
    expect(routineFeature).toContain('id: routine-routing');
    expect(routineFeature).toContain('인앱 라우팅');
    expect(routineFeature).toContain('Requirement: In-app routing to routine tab');
    expect(routineFeature).toContain('Requirement: Deep link to routine tab');

    // Verify platform-gate feature
    const platformFeature = fs.readFileSync(
      path.join(tmpDir, 'wiki', '03-features', 'platform-gate-routine.md'), 'utf-8',
    );
    expect(platformFeature).toContain('Android');
    expect(platformFeature).toContain('Requirement: Hide routine tab on Android');

    // Verify source note from config context
    const sourceNote = fs.readFileSync(
      path.join(tmpDir, 'wiki', '01-sources', 'project-context.md'), 'utf-8',
    );
    expect(sourceNote).toContain('type: source');
    expect(sourceNote).toContain('Swimming Activity Tracker');
    expect(sourceNote).toContain('React Native');

    // Verify archived changes
    const archivedChange = fs.readFileSync(
      path.join(tmpDir, 'wiki', '99-archive', '2026-04-01-immediate-expo-and-routing.md'), 'utf-8',
    );
    expect(archivedChange).toContain('type: change');
    expect(archivedChange).toContain('status: applied');
    expect(archivedChange).toContain('created_at: "2026-04-01"');
    expect(archivedChange).toContain('Push notifications cannot navigate to routines');
    // Should have parsed delta spec properly
    expect(archivedChange).toContain('ADDED requirement "In-app routing to routine tab"');
    expect(archivedChange).toContain('ADDED requirement "Deep link to routine tab"');
    // Should have extracted tasks
    expect(archivedChange).toContain('[x] 1.1 Widen RouteConfig.tabScreen');

    // Verify second archived change has both ADDED and MODIFIED delta entries
    const change2 = fs.readFileSync(
      path.join(tmpDir, 'wiki', '99-archive', '2026-04-04-hide-routine-android.md'), 'utf-8',
    );
    expect(change2).toContain('status: applied');
    expect(change2).toContain('ADDED requirement "Hide routine tab on Android"');
    expect(change2).toContain('MODIFIED requirement "Region-agnostic routing"');

    // Verify change 3: Non-goals extracted, Modified Capabilities used for feature ref
    const change3 = fs.readFileSync(
      path.join(tmpDir, 'wiki', '99-archive', '2026-04-02-add-routine-push-routing.md'), 'utf-8',
    );
    expect(change3).toContain('status: applied');
    expect(change3).toContain('created_at: "2026-04-01"');
    // Non-goals section should be preserved in Proposed Update
    expect(change3).toContain('Non-goals');
    expect(change3).toContain('루틴 폼');
    // Delta specs should be parsed
    expect(change3).toContain('ADDED requirement "Admin push notification routing to routine tab"');
    expect(change3).toContain('ADDED requirement "Admin UI routine route option"');
    // Feature ref from modified capabilities
    expect(change3).toContain('Feature: Routine Routing');

    // Verify change 4: Korean requirement names in delta specs
    const change4 = fs.readFileSync(
      path.join(tmpDir, 'wiki', '99-archive', '2026-04-04-watch-sync-logging.md'), 'utf-8',
    );
    expect(change4).toContain('status: applied');
    expect(change4).toContain('created_at: "2026-04-05"');
    // Korean requirement names must be preserved
    expect(change4).toContain('Catch 블록 에러를 Sentry로 전송');
    expect(change4).toContain('HealthKit 쿼리 결과 0건 시 Sentry warning 전송');
    expect(change4).toContain('매칭 후 새 기록 0건 시 Sentry info 전송');
    // Feature ref from new capabilities
    expect(change4).toContain('Feature: Watch Sync Diagnostics');
  });

  it('migration is idempotent', async () => {
    setupSyeongLikeProject(tmpDir);

    const result1 = await migrate({ projectPath: tmpDir });
    expect(result1.filesWritten.length).toBeGreaterThan(0);
    const writtenCount = result1.filesWritten.length;

    const result2 = await migrate({ projectPath: tmpDir });
    expect(result2.filesSkipped.length).toBe(writtenCount);
    expect(result2.filesWritten).toHaveLength(0);
  });

  it('skip-archive excludes archived changes', async () => {
    setupSyeongLikeProject(tmpDir);

    const result = await migrate({ projectPath: tmpDir, skipArchive: true });
    const archiveFiles = result.filesWritten.filter(f => f.includes('99-archive'));
    expect(archiveFiles).toHaveLength(0);
  });

  it('dry-run produces plan without writing', async () => {
    setupSyeongLikeProject(tmpDir);

    const result = await migrate({ projectPath: tmpDir, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.filesWritten).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'wiki'))).toBe(false);
    expect(result.plan.totalFiles).toBeGreaterThan(0);
  });

  it('generates decision notes from substantial design.md', async () => {
    setupSyeongLikeProject(tmpDir);

    const result = await migrate({ projectPath: tmpDir });
    // The first change has a substantial design.md (>200 chars)
    const decisionFiles = result.filesWritten.filter(f => f.includes('05-decisions'));
    expect(decisionFiles.length).toBeGreaterThanOrEqual(1);

    const decisionNote = fs.readFileSync(
      path.join(tmpDir, decisionFiles[0]), 'utf-8',
    );
    expect(decisionNote).toContain('type: decision');
    expect(decisionNote).toContain('Extend existing inAppRouter pattern');
  });
});
