import { z } from 'zod';

export const NoteTypeEnum = z.enum([
  'feature', 'change', 'system', 'decision', 'source', 'query',
]);
export type NoteType = z.infer<typeof NoteTypeEnum>;

export const NoteStatusEnum = z.enum([
  'active',
  'deprecated',
  'draft',
  'archived',
  'proposed',
  'planned',
  'in_progress',
  'applied',
]);

export const ChangeStatusEnum = z.enum(['proposed', 'planned', 'in_progress', 'applied']);
export const FeatureStatusEnum = z.enum(['active', 'deprecated']);
export const GeneralStatusEnum = z.enum(['active', 'draft', 'archived']);

/** Reusable wikilink reference validator */
export const WikilinkRefSchema = z.string().regex(/^\[\[.+\]\]$/, 'Must be a wikilink [[...]]');

/**
 * Base frontmatter shared by all note types.
 * Follows 00-unified-types.md BaseFrontmatter.
 */
export const BaseFrontmatterSchema = z.object({
  type: NoteTypeEnum,
  id: z.string()
    .min(1, 'id is required')
    .regex(/^[\p{Ll}\p{Lo}\p{N}-]+$/u, 'id must be lowercase alphanumeric (Unicode) with hyphens'),
  status: NoteStatusEnum,
  tags: z.array(z.string()).default([]),
}).passthrough();

export type BaseFrontmatter = z.infer<typeof BaseFrontmatterSchema>;
