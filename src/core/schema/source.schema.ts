import { z } from 'zod';
import { BaseFrontmatterSchema, GeneralStatusEnum } from './base.schema.js';

/**
 * Source frontmatter schema.
 * Follows 00-unified-types.md SourceFrontmatter.
 */
export const SourceFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('source'),
  status: GeneralStatusEnum,
  source_type: z.enum([
    'prd',
    'issue',
    'meeting',
    'code_reading',
    'research',
    'other',
  ]).optional(),
  url: z.string().url().optional(),
});

export type SourceFrontmatter = z.infer<typeof SourceFrontmatterSchema>;

export const SOURCE_REQUIRED_SECTIONS = [
  'Summary',
  'Key Points',
] as const;
