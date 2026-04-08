import type { NoteType } from './base.schema.js';
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
} as const satisfies Record<NoteType, { frontmatter: unknown; requiredSections: readonly string[] }>;

// Base
export {
  BaseFrontmatterSchema,
  NoteTypeEnum,
  NoteStatusEnum,
  ChangeStatusEnum,
  FeatureStatusEnum,
  GeneralStatusEnum,
  WikilinkRefSchema,
  type NoteType,
} from './base.schema.js';

// Frontmatter union
export { FrontmatterSchema, type Frontmatter } from './frontmatter.js';

// Per-type schemas
export { FeatureFrontmatterSchema, FEATURE_REQUIRED_SECTIONS, FEATURE_OPTIONAL_SECTIONS } from './feature.schema.js';
export {
  ChangeFrontmatterSchema,
  CHANGE_REQUIRED_SECTIONS,
  CHANGE_SOFT_SECTIONS,
  CHANGE_OPTIONAL_SECTIONS,
  CHANGE_STATUS_TRANSITIONS,
  PLANNED_HARD_PREREQUISITES,
  PLANNED_SOFT_PREREQUISITES,
} from './change.schema.js';
export { SystemFrontmatterSchema, SYSTEM_REQUIRED_SECTIONS } from './system.schema.js';
export { DecisionFrontmatterSchema, DECISION_REQUIRED_SECTIONS } from './decision.schema.js';
export { SourceFrontmatterSchema, SOURCE_REQUIRED_SECTIONS } from './source.schema.js';
export { QueryFrontmatterSchema, QUERY_REQUIRED_SECTIONS } from './query.schema.js';

// Requirement + Scenario
export { RequirementSchema, ScenarioSchema, type Requirement, type Scenario } from './requirement.js';

// Delta Summary
export {
  DeltaSummaryEntrySchema,
  DeltaOpEnum,
  DeltaTargetTypeEnum,
  DELTA_APPLY_ORDER,
  DELTA_REQUIREMENT_PATTERN,
  DELTA_RENAMED_PATTERN,
  DELTA_SECTION_PATTERN,
  type DeltaOp,
  type DeltaTargetType,
  type DeltaSummaryEntry,
} from './delta-summary.js';

// Validation constants
export { WHY_MIN_LENGTH, MAX_DELTAS_PER_CHANGE } from './validation-constants.js';

// Templates
export {
  scaffoldFeature,
  scaffoldChange,
  scaffoldSystem,
  scaffoldDecision,
  scaffoldSource,
  scaffoldQuery,
  SCAFFOLD_REGISTRY,
} from './templates.js';
