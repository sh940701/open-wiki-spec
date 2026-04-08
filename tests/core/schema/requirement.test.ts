import { describe, it, expect } from 'vitest';
import { RequirementSchema, ScenarioSchema } from '../../../src/core/schema/requirement.js';

describe('ScenarioSchema', () => {
  it('should validate a well-formed scenario', () => {
    const result = ScenarioSchema.safeParse({
      name: 'Valid login',
      raw_text: '- WHEN user enters credentials\n- THEN user is authenticated',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = ScenarioSchema.safeParse({
      name: '',
      raw_text: 'some text',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty raw_text', () => {
    const result = ScenarioSchema.safeParse({
      name: 'Valid',
      raw_text: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('RequirementSchema', () => {
  const validRequirement = {
    name: 'Passkey Authentication',
    key: 'feature-auth-login::Passkey Authentication',
    normative: 'The system SHALL support passkey authentication.',
    scenarios: [
      {
        name: 'User logs in with passkey',
        raw_text: '- WHEN user initiates passkey login\n- THEN user is authenticated',
      },
    ],
    content_hash: 'abc123def456',
  };

  it('should validate a well-formed requirement', () => {
    const result = RequirementSchema.safeParse(validRequirement);
    expect(result.success).toBe(true);
  });

  it('should accept normative with MUST', () => {
    const result = RequirementSchema.safeParse({
      ...validRequirement,
      normative: 'The system MUST support passkey authentication.',
    });
    expect(result.success).toBe(true);
  });

  it('should reject normative without SHALL or MUST', () => {
    const result = RequirementSchema.safeParse({
      ...validRequirement,
      normative: 'The system should support passkey authentication.',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty scenarios array', () => {
    const result = RequirementSchema.safeParse({
      ...validRequirement,
      scenarios: [],
    });
    expect(result.success).toBe(false);
  });

  it('should accept multiple scenarios', () => {
    const result = RequirementSchema.safeParse({
      ...validRequirement,
      scenarios: [
        { name: 'Happy path', raw_text: '- WHEN valid\n- THEN success' },
        { name: 'Error path', raw_text: '- WHEN invalid\n- THEN error' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = RequirementSchema.safeParse({
      ...validRequirement,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty key', () => {
    const result = RequirementSchema.safeParse({
      ...validRequirement,
      key: '',
    });
    expect(result.success).toBe(false);
  });
});
