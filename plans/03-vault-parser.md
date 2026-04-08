# Vault Parser Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec has a three-file parser system under `src/core/parsers/`:

**`markdown-parser.ts`** -- Base parser class:
- Takes raw markdown string, normalizes line endings (`\r\n` -> `\n`).
- `parseSections()`: Walks lines, matches `^(#{1,6})\s+(.+)$`, builds a `Section[]` tree with `level`, `title`, `content`, `children[]`.
- `findSection(sections, title)`: Recursive case-insensitive title lookup.
- `parseRequirements(section)`: Extracts `Requirement[]` from children of a Requirements section. Each requirement gets its `text` from the first non-empty content line (before child headers), falls back to heading text.
- `parseScenarios(requirementSection)`: Extracts `Scenario[]` from children of a requirement section. Each scenario is `{ rawText: string }`.
- `parseDeltas(content)`: Regex-based extraction of delta operations from "What Changes" section bullet lines. Matches `^\s*-\s*\*\*([^*:]+)(?::\*\*|\*\*:)\s*(.+)$` and infers operation from description keywords.
- `parseSpec(name)`: Orchestrates: parseSections -> find Purpose + Requirements -> parseRequirements -> return Spec.
- `parseChange(name)`: Orchestrates: parseSections -> find Why + What Changes -> parseDeltas -> return Change.

**`change-parser.ts`** -- Extended parser for changes with delta spec files:
- Extends `MarkdownParser`.
- `parseChangeWithDeltas(name)`: Parses the proposal first, then walks `specs/<domain>/spec.md` files for structured delta specs.
- `parseSpecDeltas(specName, content)`: Parses `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, `## RENAMED Requirements` sections.
- `parseRenames(content)`: Matches `FROM: ### Requirement: <old>` / `TO: ### Requirement: <new>` pairs.

**`requirement-blocks.ts`** -- Low-level requirement block operations:
- `extractRequirementsSection(content)`: Splits a spec file into `{ before, headerLine, preamble, bodyBlocks[], after }` for surgical editing.
- `parseDeltaSpec(content)`: Returns `DeltaPlan { added, modified, removed, renamed, sectionPresence }`.
- `parseRequirementBlocksFromSection(body)`: Extracts raw requirement blocks with `headerLine`, `name`, `raw`.
- `normalizeRequirementName(name)`: Trims whitespace.

### Key Source Files

| File | Role |
|------|------|
| `src/core/parsers/markdown-parser.ts` | Base markdown section parser + spec/change parsing |
| `src/core/parsers/change-parser.ts` | Delta spec file parsing for changes |
| `src/core/parsers/requirement-blocks.ts` | Low-level requirement block extraction and delta plan parsing |
| `src/core/schemas/base.schema.ts` | RequirementSchema, ScenarioSchema (Zod validation) |
| `src/core/schemas/spec.schema.ts` | SpecSchema (Zod validation) |
| `src/core/schemas/change.schema.ts` | ChangeSchema, DeltaSchema (Zod validation) |
| `src/core/validation/validator.ts` | Uses parsers + Zod schemas for full validation |
| `src/core/specs-apply.ts` | Uses requirement-blocks for delta application |

### Core Algorithm / Flow

**Spec parsing:**
```
Raw markdown string
  -> normalizeContent (CRLF -> LF)
  -> parseSections (build Section tree)
  -> findSection("Purpose") -> extract overview
  -> findSection("Requirements") -> parseRequirements
     -> for each child of Requirements section:
        -> extract text from first content line
        -> parseScenarios from child sections
  -> Validate via SpecSchema
  -> Return Spec object
```

**Change parsing:**
```
Raw proposal.md
  -> parseSections -> find "Why" and "What Changes"
  -> parseDeltas from "What Changes" (simple bullet format)
  -> Walk specs/<domain>/spec.md files
     -> parseSectionsFromContent for each delta spec
     -> parseSpecDeltas: ADDED/MODIFIED/REMOVED/RENAMED sections
        -> parseRequirementBlocksFromSection for each
  -> Combine simple deltas + structured deltas
  -> Validate via ChangeSchema
  -> Return Change object
```

**Delta application (specs-apply.ts):**
```
For each delta spec source file:
  1. parseDeltaSpec -> get DeltaPlan
  2. Read target main spec
  3. extractRequirementsSection -> get parts
  4. Apply operations in order: RENAMED -> REMOVED -> MODIFIED -> ADDED
  5. Rebuild spec content from parts
  6. Validate rebuilt content
  7. Write to target file
```

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

**Section 10.3** -- Every typed note is parsed into an IndexRecord with: `id`, `type`, `title`, `aliases`, `path`, `status`, `tags`, `systems`, `sources`, `decisions`, `changes`, `depends_on`, `touches`, `links_out`, `links_in`, `headings`, `requirements`, `delta_summary`, `tasks`, `raw_text`, `content_hash`.

**Section 10.7** -- Wikilink/Alias -> ID normalization: exact title match -> alias match -> raise ambiguous error -> raise invalid target error -> store id.

**Section 10.1** -- Canonical data lives in raw vault markdown. Index is disposable cache.

**Section 10.1.1** -- Schema version in `wiki/00-meta/schema.md`.

**Section 10.2** -- Fresh vault scan at start of `propose`, `query`, `verify`. Scan target: `wiki/**/*.md`.

**Section 14.1** -- Feature Requirements: `### Requirement: <name>`, normative with SHALL/MUST, scenarios with WHEN/THEN.

**Section 14.2** -- Change Delta Summary: structured grammar with ADDED/MODIFIED/REMOVED/RENAMED, base_fingerprint.

**Section 11.1** -- Canonical identity is frontmatter `id`. Title and path are mutable.

**Section 10.8** -- Verify must check: completeness, correctness, coherence, vault integrity.

### Differences from OpenSpec

| Aspect | OpenSpec Parser | open-wiki-spec Parser |
|--------|----------------|----------------------|
| Input format | Pure markdown (no frontmatter) | YAML frontmatter + markdown body |
| Identity source | File path / name parameter | Frontmatter `id` field |
| Relationship data | Implicit from directory structure | Explicit frontmatter wikilinks |
| Delta location | Separate files under `changes/<name>/specs/` | Inline `## Delta Summary` section in Change note |
| Delta format | Structured markdown with `## ADDED/MODIFIED/REMOVED Requirements` | Line-based grammar: `- OP target_type "name" prep [[Feature]]` |
| Wikilinks | Not present | Core navigation mechanism, must be extracted and normalized |
| Note types | 2 (Spec, Change) | 6 (Feature, Change, System, Decision, Source, Query) |
| Hashing | Not present | content_hash for requirements (base_fingerprint comparison) |
| Scenario format | `#### Scenario:` with raw text | Same structure, but WHEN/THEN enforcement |
| Output | Typed objects (Spec, Change) | IndexRecord (unified shape for all note types) |

### Contracts to Satisfy

1. Parse YAML frontmatter from any vault markdown file and validate against the correct Zod schema.
2. Extract all `[[wikilink]]` references from both frontmatter and body text.
3. Parse heading hierarchy to identify sections and their content.
4. Parse requirement blocks within Feature notes (name, normative, scenarios).
5. Parse Delta Summary lines within Change notes (op, target_type, target_name, feature, base_fingerprint).
6. Compute SHA-256 content hash of requirement bodies for base_fingerprint support.
7. Parse task checklists (`- [ ]` / `- [x]`) from Change notes.
8. Produce an IndexRecord from any parsed note.
9. Handle malformed notes gracefully: return partial results with errors, do not crash.
10. Skip operational meta files (`wiki/00-meta/index.md`, `log.md`, `schema.md`) during note parsing -- these are not typed notes and have no frontmatter. `parseNote(filePath)` reads the file itself and returns a `ParseResult` with `frontmatter: null` for files without valid frontmatter. The index engine (Plan 04) checks for null frontmatter and skips non-typed notes.

---

## 3. Implementation Plan

### Architecture Overview

The parser module is split into focused sub-parsers, each handling one parsing concern:

```
core/parser/
  frontmatter-parser.ts    # YAML extraction + Zod validation
  section-parser.ts        # Heading hierarchy parsing
  wikilink-parser.ts       # [[wikilink]] extraction + normalization
  requirement-parser.ts    # Requirement block parsing (Feature notes)
  delta-summary-parser.ts  # Delta Summary line parsing (Change notes)
  task-parser.ts           # Checklist item parsing (Change notes)
  note-parser.ts           # Unified orchestrator: compose sub-parsers -> IndexRecord
  types.ts                 # Shared parser output types
```

**Data flow:**

```
Raw markdown string
  │
  ├──► frontmatter-parser ──► validated frontmatter object
  │
  ├──► section-parser ──► Section[] tree + heading list
  │
  ├──► wikilink-parser ──► wikilink set (from frontmatter + body)
  │
  ├──► requirement-parser ──► Requirement[] (if Feature)
  │
  ├──► delta-summary-parser ──► DeltaSummaryEntry[] (if Change)
  │
  ├──► task-parser ──► Task[] (if Change)
  │
  └──► note-parser (orchestrator) ──► IndexRecord
```

Each sub-parser is independently testable and has no dependencies on other sub-parsers. The `note-parser` is the only module that composes them.

### Data Structures

#### Parser Output Types

```typescript
// src/core/parser/types.ts

import type { Frontmatter } from '../schema/frontmatter.js';         // discriminated union from Plan 02
import type { Requirement } from '../schema/requirement.js';          // with Scenario[] from 00-unified-types.md
import type { DeltaSummaryEntry } from '../schema/delta-summary.js';  // with target_note_id from 00-unified-types.md

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
export interface TaskItem {
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
  tasks: TaskItem[];
  /** Body text (markdown without frontmatter) */
  body: string;
  /** SHA-256 hash of the full body text */
  contentHash: string;
  /** Errors encountered during parsing */
  errors: ParseError[];
}
```

### Core Algorithms

#### 1. Frontmatter Parser

```typescript
// src/core/parser/frontmatter-parser.ts

import { parse as parseYaml } from 'yaml';
import { FrontmatterSchema, type Frontmatter } from '../schema/frontmatter.js';
import type { RawFrontmatter, ParseError } from './types.js';

/**
 * Extract YAML frontmatter from a markdown string.
 * 
 * Frontmatter is delimited by --- on its own line at the start of the file
 * and a closing --- on its own line.
 * 
 * Algorithm:
 *   1. Check if the first line is exactly "---"
 *   2. Scan forward for the closing "---"
 *   3. Extract the YAML between the delimiters
 *   4. Parse with the `yaml` package
 *   5. Return { data, body, bodyStartLine }
 */
export function extractFrontmatter(content: string): { raw: RawFrontmatter | null; errors: ParseError[] } {
  const errors: ParseError[] = [];
  // Normalize CRLF to LF before any line-splitting (matches OpenSpec's normalizeContent())
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  
  // Must start with ---
  if (lines.length === 0 || lines[0].trim() !== '---') {
    errors.push({
      level: 'error',
      source: 'frontmatter',
      message: 'File does not start with YAML frontmatter delimiter (---)',
      line: 1,
    });
    return { raw: null, errors };
  }
  
  // Find closing ---
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIndex = i;
      break;
    }
  }
  
  if (closeIndex === -1) {
    errors.push({
      level: 'error',
      source: 'frontmatter',
      message: 'No closing frontmatter delimiter (---) found',
      line: 1,
    });
    return { raw: null, errors };
  }
  
  const yamlContent = lines.slice(1, closeIndex).join('\n');
  const body = lines.slice(closeIndex + 1).join('\n');  // already CRLF-normalized
  const bodyStartLine = closeIndex + 2; // 1-indexed, line after closing ---
  
  let data: Record<string, unknown>;
  try {
    data = parseYaml(yamlContent);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      errors.push({
        level: 'error',
        source: 'frontmatter',
        message: 'Frontmatter YAML must be an object (key-value pairs)',
        line: 1,
      });
      return { raw: null, errors };
    }
  } catch (e) {
    errors.push({
      level: 'error',
      source: 'frontmatter',
      message: `Invalid YAML in frontmatter: ${(e as Error).message}`,
      line: 1,
    });
    return { raw: null, errors };
  }
  
  return {
    raw: { data: data as Record<string, unknown>, body, bodyStartLine },
    errors,
  };
}

/**
 * Validate raw frontmatter data against the discriminated union schema.
 * Returns the validated frontmatter or null with errors.
 */
export function validateFrontmatter(
  data: Record<string, unknown>
): { frontmatter: Frontmatter | null; errors: ParseError[] } {
  const errors: ParseError[] = [];
  
  const result = FrontmatterSchema.safeParse(data);
  
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        level: 'error',
        source: 'frontmatter',
        message: `${issue.path.join('.')}: ${issue.message}`,
      });
    }
    return { frontmatter: null, errors };
  }
  
  return { frontmatter: result.data, errors };
}
```

#### 2. Section Parser

```typescript
// src/core/parser/section-parser.ts

import type { Section, ParseError } from './types.js';

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const CODE_FENCE_REGEX = /^(`{3,}|~{3,})/;

/**
 * Parse a markdown body into a hierarchical section tree.
 * 
 * Algorithm:
 *   1. Normalize CRLF to LF (if not already done by frontmatter parser).
 *   2. Split body into lines.
 *   3. Walk each line looking for heading matches, skipping lines
 *      inside fenced code blocks (``` or ~~~). This prevents code
 *      examples containing `#` or `---` from being misinterpreted
 *      as headings or frontmatter delimiters.
 *   4. For each heading, create a Section node.
 *   5. Build parent-child relationships using a stack:
 *      - Pop stack entries with level >= current level.
 *      - If stack is non-empty, current is a child of top-of-stack.
 *      - If stack is empty, current is a root section.
 *   6. Section content is the text between this heading and the next
 *      heading of same or higher level.
 * 
 * This is the same algorithm as OpenSpec's MarkdownParser.parseSections()
 * but adapted to track line numbers, work on body-only content, and
 * handle fenced code blocks.
 */
export function parseSections(
  body: string, 
  bodyStartLine: number = 1
): { sections: Section[]; headings: string[]; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const sections: Section[] = [];
  const headings: string[] = [];
  // Normalize CRLF in case body wasn't processed through frontmatter parser
  const normalizedBody = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedBody.split('\n');
  const stack: Section[] = [];

  // Track heading positions for content extraction, skipping code fences
  const headingPositions: { index: number; level: number; title: string }[] = [];
  let insideCodeFence = false;
  let codeFenceMarker = '';
  
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(CODE_FENCE_REGEX);
    if (fenceMatch) {
      if (!insideCodeFence) {
        insideCodeFence = true;
        codeFenceMarker = fenceMatch[1][0]; // ` or ~
      } else if (lines[i].trim().startsWith(codeFenceMarker)) {
        insideCodeFence = false;
        codeFenceMarker = '';
      }
      continue;
    }
    if (insideCodeFence) continue;

    const match = lines[i].match(HEADING_REGEX);
    if (match) {
      headingPositions.push({
        index: i,
        level: match[1].length,
        title: match[2].trim(),
      });
    }
  }

  for (let h = 0; h < headingPositions.length; h++) {
    const { index, level, title } = headingPositions[h];
    headings.push(title);
    
    // Content runs from heading+1 to the next heading of same or higher level
    const nextIndex = h + 1 < headingPositions.length
      ? headingPositions[h + 1].index
      : lines.length;
    
    const contentLines: string[] = [];
    for (let i = index + 1; i < nextIndex; i++) {
      // Include all lines up to the next heading of same or higher level
      // But child headings (deeper level) are part of this section's children,
      // not its direct content. We include them here for the content string
      // but they'll also appear in children. The content is "everything between
      // this heading and the next same-or-higher-level heading, excluding child headings".
      const childMatch = lines[i].match(HEADING_REGEX);
      if (childMatch && childMatch[1].length <= level) {
        break;
      }
      contentLines.push(lines[i]);
    }
    
    const section: Section = {
      level,
      title,
      content: contentLines.join('\n').trim(),
      line: bodyStartLine + index,
      children: [],
    };

    // Build hierarchy
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      sections.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  return { sections, headings, errors };
}

/**
 * Find a section by title (case-insensitive, recursive).
 */
export function findSection(sections: Section[], title: string): Section | undefined {
  const target = title.toLowerCase();
  for (const section of sections) {
    if (section.title.toLowerCase() === target) {
      return section;
    }
    const child = findSection(section.children, title);
    if (child) return child;
  }
  return undefined;
}
```

#### 3. Wikilink Parser

```typescript
// src/core/parser/wikilink-parser.ts

import type { WikilinkOccurrence, ParseError } from './types.js';

/**
 * Regex for wikilinks: [[target]] or [[target|alias]]
 * Handles:
 *   [[Feature: Auth Login]]
 *   [[Feature: Auth Login|Auth]]
 *   "[[Feature: Auth Login]]"  (inside YAML string values)
 */
const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

const CODE_FENCE_REGEX = /^(`{3,}|~{3,})/;

/**
 * Extract all wikilinks from a string, tracking their location.
 * 
 * Algorithm:
 *   1. Split input into lines.
 *   2. Track code fence state (``` or ~~~). Lines inside fenced code blocks
 *      are skipped entirely -- wikilinks in code examples are NOT extracted.
 *   3. For each non-code-fenced line, run WIKILINK_REGEX.
 *   4. For each match, create a WikilinkOccurrence.
 *   5. Deduplicate is NOT done here; callers can dedupe as needed.
 */
export function extractWikilinks(
  text: string,
  location: 'frontmatter' | 'body',
  startLine: number = 1
): { wikilinks: WikilinkOccurrence[]; errors: ParseError[] } {
  const wikilinks: WikilinkOccurrence[] = [];
  const errors: ParseError[] = [];
  const lines = text.split('\n');
  let insideCodeFence = false;
  let codeFenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code fence state to skip wikilinks inside code blocks
    const fenceMatch = line.match(CODE_FENCE_REGEX);
    if (fenceMatch) {
      if (!insideCodeFence) {
        insideCodeFence = true;
        codeFenceMarker = fenceMatch[1][0]; // ` or ~
      } else if (line.trim().startsWith(codeFenceMarker)) {
        insideCodeFence = false;
        codeFenceMarker = '';
      }
      continue;
    }
    if (insideCodeFence) continue;

    let match: RegExpExecArray | null;
    
    // Reset regex state
    WIKILINK_REGEX.lastIndex = 0;
    
    while ((match = WIKILINK_REGEX.exec(line)) !== null) {
      const target = match[1].trim();
      const alias = match[2]?.trim() ?? null;
      
      if (target.length === 0) {
        errors.push({
          level: 'warning',
          source: 'wikilink',
          message: 'Empty wikilink target',
          line: startLine + i,
        });
        continue;
      }

      wikilinks.push({
        target,
        alias,
        location,
        line: startLine + i,
      });
    }
  }

  return { wikilinks, errors };
}

/**
 * Strip wikilink syntax from a raw wikilink string.
 * 
 * Strips [[...]] brackets and drops the display text after |.
 * Used by the index engine (Plan 04) for wikilink resolution.
 * 
 * Examples:
 *   "[[Feature: Auth Login]]"       -> "Feature: Auth Login"
 *   "[[Feature: Auth Login|Auth]]"  -> "Feature: Auth Login"
 *   "Feature: Auth Login"           -> "Feature: Auth Login" (no-op if no brackets)
 */
export function stripWikilinkSyntax(wikilink: string): string {
  let result = wikilink.trim();
  // Remove [[ and ]]
  if (result.startsWith('[[') && result.endsWith(']]')) {
    result = result.slice(2, -2);
  }
  // Drop display text after |
  const pipeIndex = result.indexOf('|');
  if (pipeIndex !== -1) {
    result = result.slice(0, pipeIndex);
  }
  return result.trim();
}

/**
 * Normalize a wikilink target to a set of unique target strings.
 * Used to build links_out for the index record.
 */
export function uniqueWikilinkTargets(wikilinks: WikilinkOccurrence[]): string[] {
  const targets = new Set<string>();
  for (const wl of wikilinks) {
    targets.add(wl.target);
  }
  return Array.from(targets);
}
```

#### 4. Requirement Parser

```typescript
// src/core/parser/requirement-parser.ts

import { createHash } from 'crypto';
import type { Section, ParseError } from './types.js';
import type { Requirement, Scenario } from '../schema/requirement.js';
import { findSection } from './section-parser.js';

const REQUIREMENT_HEADING_REGEX = /^Requirement:\s*(.+)$/;
const SCENARIO_HEADING_REGEX = /^Scenario:\s*(.+)$/;

/**
 * Parse requirement blocks from a Feature note's section tree.
 * 
 * Algorithm:
 *   1. Find the "Requirements" section in the tree.
 *   2. For each child section matching "### Requirement: <name>":
 *      a. Extract the normative statement (first non-empty paragraph
 *         before any child sections).
 *      b. For each child section matching "#### Scenario: <name>":
 *         - Extract the raw scenario text.
 *      c. Compute content_hash = SHA-256(normalize(normative + scenarios)).
 *   3. Validate:
 *      - Normative must contain SHALL or MUST (warning).
 *      - At least 1 scenario per requirement (warning).
 *      - Requirement names must be unique (error).
 *   4. Return Requirement[] and any errors.
 *
 * NOTE: The `key` field (composite key `feature_id::name`) is NOT set here
 * because the parser does not know the parent feature_id. The index-builder
 * (Plan 04) sets the `key` field when building the VaultIndex.
 * The parser returns `key: ''` as a placeholder.
 */
export function parseRequirements(
  sections: Section[]
): { requirements: Requirement[]; errors: ParseError[] } {
  const requirements: Requirement[] = [];
  const errors: ParseError[] = [];
  const seenNames = new Set<string>();

  const reqSection = findSection(sections, 'Requirements');
  if (!reqSection) {
    return { requirements, errors };
  }

  for (const child of reqSection.children) {
    const nameMatch = child.title.match(REQUIREMENT_HEADING_REGEX);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();

    // Check for duplicate names
    if (seenNames.has(name)) {
      errors.push({
        level: 'error',
        source: 'requirement',
        message: `Duplicate requirement name: "${name}"`,
        line: child.line,
      });
      continue;
    }
    seenNames.add(name);

    // Extract normative statement: content before child sections
    const normative = extractNormativeStatement(child);

    if (!normative) {
      errors.push({
        level: 'warning',
        source: 'requirement',
        message: `Requirement "${name}" has no normative statement`,
        line: child.line,
      });
    }

    if (normative && !normative.includes('SHALL') && !normative.includes('MUST')) {
      errors.push({
        level: 'warning',
        source: 'requirement',
        message: `Requirement "${name}" normative statement lacks SHALL or MUST`,
        line: child.line,
      });
    }

    // Parse scenarios
    const scenarios: Scenario[] = [];
    for (const scenarioChild of child.children) {
      const scenarioMatch = scenarioChild.title.match(SCENARIO_HEADING_REGEX);
      if (!scenarioMatch) continue;

      const scenarioName = scenarioMatch[1].trim();
      const scenarioText = scenarioChild.content.trim();

      if (!scenarioText) {
        errors.push({
          level: 'warning',
          source: 'requirement',
          message: `Scenario "${scenarioName}" in requirement "${name}" is empty`,
          line: scenarioChild.line,
        });
        continue;
      }

      // Check for WHEN/THEN
      if (!scenarioText.includes('WHEN') || !scenarioText.includes('THEN')) {
        errors.push({
          level: 'warning',
          source: 'requirement',
          message: `Scenario "${scenarioName}" in requirement "${name}" lacks WHEN/THEN structure`,
          line: scenarioChild.line,
        });
      }

      scenarios.push({ name: scenarioName, raw_text: scenarioText });
    }

    if (scenarios.length === 0) {
      errors.push({
        level: 'warning',
        source: 'requirement',
        message: `Requirement "${name}" has no scenarios`,
        line: child.line,
      });
    }

    // Compute content hash
    const hashInput = normalizeForHashing(normative || '', scenarios);
    const content_hash = computeHash(hashInput);

    requirements.push({
      name,
      key: '',  // placeholder; set by index-builder (Plan 04) as `${feature_id}::${name}`
      normative: normative || '',
      scenarios,
      content_hash,
    });
  }

  return { requirements, errors };
}

/**
 * Extract the normative statement from a requirement section.
 * The normative statement is the content before any child headings.
 */
function extractNormativeStatement(section: Section): string | null {
  // The section.content includes child heading content.
  // We need only the part before the first child heading.
  const lines = section.content.split('\n');
  const normativeLines: string[] = [];

  for (const line of lines) {
    if (line.match(/^#{1,6}\s+/)) {
      break; // Hit a child heading
    }
    normativeLines.push(line);
  }

  const text = normativeLines.join('\n').trim();
  return text || null;
}

/**
 * Normalize requirement content for hashing.
 * This ensures the hash is stable across whitespace changes
 * but sensitive to meaningful content changes.
 */
function normalizeForHashing(normative: string, scenarios: Scenario[]): string {
  const parts: string[] = [
    normative.trim().replace(/\s+/g, ' '),
  ];
  for (const s of scenarios) {
    parts.push(s.raw_text.trim().replace(/\s+/g, ' '));
  }
  return parts.join('\n');
}

/**
 * Compute SHA-256 hash of a string, returned as "sha256:<hex>".
 */
function computeHash(input: string): string {
  const hash = createHash('sha256').update(input, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}
```

#### 5. Delta Summary Parser

```typescript
// src/core/parser/delta-summary-parser.ts

import type { Section, ParseError } from './types.js';
import type { DeltaSummaryEntry } from '../schema/delta-summary.js';
import { DeltaOpEnum } from '../schema/delta-summary.js';
import { findSection } from './section-parser.js';

/**
 * Regex for Delta Summary lines.
 * 
 * Grammar (from overview.md Section 14.2):
 *
 *   Requirement ops:
 *     - ADDED requirement "name" to [[Feature]]
 *     - MODIFIED requirement "name" in [[Feature]]
 *     - REMOVED requirement "name" from [[Feature]]
 *     - RENAMED requirement "old" to "new" in [[Feature]]
 *
 *   Section ops:
 *     - ADDED section "name" in [[Note]]
 *     - MODIFIED section "name" in [[Note]]
 *     - REMOVED section "name" from [[Note]]
 *
 *   Optional suffix:
 *     [base: sha256:abc123...]
 *     [base: n/a]
 *
 *   Optional trailing description after colon:
 *     - MODIFIED section "Current Behavior" in [[Feature: Auth Login]]: updated to reflect passkey support
 */

const REQUIREMENT_OP_REGEX = 
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+requirement\s+"([^"]+)"\s+(to|in|from)\s+\[\[([^\]]+)\]\](?:\s*:\s*(.+?))?(?:\s+\[base:\s*([^\]]+)\])?$/;

const RENAMED_OP_REGEX = 
  /^-\s+RENAMED\s+requirement\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+\[\[([^\]]+)\]\](?:\s+\[base:\s*([^\]]+)\])?$/;

const SECTION_OP_REGEX = 
  /^-\s+(ADDED|MODIFIED|REMOVED)\s+section\s+"([^"]+)"\s+(in|from)\s+\[\[([^\]]+)\]\](?:\s*:\s*(.+?))?(?:\s+\[base:\s*([^\]]+)\])?$/;

/**
 * Parse Delta Summary entries from a Change note's section tree.
 * 
 * Algorithm:
 *   1. Find the "Delta Summary" section.
 *   2. Split its content into lines.
 *   3. For each line starting with "- ":
 *      a. Try RENAMED_OP_REGEX first (most specific).
 *      b. Try REQUIREMENT_OP_REGEX.
 *      c. Try SECTION_OP_REGEX.
 *      d. If no match, record a warning about unparseable line.
 *   4. Validate base_fingerprint:
 *      - ADDED entries should have [base: n/a] or no base tag.
 *      - MODIFIED/REMOVED/RENAMED should have [base: sha256:...].
 *   5. Return DeltaSummaryEntry[] and any errors.
 */
export function parseDeltaSummary(
  sections: Section[]
): { entries: DeltaSummaryEntry[]; errors: ParseError[] } {
  const entries: DeltaSummaryEntry[] = [];
  const errors: ParseError[] = [];

  const deltaSection = findSection(sections, 'Delta Summary');
  if (!deltaSection) {
    return { entries, errors };
  }

  const lines = deltaSection.content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('- ')) continue;

    const lineNum = deltaSection.line + i + 1; // approximate

    // Try RENAMED first (most specific)
    const renamedMatch = line.match(RENAMED_OP_REGEX);
    if (renamedMatch) {
      const oldName = renamedMatch[1];
      const newName = renamedMatch[2];
      const feature = renamedMatch[3];
      const baseFP = renamedMatch[4] ?? null;

      entries.push({
        op: 'RENAMED',
        target_type: 'requirement',
        target_name: oldName,
        new_name: newName,
        target_note_id: feature,  // store raw target, not re-wrapped in [[...]]
        base_fingerprint: normalizeFingerprint(baseFP),
        description: '',
      });

      validateFingerprint('RENAMED', baseFP, oldName, lineNum, errors);
      continue;
    }

    // Try requirement operations
    const reqMatch = line.match(REQUIREMENT_OP_REGEX);
    if (reqMatch) {
      const op = reqMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED';
      const name = reqMatch[2];
      const feature = reqMatch[4];
      const description = reqMatch[5] ?? '';
      const baseFP = reqMatch[6] ?? null;

      entries.push({
        op,
        target_type: 'requirement',
        target_name: name,
        target_note_id: feature,  // store raw target, not re-wrapped in [[...]]
        base_fingerprint: normalizeFingerprint(baseFP),
        description,
      });

      validateFingerprint(op, baseFP, name, lineNum, errors);
      continue;
    }

    // Try section operations
    const secMatch = line.match(SECTION_OP_REGEX);
    if (secMatch) {
      const op = secMatch[1] as 'ADDED' | 'MODIFIED' | 'REMOVED';
      const name = secMatch[2];
      const feature = secMatch[4];
      const description = secMatch[5] ?? '';
      const baseFP = secMatch[6] ?? null;

      entries.push({
        op,
        target_type: 'section',
        target_name: name,
        target_note_id: feature,  // store raw target, not re-wrapped in [[...]]
        base_fingerprint: normalizeFingerprint(baseFP),
        description,
      });
      continue;
    }

    // Unparseable line
    if (line.match(/^-\s+(ADDED|MODIFIED|REMOVED|RENAMED)/)) {
      errors.push({
        level: 'warning',
        source: 'delta_summary',
        message: `Delta Summary line does not match expected grammar: "${line}"`,
        line: lineNum,
      });
    }
    // Lines not starting with a delta op keyword are ignored (could be prose)
  }

  return { entries, errors };
}

function normalizeFingerprint(raw: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === 'n/a' || trimmed === 'N/A') return null;
  return trimmed;
}

function validateFingerprint(
  op: string,
  baseFP: string | null,
  name: string,
  line: number,
  errors: ParseError[]
): void {
  if (op === 'ADDED') {
    // ADDED should have [base: n/a] or no base tag; both normalize to null
    // No warning needed
    return;
  }
  // MODIFIED, REMOVED, RENAMED should have a real fingerprint
  if (!baseFP || baseFP.trim() === 'n/a' || baseFP.trim() === 'N/A') {
    errors.push({
      level: 'warning',
      source: 'delta_summary',
      message: `${op} entry for "${name}" is missing base_fingerprint (expected [base: sha256:...])`,
      line,
    });
  }
}
```

#### 6. Task Parser

```typescript
// src/core/parser/task-parser.ts

import type { Section, TaskItem, ParseError } from './types.js';
import { findSection } from './section-parser.js';

const TASK_REGEX = /^-\s+\[([ xX])\]\s+(.+)$/;

/**
 * Parse task checklist items from a Change note's Tasks section.
 * 
 * Algorithm:
 *   1. Find the "Tasks" section.
 *   2. Walk all lines in the section content (including children).
 *   3. Match "- [ ] text" (unchecked) or "- [x] text" (checked).
 *   4. Return TaskItem[].
 */
export function parseTasks(
  sections: Section[]
): { tasks: TaskItem[]; errors: ParseError[] } {
  const tasks: TaskItem[] = [];
  const errors: ParseError[] = [];

  const taskSection = findSection(sections, 'Tasks');
  if (!taskSection) {
    return { tasks, errors };
  }

  // Walk all content including from child sections
  const allContent = gatherAllContent(taskSection);
  const lines = allContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(TASK_REGEX);
    if (match) {
      tasks.push({
        text: match[2].trim(),
        done: match[1] !== ' ',
        line: taskSection.line + i + 1, // approximate
      });
    }
  }

  return { tasks, errors };
}

/**
 * Gather all text content from a section and its children recursively.
 */
function gatherAllContent(section: Section): string {
  let content = section.content;
  for (const child of section.children) {
    content += '\n' + gatherAllContent(child);
  }
  return content;
}
```

#### 7. Note Parser (Orchestrator)

```typescript
// src/core/parser/note-parser.ts

import { createHash } from 'crypto';
import { extractFrontmatter, validateFrontmatter } from './frontmatter-parser.js';
import { parseSections } from './section-parser.js';
import { extractWikilinks, uniqueWikilinkTargets } from './wikilink-parser.js';
import { parseRequirements } from './requirement-parser.js';
import { parseDeltaSummary } from './delta-summary-parser.js';
import { parseTasks } from './task-parser.js';
import type { ParseResult, ParseError, WikilinkOccurrence } from './types.js';
import type { IndexRecord } from '../../types/index-record.js';

/**
 * Parse a single markdown note into a complete ParseResult.
 * 
 * This is the main entry point for parsing any vault note.
 * It reads the file at the given path and orchestrates all sub-parsers.
 * 
 * Per 00-unified-types.md Parser↔Index API Boundary:
 *   parseNote(filePath: string): ParseResult
 *   Reads the file at filePath, parses frontmatter/sections/wikilinks/requirements/delta-summary.
 *   Returns ParseResult with raw wikilinks (not resolved to ids).
 * 
 * Algorithm:
 *   1. Read the file content from filePath.
 *   2. Extract and validate frontmatter.
 *   3. Parse sections from body.
 *   4. Extract wikilinks from frontmatter YAML and body (skipping code blocks).
 *   5. If note type is "feature", parse requirements.
 *   6. If note type is "change", parse delta summary and tasks.
 *   7. Compute body content hash.
 *   8. Assemble and return ParseResult.
 */
export function parseNote(filePath: string): ParseResult {
  const content = readFileSync(filePath, 'utf-8');
  const errors: ParseError[] = [];

  // 1. Frontmatter
  const { raw, errors: fmExtractErrors } = extractFrontmatter(content);
  errors.push(...fmExtractErrors);

  let frontmatter = null;
  let rawFrontmatter = null;
  let body = content;
  let bodyStartLine = 1;

  if (raw) {
    rawFrontmatter = raw.data;
    body = raw.body;
    bodyStartLine = raw.bodyStartLine;

    const { frontmatter: validated, errors: fmValidateErrors } = validateFrontmatter(raw.data);
    errors.push(...fmValidateErrors);
    frontmatter = validated;
  }

  // 2. Sections
  const { sections, headings, errors: sectionErrors } = parseSections(body, bodyStartLine);
  errors.push(...sectionErrors);

  // 3. Wikilinks (from both frontmatter YAML values and body)
  // Walk frontmatter object recursively to extract wikilinks from string values only.
  // This avoids the fragility of JSON.stringify (wrong line numbers, escaped quotes,
  // matching in unexpected keys).
  const fmWikilinks = raw
    ? extractWikilinksFromObject(raw.data, 'frontmatter')
    : { wikilinks: [], errors: [] };
  const bodyWikilinks = extractWikilinks(body, 'body', bodyStartLine);
  errors.push(...fmWikilinks.errors, ...bodyWikilinks.errors);
  const allWikilinks = [...fmWikilinks.wikilinks, ...bodyWikilinks.wikilinks];

  // 4. Requirements (Feature only)
  const noteType = frontmatter?.type;
  let requirements = [];
  if (noteType === 'feature') {
    const reqResult = parseRequirements(sections);
    requirements = reqResult.requirements;
    errors.push(...reqResult.errors);
  }

  // 5. Delta Summary + Tasks (Change only)
  let deltaSummary = [];
  let tasks = [];
  if (noteType === 'change') {
    const deltaResult = parseDeltaSummary(sections);
    deltaSummary = deltaResult.entries;
    errors.push(...deltaResult.errors);

    const taskResult = parseTasks(sections);
    tasks = taskResult.tasks;
    errors.push(...taskResult.errors);
  }

  // 6. Content hash
  const contentHash = computeBodyHash(body);

  return {
    frontmatter,
    rawFrontmatter,
    sections,
    headings,
    wikilinks: allWikilinks,
    requirements,
    deltaSummary,
    tasks,
    body,
    contentHash,
    errors,
  };
}

/**
 * Convert a ParseResult into an IndexRecord.
 * 
 * This bridges the parser output to the index format.
 * Requires the file path and schema version as external inputs.
 *
 * Follows 00-unified-types.md IndexRecord shape exactly:
 * - `feature`/`features` fields for Change notes
 * - `created_at` for Change notes
 * - `tasks` as TaskItem[] (with `done`, without `line`)
 * - `requirements` as Requirement[] (with Scenario objects)
 *
 * IMPORTANT: Per 00-unified-types.md Ownership Rules, parsing and index-building
 * are separate concerns. This function produces a PRELIMINARY IndexRecord where:
 *
 * - Relationship fields (`systems`, `sources`, `decisions`, `changes`, `feature`,
 *   `features`, `depends_on`, `touches`, `links_out`) contain RAW wikilink strings
 *   (e.g. "[[Feature: Auth Login]]"), NOT resolved IDs.
 * - `links_in` is empty (computed by index-builder as reverse index).
 * - `requirements[].key` is empty placeholder (set by index-builder as
 *   `${feature_id}::${name}`).
 * - `delta_summary[].target_note_id` contains the raw wikilink target text
 *   (e.g. "Feature: Auth Login"), not a resolved ID.
 *
 * The index-builder (Plan 04) is responsible for:
 *   1. Resolving all wikilink strings to canonical IDs (overview 10.7)
 *   2. Computing `links_in` as the reverse index of `links_out`
 *   3. Setting `requirements[].key` composite keys
 *   4. Detecting duplicate IDs, unresolved wikilinks, etc.
 */
export function toIndexRecord(
  result: ParseResult,
  filePath: string,
  schemaVersion: string
): IndexRecord | null {
  if (!result.frontmatter) {
    return null; // Can't build index record without valid frontmatter
  }

  const fm = result.frontmatter;

  // Extract title from first H1 heading or derive from id
  const h1 = result.sections.find(s => s.level === 1);
  const title = h1?.title ?? fm.id;

  // Build links_out from wikilinks
  const linksOut = uniqueWikilinkTargets(result.wikilinks);

  // Helper to extract array field from frontmatter safely
  const getArray = (key: string): string[] => {
    const val = (fm as any)[key];
    return Array.isArray(val) ? val : [];
  };

  const getScalar = (key: string): string | undefined => {
    const val = (fm as any)[key];
    return typeof val === 'string' ? val : undefined;
  };

  return {
    schema_version: schemaVersion,
    id: fm.id,
    type: fm.type,
    title,
    aliases: getArray('aliases'),
    path: filePath,
    status: (fm as any).status ?? 'active',
    created_at: fm.type === 'change' ? getScalar('created_at') : undefined,
    tags: getArray('tags'),
    systems: getArray('systems'),
    sources: getArray('sources'),
    decisions: getArray('decisions'),
    changes: getArray('changes'),
    feature: getScalar('feature'),
    features: fm.type === 'change' ? getArray('features') : undefined,
    depends_on: getArray('depends_on'),
    touches: getArray('touches'),
    links_out: linksOut,
    links_in: [],  // Computed by index-builder (Plan 04) as reverse index
    headings: result.headings,
    requirements: result.requirements,
    delta_summary: result.deltaSummary,
    tasks: result.tasks.map(t => ({ text: t.text, done: t.done })),
    raw_text: result.body,
    content_hash: result.contentHash,
  };
}

function computeBodyHash(body: string): string {
  const hash = createHash('sha256').update(body, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Recursively walk a frontmatter object and extract wikilinks from string values.
 * Unlike JSON.stringify, this correctly handles nested objects and avoids
 * matching against keys or producing wrong line numbers.
 */
function extractWikilinksFromObject(
  obj: Record<string, unknown>,
  location: 'frontmatter' | 'body'
): { wikilinks: WikilinkOccurrence[]; errors: ParseError[] } {
  const allWikilinks: WikilinkOccurrence[] = [];
  const allErrors: ParseError[] = [];

  function walk(value: unknown): void {
    if (typeof value === 'string') {
      const { wikilinks, errors } = extractWikilinks(value, location, 1);
      allWikilinks.push(...wikilinks);
      allErrors.push(...errors);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) walk(v);
    }
  }

  walk(obj);
  return { wikilinks: allWikilinks, errors: allErrors };
}
```

### Content Hashing Strategy

Content hashing serves two purposes in open-wiki-spec:

1. **Requirement-level hashing** (`content_hash` on each requirement): Used for `base_fingerprint` comparison in stale-change detection. Computed from `normalize(normative + scenarios)`.

2. **Note-level hashing** (`content_hash` on IndexRecord): Used for index cache invalidation. Computed as SHA-256 of the entire body text.

**Normalization for requirement hashing:**

```
1. Concatenate normative statement and all scenario rawText.
2. Trim each part.
3. Collapse all whitespace runs to single spaces.
4. Join with single newline.
5. SHA-256 the result.
6. Return as "sha256:<hex>".
```

This ensures that:
- Minor formatting changes (extra spaces, trailing whitespace) do NOT change the hash.
- Meaningful content changes (different words, different scenarios) DO change the hash.
- Scenario order DOES affect the hash (reordering scenarios is a meaningful change).

### Error Handling for Malformed Notes

The parser follows a **collect-and-continue** strategy. It never throws on malformed input. Instead:

1. Each sub-parser returns `{ result, errors: ParseError[] }`.
2. Errors are accumulated in the final `ParseResult.errors` array.
3. Each error has a `level` ('error' or 'warning'), `source` (which sub-parser), `message`, and optional `line`.
4. The note-parser returns as much data as possible even when parts fail.

**Failure modes and recovery:**

| Failure | Recovery | Error Level |
|---------|----------|-------------|
| No frontmatter delimiter | Return null frontmatter, parse body as-is | error |
| Invalid YAML in frontmatter | Return null frontmatter, parse body as-is | error |
| Frontmatter fails Zod validation | Return null frontmatter, store rawFrontmatter for inspection | error |
| Unknown note type | Parse sections/wikilinks, skip type-specific parsing | warning |
| Requirement without normative | Include requirement with empty normative | warning |
| Requirement without scenarios | Include requirement with empty scenarios | warning |
| Unparseable Delta Summary line | Skip line, record warning | warning |
| Missing base_fingerprint | Include entry with null base_fingerprint | warning |
| Empty section | Include section with empty content | none (normal) |
| Malformed wikilink | Skip occurrence, record warning | warning |

### File Structure

```
src/core/parser/
  frontmatter-parser.ts       # extractFrontmatter(), validateFrontmatter()
  section-parser.ts            # parseSections(), findSection()
  wikilink-parser.ts           # extractWikilinks(), uniqueWikilinkTargets(), stripWikilinkSyntax()
  requirement-parser.ts        # parseRequirements()
  delta-summary-parser.ts      # parseDeltaSummary()
  task-parser.ts               # parseTasks()
  note-parser.ts               # parseNote(), toIndexRecord()
  types.ts                     # All parser output types
  index.ts                     # Re-exports
```

### Public API / Interface

```typescript
// src/core/parser/index.ts

export { extractFrontmatter, validateFrontmatter } from './frontmatter-parser.js';
export { parseSections, findSection } from './section-parser.js';
export { extractWikilinks, uniqueWikilinkTargets, stripWikilinkSyntax } from './wikilink-parser.js';
export { parseRequirements } from './requirement-parser.js';
export { parseDeltaSummary } from './delta-summary-parser.js';
export { parseTasks } from './task-parser.js';
export { parseNote, toIndexRecord } from './note-parser.js';
export type {
  RawFrontmatter,
  Section,
  WikilinkOccurrence,
  TaskItem,
  ParseError,
  ParseResult,
} from './types.js';
```

### Dependencies on Other Modules

- **Depends on**:
  - `yaml` (npm) -- YAML frontmatter parsing
  - `crypto` (node built-in) -- SHA-256 hashing
  - `src/core/schema/frontmatter.ts` -- `FrontmatterSchema` discriminated union and `Frontmatter` type (from Plan 02)
  - `src/core/schema/requirement.ts` -- `Requirement`/`Scenario` types (follows 00-unified-types.md)
  - `src/core/schema/delta-summary.ts` -- `DeltaSummaryEntry`/`DeltaOpEnum` types (follows 00-unified-types.md)
  - `src/types/index-record.ts` -- `IndexRecord` type (follows 00-unified-types.md)

- **Depended on by**:
  - `src/core/index-engine/build.ts` -- calls `parseNote(filePath)` for each vault file. Imports `stripWikilinkSyntax()` for wikilink resolution.
  - `src/core/validation/` -- uses `parseNote()` for verify checks
  - `src/core/workflow/apply.ts` -- uses requirement-parser and delta-summary-parser for apply operations

---

## 4. Test Strategy

### Unit Tests Per Sub-Parser

**frontmatter-parser.test.ts:**
- Valid frontmatter with all fields extracts correctly.
- Missing opening `---` returns null with error.
- Missing closing `---` returns null with error.
- Invalid YAML returns null with error.
- Frontmatter with wikilink string values extracts correctly.
- Non-object YAML (array, scalar) returns null with error.
- Frontmatter validation: valid Feature, Change, System, Decision, Source, Query.
- Frontmatter validation: missing type field fails.
- Frontmatter validation: wrong id prefix fails.
- Frontmatter validation: both feature and features fails for Change.

**section-parser.test.ts:**
- Single H1 heading produces one root section.
- Nested headings (H1 > H2 > H3) produce correct tree structure.
- Multiple H2 sections at same level are siblings.
- Section content excludes child heading content.
- Empty section (heading with no body before next heading) has empty content.
- No headings in body produces empty sections array.
- Line numbers are correctly tracked.

**wikilink-parser.test.ts:**
- Simple wikilink `[[Feature: Auth Login]]` extracts correctly.
- Wikilink with alias `[[Feature: Auth Login|Auth]]` extracts target and alias.
- Multiple wikilinks on one line all extracted.
- Wikilinks in frontmatter YAML strings extracted.
- Wikilinks in body text extracted.
- Empty wikilink `[[]]` produces warning.
- Nested brackets handled correctly.
- Special characters in wikilink targets (colons, hyphens, spaces).

**requirement-parser.test.ts:**
- Feature with 2 requirements, each with scenarios, parsed correctly.
- Requirement names extracted from `### Requirement: <name>`.
- Normative statement is content before first child heading.
- Scenarios extracted from `#### Scenario: <name>` children.
- Duplicate requirement name produces error.
- Missing normative produces warning.
- Missing SHALL/MUST produces warning.
- Missing scenarios produces warning.
- Missing WHEN/THEN in scenario produces warning.
- Content hash computed and stable across whitespace changes.
- Content hash changes when normative content changes.

**delta-summary-parser.test.ts:**
- ADDED requirement line parsed correctly.
- MODIFIED requirement line with base fingerprint parsed.
- REMOVED requirement line parsed.
- RENAMED requirement line with old/new names parsed.
- Section operation lines parsed.
- Base fingerprint "n/a" normalized to null.
- Missing base fingerprint on MODIFIED produces warning.
- Unparseable delta line produces warning.
- Lines without delta op prefix are ignored.
- Description after colon extracted.
- Multiple entries in one Delta Summary section all parsed.

**task-parser.test.ts:**
- Unchecked task `- [ ] text` parsed as done: false.
- Checked task `- [x] text` parsed as done: true.
- Uppercase `- [X] text` parsed as done: true.
- Tasks in nested subsections within Tasks section are found.
- Non-task list items (no checkbox) are ignored.
- Empty Tasks section returns empty array.

**note-parser.test.ts:**
- Full Feature note with frontmatter + requirements + wikilinks parsed into complete ParseResult.
- Full Change note with frontmatter + delta summary + tasks parsed.
- System note parsed with required sections identified.
- Note with invalid frontmatter still returns sections and wikilinks.
- `toIndexRecord()` produces valid IndexRecord from ParseResult.
- `toIndexRecord()` returns null for notes with invalid frontmatter.
- Content hash is deterministic for same content.

### Integration Tests

- Parse a complete test vault (in `tests/fixtures/vault/`) with all 6 note types.
- Verify all notes produce valid IndexRecords.
- Verify wikilink cross-references resolve within the test vault.
- Verify requirement content hashes are stable across multiple parses.

### Edge Cases

- Note with only frontmatter and no body.
- Note with body but no headings.
- Note with deeply nested headings (H1 > H2 > H3 > H4 > H5 > H6).
- Very large note (> 100KB).
- Note with code blocks containing `---` (should not be misinterpreted as frontmatter).
- Note with code blocks containing `#` (should not be misinterpreted as headings).
- Wikilinks inside code blocks MUST be IGNORED during extraction (code fence detection, same approach as section-parser).
- Frontmatter with multiline string values.
- UTF-8 content with non-ASCII characters in titles, requirement names.
- Mixed line endings (CRLF + LF in same file).

---

## 5. Implementation Order

### Prerequisites
- Plan 01 (Project Structure) complete: `package.json`, `tsconfig.json`, `src/core/parser/` directory exists.
- Plan 02 (Note Templates) complete: `src/core/schema/` module with all Zod schemas available.

### Build Order

1. **`types.ts`**: Define all parser output types (RawFrontmatter, Section, WikilinkOccurrence, TaskItem, ParseError, ParseResult). No dependencies.

2. **`frontmatter-parser.ts`**: Implement `extractFrontmatter()` and `validateFrontmatter()`. Depends on `yaml` npm package and `src/core/schema/frontmatter.ts`. Write tests.

3. **`section-parser.ts`**: Implement `parseSections()` and `findSection()`. No dependencies on other parser files. Write tests.

4. **`wikilink-parser.ts`**: Implement `extractWikilinks()`, `uniqueWikilinkTargets()`, and `stripWikilinkSyntax()`. Wikilink extraction must skip fenced code blocks (same approach as section-parser). No dependencies on other parser files. Write tests.

5. **`task-parser.ts`**: Implement `parseTasks()`. Depends on `section-parser.ts` (`findSection`). Write tests.

6. **`requirement-parser.ts`**: Implement `parseRequirements()`. Depends on `section-parser.ts` (`findSection`) and `crypto`. Write tests.

7. **`delta-summary-parser.ts`**: Implement `parseDeltaSummary()`. Depends on `section-parser.ts` (`findSection`) and `src/core/schema/delta-summary.ts`. Write tests.

8. **`note-parser.ts`**: Implement `parseNote()` and `toIndexRecord()`. Depends on all sub-parsers. Write integration tests.

9. **`index.ts`**: Re-export all modules.

10. **Create test fixtures**: Build a minimal test vault under `tests/fixtures/vault/` with representative notes of each type.

### Dependency Graph

```
types.ts (no deps)
  │
  ├──► frontmatter-parser.ts (depends on yaml, schema/frontmatter)
  ├──► section-parser.ts (no deps)
  ├──► wikilink-parser.ts (no deps)
  ├──► task-parser.ts (depends on section-parser)
  ├──► requirement-parser.ts (depends on section-parser, crypto)
  └──► delta-summary-parser.ts (depends on section-parser, schema/delta-summary)
         │
         └──► note-parser.ts (depends on ALL sub-parsers)
```
