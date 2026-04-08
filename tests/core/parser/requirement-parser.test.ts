import { describe, it, expect } from 'vitest';
import { parseRequirements } from '../../../src/core/parser/requirement-parser.js';
import { parseSections } from '../../../src/core/parser/section-parser.js';

describe('parseRequirements', () => {
  it('parses requirements with scenarios', () => {
    const body = `## Requirements

### Requirement: Password Login

The system SHALL allow users to authenticate using email and password.

#### Scenario: Successful login

WHEN a user submits valid credentials
THEN the system returns a session token

#### Scenario: Invalid password

WHEN a user submits wrong password
THEN the system returns a 401 error

### Requirement: Session Management

The system MUST issue JWT tokens with 24h lifetime.

#### Scenario: Token expiry

WHEN a token is older than 24 hours
THEN the system rejects it`;

    const { sections } = parseSections(body);
    const { requirements, errors } = parseRequirements(sections);

    expect(requirements).toHaveLength(2);
    expect(requirements[0].name).toBe('Password Login');
    expect(requirements[0].normative).toContain('SHALL');
    expect(requirements[0].scenarios).toHaveLength(2);
    expect(requirements[0].scenarios[0].name).toBe('Successful login');
    expect(requirements[0].scenarios[0].raw_text).toContain('WHEN');
    expect(requirements[0].key).toBe(''); // placeholder
    expect(requirements[0].content_hash).toMatch(/^sha256:[0-9a-f]+$/);

    expect(requirements[1].name).toBe('Session Management');
    expect(requirements[1].normative).toContain('MUST');
    expect(requirements[1].scenarios).toHaveLength(1);

    // Only warnings at most, no errors
    expect(errors.filter(e => e.level === 'error')).toHaveLength(0);
  });

  it('warns on duplicate requirement name', () => {
    const body = `## Requirements

### Requirement: Same Name

The system SHALL do X.

#### Scenario: S1

WHEN X THEN Y

### Requirement: Same Name

The system SHALL do Y.

#### Scenario: S2

WHEN A THEN B`;

    const { sections } = parseSections(body);
    const { requirements, errors } = parseRequirements(sections);

    expect(requirements).toHaveLength(1); // second skipped
    expect(errors.some(e => e.level === 'error' && e.message.includes('Duplicate'))).toBe(true);
  });

  it('warns when normative lacks SHALL or MUST', () => {
    const body = `## Requirements

### Requirement: Weak Req

The system should allow users to log in.

#### Scenario: S1

WHEN user logs in THEN ok`;

    const { sections } = parseSections(body);
    const { errors } = parseRequirements(sections);

    expect(errors.some(e => e.message.includes('SHALL or MUST'))).toBe(true);
  });

  it('warns when requirement has no scenarios', () => {
    const body = `## Requirements

### Requirement: No Scenarios

The system SHALL do something.`;

    const { sections } = parseSections(body);
    const { errors } = parseRequirements(sections);

    expect(errors.some(e => e.message.includes('no scenarios'))).toBe(true);
  });

  it('warns when scenario lacks WHEN/THEN', () => {
    const body = `## Requirements

### Requirement: Weak Scenario

The system SHALL do stuff.

#### Scenario: Missing structure

Just some description without proper format.`;

    const { sections } = parseSections(body);
    const { errors } = parseRequirements(sections);

    expect(errors.some(e => e.message.includes('WHEN/THEN'))).toBe(true);
  });

  it('returns empty array when no Requirements section', () => {
    const body = `## Other Section\nContent`;
    const { sections } = parseSections(body);
    const { requirements } = parseRequirements(sections);
    expect(requirements).toHaveLength(0);
  });

  it('content hash is stable across whitespace changes', () => {
    const body1 = `## Requirements

### Requirement: Test

The system SHALL do X.

#### Scenario: S1

WHEN   X   THEN   Y`;

    const body2 = `## Requirements

### Requirement: Test

The system SHALL do X.

#### Scenario: S1

WHEN X THEN Y`;

    const { sections: s1 } = parseSections(body1);
    const { sections: s2 } = parseSections(body2);
    const { requirements: r1 } = parseRequirements(s1);
    const { requirements: r2 } = parseRequirements(s2);

    expect(r1[0].content_hash).toBe(r2[0].content_hash);
  });

  it('content hash changes when normative content changes', () => {
    const body1 = `## Requirements

### Requirement: Test

The system SHALL do X.

#### Scenario: S1

WHEN X THEN Y`;

    const body2 = `## Requirements

### Requirement: Test

The system SHALL do Y.

#### Scenario: S1

WHEN X THEN Y`;

    const { sections: s1 } = parseSections(body1);
    const { sections: s2 } = parseSections(body2);
    const { requirements: r1 } = parseRequirements(s1);
    const { requirements: r2 } = parseRequirements(s2);

    expect(r1[0].content_hash).not.toBe(r2[0].content_hash);
  });
});
