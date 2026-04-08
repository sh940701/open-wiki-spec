import { z } from 'zod';
import { BaseFrontmatterSchema, GeneralStatusEnum, WikilinkRefSchema } from './base.schema.js';

/**
 * Query frontmatter schema.
 * Follows 00-unified-types.md QueryFrontmatter.
 */
export const QueryFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('query'),
  status: GeneralStatusEnum,
  question: z.string().min(1, 'Query must state its question').optional(),
  consulted: z.array(WikilinkRefSchema).optional(),
  features: z.array(WikilinkRefSchema).optional(),
  systems: z.array(WikilinkRefSchema).optional(),
});

export type QueryFrontmatter = z.infer<typeof QueryFrontmatterSchema>;

export const QUERY_REQUIRED_SECTIONS = [
  'Question',
  'Findings',
  'Conclusion',
] as const;
