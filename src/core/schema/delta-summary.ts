import { z } from 'zod';

export const DeltaOpEnum = z.enum(['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']);
export type DeltaOp = z.infer<typeof DeltaOpEnum>;

export const DeltaTargetTypeEnum = z.enum(['requirement', 'section']);
export type DeltaTargetType = z.infer<typeof DeltaTargetTypeEnum>;

/**
 * DeltaSummaryEntry schema.
 * Follows 00-unified-types.md DeltaSummaryEntry.
 */
export const DeltaSummaryEntrySchema = z.object({
  op: DeltaOpEnum,
  target_type: DeltaTargetTypeEnum,
  target_name: z.string().min(1),
  new_name: z.string().optional(),
  target_note_id: z.string().min(1),
  base_fingerprint: z.string().nullable(),
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
