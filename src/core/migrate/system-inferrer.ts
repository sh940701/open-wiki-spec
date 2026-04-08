/**
 * Infers System notes from OpenSpec specs by grouping capabilities by domain.
 */
import * as path from 'node:path';
import type { ScannedSpec, ConversionResult } from './types.js';

/** Known domain prefixes and their system mapping */
const DOMAIN_PREFIXES: Array<{ prefix: string; system: string; title: string }> = [
  { prefix: 'cli-', system: 'cli', title: 'CLI' },
  { prefix: 'opsx-', system: 'opsx', title: 'OPSX Skills' },
  { prefix: 'schema-', system: 'schema', title: 'Schema' },
];

/** Default system for specs that don't match any domain prefix */
const DEFAULT_SYSTEM = 'core';
const DEFAULT_SYSTEM_TITLE = 'Core';

export interface InferredSystem {
  id: string;
  title: string;
  capabilities: string[];
}

/**
 * Infer systems from a list of specs by grouping capabilities by domain prefix.
 */
export function inferSystems(specs: ScannedSpec[]): InferredSystem[] {
  const systemMap = new Map<string, InferredSystem>();

  for (const spec of specs) {
    const { id, title } = resolveSystem(spec.capability);

    let system = systemMap.get(id);
    if (!system) {
      system = { id, title, capabilities: [] };
      systemMap.set(id, system);
    }
    system.capabilities.push(spec.capability);
  }

  return Array.from(systemMap.values());
}

/**
 * Build a mapping from capability name to system wikilink ref.
 */
export function buildSystemRefMap(systems: InferredSystem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const system of systems) {
    const ref = `[[System: ${system.title}]]`;
    for (const cap of system.capabilities) {
      map.set(cap, ref);
    }
  }
  return map;
}

/**
 * Build a mapping from capability name to feature wikilink ref.
 */
export function buildFeatureRefMap(capabilities: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const cap of capabilities) {
    // Build ref using the Feature note title format (matches H1 from spec-converter)
    const title = cap
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    map.set(cap, `[[Feature: ${title}]]`);
  }
  return map;
}

/**
 * Convert inferred systems into System note ConversionResults.
 */
export function convertSystems(systems: InferredSystem[]): ConversionResult[] {
  return systems.map(system => ({
    targetPath: path.join('wiki', '02-systems', `${system.id}.md`),
    content: buildSystemNote(system),
    sourceDescription: `Inferred from ${system.capabilities.length} capabilities`,
  }));
}

function buildSystemNote(system: InferredSystem): string {
  const capList = system.capabilities.map(c => {
    const title = c
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return `- [[Feature: ${title}]]`;
  }).join('\n');

  return `---
type: system
id: ${system.id}
status: active
tags:
  - system
  - migrated
---

# System: ${system.title}

## Overview

System inferred from OpenSpec capabilities during migration.

## Boundaries

Encompasses the following capabilities:
${capList}

## Key Components

<!-- Populated from migrated specs -->

## Interfaces

<!-- Define how other systems interact with this one -->

## Related Notes
`;
}

/**
 * Resolve which system a capability belongs to based on its name prefix.
 */
function resolveSystem(capability: string): { id: string; title: string } {
  for (const domain of DOMAIN_PREFIXES) {
    if (capability.startsWith(domain.prefix)) {
      return { id: domain.system, title: domain.title };
    }
  }
  return { id: DEFAULT_SYSTEM, title: DEFAULT_SYSTEM_TITLE };
}
