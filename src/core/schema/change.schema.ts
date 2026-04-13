import { z } from 'zod';
import { BaseFrontmatterSchema, ChangeStatusEnum, WikilinkRefSchema } from './base.schema.js';

/**
 * Change frontmatter schema.
 * Follows 00-unified-types.md ChangeFrontmatter.
 *
 * Serialization rules (overview 13.2):
 * - Single-feature: `feature: "[[Feature: Auth Login]]"` (scalar)
 * - Multi-feature: `features: ["[[Feature: A]]", "[[Feature: B]]"]` (array, min 2)
 * - Never both, never neither
 */
export const ChangeFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('change'),
  status: ChangeStatusEnum,
  created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'created_at must be ISO date YYYY-MM-DD'),
  // Reject explicit null (YAML `feature: null`) — it must either be a valid wikilink or omitted.
  feature: WikilinkRefSchema.optional(),
  features: z.array(WikilinkRefSchema).min(2).optional(),
  depends_on: z.array(WikilinkRefSchema).default([]),
  touches: z.array(WikilinkRefSchema).default([]),
  systems: z.array(WikilinkRefSchema).default([]),
  sources: z.array(WikilinkRefSchema).default([]),
  decisions: z.array(WikilinkRefSchema).default([]),
}).refine(
  (data) => {
    // Reject explicit null — it must be omitted entirely or be a valid wikilink
    if (data.feature === null || (data as unknown as { feature?: unknown }).feature === null) {
      return false;
    }
    const hasFeature = data.feature !== undefined;
    const hasFeatures = data.features !== undefined && data.features.length > 0;
    return hasFeature !== hasFeatures;
  },
  'Must have exactly one of feature (scalar) or features (array), not both and not neither. "feature: null" is not allowed.',
);

export type ChangeFrontmatter = z.infer<typeof ChangeFrontmatterSchema>;

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
  applied: [],
};

/**
 * Hard prerequisites for proposed -> planned transition (overview 15):
 */
export const PLANNED_HARD_PREREQUISITES = [
  'Why',
  'Delta Summary',
  'Tasks',
  'Validation',
] as const;

/**
 * Soft prerequisites for proposed -> planned (warning only):
 */
export const PLANNED_SOFT_PREREQUISITES = [
  'Design Approach',
] as const;
