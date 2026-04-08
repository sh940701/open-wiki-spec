import { describe, it, expect } from 'vitest';
import { convertSpec, convertAllSpecs } from '../../../src/core/migrate/spec-converter.js';
import type { ScannedSpec } from '../../../src/core/migrate/types.js';

describe('convertSpec', () => {
  it('converts a basic spec to a Feature note', () => {
    const spec: ScannedSpec = {
      capability: 'auth-login',
      specPath: 'specs/auth-login/spec.md',
      content: `# Auth Login Specification

## Purpose

The auth login module handles user authentication.

## Requirements

### Requirement: User Authentication
The system SHALL issue a JWT token upon successful login.

#### Scenario: Valid credentials
- WHEN the user submits valid credentials
- THEN a JWT token is returned
`,
    };

    const result = convertSpec(spec, '[[cli]]');

    expect(result.targetPath).toContain('03-features');
    expect(result.targetPath).toContain('auth-login.md');
    expect(result.content).toContain('type: feature');
    expect(result.content).toContain('id: auth-login');
    expect(result.content).toContain('status: active');
    expect(result.content).toContain('"[[cli]]"');
    expect(result.content).toContain('# Feature: Auth Login');
    expect(result.content).toContain('auth login module handles user authentication');
    expect(result.content).toContain('Requirement: User Authentication');
    expect(result.content).toContain('JWT token');
    expect(result.content).toContain('migrated');
  });

  it('handles spec with no Purpose section', () => {
    const spec: ScannedSpec = {
      capability: 'no-purpose',
      specPath: 'specs/no-purpose/spec.md',
      content: `# Some Spec

## Requirements

### Requirement: Something
The system SHALL do something.
`,
    };

    const result = convertSpec(spec, '[[core]]');
    expect(result.content).toContain('<!-- Migrated from OpenSpec - purpose not specified -->');
  });

  it('preserves requirements block structure', () => {
    const spec: ScannedSpec = {
      capability: 'multi-req',
      specPath: 'specs/multi-req/spec.md',
      content: `# Multi Requirement Spec

## Purpose

Testing multi-requirement conversion.

## Requirements

### Requirement: First
The system SHALL do first.

#### Scenario: First scenario
- WHEN condition
- THEN outcome

### Requirement: Second
The system MUST do second.

#### Scenario: Second scenario
- WHEN other condition
- THEN other outcome

## Why

Some trailing section.
`,
    };

    const result = convertSpec(spec, '[[core]]');
    expect(result.content).toContain('Requirement: First');
    expect(result.content).toContain('Requirement: Second');
    expect(result.content).toContain('Scenario: First scenario');
    expect(result.content).toContain('Scenario: Second scenario');
  });

  it('handles spec without H1 heading (real-world format)', () => {
    const spec: ScannedSpec = {
      capability: 'routine-routing',
      specPath: 'specs/routine-routing/spec.md',
      content: `## Purpose

루틴 화면에 대한 인앱 라우팅, 딥링크, 푸시 알림 라우팅을 정의한다.

## Requirements

### Requirement: In-app routing to routine tab
The system SHALL support programmatic navigation to the RoutineMainScreen tab.

#### Scenario: Navigate to routine tab via inAppRouter
- **WHEN** routeToScreen('RoutineMainScreen') is called
- **THEN** the app navigates to MainTabScreen with the RoutineMainScreen tab selected

### Requirement: Deep link to routine tab
The PATH_TO_SCREEN_MAP SHALL map path 'routine' to 'RoutineMainScreen'.

#### Scenario: Open routine tab via deep link
- **WHEN** the app receives deep link syeong://routine
- **THEN** the routine tab is displayed
`,
    };

    const result = convertSpec(spec, '[[core]]');
    expect(result.content).toContain('# Feature: Routine Routing');
    expect(result.content).toContain('인앱 라우팅');
    expect(result.content).toContain('Requirement: In-app routing to routine tab');
    expect(result.content).toContain('Requirement: Deep link to routine tab');
    expect(result.content).toContain('Scenario: Navigate to routine tab');
  });

  it('formats kebab-case titles correctly', () => {
    const spec: ScannedSpec = {
      capability: 'cli-init-command',
      specPath: 'specs/cli-init-command/spec.md',
      content: '# CLI Init\n\n## Requirements\n',
    };

    const result = convertSpec(spec, '[[cli]]');
    expect(result.content).toContain('# Feature: Cli Init Command');
  });
});

describe('convertAllSpecs', () => {
  it('converts multiple specs and collects warnings', () => {
    const specs: ScannedSpec[] = [
      {
        capability: 'auth',
        specPath: 'specs/auth/spec.md',
        content: '# Auth\n\n## Purpose\nAuth stuff.\n\n## Requirements\n',
      },
      {
        capability: 'payments',
        specPath: 'specs/payments/spec.md',
        content: '# Payments\n\n## Purpose\nPayment stuff.\n\n## Requirements\n',
      },
    ];

    const systemRefs = new Map<string, string>([
      ['auth', '[[core]]'],
      ['payments', '[[core]]'],
    ]);

    const { results, warnings } = convertAllSpecs(specs, systemRefs);
    expect(results).toHaveLength(2);
    expect(warnings).toHaveLength(0);
    expect(results[0].targetPath).toContain('auth.md');
    expect(results[1].targetPath).toContain('payments.md');
  });

  it('uses default-system when no ref is found', () => {
    const specs: ScannedSpec[] = [
      {
        capability: 'unknown',
        specPath: 'specs/unknown/spec.md',
        content: '# Unknown\n\n## Requirements\n',
      },
    ];

    const { results } = convertAllSpecs(specs, new Map());
    expect(results[0].content).toContain('default-system');
  });
});
