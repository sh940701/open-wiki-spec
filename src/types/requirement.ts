export interface Scenario {
  /** Name from `#### Scenario: <name>` header */
  name: string;
  /** Raw text of the scenario (WHEN/THEN lines) */
  raw_text: string;
}

export interface Requirement {
  /** Stable name from `### Requirement: <name>` header */
  name: string;
  /** Composite key: `${feature_id}::${name}` */
  key: string;
  /** Normative statement containing SHALL or MUST */
  normative: string;
  /** Array of scenario objects */
  scenarios: Scenario[];
  /** SHA-256 hash of normalized (normative + scenarios) body */
  content_hash: string;
}
