import { describe, it, expect } from 'vitest';
import { convertChange, convertAllChanges } from '../../../src/core/migrate/change-converter.js';
import type { ScannedChange } from '../../../src/core/migrate/types.js';

function makeChange(overrides: Partial<ScannedChange> = {}): ScannedChange {
  return {
    name: 'add-dark-mode',
    dirPath: '/tmp/openspec/changes/add-dark-mode',
    proposal: `## Why

We need dark mode for accessibility.

## What Changes

Adding dark mode toggle and theme system.

## Impact

Affects UI rendering.
`,
    design: null,
    tasks: `- [ ] Add toggle component
- [x] Define color tokens
- [ ] Update theme provider`,
    metadata: { schema: 'spec-driven', created: '2025-06-15' },
    deltaSpecs: [],
    archived: false,
    ...overrides,
  };
}

describe('convertChange', () => {
  const featureRefs = new Map<string, string>([
    ['ui', '[[Feature: Ui]]'],
    ['auth', '[[Feature: Auth]]'],
  ]);
  const systemRefMap = new Map<string, string>([
    ['ui', '[[core]]'],
    ['auth', '[[core]]'],
  ]);

  it('converts a basic active change to a Change note', () => {
    const change = makeChange();
    const { changeNote, decisionNote, warnings } = convertChange(change, featureRefs, systemRefMap);

    expect(changeNote.targetPath).toContain('04-changes');
    expect(changeNote.targetPath).toContain('add-dark-mode.md');
    expect(changeNote.content).toContain('type: change');
    expect(changeNote.content).toContain('id: add-dark-mode');
    expect(changeNote.content).toContain('status: proposed');
    expect(changeNote.content).toContain('created_at: "2025-06-15"');
    expect(changeNote.content).toContain('dark mode for accessibility');
    expect(changeNote.content).toContain('migrated');
    expect(decisionNote).toBeNull();
  });

  it('converts an archived change with status applied', () => {
    const change = makeChange({
      name: '2025-01-11-add-update-command',
      archived: true,
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.targetPath).toContain('99-archive');
    expect(changeNote.content).toContain('status: applied');
  });

  it('extracts created_at from archived date prefix', () => {
    const change = makeChange({
      name: '2025-01-11-add-update-command',
      archived: true,
      metadata: null,
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('created_at: "2025-01-11"');
  });

  it('extracts tasks from tasks.md', () => {
    const change = makeChange();
    const { changeNote } = convertChange(change, featureRefs, systemRefMap);

    expect(changeNote.content).toContain('- [ ] Add toggle component');
    expect(changeNote.content).toContain('- [x] Define color tokens');
    expect(changeNote.content).toContain('- [ ] Update theme provider');
  });

  it('generates decision note from substantial design.md', () => {
    const longDesign = `## Context

This is a substantial design document that explains the architecture.

## Decisions

### 1. Use CSS custom properties

We decided to use CSS custom properties for theming because they provide runtime switching capability without JavaScript overhead. This approach also supports cascading themes for nested components.

### 2. Store preference in localStorage

User preference persists via localStorage with a key of "theme-preference".
`;

    const change = makeChange({ design: longDesign });
    const { changeNote, decisionNote } = convertChange(change, featureRefs, systemRefMap);

    expect(decisionNote).not.toBeNull();
    expect(decisionNote!.targetPath).toContain('05-decisions');
    expect(decisionNote!.targetPath).toContain('decision-add-dark-mode.md');
    expect(decisionNote!.content).toContain('type: decision');
    expect(decisionNote!.content).toContain('CSS custom properties');
  });

  it('does not generate decision note from short design.md', () => {
    const change = makeChange({ design: '## Context\nShort.' });
    const { decisionNote } = convertChange(change, featureRefs, systemRefMap);
    expect(decisionNote).toBeNull();
  });

  it('handles change with delta specs (generic fallback)', () => {
    const change = makeChange({
      deltaSpecs: [
        { capability: 'ui', content: '# UI delta spec\nSome unstructured content.' },
      ],
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('MODIFIED section');
    expect(changeNote.content).toContain('[[Feature: Ui]]');
  });

  it('parses real delta spec format with ADDED/MODIFIED Requirements', () => {
    const change = makeChange({
      deltaSpecs: [
        {
          capability: 'ui',
          content: `## ADDED Requirements

### Requirement: In-app routing to routine tab
The system SHALL support programmatic navigation to the RoutineMainScreen tab.

#### Scenario: Navigate to routine tab
- **WHEN** routeToScreen is called
- **THEN** the app navigates to the tab

### Requirement: Deep link to routine tab
The PATH_TO_SCREEN_MAP SHALL map path 'routine' to RoutineMainScreen.

#### Scenario: Open via deep link
- **WHEN** deep link received
- **THEN** routine tab displayed
`,
        },
      ],
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('ADDED requirement "In-app routing to routine tab" to [[Feature: Ui]]');
    expect(changeNote.content).toContain('ADDED requirement "Deep link to routine tab" to [[Feature: Ui]]');
  });

  it('parses MODIFIED Requirements from delta specs', () => {
    const change = makeChange({
      deltaSpecs: [
        {
          capability: 'auth',
          content: `## MODIFIED Requirements

### Requirement: Region-agnostic routing
Routine routing SHALL work on iOS only. Android SHALL be blocked.

#### Scenario: iOS works
- **WHEN** on iOS
- **THEN** routing works
`,
        },
      ],
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('MODIFIED requirement "Region-agnostic routing" in [[Feature: Auth]]');
  });

  it('handles mixed ADDED and MODIFIED in one delta spec', () => {
    const change = makeChange({
      deltaSpecs: [
        {
          capability: 'ui',
          content: `## ADDED Requirements

### Requirement: New feature
The system SHALL do new thing.

## MODIFIED Requirements

### Requirement: Existing feature
Updated behavior.
`,
        },
      ],
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('ADDED requirement "New feature" to [[Feature: Ui]]');
    expect(changeNote.content).toContain('MODIFIED requirement "Existing feature" in [[Feature: Ui]]');
  });

  it('parses Korean/non-ASCII requirement names in delta specs', () => {
    const change = makeChange({
      deltaSpecs: [
        {
          capability: 'ui',
          content: `## ADDED Requirements

### Requirement: Catch 블록 에러를 Sentry로 전송
워치 동기화 catch 블록에서 발생하는 에러를 Sentry.captureException으로 전송 SHALL.

#### Scenario: HealthKit Authorization not determined 에러 발생
- **WHEN** HealthKit 권한 없이 syncWatchRecords 호출
- **THEN** Sentry에 error 이벤트 전송

### Requirement: HealthKit 쿼리 결과 0건 시 Sentry warning 전송
syncWatchRecords에서 HealthKit 쿼리 결과가 0건일 때 warning 전송 SHALL.

#### Scenario: 권한 거부로 빈 배열 반환
- **WHEN** 유저가 권한 거부
- **THEN** Sentry warning 전송
`,
        },
      ],
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('ADDED requirement "Catch 블록 에러를 Sentry로 전송" to [[Feature: Ui]]');
    expect(changeNote.content).toContain('ADDED requirement "HealthKit 쿼리 결과 0건 시 Sentry warning 전송" to [[Feature: Ui]]');
  });

  it('handles change with depends_on metadata', () => {
    const change = makeChange({
      metadata: {
        schema: 'spec-driven',
        created: '2025-06-15',
        dependsOn: ['add-theme-system'],
      },
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('[[add-theme-system]]');
  });

  it('formats archived change title without date prefix', () => {
    const change = makeChange({
      name: '2025-08-06-add-init-command',
      archived: true,
    });

    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('# Change: Add Init Command');
  });

  it('handles change with no proposal gracefully', () => {
    const change = makeChange({ proposal: null });

    // convertChange requires proposal to exist in the scan step,
    // but if somehow passed null, it should handle it
    const { changeNote } = convertChange(change, featureRefs, systemRefMap);
    expect(changeNote.content).toContain('type: change');
  });
});

describe('convertAllChanges', () => {
  it('converts multiple changes and collects results', () => {
    const changes: ScannedChange[] = [
      makeChange({ name: 'change-a' }),
      makeChange({ name: 'change-b' }),
    ];

    const featureRefs = new Map<string, string>();
    const systemRefMap = new Map<string, string>();
    const { results, warnings } = convertAllChanges(changes, featureRefs, systemRefMap);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
