import { z } from 'zod';
import { BaseFrontmatterSchema, FeatureStatusEnum, WikilinkRefSchema } from './base.schema.js';

/**
 * Feature frontmatter schema.
 * Follows 00-unified-types.md FeatureFrontmatter.
 */
export const FeatureFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('feature'),
  status: FeatureStatusEnum,
  systems: z.array(WikilinkRefSchema).default([]),
  sources: z.array(WikilinkRefSchema).default([]),
  decisions: z.array(WikilinkRefSchema).default([]),
  changes: z.array(WikilinkRefSchema).default([]),
});

export type FeatureFrontmatter = z.infer<typeof FeatureFrontmatterSchema>;

export const FEATURE_REQUIRED_SECTIONS = [
  'Purpose',
  'Current Behavior',
  'Constraints',
  'Known Gaps',
  'Requirements',
] as const;

export const FEATURE_OPTIONAL_SECTIONS = [
  'Change Log',
  'Related Notes',
] as const;
