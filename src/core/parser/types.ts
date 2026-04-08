import type { Frontmatter } from '../schema/frontmatter.js';
import type { Requirement } from '../../types/requirement.js';
import type { DeltaSummaryEntry } from '../../types/delta.js';

/** Result of frontmatter extraction (before Zod validation) */
export interface RawFrontmatter {
  /** The raw YAML object */
  data: Record<string, unknown>;
  /** The body content after the closing --- */
  body: string;
  /** Line number where the body starts (1-indexed) */
  bodyStartLine: number;
}

/** A parsed section from the heading hierarchy */
export interface Section {
  /** Heading level (1-6) */
  level: number;
  /** Heading text (without # prefix) */
  title: string;
  /** Content between this heading and the next heading of same or higher level */
  content: string;
  /** Line number of the heading (1-indexed) */
  line: number;
  /** Child sections (headings of deeper level) */
  children: Section[];
}

/** A wikilink occurrence in the document */
export interface WikilinkOccurrence {
  /** The raw wikilink text, e.g. "Feature: Auth Login" (without brackets) */
  target: string;
  /** Display alias if present, e.g. "Auth" in [[Feature: Auth Login|Auth]] */
  alias: string | null;
  /** Where this wikilink was found */
  location: 'frontmatter' | 'body';
  /** Line number (1-indexed) */
  line: number;
}

/** A parsed task item from a checklist */
export interface ParsedTaskItem {
  /** The task text (without the checkbox marker) */
  text: string;
  /** Whether the checkbox is checked */
  done: boolean;
  /** Line number (1-indexed) */
  line: number;
}

/** Errors collected during parsing */
export interface ParseError {
  /** Error severity */
  level: 'error' | 'warning';
  /** What component produced this error */
  source: 'frontmatter' | 'section' | 'wikilink' | 'requirement' | 'delta_summary' | 'task' | 'hash';
  /** Human-readable error message */
  message: string;
  /** Line number if applicable (1-indexed) */
  line?: number;
}

/**
 * Complete parse result for a single note.
 *
 * IMPORTANT: This is the parser's output, NOT the final IndexRecord shape.
 * Per 00-unified-types.md Ownership Rules:
 *   - `requirements[].key` is an empty string placeholder ('').
 *     The index engine (Plan 04) computes the composite key as `feature_id::name`.
 *   - `deltaSummary[].target_note_id` contains the RAW wikilink target text
 *     (e.g. "Feature: Auth Login"), NOT a resolved id.
 *     The index engine (Plan 04) resolves this to a canonical id.
 *   - All wikilink strings in frontmatter fields are RAW (not resolved to ids).
 *     The index engine (Plan 04) resolves them using stripWikilinkSyntax + lookup.
 */
export interface ParseResult {
  /** Validated frontmatter (null if frontmatter is invalid) */
  frontmatter: Frontmatter | null;
  /** Raw frontmatter data (always present if file has ---) */
  rawFrontmatter: Record<string, unknown> | null;
  /** Section tree */
  sections: Section[];
  /** Flat list of heading titles */
  headings: string[];
  /** All wikilinks found in the document */
  wikilinks: WikilinkOccurrence[];
  /** Parsed requirements (Feature notes only). key is '' placeholder. */
  requirements: Requirement[];
  /** Parsed delta summary entries (Change notes only). target_note_id is raw wikilink text. */
  deltaSummary: DeltaSummaryEntry[];
  /** Parsed tasks (Change notes only) */
  tasks: ParsedTaskItem[];
  /** Body text (markdown without frontmatter) */
  body: string;
  /** SHA-256 hash of the full body text, format: sha256:<hex> */
  contentHash: string;
  /** Errors encountered during parsing */
  errors: ParseError[];
}
