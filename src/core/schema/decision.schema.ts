import { z } from 'zod';
import { BaseFrontmatterSchema, GeneralStatusEnum, WikilinkRefSchema } from './base.schema.js';

/**
 * Decision frontmatter schema.
 * Follows 00-unified-types.md DecisionFrontmatter.
 */
export const DecisionFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('decision'),
  status: GeneralStatusEnum,
  features: z.array(WikilinkRefSchema).default([]),
  changes: z.array(WikilinkRefSchema).default([]),
});

export type DecisionFrontmatter = z.infer<typeof DecisionFrontmatterSchema>;

export const DECISION_REQUIRED_SECTIONS = [
  'Context',
  'Options Considered',
  'Decision',
  'Consequences',
] as const;
