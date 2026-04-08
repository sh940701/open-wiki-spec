import { z } from 'zod';
import { FeatureFrontmatterSchema } from './feature.schema.js';
import { ChangeFrontmatterSchema } from './change.schema.js';
import { SystemFrontmatterSchema } from './system.schema.js';
import { DecisionFrontmatterSchema } from './decision.schema.js';
import { SourceFrontmatterSchema } from './source.schema.js';
import { QueryFrontmatterSchema } from './query.schema.js';

/**
 * Discriminated union on the `type` field.
 *
 * Note: ChangeFrontmatterSchema uses .refine() which makes it incompatible
 * with z.discriminatedUnion(). We use z.union() instead, which still validates
 * correctly based on the `type` literal in each schema.
 */
export const FrontmatterSchema = z.union([
  FeatureFrontmatterSchema,
  ChangeFrontmatterSchema,
  SystemFrontmatterSchema,
  DecisionFrontmatterSchema,
  SourceFrontmatterSchema,
  QueryFrontmatterSchema,
]);

export type Frontmatter = z.infer<typeof FrontmatterSchema>;
