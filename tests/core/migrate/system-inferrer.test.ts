import { describe, it, expect } from 'vitest';
import {
  inferSystems,
  buildSystemRefMap,
  buildFeatureRefMap,
  convertSystems,
} from '../../../src/core/migrate/system-inferrer.js';
import type { ScannedSpec } from '../../../src/core/migrate/types.js';

function makeSpec(capability: string): ScannedSpec {
  return {
    capability,
    specPath: `specs/${capability}/spec.md`,
    content: `# ${capability} Spec\n\n## Requirements\n`,
  };
}

describe('inferSystems', () => {
  it('groups cli- prefixed specs into CLI system', () => {
    const specs = [makeSpec('cli-init'), makeSpec('cli-update'), makeSpec('cli-show')];
    const systems = inferSystems(specs);

    expect(systems).toHaveLength(1);
    expect(systems[0].id).toBe('cli');
    expect(systems[0].title).toBe('CLI');
    expect(systems[0].capabilities).toEqual(['cli-init', 'cli-update', 'cli-show']);
  });

  it('groups opsx- prefixed specs into OPSX system', () => {
    const specs = [makeSpec('opsx-archive-skill'), makeSpec('opsx-verify-skill')];
    const systems = inferSystems(specs);

    expect(systems).toHaveLength(1);
    expect(systems[0].id).toBe('opsx');
  });

  it('groups schema- prefixed specs into Schema system', () => {
    const specs = [makeSpec('schema-init-command'), makeSpec('schema-validate-command')];
    const systems = inferSystems(specs);

    expect(systems).toHaveLength(1);
    expect(systems[0].id).toBe('schema');
  });

  it('places unmatched specs into Core system', () => {
    const specs = [makeSpec('auth'), makeSpec('telemetry')];
    const systems = inferSystems(specs);

    expect(systems).toHaveLength(1);
    expect(systems[0].id).toBe('core');
    expect(systems[0].title).toBe('Core');
    expect(systems[0].capabilities).toEqual(['auth', 'telemetry']);
  });

  it('creates multiple systems from mixed specs', () => {
    const specs = [
      makeSpec('cli-init'),
      makeSpec('cli-update'),
      makeSpec('auth'),
      makeSpec('opsx-verify-skill'),
      makeSpec('telemetry'),
    ];

    const systems = inferSystems(specs);
    const ids = systems.map(s => s.id).sort();
    expect(ids).toEqual(['cli', 'core', 'opsx']);
  });

  it('returns empty array for no specs', () => {
    expect(inferSystems([])).toEqual([]);
  });
});

describe('buildSystemRefMap', () => {
  it('maps capabilities to system wikilink refs', () => {
    const systems = inferSystems([makeSpec('cli-init'), makeSpec('auth')]);
    const map = buildSystemRefMap(systems);

    expect(map.get('cli-init')).toBe('[[System: CLI]]');
    expect(map.get('auth')).toBe('[[System: Core]]');
  });
});

describe('buildFeatureRefMap', () => {
  it('maps capabilities to feature wikilink refs', () => {
    const map = buildFeatureRefMap(['auth', 'cli-init']);
    expect(map.get('auth')).toBe('[[Feature: Auth]]');
    expect(map.get('cli-init')).toBe('[[Feature: Cli Init]]');
  });
});

describe('convertSystems', () => {
  it('generates System note ConversionResults', () => {
    const systems = inferSystems([makeSpec('cli-init'), makeSpec('cli-update')]);
    const results = convertSystems(systems);

    expect(results).toHaveLength(1);
    expect(results[0].targetPath).toContain('02-systems');
    expect(results[0].targetPath).toContain('cli.md');
    expect(results[0].content).toContain('type: system');
    expect(results[0].content).toContain('id: cli');
    expect(results[0].content).toContain('[[Feature: Cli Init]]');
    expect(results[0].content).toContain('[[Feature: Cli Update]]');
    expect(results[0].content).toContain('migrated');
  });
});
