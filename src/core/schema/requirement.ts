import { z } from 'zod';

/**
 * Scenario schema.
 * Follows 00-unified-types.md Scenario.
 */
export const ScenarioSchema = z.object({
  /** Name from `#### Scenario: <name>` header */
  name: z.string().min(1),
  /** Raw text of the scenario (WHEN/THEN lines) */
  raw_text: z.string().min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

/**
 * Requirement schema.
 * Follows 00-unified-types.md Requirement.
 *
 * - Normative statement must contain SHALL or MUST
 * - At least 1 scenario per requirement
 * - Composite key: `${feature_id}::${name}`
 */
export const RequirementSchema = z.object({
  /** Stable name from `### Requirement: <name>` header */
  name: z.string().min(1),
  /** Composite key: `${feature_id}::${name}` */
  key: z.string().min(1),
  /** The normative statement containing SHALL or MUST */
  normative: z.string()
    .min(1, 'Normative statement is required')
    .refine(
      (text) => text.includes('SHALL') || text.includes('MUST'),
      'Normative statement must contain SHALL or MUST',
    ),
  /** Array of scenario objects */
  scenarios: z.array(ScenarioSchema)
    .min(1, 'At least one scenario is required'),
  /** SHA-256 of normalized content */
  content_hash: z.string(),
});

export type Requirement = z.infer<typeof RequirementSchema>;
