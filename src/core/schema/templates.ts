import type { NoteType } from './base.schema.js';

/**
 * Scaffolding functions for creating new notes with proper structure.
 * Used by init and workflow commands.
 */

/**
 * Escape a value for inclusion in a YAML double-quoted string.
 * Handles backslashes and embedded double quotes to prevent injection.
 */
function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function scaffoldFeature(id: string, title: string, systemRef: string): string {
  const safeId = escapeYamlString(id);
  const safeSystemRef = escapeYamlString(systemRef);
  return `---
type: feature
id: ${safeId}
status: active
systems:
  - "[[${safeSystemRef}]]"
sources: []
decisions: []
changes: []
tags:
  - feature
---

# Feature: ${title}

## Purpose

<!-- Why this feature exists and what value it provides -->

## Current Behavior

<!-- How the system currently works for this feature -->

## Constraints

<!-- Technical or business constraints that bound this feature -->

## Known Gaps

<!-- Known limitations or areas that need attention -->

## Requirements

### Requirement: <Requirement Name>
The system SHALL <normative statement>.

#### Scenario: <Scenario description>
- WHEN <condition>
- THEN <expected outcome>

## Change Log

| Date | Change | Summary |
|------|--------|---------|

## Related Notes
`;
}

export function scaffoldChange(
  id: string,
  title: string,
  featureRef: string,
  systemRef: string,
  createdAt: string,
): string {
  const safeFeatureRef = escapeYamlString(featureRef);
  const safeSystemRef = escapeYamlString(systemRef);
  const safeCreatedAt = escapeYamlString(createdAt);
  const safeId = escapeYamlString(id);
  return `---
type: change
id: ${safeId}
status: proposed
created_at: "${safeCreatedAt}"
feature: "[[${safeFeatureRef}]]"
depends_on: []
touches:
  - "[[${safeFeatureRef}]]"
systems:
  - "[[${safeSystemRef}]]"
sources: []
decisions: []
tags:
  - change
---

# Change: ${title}

## Why

<!-- Why this change is needed. Minimum 50 characters. -->

## Delta Summary
- ADDED requirement "<name>" to [[${featureRef}]] [base: n/a]

## Proposed Update

<!-- 1-3 sentence description of what this change does and how -->

## Design Approach

<!-- Ephemeral technical design for this change. -->

## Impact

<!-- What parts of the system are affected -->

## Tasks
- [ ] <first task>

## Validation

<!-- How to verify this change is correct after implementation -->

## Status Notes

<!-- Optional operational log. -->
`;
}

export function scaffoldSystem(id: string, title: string): string {
  return `---
type: system
id: ${id}
status: active
tags:
  - system
---

# System: ${title}

## Overview

<!-- What this system does at a high level -->

## Boundaries

<!-- What is inside this system and what is outside -->

## Key Components

<!-- Major internal parts and their roles -->

## Interfaces

<!-- How other systems interact with this one -->

## Related Notes
`;
}

export function scaffoldDecision(id: string, title: string): string {
  return `---
type: decision
id: ${id}
status: active
features: []
changes: []
tags:
  - decision
---

# Decision: ${title}

## Context

<!-- What situation prompted this decision -->

## Options Considered

<!-- Alternatives that were evaluated, with pros/cons -->

## Decision

<!-- What was decided and the primary rationale -->

## Consequences

<!-- Implications, trade-offs, and follow-up actions -->

## Related Notes
`;
}

export function scaffoldSource(id: string, title: string): string {
  return `---
type: source
id: ${id}
status: active
source_type: other
tags:
  - source
---

# Source: ${title}

## Summary

<!-- What this source document says -->

## Key Points

<!-- Extracted insights relevant to the project -->

## Related Notes
`;
}

export function scaffoldQuery(id: string, title: string): string {
  return `---
type: query
id: ${id}
status: draft
tags:
  - query
---

# Query: ${title}

## Question

<!-- What was being investigated -->

## Findings

<!-- What was discovered -->

## Conclusion

<!-- Answer or recommended next steps -->

## Related Notes
`;
}

/** Registry mapping note type to scaffolding function */
export const SCAFFOLD_REGISTRY: Record<NoteType, (...args: string[]) => string> = {
  feature: scaffoldFeature,
  change: scaffoldChange,
  system: scaffoldSystem,
  decision: scaffoldDecision,
  source: scaffoldSource,
  query: scaffoldQuery,
};
