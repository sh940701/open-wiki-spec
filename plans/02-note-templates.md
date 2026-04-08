# Note Templates Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec has two primary document types, not six:

1. **Spec** (`openspec/specs/<domain>/spec.md`): Markdown with `## Purpose` and `## Requirements` sections. Requirements use `### Requirement:` headings with `#### Scenario:` children. Validated by `SpecSchema` (Zod) requiring `name`, `overview` (Purpose), and `requirements[]`.

2. **Change** (`openspec/changes/<name>/`): A folder containing multiple files:
   - `proposal.md` -- `## Why` + `## What Changes` (simple deltas as bullet lists)
   - `design.md` -- Technical approach and architecture decisions
   - `tasks.md` -- Checkbox task list
   - `specs/<domain>/spec.md` -- Delta spec files with `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`
   - `.openspec.yaml` -- Metadata (schema name, created date)

OpenSpec has **no** frontmatter, **no** typed notes beyond spec/change, **no** wikilinks, **no** note IDs, and **no** status lifecycle in metadata.

### Key Source Files

| File | What It Defines |
|------|----------------|
| `src/core/schemas/base.schema.ts` | `RequirementSchema` (text with SHALL/MUST + scenarios[]), `ScenarioSchema` (rawText) |
| `src/core/schemas/spec.schema.ts` | `SpecSchema` (name, overview, requirements[], metadata) |
| `src/core/schemas/change.schema.ts` | `ChangeSchema` (name, why, whatChanges, deltas[]), `DeltaSchema` (spec, operation, description, requirement?, rename?) |
| `src/core/artifact-graph/types.ts` | `ArtifactSchema` (id, generates, template, requires[]), `SchemaYaml`, `ChangeMetadata` (schema, created) |
| `src/core/validation/constants.ts` | Validation thresholds: `MIN_WHY_SECTION_LENGTH=50`, `MAX_DELTAS_PER_CHANGE=10`, validation messages |

### Core Algorithm / Flow

OpenSpec's spec document model:

```
Spec
  ├── name: string
  ├── overview: string (from ## Purpose)
  ├── requirements: Requirement[]
  │     ├── text: string (must contain SHALL or MUST)
  │     └── scenarios: Scenario[]
  │           └── rawText: string
  └── metadata: { version, format: "openspec" }

Change
  ├── name: string
  ├── why: string (min 50, max 1000 chars)
  ├── whatChanges: string
  ├── deltas: Delta[]
  │     ├── spec: string (target spec name)
  │     ├── operation: "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED"
  │     ├── description: string
  │     ├── requirement?: Requirement
  │     └── rename?: { from, to }
  └── metadata: { version, format: "openspec-change" }
```

Validation:
- Requirements must contain `SHALL` or `MUST`
- Requirements must have at least 1 scenario
- Changes must have at least 1 delta, max 10
- Why section must be 50-1000 characters

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

- **Section 13.2**: 6 note types: Feature, Change, System, Decision, Source, Query
- **Section 14.1**: Feature = canonical spec with machine-verifiable Requirements (composite key identity)
- **Section 14.2**: Change = proposal + delta summary + tasks + status with structured grammar
- **Section 14.3**: Decision, System, Source also have minimum contracts
- **Section 13.3**: Folder structure: `wiki/00-meta/`, `01-sources/`, `02-systems/`, `03-features/`, `04-changes/`, `05-decisions/`, `06-queries/`, `99-archive/`
- **Section 11.1**: Canonical identity is frontmatter `id` (immutable after creation)
- **Section 10.3**: Index record shape with requirements[], delta_summary[], tasks[]
- **Section 15**: Status lifecycle: `proposed -> planned -> in_progress -> applied`
- **Section 10.1.1**: Schema version managed in `wiki/00-meta/schema.md`

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec | Why |
|--------|---------|----------------|-----|
| Note types | 2 (Spec, Change) | 6 (Feature, Change, System, Decision, Source, Query) | Richer knowledge graph |
| Identity | Filesystem path | Frontmatter `id` (immutable) | Survives rename/move |
| Metadata | `.openspec.yaml` file or none | YAML frontmatter in every note | Obsidian-native, typed |
| Spec format | `## Purpose` + `## Requirements` | Full frontmatter + 5 minimum sections + Requirements | More metadata, same rigor |
| Change format | Folder with separate files (proposal.md, design.md, tasks.md, specs/) | Single note with all sections inline | Less fragmentation |
| Delta format | Separate spec files under `specs/` directory | `## Delta Summary` section with structured grammar lines | Inline, machine-readable |
| Status | None (implied by folder: changes/ vs archive/) | Explicit frontmatter `status` with lifecycle | Queryable, graph-friendly |
| Requirements | `text` field with SHALL/MUST | `### Requirement: <name>` with composite key identity | Named, traceable |
| Decision tracking | Mixed into `design.md` | Separate `Decision` note type with durable lifetime | Long-lived rationale |
| Relationships | Implicit (filesystem proximity) | Explicit wikilinks in frontmatter (`systems`, `sources`, `decisions`, `changes`) | Graph traversal |
| Content fingerprint | None | `content_hash` on requirements for stale-change detection | Conflict safety |

### Contracts to Satisfy

From overview.md, the following contracts are binding for note templates:

1. **Requirement identity** (14.1): Composite key `feature_id + "::" + requirement_name`
2. **Requirement format** (14.1): `SHALL`/`MUST` in normative statement, at least 1 `WHEN`/`THEN` scenario per requirement
3. **Delta Summary grammar** (14.2): `- (ADDED|MODIFIED|REMOVED) requirement "<name>" (to|in|from) [[<Feature>]]`, `- RENAMED requirement "<old>" to "<new>" in [[<Feature>]]`
4. **Base fingerprint** (14.2): `MODIFIED`/`REMOVED`/`RENAMED` entries carry `[base: <content_hash>]`; `ADDED` carries `[base: n/a]`
5. **Atomic apply order** (14.2): `RENAMED` -> `REMOVED` -> `MODIFIED` -> `ADDED`
6. **Section-completeness contract** (15): Hard prerequisites for `proposed -> planned`: non-empty Why, at least 1 Delta Summary entry, at least 1 Task, non-empty Validation
7. **Design Approach** (14.2): Ephemeral per-change section; durable rationale goes in Decision note. No content duplication.
8. **Decision promotion criteria** (14.2): Promote when impacts multiple Features/Systems, hard to reverse, needs team consensus, or outlives the Change
9. **Status lifecycle** (15): `proposed -> planned -> in_progress -> applied`
10. **feature/features serialization** (13.2): Singular `feature:` for scalar, plural `features:` for array. Never mix.
11. **touches vs depends_on** (14.2): `touches` = impact surface for conflict detection; `depends_on` = prerequisite ordering
12. **Status Notes** (14.2): Completely optional, no gate conditions
13. **Schema version** (10.1.1): Tracked in `wiki/00-meta/schema.md` (format defined in 01-project-structure.md). Schema version lives in this file, NOT in individual note frontmatter.
14. **Minimum section contract** (14.3): Every note type has required minimum sections
15. **`created_at` required for Change** (10.5.1): Deterministic ordering uses `(created_at, change_id)` tuple. The `created_at` field is required in Change frontmatter (ISO date YYYY-MM-DD).

---

## 3. Implementation Plan

### Architecture Overview

Note templates are implemented as two complementary layers:

1. **Zod schemas** (`src/core/schema/`): Define and validate the frontmatter contract and structural requirements for each note type
2. **Markdown templates**: Reference documents that define the minimum sections for each note type (used by `init` and workflow commands when creating notes)

The schemas are the source of truth for validation. The templates are the source of truth for note creation. Both must agree on structure.

### Data Structures

#### Base Frontmatter Schema

```typescript
// src/core/schema/base.schema.ts

import { z } from 'zod';

export const NoteTypeEnum = z.enum([
  'feature', 'change', 'system', 'decision', 'source', 'query'
]);
export type NoteType = z.infer<typeof NoteTypeEnum>;

/**
 * Status values follow 00-unified-types.md:
 *   ChangeStatus = 'proposed' | 'planned' | 'in_progress' | 'applied'
 *   FeatureStatus = 'active' | 'deprecated'
 *   GeneralStatus = 'active' | 'draft' | 'archived'
 *
 * NoteStatusEnum is the union of all possible status values.
 * Each note type schema further constrains this to its allowed subset.
 */
export const NoteStatusEnum = z.enum([
  'active',      // Feature, System, Decision, Source, Query
  'deprecated',  // Feature only
  'draft',       // General (System, Decision, Source, Query)
  'archived',    // General (System, Decision, Source, Query)
  'proposed',    // Change only
  'planned',     // Change only
  'in_progress', // Change only
  'applied',     // Change only
]);

export const ChangeStatusEnum = z.enum(['proposed', 'planned', 'in_progress', 'applied']);
export const FeatureStatusEnum = z.enum(['active', 'deprecated']);
export const GeneralStatusEnum = z.enum(['active', 'draft', 'archived']);

/** Reusable wikilink reference validator. Defined once, imported by all note schemas. */
export const WikilinkRef = z.string().regex(/^\[\[.+\]\]$/, 'Must be a wikilink [[...]]');

/**
 * Every note must have at least these fields (follows 00-unified-types.md BaseFrontmatter).
 * Note: `aliases` is NOT in BaseFrontmatter per unified types. It is handled at
 * the IndexRecord level (from parsed frontmatter extra fields) rather than as a
 * schema-enforced field.
 */
export const BaseFrontmatterSchema = z.object({
  type: NoteTypeEnum,
  id: z.string()
    .min(1, 'id is required')
    .regex(/^[a-z0-9-]+$/, 'id must be lowercase alphanumeric with hyphens'),
  status: NoteStatusEnum,
  tags: z.array(z.string()).default([]),
}).passthrough();  // allow extra fields like aliases to pass through

export type BaseFrontmatter = z.infer<typeof BaseFrontmatterSchema>;
```

#### Feature Schema

```typescript
// src/core/schema/feature.schema.ts

import { z } from 'zod';
import { BaseFrontmatterSchema, WikilinkRef } from './base.schema.js';

/**
 * Follows 00-unified-types.md FeatureFrontmatter:
 * - status: FeatureStatus (active | deprecated)
 * - systems, sources, decisions, changes: all required string[] (default [])
 */
export const FeatureFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('feature'),
  status: FeatureStatusEnum,
  systems: z.array(WikilinkRef).min(1, 'Feature must reference at least one System'),
  sources: z.array(WikilinkRef).default([]),
  decisions: z.array(WikilinkRef).default([]),
  changes: z.array(WikilinkRef).default([]),
});

export type FeatureFrontmatter = z.infer<typeof FeatureFrontmatterSchema>;

/**
 * Feature minimum section contract:
 * - # Feature: <title>           (H1, required)
 * - ## Purpose                    (required, non-empty)
 * - ## Current Behavior           (required)
 * - ## Constraints                (required)
 * - ## Known Gaps                 (required)
 * - ## Requirements               (required, must contain at least 1 requirement block)
 * - ## Related Notes              (optional)
 *
 * Each requirement block:
 * - ### Requirement: <name>       (name unique within Feature)
 * - Normative statement with SHALL or MUST
 * - #### Scenario: <description>  (at least 1 per requirement)
 *   - WHEN/THEN format
 */
export const FEATURE_REQUIRED_SECTIONS = [
  'Purpose',
  'Current Behavior',
  'Constraints',
  'Known Gaps',
  'Requirements',
] as const;

export const FEATURE_OPTIONAL_SECTIONS = [
  'Related Notes',
] as const;
```

#### Change Schema

```typescript
// src/core/schema/change.schema.ts

import { z } from 'zod';
import { BaseFrontmatterSchema, WikilinkRef } from './base.schema.js';

/**
 * Change frontmatter (follows 00-unified-types.md ChangeFrontmatter).
 *
 * Key serialization rules from overview 13.2:
 * - Single-feature change: `feature: "[[Feature: Auth Login]]"` (scalar)
 * - Multi-feature change: `features: ["[[Feature: Auth Login]]", ...]` (array)
 * - Never use both `feature:` and `features:` at the same time
 * - Never put an array under `feature:`
 * - Never put a scalar under `features:`
 */
export const ChangeFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('change'),
  status: ChangeStatusEnum,

  /** ISO date YYYY-MM-DD, required for deterministic ordering (overview 10.5.1) */
  created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'created_at must be ISO date YYYY-MM-DD'),

  // Single-feature (default) or multi-feature (exception)
  feature: WikilinkRef.optional(),
  features: z.array(WikilinkRef).min(2).optional(),

  depends_on: z.array(WikilinkRef).default([]),
  touches: z.array(WikilinkRef).default([]),
  systems: z.array(WikilinkRef).default([]),
  sources: z.array(WikilinkRef).default([]),
  decisions: z.array(WikilinkRef).default([]),
})
.refine(
  (data) => !!data.feature !== !!(data.features && data.features.length > 0),
  'Must have exactly one of feature (scalar) or features (array), not both and not neither'
);

export type ChangeFrontmatter = z.infer<typeof ChangeFrontmatterSchema>;

/**
 * Change minimum section contract:
 * - # Change: <title>             (H1, required)
 * - ## Why                        (required, non-empty, min 50 chars)
 * - ## Delta Summary              (required, at least 1 entry)
 * - ## Proposed Update            (required, 1-3 sentence what/how)
 * - ## Design Approach            (soft prerequisite: warning if absent on complex changes)
 * - ## Impact                     (required)
 * - ## Tasks                      (required, at least 1 checkbox item)
 * - ## Validation                 (required, non-empty)
 * - ## Status Notes               (optional, no gate conditions)
 */
export const CHANGE_REQUIRED_SECTIONS = [
  'Why',
  'Delta Summary',
  'Proposed Update',
  'Impact',
  'Tasks',
  'Validation',
] as const;

export const CHANGE_SOFT_SECTIONS = [
  'Design Approach',
] as const;

export const CHANGE_OPTIONAL_SECTIONS = [
  'Status Notes',
] as const;

/** Status transitions allowed for Change notes */
export const CHANGE_STATUS_TRANSITIONS: Record<string, string[]> = {
  proposed: ['planned'],
  planned: ['in_progress'],
  in_progress: ['applied'],
  applied: [], // terminal state (archival is a move, not a status change)
};

/**
 * Hard prerequisites for proposed -> planned transition (overview 15):
 * 1. Why is non-empty
 * 2. Delta Summary has at least 1 entry
 * 3. Tasks has at least 1 item
 * 4. Validation is non-empty
 */
export const PLANNED_HARD_PREREQUISITES = [
  'Why',
  'Delta Summary',
  'Tasks',
  'Validation',
] as const;

/**
 * Soft prerequisites for proposed -> planned (warning only):
 * 5. Design Approach exists (or explicit N/A)
 * 6. At least 1 Decision link (when significant tech decision involved)
 */
export const PLANNED_SOFT_PREREQUISITES = [
  'Design Approach',
] as const;
```

#### Delta Summary Grammar

The Delta Summary is a structured section within a Change note. Each line follows a strict grammar:

```typescript
// src/core/schema/delta-summary.ts

/**
 * Delta Summary Grammar (overview 14.2):
 *
 * Requirement operations:
 *   - ADDED requirement "<name>" to [[<Feature>]] [base: n/a]
 *   - MODIFIED requirement "<name>" in [[<Feature>]] [base: <hash>]
 *   - REMOVED requirement "<name>" from [[<Feature>]] [base: <hash>]
 *   - RENAMED requirement "<old>" to "<new>" in [[<Feature>]] [base: <hash>]
 *
 * Section operations:
 *   - ADDED section "<name>" in [[<note>]]
 *   - MODIFIED section "<name>" in [[<note>]]
 *   - REMOVED section "<name>" from [[<note>]]
 *
 * MODIFIED/REMOVED/RENAMED entries must include [base: <content_hash>].
 * ADDED entries use [base: n/a].
 */

import { z } from 'zod';

export const DeltaOpEnum = z.enum(['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']);
export type DeltaOp = z.infer<typeof DeltaOpEnum>;

export const DeltaTargetTypeEnum = z.enum(['requirement', 'section']);
export type DeltaTargetType = z.infer<typeof DeltaTargetTypeEnum>;

/**
 * DeltaSummaryEntry follows 00-unified-types.md DeltaSummaryEntry shape.
 * Field names: target_note_id (not feature), new_name (not rename_to).
 */
export const DeltaSummaryEntrySchema = z.object({
  op: DeltaOpEnum,
  target_type: DeltaTargetTypeEnum,
  /** Name of the requirement or section */
  target_name: z.string().min(1),
  /** For RENAMED: the new name */
  new_name: z.string().optional(),
  /** Wikilink-resolved feature/note id */
  target_note_id: z.string().min(1),
  /** SHA-256 hash of the target at time of writing. null for ADDED. */
  base_fingerprint: z.string().nullable(),
  /** Free-text description of the change */
  description: z.string().optional().default(''),
});

export type DeltaSummaryEntry = z.infer<typeof DeltaSummaryEntrySchema>;

/**
 * Atomic apply order (overview 14.2):
 * 1. RENAMED -- name changes first so subsequent ops use new names
 * 2. REMOVED
 * 3. MODIFIED
 * 4. ADDED
 */
export const DELTA_APPLY_ORDER: DeltaOp[] = ['RENAMED', 'REMOVED', 'MODIFIED', 'ADDED'];

/**
 * Regex patterns for parsing Delta Summary lines.
 *
 * Examples:
 *   - ADDED requirement "Passkey Authentication" to [[Feature: Auth Login]] [base: n/a]
 *   - MODIFIED requirement "Password Login" in [[Feature: Auth Login]] [base: sha256:def456...]
 *   - REMOVED requirement "Remember Me" from [[Feature: Auth Login]] [base: sha256:abc123...]
 *   - RENAMED requirement "Login Auth" to "Password Login" in [[Feature: Auth Login]] [base: sha256:789abc...]
 *   - MODIFIED section "Current Behavior" in [[Feature: Auth Login]]
 */
export const DELTA_REQUIREMENT_PATTERN =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*([^\]]+)\])?$/;

export const DELTA_RENAMED_PATTERN =
  /^-\s+RENAMED\s+requirement\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*([^\]]+)\])?$/;

export const DELTA_SECTION_PATTERN =
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+section\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\]$/;
```

#### Requirement Record

```typescript
// src/core/schema/requirement.ts

/**
 * Requirement identity and validation (overview 14.1):
 *
 * - Name comes from: ### Requirement: <name>
 * - <name> is unique within its parent Feature
 * - Canonical identity: feature_id + "::" + requirement_name (composite key)
 * - Normative statement must contain SHALL or MUST
 * - At least 1 scenario per requirement
 * - Each scenario uses WHEN/THEN format
 * - content_hash = SHA-256 of normalized (normative + all scenarios concatenated)
 */

import { z } from 'zod';

/**
 * Follows 00-unified-types.md Requirement shape.
 * - Identifier field is `name` (not `title`).
 * - `scenarios` is `Scenario[]` (structured objects, not plain strings).
 */

export const ScenarioSchema = z.object({
  /** Name from `#### Scenario: <name>` header */
  name: z.string().min(1),
  /** Raw text of the scenario (WHEN/THEN lines) */
  raw_text: z.string().min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export const RequirementSchema = z.object({
  /** Stable name from `### Requirement: <name>` header */
  name: z.string().min(1),
  /** Composite key: `${feature_id}::${name}` */
  key: z.string().min(1),
  /** The normative statement containing SHALL or MUST */
  normative: z.string()
    .min(1, 'Normative statement is required')
    .refine(
      (text) => text.includes('SHALL') || text.includes('MUST'),
      'Normative statement must contain SHALL or MUST'
    ),
  /** Array of scenario objects */
  scenarios: z.array(ScenarioSchema)
    .min(1, 'At least one scenario is required'),
  /** SHA-256 of normalized content (for fingerprinting / stale detection) */
  content_hash: z.string(),
});

export type Requirement = z.infer<typeof RequirementSchema>;
```

#### System Schema

```typescript
// src/core/schema/system.schema.ts

import { z } from 'zod';
import { BaseFrontmatterSchema, WikilinkRef } from './base.schema.js';

/**
 * Follows 00-unified-types.md SystemFrontmatter:
 * - status: GeneralStatus (active | draft | archived)
 */
export const SystemFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('system'),
  status: GeneralStatusEnum,
});

export type SystemFrontmatter = z.infer<typeof SystemFrontmatterSchema>;

/**
 * System minimum section contract:
 * - # System: <title>            (H1, required)
 * - ## Overview                  (required, non-empty)
 * - ## Boundaries                (required -- what is inside/outside this system)
 * - ## Key Components            (required -- major internal parts)
 * - ## Interfaces                (required -- how other systems interact with this one)
 * - ## Related Notes             (optional)
 */
export const SYSTEM_REQUIRED_SECTIONS = [
  'Overview',
  'Boundaries',
  'Key Components',
  'Interfaces',
] as const;
```

#### Decision Schema

```typescript
// src/core/schema/decision.schema.ts

import { z } from 'zod';
import { BaseFrontmatterSchema, WikilinkRef } from './base.schema.js';

/**
 * Follows 00-unified-types.md DecisionFrontmatter:
 * - status: GeneralStatus (active | draft | archived)
 * - features and changes are required string[]
 */
export const DecisionFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('decision'),
  status: GeneralStatusEnum,
  features: z.array(WikilinkRef).default([]),
  changes: z.array(WikilinkRef).default([]),
});

export type DecisionFrontmatter = z.infer<typeof DecisionFrontmatterSchema>;

/**
 * Decision minimum section contract:
 * - # Decision: <title>           (H1, required)
 * - ## Context                    (required -- what situation prompted this decision)
 * - ## Options Considered         (required -- alternatives evaluated)
 * - ## Decision                   (required -- what was decided and why)
 * - ## Consequences               (required -- implications, trade-offs)
 * - ## Related Notes              (optional)
 *
 * Decision promotion criteria (overview 14.2):
 * - Impacts multiple Features or Systems
 * - Hard to reverse or high migration cost
 * - Needs team consensus or ADR-level review
 * - Contains rationale that should outlive the Change
 *
 * NOTE: `superseded_by` is not a schema-level field. When status is 'archived',
 * the superseding decision can be referenced via a wikilink in the body text.
 */
export const DECISION_REQUIRED_SECTIONS = [
  'Context',
  'Options Considered',
  'Decision',
  'Consequences',
] as const;
```

#### Source Schema

```typescript
// src/core/schema/source.schema.ts

import { z } from 'zod';
import { BaseFrontmatterSchema, WikilinkRef } from './base.schema.js';

/**
 * Follows 00-unified-types.md SourceFrontmatter:
 * - status: GeneralStatus (active | draft | archived)
 * - source_type and url are plan-level additions (not in unified types)
 */
export const SourceFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('source'),
  status: GeneralStatusEnum,
  /** Plan-level addition: categorizes the source. Not mandated by overview.md. */
  source_type: z.enum([
    'prd',           // Product Requirements Document
    'issue',         // GitHub issue, Linear ticket, etc.
    'meeting',       // Meeting notes
    'code_reading',  // Code analysis notes
    'research',      // External research, articles
    'other',
  ]).optional(),
  /** Plan-level addition: External URL if applicable. */
  url: z.string().url().optional(),
});

export type SourceFrontmatter = z.infer<typeof SourceFrontmatterSchema>;

/**
 * Source minimum section contract:
 * - # Source: <title>             (H1, required)
 * - ## Summary                    (required -- what this source says)
 * - ## Key Points                 (required -- extracted insights)
 * - ## Related Notes              (optional)
 */
export const SOURCE_REQUIRED_SECTIONS = [
  'Summary',
  'Key Points',
] as const;
```

#### Query Schema

```typescript
// src/core/schema/query.schema.ts

import { z } from 'zod';
import { BaseFrontmatterSchema, WikilinkRef } from './base.schema.js';

/**
 * Follows 00-unified-types.md QueryFrontmatter:
 * - status: GeneralStatus (active | draft | archived)
 * - question is a plan-level addition (not in unified types, but in overview.md)
 */
export const QueryFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('query'),
  status: GeneralStatusEnum,
  /**
   * Plan-level addition: the question being investigated.
   * The authoritative question text lives in the ## Question body section.
   * This frontmatter field is a convenience for quick display/search.
   */
  question: z.string().min(1, 'Query must state its question').optional(),
});

export type QueryFrontmatter = z.infer<typeof QueryFrontmatterSchema>;

/**
 * Query minimum section contract:
 * - # Query: <title>              (H1, required)
 * - ## Question                   (required -- what was being investigated)
 * - ## Findings                   (required -- what was discovered)
 * - ## Conclusion                 (required -- answer or next steps)
 * - ## Related Notes              (optional)
 */
export const QUERY_REQUIRED_SECTIONS = [
  'Question',
  'Findings',
  'Conclusion',
] as const;
```

### Complete Note Templates (Markdown)

These are the reference templates used when creating notes via `init` or workflow commands.

#### Feature Template

```markdown
---
type: feature
id: feature-<slug>
status: active
systems:
  - "[[System: <system-name>]]"
sources: []
decisions: []
changes: []
tags:
  - feature
aliases: []
---

# Feature: <Title>

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

## Related Notes
```

#### Change Template

```markdown
---
type: change
id: change-<slug>
status: proposed
created_at: "YYYY-MM-DD"
feature: "[[Feature: <target-feature>]]"
depends_on: []
touches:
  - "[[Feature: <target-feature>]]"
systems:
  - "[[System: <related-system>]]"
sources: []
decisions: []
tags:
  - change
---

# Change: <Title>

## Why

<!-- Why this change is needed. Minimum 50 characters. -->

## Delta Summary
- ADDED requirement "<name>" to [[Feature: <target>]] [base: n/a]

## Proposed Update

<!-- 1-3 sentence description of what this change does and how -->

## Design Approach

<!-- Ephemeral technical design for this change.
     For durable rationale, create a Decision note and link it.
     Can be N/A for trivial changes. -->

## Impact

<!-- What parts of the system are affected -->

## Tasks
- [ ] <first task>

## Validation

<!-- How to verify this change is correct after implementation -->

## Status Notes

<!-- Optional operational log. Not part of any gate condition. -->
```

#### System Template

```markdown
---
type: system
id: system-<slug>
status: active
tags:
  - system
aliases: []
---

# System: <Title>

## Overview

<!-- What this system does at a high level -->

## Boundaries

<!-- What is inside this system and what is outside -->

## Key Components

<!-- Major internal parts and their roles -->

## Interfaces

<!-- How other systems interact with this one -->

## Related Notes
```

#### Decision Template

```markdown
---
type: decision
id: decision-<slug>
status: active
features: []
changes: []
tags:
  - decision
aliases: []
---

# Decision: <Title>

## Context

<!-- What situation prompted this decision -->

## Options Considered

<!-- Alternatives that were evaluated, with pros/cons -->

## Decision

<!-- What was decided and the primary rationale -->

## Consequences

<!-- Implications, trade-offs, and follow-up actions -->

## Related Notes
```

#### Source Template

```markdown
---
type: source
id: source-<slug>
status: active
source_type: other
tags:
  - source
aliases: []
---

# Source: <Title>

## Summary

<!-- What this source document says -->

## Key Points

<!-- Extracted insights relevant to the project -->

## Related Notes
```

#### Query Template

```markdown
---
type: query
id: query-<slug>
status: draft
tags:
  - query
aliases: []
---

# Query: <Title>

## Question

<!-- What was being investigated -->

## Findings

<!-- What was discovered -->

## Conclusion

<!-- Answer or recommended next steps -->

## Related Notes
```

### Validation Rules (Complete Reference)

#### Universal Rules (All Note Types)

| Rule | Severity | Description |
|------|----------|-------------|
| `MISSING_TYPE` | error | `type` field missing from frontmatter |
| `INVALID_TYPE` | error | `type` value not in allowed enum |
| `MISSING_ID` | error | `id` field missing from frontmatter |
| `INVALID_ID_FORMAT` | error | `id` does not match `^[a-z0-9-]+$` |
| `MISSING_STATUS` | error | `status` field missing from frontmatter |
| `INVALID_STATUS` | error | `status` value not valid for this note type |
| `MISSING_REQUIRED_SECTION` | error | A minimum-contract section is missing |
| `EMPTY_REQUIRED_SECTION` | error | A required section exists but is empty |
| `TITLE_MISMATCH` | warning | H1 title does not start with note type prefix (e.g., "Feature: ") |

#### Feature-Specific Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `NO_SYSTEM_REF` | error | `systems` array is empty (Feature must reference at least 1 System) |
| `NO_REQUIREMENTS` | error | Requirements section has no `### Requirement:` blocks |
| `REQUIREMENT_NO_SHALL_MUST` | error | Requirement normative statement lacks SHALL or MUST |
| `REQUIREMENT_NO_SCENARIO` | error | Requirement has no `#### Scenario:` children |
| `REQUIREMENT_DUPLICATE_NAME` | error | Two requirements have the same name within one Feature |
| `SCENARIO_NO_WHEN_THEN` | warning | Scenario does not follow WHEN/THEN format |

#### Change-Specific Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `NO_FEATURE_REF` | error | Neither `feature` nor `features` is set |
| `BOTH_FEATURE_FIELDS` | error | Both `feature` and `features` present |
| `FEATURE_AS_ARRAY` | error | `feature` field contains an array |
| `FEATURES_AS_SCALAR` | error | `features` field contains a scalar |
| `WHY_TOO_SHORT` | error | Why section under 50 characters |
| `NO_DELTA_ENTRIES` | error | Delta Summary has no parseable entries |
| `INVALID_DELTA_GRAMMAR` | error | Delta Summary line does not match expected grammar |
| `DELTA_MISSING_BASE` | warning | MODIFIED/REMOVED/RENAMED entry missing `[base:]` |
| `NO_TASKS` | error | Tasks section has no checkbox items |
| `EMPTY_VALIDATION` | error | Validation section is empty |
| `INVALID_STATUS_TRANSITION` | error | Attempted transition not in allowed map |
| `MISSING_DESIGN_APPROACH` | warning | Complex change (3+ deltas) without Design Approach section |
| `MISSING_DECISION_LINK` | warning | Significant tech decision without Decision note link |

#### Decision-Specific Rules

No decision-specific validation rules beyond the universal rules. The `status` field follows `GeneralStatus` (active | draft | archived).

### FrontmatterSchema Discriminated Union

Plan 03's `validateFrontmatter()` requires a single `FrontmatterSchema` that can validate any note type. This is defined as a Zod discriminated union on the `type` field, following 00-unified-types.md's `Frontmatter` union type.

```typescript
// src/core/schema/frontmatter.ts

import { z } from 'zod';
import { FeatureFrontmatterSchema } from './feature.schema.js';
import { ChangeFrontmatterSchema } from './change.schema.js';
import { SystemFrontmatterSchema } from './system.schema.js';
import { DecisionFrontmatterSchema } from './decision.schema.js';
import { SourceFrontmatterSchema } from './source.schema.js';
import { QueryFrontmatterSchema } from './query.schema.js';

/**
 * Discriminated union on the `type` field.
 * Validates frontmatter against the correct schema based on note type.
 *
 * Follows 00-unified-types.md Frontmatter union:
 *   type Frontmatter =
 *     | FeatureFrontmatter
 *     | ChangeFrontmatter
 *     | SystemFrontmatter
 *     | DecisionFrontmatter
 *     | SourceFrontmatter
 *     | QueryFrontmatter;
 */
export const FrontmatterSchema = z.discriminatedUnion('type', [
  FeatureFrontmatterSchema,
  ChangeFrontmatterSchema,
  SystemFrontmatterSchema,
  DecisionFrontmatterSchema,
  SourceFrontmatterSchema,
  QueryFrontmatterSchema,
]);

export type Frontmatter = z.infer<typeof FrontmatterSchema>;
```

### Validation Constants

```typescript
// src/core/schema/validation-constants.ts

/** Minimum character count for the Why section (overview 14.2, matching OpenSpec MIN_WHY_SECTION_LENGTH) */
export const WHY_MIN_LENGTH = 50;

/** Maximum delta entries per change (matching OpenSpec MAX_DELTAS_PER_CHANGE) */
export const MAX_DELTAS_PER_CHANGE = 10;
```

### Schema Registry

```typescript
// src/core/schema/index.ts

import { NoteType } from './base.schema.js';
import { FeatureFrontmatterSchema, FEATURE_REQUIRED_SECTIONS } from './feature.schema.js';
import { ChangeFrontmatterSchema, CHANGE_REQUIRED_SECTIONS } from './change.schema.js';
import { SystemFrontmatterSchema, SYSTEM_REQUIRED_SECTIONS } from './system.schema.js';
import { DecisionFrontmatterSchema, DECISION_REQUIRED_SECTIONS } from './decision.schema.js';
import { SourceFrontmatterSchema, SOURCE_REQUIRED_SECTIONS } from './source.schema.js';
import { QueryFrontmatterSchema, QUERY_REQUIRED_SECTIONS } from './query.schema.js';

export const SCHEMA_REGISTRY = {
  feature: {
    frontmatter: FeatureFrontmatterSchema,
    requiredSections: FEATURE_REQUIRED_SECTIONS,
  },
  change: {
    frontmatter: ChangeFrontmatterSchema,
    requiredSections: CHANGE_REQUIRED_SECTIONS,
  },
  system: {
    frontmatter: SystemFrontmatterSchema,
    requiredSections: SYSTEM_REQUIRED_SECTIONS,
  },
  decision: {
    frontmatter: DecisionFrontmatterSchema,
    requiredSections: DECISION_REQUIRED_SECTIONS,
  },
  source: {
    frontmatter: SourceFrontmatterSchema,
    requiredSections: SOURCE_REQUIRED_SECTIONS,
  },
  query: {
    frontmatter: QueryFrontmatterSchema,
    requiredSections: QUERY_REQUIRED_SECTIONS,
  },
} as const satisfies Record<NoteType, { frontmatter: any; requiredSections: readonly string[] }>;
```

### ID Generation

```typescript
// src/utils/id-generator.ts

/**
 * Generate a deterministic note ID from type and title.
 *
 * Examples:
 *   generateId('feature', 'Auth Login')        -> 'feature-auth-login'
 *   generateId('change', 'Add Passkey Login')   -> 'change-add-passkey-login'
 *   generateId('system', 'Authentication')      -> 'system-authentication'
 *   generateId('decision', 'Use WebAuthn')      -> 'decision-use-webauthn'
 *
 * Rules:
 *   - Lowercase
 *   - Spaces and underscores become hyphens
 *   - Non-alphanumeric characters (except hyphens) are stripped
 *   - Consecutive hyphens are collapsed
 *   - Leading/trailing hyphens are trimmed
 */
export function generateId(type: NoteType, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${type}-${slug}`;
}
```

### File Structure

```
src/core/schema/
  base.schema.ts           # BaseFrontmatterSchema, NoteTypeEnum, NoteStatusEnum, WikilinkRef
  frontmatter.ts           # FrontmatterSchema discriminated union, Frontmatter type
  feature.schema.ts        # FeatureFrontmatterSchema, FEATURE_REQUIRED_SECTIONS
  change.schema.ts         # ChangeFrontmatterSchema, CHANGE_REQUIRED/SOFT/OPTIONAL_SECTIONS,
                           # CHANGE_STATUS_TRANSITIONS, PLANNED_HARD/SOFT_PREREQUISITES
  delta-summary.ts         # DeltaSummaryEntrySchema, DeltaOpEnum, regex patterns, DELTA_APPLY_ORDER
  requirement.ts           # RequirementSchema, ScenarioSchema (Requirement with Scenario objects)
  system.schema.ts         # SystemFrontmatterSchema, SYSTEM_REQUIRED_SECTIONS
  decision.schema.ts       # DecisionFrontmatterSchema, DECISION_REQUIRED_SECTIONS
  source.schema.ts         # SourceFrontmatterSchema, SOURCE_REQUIRED_SECTIONS
  query.schema.ts          # QueryFrontmatterSchema, QUERY_REQUIRED_SECTIONS
  validation-constants.ts  # WHY_MIN_LENGTH, MAX_DELTAS_PER_CHANGE
  validation-messages.ts   # Centralized error/warning message strings
  index.ts                 # SCHEMA_REGISTRY, barrel exports

src/utils/
  id-generator.ts          # generateId() function

templates/                 # Markdown template files (used by init/create commands)
  feature.md
  change.md
  system.md
  decision.md
  source.md
  query.md
```

### Public API / Interface

```typescript
// Exports from src/core/schema/index.ts

export { SCHEMA_REGISTRY } from './index.js';
export { BaseFrontmatterSchema, NoteTypeEnum, NoteStatusEnum, ChangeStatusEnum, FeatureStatusEnum, GeneralStatusEnum, WikilinkRef, type NoteType } from './base.schema.js';
export { FrontmatterSchema, type Frontmatter } from './frontmatter.js';
export { FeatureFrontmatterSchema, FEATURE_REQUIRED_SECTIONS } from './feature.schema.js';
export { ChangeFrontmatterSchema, CHANGE_REQUIRED_SECTIONS, CHANGE_STATUS_TRANSITIONS, PLANNED_HARD_PREREQUISITES } from './change.schema.js';
export { DeltaSummaryEntrySchema, DeltaOpEnum, DELTA_APPLY_ORDER, DELTA_REQUIREMENT_PATTERN, DELTA_RENAMED_PATTERN, DELTA_SECTION_PATTERN } from './delta-summary.js';
export { RequirementSchema, ScenarioSchema, type Requirement, type Scenario } from './requirement.js';
export { SystemFrontmatterSchema, SYSTEM_REQUIRED_SECTIONS } from './system.schema.js';
export { DecisionFrontmatterSchema, DECISION_REQUIRED_SECTIONS } from './decision.schema.js';
export { SourceFrontmatterSchema, SOURCE_REQUIRED_SECTIONS } from './source.schema.js';
export { QueryFrontmatterSchema, QUERY_REQUIRED_SECTIONS } from './query.schema.js';
export { WHY_MIN_LENGTH, MAX_DELTAS_PER_CHANGE } from './validation-constants.js';
```

### Dependencies on Other Modules

- **Depends on**: `src/types/` (shared type definitions from 01-project-structure)
- **Used by**: `src/core/parser/` (03-vault-parser validates parsed frontmatter against schemas), `src/core/index/` (index builder uses schemas to determine which fields to extract), `src/core/workflow/` (note creation uses templates, verification uses validation rules)

---

## 4. Test Strategy

### Unit Tests per Schema

For each note type (feature, change, system, decision, source, query):

1. **Valid frontmatter**: Parse and validate a well-formed frontmatter object
2. **Missing required fields**: Verify error for each missing required field
3. **Invalid field types**: Wrong type for each field (string where array expected, etc.)
4. **Invalid enum values**: Status values not in allowed set for the note type
5. **Edge cases**: Empty arrays, extra unknown fields (should pass through), Unicode in strings

### Feature-Specific Tests

- Requirement with SHALL passes, without SHALL/MUST fails
- Requirement with 0 scenarios fails, with 1+ passes
- Duplicate requirement names detected
- Composite key generation: `feature-auth-login::Passkey Authentication`
- Content hash: same content produces same hash, different content produces different hash

### Change-Specific Tests

- `feature` as scalar passes, as array fails
- `features` as array (2+) passes, as scalar fails
- Both `feature` and `features` present fails
- Neither `feature` nor `features` present fails
- Delta Summary grammar parsing: all 4 operations, section operations, base fingerprint extraction
- Status transition validation: allowed transitions pass, disallowed transitions fail
- Planned prerequisites check: complete passes, each missing field individually fails

### Decision-Specific Tests

- `status: superseded` without `superseded_by` fails
- `status: active` with no `superseded_by` passes

### ID Generator Tests

- Various titles with spaces, special characters, Unicode
- Type prefix correctly prepended
- Deterministic: same input always produces same output

### Integration Test

- Parse a complete valid vault with all 6 note types -> validate all pass
- Parse a vault with intentional errors -> collect all validation findings -> verify error codes match expectations

---

## 5. Implementation Order

### Prerequisites

- 01-project-structure must be complete (shared types, build config)

### Order

1. **Base schema** (`base.schema.ts`): NoteTypeEnum, NoteStatusEnum, BaseFrontmatterSchema
2. **Requirement schema** (`requirement.ts`): RequirementSchema with composite key and content_hash
3. **Delta Summary schema** (`delta-summary.ts`): DeltaSummaryEntrySchema, regex patterns, apply order
4. **Feature schema** (`feature.schema.ts`): FeatureFrontmatterSchema, required sections
5. **Change schema** (`change.schema.ts`): ChangeFrontmatterSchema, status transitions, planned prerequisites
6. **System/Decision/Source/Query schemas**: Remaining 4 note types
7. **Validation messages** (`validation-messages.ts`): Centralized error strings
8. **Schema registry** (`index.ts`): SCHEMA_REGISTRY combining all schemas
9. **ID generator** (`src/utils/id-generator.ts`)
10. **Markdown templates** (`templates/*.md`)
11. **Unit tests** for all schemas and ID generator
12. **Integration test** with fixture vault
