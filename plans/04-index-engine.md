# Index Engine Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec uses an **artifact dependency graph** to manage the state of a change's artifacts (proposal, design, tasks, specs). The graph is defined by a YAML schema that declares artifacts, their dependencies (`requires`), and their output files (`generates`). Completion is detected by checking whether the generated file exists on disk.

Key characteristics:

- The graph is a **DAG of artifact types** within a single change, not a graph of all project knowledge.
- State detection is purely filesystem-based: if the file at `artifact.generates` exists, the artifact is "done."
- The graph supports topological sort (Kahn's algorithm) for build order and can identify which artifacts are "ready" (all deps satisfied) or "blocked."
- There is no index of note content, no frontmatter parsing, no wikilink resolution, and no cross-note relationship tracking.
- Schema validation (Zod) checks for duplicate IDs, dangling `requires` references, and cyclic dependencies.
- The `CompletedSet` is a simple `Set<string>` of artifact IDs.

### Key Source Files

| File | Description |
|------|-------------|
| `src/core/artifact-graph/graph.ts` | `ArtifactGraph` class: Map-based DAG with Kahn's topological sort, `getNextArtifacts()`, `isComplete()`, `getBlocked()` |
| `src/core/artifact-graph/state.ts` | `detectCompleted()`: walks the change directory, checks file existence (supports globs) to build `CompletedSet` |
| `src/core/artifact-graph/types.ts` | Zod schemas for `Artifact`, `SchemaYaml`, `ChangeMetadata`; TypeScript types `CompletedSet = Set<string>`, `BlockedArtifacts` |
| `src/core/artifact-graph/schema.ts` | YAML loading, Zod validation, cycle detection (DFS), duplicate-ID check, dangling-reference check |
| `src/core/artifact-graph/index.ts` | Barrel re-exports for the entire artifact-graph module |
| `src/core/list.ts` | `ListCommand`: iterates change directories, reads task progress, formats output |

### Core Algorithm / Flow

1. A YAML schema file is loaded and validated (Zod parse, duplicate IDs, dangling references, cycle detection).
2. `ArtifactGraph` stores artifacts in a `Map<string, Artifact>` keyed by `artifact.id`.
3. `detectCompleted()` scans the change directory for each artifact's `generates` path (file existence or glob match).
4. `getNextArtifacts(completed)` returns IDs where all `requires` are in the completed set.
5. `getBuildOrder()` uses Kahn's algorithm with deterministic tie-breaking (alphabetical sort).
6. `isComplete(completed)` returns true when every artifact ID is in the completed set.

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

The index engine is governed primarily by **section 10** of overview.md:

- **10.1**: The vault is the truth; the index is a disposable derived cache. Even if damaged, it must be reconstructable by rescanning raw markdown.
- **10.1.1**: Schema version tracked in `wiki/00-meta/schema.md`. Index build records `schema_version`. Verify detects schema mismatch.
- **10.2**: Fresh vault scan at the start of `propose`, `query`, and `verify`. Default is in-memory index. Disk cache optional, invalidated by `mtime + file size + content hash`.
- **10.3**: Index record shape with composite requirement keys (`feature_id::requirement_name`), `content_hash`, `delta_summary`, `links_out`, `links_in` (computed as reverse index), and more.
- **10.7**: Wikilink-to-ID normalization: exact title match, then alias match, then ambiguous/invalid error. Machines always store `id`.
- **Section 11.1**: `id` is immutable canonical identity. Title and path can change.
- **Section 11.2**: On index rebuild, `id -> path/title/aliases` mapping is recalculated.

### Differences from OpenSpec

| Dimension | OpenSpec | open-wiki-spec |
|-----------|----------|----------------|
| What is indexed | Artifact types within one change (proposal, design, tasks) | All typed notes across the entire vault (Feature, Change, System, Decision, Source, Query) |
| Index key | Artifact ID (from YAML schema) | Note `id` (from frontmatter) |
| Completion signal | File existence on disk | Not applicable; index tracks note content, not completion |
| Graph model | DAG of artifact dependencies within a change | Knowledge graph of notes linked by wikilinks and frontmatter references |
| Schema source | YAML file per workflow type | `wiki/00-meta/schema.md` for vault-wide schema version |
| Reverse links | Not tracked | `links_in` computed as reverse index from all notes' `links_out` |
| Content hashing | Not done | `content_hash` per note, `content_hash` per requirement for stale-base detection |
| Requirements parsing | Separate spec files with their own parser | Requirements extracted from `## Requirements` section of Feature notes |
| Delta summary | Not a concept | Parsed from Change notes for operation validation |
| Wikilink resolution | Not applicable (no wikilinks) | Full normalization pipeline: wikilink -> title match -> alias match -> id |

### Contracts to Satisfy

1. Every typed note parsed into the record shape from section 10.3.
2. `links_in` computed as reverse index after all notes are parsed.
3. Wikilink normalization follows section 10.7 exactly.
4. Schema version from `wiki/00-meta/schema.md` recorded with each index build.
5. Fresh scan on every `propose`, `query`, `verify` invocation.
6. Disk cache invalidation uses `mtime + file size + content hash` (section 10.2).
7. Requirement identity uses composite key `feature_id::requirement_name` (section 10.3).
8. `content_hash` computed for requirement bodies (normative + scenarios) for stale-base detection.

---

## 3. Implementation Plan

### Architecture Overview

```
                    +-----------------+
                    |   Vault (disk)  |
                    |  wiki/**/*.md   |
                    +--------+--------+
                             |
                     fresh scan on
                   propose/query/verify
                             |
                             v
                    +--------+--------+
                    |  Index Engine   |
                    |                 |
                    | 1. Scan files   |
                    | 2. Parse notes  |
                    | 3. Build index  |
                    | 4. Resolve links|
                    | 5. Compute      |
                    |    reverse idx  |
                    +--------+--------+
                             |
                             v
                    +--------+--------+
                    |  VaultIndex     |
                    |  (in-memory)    |
                    |                 |
                    |  Map<id, rec>   |
                    |  links_in map   |
                    |  path->id map   |
                    |  title->id map  |
                    |  alias->id map  |
                    +-----------------+
```

The Index Engine is a stateless builder. Each call to `buildIndex(vaultRoot)` produces a fresh `VaultIndex` object. The engine depends on the Vault Parser (plan 03) for all note parsing. Per the ownership rules in `00-unified-types.md`, the index engine does NOT re-parse frontmatter or sections; it calls `parseNote()` from plan 03 for each `.md` file and then transforms the resulting `ParseResult[]` into a `VaultIndex` by resolving wikilinks to IDs, computing the reverse index (`links_in`), detecting duplicate IDs, and checking the schema version.

### Data Structures

```typescript
// ---- Index Record (section 10.3 contract) ----

interface Requirement {
  /** Stable name from `### Requirement: <name>` header */
  name: string;
  /** Composite key: `${feature_id}::${name}` */
  key: string;
  /** Normative statement containing SHALL or MUST */
  normative: string;
  /** Array of scenario objects */
  scenarios: Scenario[];
  /** SHA-256 hash of normalized (normative + scenarios) body, format: `sha256:<hex>` */
  content_hash: string;
}

interface Scenario {
  /** Name from `#### Scenario: <name>` header */
  name: string;
  /** Raw text of the scenario (WHEN/THEN lines) */
  raw_text: string;
}

type DeltaOp = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
type DeltaTargetType = 'requirement' | 'section';

interface DeltaSummaryEntry {
  op: DeltaOp;
  target_type: DeltaTargetType;
  /** Name of the requirement or section */
  target_name: string;
  /** For RENAMED: the new name */
  new_name?: string;
  /** Wikilink-resolved feature/note id */
  target_note_id: string;
  /** SHA-256 hash of the target at time of writing. null for ADDED. */
  base_fingerprint: string | null;
  /** Free-text description of the change */
  description?: string;
}

type NoteType = 'feature' | 'change' | 'system' | 'decision' | 'source' | 'query';
type ChangeStatus = 'proposed' | 'planned' | 'in_progress' | 'applied';
type FeatureStatus = 'active' | 'deprecated';
type GeneralStatus = 'active' | 'draft' | 'archived';

interface TaskItem {
  text: string;
  done: boolean;
}

interface IndexRecord {
  // ---- Identity ----
  /** Schema version from wiki/00-meta/schema.md at build time */
  schema_version: string;
  /** Immutable frontmatter id */
  id: string;
  /** Note type from frontmatter */
  type: NoteType;
  /** Note title (h1 or filename) */
  title: string;
  /** Frontmatter aliases */
  aliases: string[];
  /** File path relative to vault root */
  path: string;
  /** Frontmatter status */
  status: string;
  /** Frontmatter tags */
  tags: string[];

  // ---- Relationship fields (stored as resolved ids) ----
  /** System note ids this note belongs to */
  systems: string[];
  /** Source note ids referenced */
  sources: string[];
  /** Decision note ids referenced */
  decisions: string[];
  /** Change note ids linked (from Feature) */
  changes: string[];
  /** Dependency change ids (from Change) */
  depends_on: string[];
  /** Feature/System ids this Change touches */
  touches: string[];
  /** All outgoing wikilink targets resolved to ids */
  links_out: string[];
  /** All incoming links (computed in reverse-index pass) */
  links_in: string[];

  // ---- Feature-specific ----
  /** Parsed heading names */
  headings: string[];
  /** Parsed requirements (Feature only; empty for other types) */
  requirements: Requirement[];

  // ---- Change-specific ----
  /** Parsed delta summary entries (Change only; empty for other types) */
  delta_summary: DeltaSummaryEntry[];
  /** Parsed task checklist items (Change only; empty for other types) */
  tasks: TaskItem[];
  /** Feature target: singular feature id (from `feature:` field) */
  feature?: string;
  /** Feature targets: multiple feature ids (from `features:` field) */
  features?: string[];
  /** created_at date string for deterministic ordering */
  created_at?: string;

  // ---- Content ----
  /** Full raw markdown text (for full-text search) */
  raw_text: string;
  /** SHA-256 hash of the entire file content, format: `sha256:<hex>` */
  content_hash: string;

  // ---- Cache invalidation (implementation-only, not part of canonical IndexRecord shape) ----
  /** File modification time (epoch ms) */
  mtime: number;
  /** File size in bytes */
  file_size: number;
}
```

```typescript
// ---- Lookup Maps ----

interface WikilinkResolution {
  target_id: string;
  resolved_via: 'title' | 'alias';
}

interface WikilinkError {
  source_id: string;
  source_path: string;
  raw_link: string;
  error: 'no_match' | 'ambiguous_alias' | 'missing_id';
  candidates?: string[];  // for ambiguous
}

// ---- Index Warning (matches 00-unified-types.md) ----

interface IndexWarning {
  type: 'duplicate_id' | 'unresolved_wikilink' | 'ambiguous_alias' |
        'missing_id' | 'schema_mismatch' | 'invalid_frontmatter';
  note_path: string;
  message: string;
}

// ---- Vault Index (the full in-memory index) ----
// Canonical shape from 00-unified-types.md, plus internal lookup maps.

interface VaultIndex {
  /** Schema version recorded at build time */
  schema_version: string;
  /** Scan timestamp (ISO) */
  scanned_at: string;
  /** All records keyed by id */
  records: Map<string, IndexRecord>;
  /** Structured warnings (canonical shape for consumers) */
  warnings: IndexWarning[];

  // ---- Internal lookup maps (implementation convenience, not part of canonical shape) ----
  /** Reverse map: file path -> id */
  path_to_id: Map<string, string>;
  /** Reverse map: lowercase title -> id[] (should be length 1 ideally) */
  title_to_ids: Map<string, string[]>;
  /** Reverse map: lowercase alias -> id[] */
  alias_to_ids: Map<string, string[]>;
  /** Wikilink resolution errors accumulated during build */
  link_errors: WikilinkError[];
  /** Duplicate id errors */
  duplicate_ids: Map<string, string[]>;  // id -> [paths]
  /** Notes without an id field */
  missing_ids: string[];  // paths
}
```

### Core Algorithm

#### Step 1: Scan vault files

```
function scanVaultFiles(vaultRoot: string): FileEntry[]
  pattern = path.join(vaultRoot, "wiki", "**", "*.md")
  files = glob(pattern)
  return files.map(f => ({
    path: relativePath(vaultRoot, f),
    absolutePath: f,
    stat: fs.statSync(f)   // mtime, size
  }))
```

#### Step 2: Read schema version

```
function readSchemaVersion(vaultRoot: string): string
  schemaPath = path.join(vaultRoot, "wiki", "00-meta", "schema.md")
  if not exists(schemaPath):
    return "unknown"
  // Use plan 03's extractFrontmatter for lightweight schema read
  content = readFile(schemaPath)
  fm = extractFrontmatter(content)
  return fm.schema_version ?? "unknown"
```

#### Step 3: Parse each note via Vault Parser (plan 03)

Per the ownership rules in `00-unified-types.md`, all parsing is owned by the vault-parser (plan 03). The index engine calls `parseNote()` and does NOT re-parse frontmatter, sections, wikilinks, requirements, delta summary, or tasks.

```
function parseNoteToRawRecord(
  fileEntry: FileEntry,
  schemaVersion: string
): { raw: RawRecord | null, missingId: boolean, invalidFrontmatter: boolean }
  // Delegate ALL parsing to plan 03
  parseResult = parseNote(fileEntry.absolutePath)

  // parseNote returns ParseResult with frontmatter: null for non-typed notes.
  // Distinguish between "no frontmatter" (meta files) and "invalid frontmatter"
  // (has --- delimiters but YAML parsing failed).
  if parseResult.frontmatter is null:
    // Check if this file had frontmatter delimiters but failed validation
    if parseResult.rawFrontmatter is not null:
      // File has frontmatter delimiters but YAML was invalid or type/schema failed
      hasParseErrors = parseResult.errors.some(e => e.source === 'frontmatter' && e.level === 'error')
      if hasParseErrors:
        return { raw: null, missingId: false, invalidFrontmatter: true }
    return { raw: null, missingId: false, invalidFrontmatter: false }

  fm = parseResult.frontmatter

  // Skip notes without a valid type
  if fm.type not in VALID_NOTE_TYPES:
    return { raw: null, missingId: false, invalidFrontmatter: false }

  // Skip notes without id (flag as missing_id for caller to record)
  if not fm.id:
    return { raw: null, missingId: true, invalidFrontmatter: false }

  // Extract title from first H1 heading or frontmatter id
  title = parseResult.headings.length > 0
    ? parseResult.headings[0]
    : fm.id

  record = {
    schema_version: schemaVersion,
    id: fm.id,
    type: fm.type,
    title: title,
    aliases: fm.aliases ?? [],
    path: fileEntry.path,
    status: fm.status ?? "active",
    tags: fm.tags ?? [],
    created_at: fm.created_at ?? null,

    // Raw wikilink strings from parseResult (not yet resolved to ids)
    systems_raw: fm.systems ?? [],
    sources_raw: fm.sources ?? [],
    decisions_raw: fm.decisions ?? [],
    changes_raw: fm.changes ?? [],
    depends_on_raw: fm.depends_on ?? [],
    touches_raw: fm.touches ?? [],
    feature_raw: fm.feature ?? null,
    features_raw: fm.features ?? null,

    headings: parseResult.headings,
    requirements: parseResult.requirements,   // already parsed by plan 03
    delta_summary: parseResult.deltaSummary,  // already parsed by plan 03 (camelCase)
    tasks: parseResult.tasks,                 // already parsed by plan 03

    links_out_raw: parseResult.wikilinks,     // extracted by plan 03
    raw_text: parseResult.body,               // body text from plan 03 (camelCase)
    content_hash: parseResult.contentHash,    // SHA-256 from plan 03 (camelCase)
    mtime: fileEntry.stat.mtimeMs,
    file_size: fileEntry.stat.size,
  }
  return { raw: record, missingId: false, invalidFrontmatter: false }
```

#### Step 4: Build lookup maps for wikilink resolution

```
function buildLookupMaps(rawRecords: RawRecord[]): LookupMaps
  title_to_ids = new Map<string, string[]>()
  alias_to_ids = new Map<string, string[]>()
  path_to_id = new Map<string, string>()

  for record in rawRecords:
    // Title map (lowercase for case-insensitive matching)
    key = record.title.toLowerCase()
    title_to_ids.getOrDefault(key, []).push(record.id)

    // Alias map
    for alias in record.aliases:
      akey = alias.toLowerCase()
      alias_to_ids.getOrDefault(akey, []).push(record.id)

    // Path map
    path_to_id.set(record.path, record.id)

  return { title_to_ids, alias_to_ids, path_to_id }
```

#### Step 5: Resolve wikilinks to ids (section 10.7)

Uses `stripWikilinkSyntax()` imported from plan 03 (vault-parser). This function is NOT defined locally -- per 00-unified-types.md ownership rules, all parsing logic belongs to plan 03.

```
// import { stripWikilinkSyntax } from '../parser/wikilink-parser.js';

function resolveWikilink(
  raw: string,
  lookups: LookupMaps
): WikilinkResolution | WikilinkError

  // Strip wikilink syntax: "[[Feature: Auth Login]]" -> "Feature: Auth Login"
  // Also handle "[[Feature: Auth Login|display text]]" -> "Feature: Auth Login"
  target = stripWikilinkSyntax(raw)
  normalized = target.toLowerCase()

  // Step 1: exact match against title
  titleMatches = lookups.title_to_ids.get(normalized) ?? []
  if titleMatches.length === 1:
    return { target_id: titleMatches[0], resolved_via: "title" }
  if titleMatches.length > 1:
    // Multiple notes with same title - still try to resolve if all same id (unlikely)
    uniqueIds = new Set(titleMatches)
    if uniqueIds.size === 1:
      return { target_id: titleMatches[0], resolved_via: "title" }
    // Ambiguous title - fall through to alias check? No, report error.
    return { error: "ambiguous_alias", raw_link: raw, candidates: titleMatches }

  // Step 2: exact match against alias
  aliasMatches = lookups.alias_to_ids.get(normalized) ?? []
  if aliasMatches.length === 1:
    return { target_id: aliasMatches[0], resolved_via: "alias" }
  if aliasMatches.length > 1:
    return { error: "ambiguous_alias", raw_link: raw, candidates: aliasMatches }

  // Step 3: no match
  return { error: "no_match", raw_link: raw }
```

#### Step 6: Resolve all relationship fields

```
function resolveRecordLinks(
  rawRecord: RawRecord,
  lookups: LookupMaps,
  errors: WikilinkError[]
): IndexRecord

  function resolveArray(rawLinks: string[]): string[]
    ids = []
    for raw in rawLinks:
      result = resolveWikilink(raw, lookups)
      if result.target_id:
        ids.push(result.target_id)
      else:
        errors.push({ source_id: rawRecord.id, source_path: rawRecord.path, ...result })
    return ids

  function resolveSingle(raw: string | null): string | undefined
    if raw is null: return undefined
    result = resolveWikilink(raw, lookups)
    if result.target_id: return result.target_id
    errors.push({ source_id: rawRecord.id, source_path: rawRecord.path, ...result })
    return undefined

  record: IndexRecord = {
    ...rawRecord,  // copy identity + content fields
    systems: resolveArray(rawRecord.systems_raw),
    sources: resolveArray(rawRecord.sources_raw),
    decisions: resolveArray(rawRecord.decisions_raw),
    changes: resolveArray(rawRecord.changes_raw),
    depends_on: resolveArray(rawRecord.depends_on_raw),
    touches: resolveArray(rawRecord.touches_raw),
    feature: resolveSingle(rawRecord.feature_raw),
    features: rawRecord.features_raw
      ? resolveArray(rawRecord.features_raw)
      : undefined,
    links_out: resolveArray(rawRecord.links_out_raw),
    links_in: [],  // populated in next step

    // Resolve delta_summary[].target_note_id from raw wikilinks to ids
    // Per 00-unified-types.md: target_note_id is "Wikilink-resolved feature/note id"
    delta_summary: rawRecord.delta_summary.map(entry => ({
      ...entry,
      target_note_id: (() => {
        const resolved = resolveWikilink(entry.target_note_id, lookups)
        if (resolved.target_id) return resolved.target_id
        errors.push({ source_id: rawRecord.id, source_path: rawRecord.path, ...resolved })
        return entry.target_note_id  // fallback to raw value
      })()
    })),

    // Compute requirement composite keys: key = feature_id + "::" + name
    // Per 00-unified-types.md: the index engine computes composite keys after parsing.
    // Plan 03's parser returns key as empty placeholder.
    requirements: rawRecord.requirements.map(req => ({
      ...req,
      key: rawRecord.id + '::' + req.name,
    })),
  }
  return record
```

#### Step 7: Compute reverse index (links_in)

```
function computeReverseIndex(records: Map<string, IndexRecord>): void
  // Clear all links_in first
  for record in records.values():
    record.links_in = []

  // For every note, add the note's id to each of its links_out targets' links_in
  for record in records.values():
    for targetId in record.links_out:
      targetRecord = records.get(targetId)
      if targetRecord:
        if record.id not in targetRecord.links_in:
          targetRecord.links_in.push(record.id)

  // Sort links_in for determinism
  for record in records.values():
    record.links_in.sort()
```

#### Step 8: Detect duplicate ids

```
function detectDuplicateIds(rawRecords: RawRecord[]): Map<string, string[]>
  idToPaths = new Map<string, string[]>()
  for record in rawRecords:
    idToPaths.getOrDefault(record.id, []).push(record.path)

  duplicates = new Map<string, string[]>()
  for [id, paths] in idToPaths:
    if paths.length > 1:
      duplicates.set(id, paths)
  return duplicates
```

#### Step 8.5: Build canonical warnings

```
function buildWarnings(
  duplicateIds: Map<string, string[]>,
  linkErrors: WikilinkError[],
  missingIds: string[],
  invalidFrontmatterPaths: string[],
  schemaVersion: string
): IndexWarning[]

  warnings: IndexWarning[] = []

  // Invalid frontmatter (files that look like notes but have unparseable YAML)
  for path in invalidFrontmatterPaths:
    warnings.push({
      type: "invalid_frontmatter",
      note_path: path,
      message: "File has frontmatter delimiters but YAML could not be parsed"
    })

  // Duplicate IDs
  for [id, paths] in duplicateIds:
    for path in paths:
      warnings.push({
        type: "duplicate_id",
        note_path: path,
        message: "Duplicate id \"" + id + "\" also found in: " + paths.filter(p => p !== path).join(", ")
      })

  // Unresolved wikilinks
  for error in linkErrors:
    if error.error === "no_match":
      warnings.push({
        type: "unresolved_wikilink",
        note_path: error.source_path,
        message: "Unresolved wikilink \"" + error.raw_link + "\""
      })
    elif error.error === "ambiguous_alias":
      warnings.push({
        type: "ambiguous_alias",
        note_path: error.source_path,
        message: "Ambiguous alias \"" + error.raw_link + "\", candidates: " + error.candidates.join(", ")
      })

  // Missing IDs
  for path in missingIds:
    warnings.push({
      type: "missing_id",
      note_path: path,
      message: "Typed note has no id field"
    })

  // Schema mismatch
  if schemaVersion === "unknown":
    warnings.push({
      type: "schema_mismatch",
      note_path: "wiki/00-meta/schema.md",
      message: "No schema.md found or schema_version is missing"
    })

  return warnings
```

#### Step 9: Assemble VaultIndex

```
function buildIndex(vaultRoot: string): VaultIndex
  // Step 1: Scan
  files = scanVaultFiles(vaultRoot)

  // Step 2: Schema version
  schemaVersion = readSchemaVersion(vaultRoot)

  // Step 3: Parse into raw records
  // parseNoteToRawRecord calls plan 03's parseNote(filePath) internally.
  // It returns null when: frontmatter is null, type is invalid, or id is missing.
  // No separate isTypedNote() function is needed -- the null-frontmatter check
  // in parseNoteToRawRecord handles non-typed files.
  rawRecords: RawRecord[] = []
  missingIds: string[] = []
  invalidFrontmatterPaths: string[] = []
  for file in files:
    { raw, missingId, invalidFrontmatter } = parseNoteToRawRecord(file, schemaVersion)
    if invalidFrontmatter:
      invalidFrontmatterPaths.push(file.path)
      continue
    if missingId:
      missingIds.push(file.path)
      continue
    if raw is null:
      continue
    rawRecords.push(raw)

  // Step 4: Build lookup maps
  lookups = buildLookupMaps(rawRecords)

  // Step 5-6: Resolve links
  linkErrors: WikilinkError[] = []
  records = new Map<string, IndexRecord>()
  duplicateIds = detectDuplicateIds(rawRecords)

  for raw in rawRecords:
    // Skip duplicate ids (keep first occurrence by path sort order)
    if duplicateIds.has(raw.id):
      paths = duplicateIds.get(raw.id)!
      if raw.path !== paths.sort()[0]:
        continue

    resolved = resolveRecordLinks(raw, lookups, linkErrors)
    records.set(resolved.id, resolved)

  // Step 7: Compute reverse index
  computeReverseIndex(records)

  // Step 8: Build canonical warnings (IndexWarning[])
  warnings = buildWarnings(duplicateIds, linkErrors, missingIds, invalidFrontmatterPaths, schemaVersion)

  return {
    schema_version: schemaVersion,
    scanned_at: new Date().toISOString(),
    records,
    warnings,
    path_to_id: lookups.path_to_id,
    title_to_ids: lookups.title_to_ids,
    alias_to_ids: lookups.alias_to_ids,
    link_errors: linkErrors,
    duplicate_ids: duplicateIds,
    missing_ids: missingIds,
  }
```

### File Structure

| File | Responsibility |
|------|---------------|
| `src/core/index-engine/types.ts` | All TypeScript interfaces: `IndexRecord`, `Requirement`, `Scenario`, `DeltaSummaryEntry`, `VaultIndex`, `IndexWarning`, `WikilinkResolution`, `WikilinkError`, `NoteType`, `ChangeStatus`, `FeatureStatus`, `GeneralStatus`, `TaskItem`. All types must match `00-unified-types.md`. |
| `src/core/index-engine/build.ts` | `buildIndex(vaultRoot): VaultIndex` - the main entry point. Orchestrates scan, parse, resolve, reverse-index |
| `src/core/index-engine/scan.ts` | `scanVaultFiles(vaultRoot): FileEntry[]` - glob-based file discovery |
| `src/core/index-engine/resolve.ts` | `buildLookupMaps()`, `resolveWikilink()`, `resolveRecordLinks()` - wikilink-to-id normalization |
| `src/core/index-engine/reverse.ts` | `computeReverseIndex()` - populates `links_in` on all records |
| `src/core/index-engine/schema-version.ts` | `readSchemaVersion()` - reads `wiki/00-meta/schema.md` frontmatter |
| `src/core/index-engine/validate.ts` | `detectDuplicateIds()`, `collectMissingIds()`, `buildWarnings()` - structural integrity checks and canonical `IndexWarning[]` construction |
| `src/core/index-engine/cache.ts` | Optional disk cache: serialize/deserialize `VaultIndex`, invalidation by `mtime + size + hash` |
| `src/core/index-engine/index.ts` | Barrel re-exports |

### Public API / Interface

```typescript
// ---- Main entry point ----

/**
 * Build a fresh in-memory index of all typed notes in the vault.
 * Called at the start of propose, query, and verify.
 *
 * @param vaultRoot - Absolute path to the vault root (parent of wiki/)
 * @param options - Optional: enable disk cache, custom glob patterns
 * @returns A complete VaultIndex with all records, lookup maps, and errors
 */
function buildIndex(vaultRoot: string, options?: BuildOptions): VaultIndex;

interface BuildOptions {
  /** Enable disk cache. Default: false */
  useCache?: boolean;
  /** Custom glob pattern override. Default: "wiki/**/*.md" */
  globPattern?: string;
}

// ---- Convenience accessors ----
// VaultIndex is constructed as a plain data object by buildIndex().
// These are standalone utility functions that operate on a VaultIndex instance.
// (Alternatively, VaultIndex can be wrapped in a class at implementation time,
// but the canonical data shape is the interface defined above.)

namespace VaultIndexUtils {
  /** Get a record by id. O(1). */
  getById(id: string): IndexRecord | undefined;

  /** Get a record by file path. O(1). */
  getByPath(path: string): IndexRecord | undefined;

  /** Get all records of a given type. */
  getByType(type: NoteType): IndexRecord[];

  /** Get all records with a given status. */
  getByStatus(status: string): IndexRecord[];

  /** Get records linked to a given system id. */
  getBySystem(systemId: string): IndexRecord[];

  /** Resolve a raw wikilink string to an id. */
  resolveWikilink(raw: string): string | WikilinkError;

  /** Get all link errors. */
  getLinkErrors(): WikilinkError[];

  /** Get all duplicate id warnings. */
  getDuplicateIds(): Map<string, string[]>;

  /** Check if the index has any structural warnings. */
  hasWarnings(): boolean;

  /** Get all records whose links_out include the given id. */
  getLinkedFrom(targetId: string): IndexRecord[];

  /** Get all records whose links_in include the given id (same as record.links_in). */
  getLinkedTo(sourceId: string): IndexRecord[];

  /** Check if the index has any warnings of the given type. */
  hasWarningType(type: IndexWarning['type']): boolean;
}
```

### Dependencies on Other Modules

| Module | What is needed |
|--------|---------------|
| **03-vault-parser** | `parseNote(filePath): ParseResult` — the single entry point for all note parsing (frontmatter, title, headings, wikilinks, requirements, delta summary, tasks, content_hash). Also `extractFrontmatter(content)` for lightweight schema version read. `stripWikilinkSyntax(raw)` for wikilink resolution. The index engine does NOT call individual sub-parsers; it consumes the `ParseResult` aggregate. |
| **02-note-templates** | `VALID_NOTE_TYPES` constant, frontmatter field definitions per note type |
| **01-project-structure** | Vault root path convention, `wiki/` directory structure |

---

## 4. Test Strategy

### Unit Tests

1. **Wikilink resolution (resolveWikilink)**
   - Exact title match resolves correctly
   - Case-insensitive title match works
   - Alias match works when no title match exists
   - Ambiguous alias (2 notes with same alias) returns error
   - No match returns error
   - Display text in wikilink (`[[Note|display]]`) is stripped correctly
   - Title with special characters resolves correctly

2. **Lookup map construction (buildLookupMaps)**
   - Title map is case-insensitive
   - Multiple aliases per note all get indexed
   - Path-to-id map is one-to-one

3. **Reverse index (computeReverseIndex)**
   - Note A links to Note B -> B.links_in includes A
   - Mutual links work correctly
   - No duplicate entries in links_in
   - links_in is sorted deterministically

4. **Duplicate id detection**
   - Two notes with same id are reported
   - First by alphabetical path order is kept in the index

5. **Missing id detection**
   - Note with `type: feature` but no `id` is recorded in missing_ids

6. **Schema version reading**
   - Reads version from frontmatter of schema.md
   - Returns "unknown" when schema.md does not exist

7. **Index record shape**
   - Feature note produces correct requirements array with composite keys
   - Change note produces correct delta_summary and tasks arrays
   - System/Decision/Source notes produce correct relationship fields
   - Empty optional fields default to empty arrays, not undefined

### Integration Tests

8. **Full buildIndex on a sample vault**
   - Create a minimal vault with one of each note type, all cross-linked
   - Verify all relationships are resolved correctly
   - Verify links_in is the exact reverse of links_out
   - Verify schema_version is recorded

9. **Wikilink error accumulation**
   - Note references a wikilink that does not exist -> appears in link_errors
   - Note references an ambiguous alias -> appears in link_errors with candidates
   - Note references a note with no id -> appears in link_errors as missing_id target

10. **Cache invalidation (if cache implemented)**
    - Modify a file's content -> cache miss, re-parsed
    - Touch a file (mtime change, same content) -> cache miss (conservative)
    - No changes -> cache hit, same index returned

### Edge Cases

11. **Empty vault** (no typed notes) -> empty index, no errors
12. **Note with `features:` (plural) field** -> multiple feature ids resolved
13. **Note with both `feature:` and `features:` (invalid)** -> error reported
14. **Self-referencing wikilink** -> appears in links_out but does not cause infinite loop
15. **Archived notes in `99-archive/`** -> still indexed (archive is navigable)
16. **Non-markdown files in vault** -> ignored by glob

---

## 5. Implementation Order

### Prerequisites

- **03-vault-parser** must be implemented first (frontmatter parsing, wikilink extraction, requirement parsing, delta summary parsing, content hashing).
- **02-note-templates** must define the frontmatter field contracts so the index engine knows what fields to expect.

### Build Sequence

```
Step 1: types.ts
  Define all interfaces: IndexRecord, Requirement, DeltaSummaryEntry,
  VaultIndex, WikilinkResolution, WikilinkError, NoteType, etc.

Step 2: scan.ts
  Implement scanVaultFiles() with glob.

Step 3: schema-version.ts
  Implement readSchemaVersion().

Step 4: resolve.ts
  Implement buildLookupMaps(), resolveWikilink(), resolveRecordLinks().
  Write unit tests for wikilink resolution.

Step 5: reverse.ts
  Implement computeReverseIndex().
  Write unit tests for reverse index computation.

Step 6: validate.ts
  Implement detectDuplicateIds(), collectMissingIds().

Step 7: build.ts
  Wire everything together in buildIndex().
  Write integration tests with sample vault fixtures.

Step 8: cache.ts (optional, can defer)
  Implement disk serialization and mtime+size+hash invalidation.

Step 9: index.ts
  Barrel re-exports.
```

### Estimated Complexity

- **Types**: ~150 lines
- **Scan**: ~30 lines
- **Schema version**: ~20 lines
- **Resolve**: ~120 lines (most complex: wikilink normalization logic)
- **Reverse**: ~30 lines
- **Validate**: ~40 lines
- **Build**: ~80 lines (orchestration)
- **Cache**: ~100 lines (optional)
- **Tests**: ~400-500 lines
