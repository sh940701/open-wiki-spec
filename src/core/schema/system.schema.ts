import { z } from 'zod';
import { BaseFrontmatterSchema, GeneralStatusEnum } from './base.schema.js';

/**
 * System frontmatter schema.
 * Follows 00-unified-types.md SystemFrontmatter.
 */
export const SystemFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('system'),
  status: GeneralStatusEnum,
});

export type SystemFrontmatter = z.infer<typeof SystemFrontmatterSchema>;

export const SYSTEM_REQUIRED_SECTIONS = [
  'Overview',
  'Boundaries',
  'Key Components',
  'Interfaces',
] as const;
