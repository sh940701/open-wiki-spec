# CLI & Init Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec's CLI is built on `commander` with a traditional command-registration pattern. The entry point is `src/cli/index.ts`, which creates a `program` with:

**Commands registered:**
- `init [path]` -- Initialize OpenSpec in a project (primary setup command)
- `update [path]` -- Update instruction files
- `list` -- List changes or specs (`--specs`, `--changes`, `--sort`, `--json`)
- `view` -- Interactive dashboard
- `change show/list/validate` -- Deprecated change subcommands
- `archive [change-name]` -- Archive a completed change
- `validate [item-name]` -- Validate changes/specs (`--all`, `--changes`, `--specs`, `--strict`, `--json`)
- `show [item-name]` -- Show change or spec (`--json`, `--type`)
- `status` -- Artifact completion status for a change
- `instructions [artifact]` -- Enriched instructions for artifact creation
- `templates` -- Show resolved template paths
- `schemas` -- List available workflow schemas
- `new change <name>` -- Create a new change directory
- `feedback <message>` -- Submit feedback
- `completion generate/install/uninstall` -- Shell completions
- `spec` and `config` and `schema` -- Additional registered commands

**Init command (`src/core/init.ts`):**
The `InitCommand` class handles setup:

1. **Validate** -- Check write permissions, detect extend mode (existing `openspec/` dir).
2. **Legacy cleanup** -- Detect and clean up legacy artifacts from older versions.
3. **Tool detection** -- Auto-detect available AI tools in the project (`getAvailableTools()`).
4. **Migration** -- If extending, migrate existing projects to profile system.
5. **Welcome screen** -- Animated terminal welcome (interactive only).
6. **Profile resolution** -- Read global config for profile (`core`/`custom`).
7. **Tool selection** -- Interactive multi-select or `--tools` flag for AI tool selection.
8. **Directory creation** -- Create `openspec/`, `openspec/specs/`, `openspec/changes/`, `openspec/changes/archive/`.
9. **Skill and command generation** -- For each selected tool, generate SKILL.md files and command files based on profile workflows.
10. **Config creation** -- Write `openspec/config.yaml` with default schema.
11. **Success message** -- Display setup summary, getting-started hints, restart instructions.

**Key concepts in OpenSpec init:**
- **Profiles**: `core` (propose, explore, apply, archive) vs `custom` (all workflows).
- **Delivery modes**: `skills`, `commands`, or `both`.
- **Skills**: SKILL.md files in tool-specific skill directories (e.g., `.claude/commands/skills/`).
- **Commands**: Tool-specific command files (e.g., `.claude/commands/opsx-propose.md`).
- **Workflow-to-skill mapping**: Each workflow name maps to a skill directory name (e.g., `explore` -> `openspec-explore`).

**Onboarding (`src/core/templates/workflows/onboard.ts`):**
An interactive guided walkthrough of the complete OpenSpec cycle:
1. Preflight (check CLI installed).
2. Welcome screen with workflow overview.
3. Task selection (scan codebase for TODOs, missing tests, etc.).
4. Explore demo (brief investigation of selected task).
5. Create change directory.
6. Fill artifacts one by one: proposal -> specs -> design -> tasks.
7. Apply (implement tasks, check them off).
8. Archive the completed change.
9. Recap with command reference table.

### Key Source Files

| File | Role |
|------|------|
| `src/cli/index.ts` | Commander program definition with all command registrations |
| `src/core/init.ts` | `InitCommand` class: validates, detects tools, creates directories, generates skills/commands |
| `src/commands/workflow/index.ts` | Re-exports workflow commands: status, instructions, templates, schemas, new change |
| `src/core/templates/workflows/onboard.ts` | Onboarding skill template: guided first-cycle walkthrough |
| `docs/getting-started.md` | User-facing documentation for OpenSpec workflow |

### Core Algorithm / Flow

**OpenSpec init:**
```
validate(path) -> legacy cleanup -> detect tools -> migrate if needed ->
welcome screen -> resolve profile -> select tools -> create directories ->
generate skills & commands -> create config -> display success
```

**OpenSpec getting-started flow:**
```
/opsx:propose -> /opsx:apply -> /opsx:archive  (core profile)
/opsx:new -> /opsx:ff or /opsx:continue -> /opsx:apply -> /opsx:verify -> /opsx:archive  (custom profile)
```

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

**Section 9.4 (v1 Product Scope):**
- v1 supports only the Claude Code environment.
- v1's agent workflow assumes Claude Code operating model (main agent + retrieval subagent).

**Section 12 (Recommended Product Definition):**
- open-wiki-spec is a "code management wiki with operating conventions."
- The first version targets a workflow in Claude Code that uses a retrieval subagent.

**Section 13.3 (Recommended Folder Structure):**
```
wiki/
  00-meta/
    index.md
    log.md
    schema.md
    conventions.md
  01-sources/
  02-systems/
  03-features/
  04-changes/
  05-decisions/
  06-queries/
  99-archive/
```

**Section 10.1.1 (Schema Version):**
- `wiki/00-meta/schema.md` declares current schema version, migration notes, deprecated fields.

**Section 10.2 (Index Refresh):**
- Fresh vault scan at the start of `propose`, `query`, and `verify`.

**Section 15 (Recommended Workflow):**
- Status lifecycle: `proposed -> planned -> in_progress -> applied`.
- Workflows: `propose`, `continue`, `apply`, `verify`, `query`.

**Section 6.2D (Plain Vault Mode):**
- Reads/writes markdown directly, no Obsidian app dependency.
- Works with CLI, automation, CI, and agent tooling.

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec |
|--------|---------|----------------|
| CLI tool name | `openspec` | `ows` (open-wiki-spec) |
| Init target | Creates `openspec/` with `specs/`, `changes/`, `changes/archive/` | Creates `wiki/` with `00-meta/` through `99-archive/` |
| Init generates | SKILL.md files + command files for multiple AI tools | Claude Code skill files only (v1 scope) |
| Config | `openspec/config.yaml` with schema selection | `wiki/00-meta/schema.md` + `wiki/00-meta/conventions.md` |
| Profiles | `core` vs `custom` with selectable workflows | N/A in v1 -- all workflows available |
| Tool selection | Multi-tool support (Claude, Cursor, Windsurf, etc.) | Claude Code only in v1 |
| Commands | `init`, `list`, `validate`, `show`, `archive`, `status`, `new change`, etc. | `init`, `propose`, `continue`, `apply`, `verify`, `query`, `status`, `list`, `archive` |
| Onboarding | Interactive multi-phase walkthrough with real code tasks | Simpler guided init that creates vault structure + example notes |
| Output modes | Human-readable + `--json` on some commands | Human-readable + `--json` on all commands |
| Subagent integration | Skill templates instruct the LLM what to do | CLI provides data; subagent prompt contracts are separate |

### Contracts to Satisfy

1. CLI binary named `ows` with commands: `init`, `propose`, `continue`, `apply`, `verify`, `query`, `status`, `list`, `archive`.
2. `ows init` creates the complete `wiki/` folder structure from section 13.3.
3. `ows init` creates `00-meta/` files: `index.md`, `log.md`, `schema.md`, `conventions.md`.
4. `ows init` generates Claude Code skill files for all workflows.
5. All commands support `--json` output mode.
6. v1 targets Claude Code only (section 9.4).
7. Plain Vault Mode: reads/writes markdown files directly (section 6.2D).
8. `ows archive` moves applied Changes to `99-archive/` (section 15 archive).

---

## 3. Implementation Plan

### Architecture Overview

```
src/
  cli/
    index.ts              -- Commander program definition, command registration
    commands/
      init.ts             -- ows init command handler
      propose.ts          -- ows propose command handler (delegates to workflow)
      continue.ts         -- ows continue command handler
      apply.ts            -- ows apply command handler
      verify.ts           -- ows verify command handler
      query.ts            -- ows query command handler
      status.ts           -- ows status command handler
      list.ts             -- ows list command handler
      archive.ts          -- ows archive command handler
    vault-discovery.ts    -- Vault path resolution utility
  init/
    init-engine.ts        -- Core init logic: vault creation, meta file generation
    meta-files.ts         -- Templates for index.md, log.md, schema.md, conventions.md
    skill-generator.ts    -- Generates Claude Code skill files from workflow templates
    types.ts              -- Init-related types
bin/
  ows.js                  -- CLI entry shim
```

### Data Structures

```typescript
// ─── CLI Types ──────────────────────────────────────────

interface CliOptions {
  json?: boolean;
}

// ─── Init Types ─────────────────────────────────────────

interface InitOptions {
  /** Target directory path (default: current directory) */
  path?: string;
  /** Force re-initialization even if wiki/ already exists */
  force?: boolean;
  /** Skip interactive prompts */
  nonInteractive?: boolean;
  /** Output as JSON */
  json?: boolean;
}

interface InitResult {
  /** Whether this was a fresh init or extend */
  mode: 'fresh' | 'extend';
  /** Path to the created/extended wiki directory */
  wikiPath: string;
  /** Directories created */
  directoriesCreated: string[];
  /** Meta files created */
  metaFilesCreated: string[];
  /** Skill files generated */
  skillFilesGenerated: string[];
  /** Warnings (e.g., existing files skipped) */
  warnings: string[];
}

// ─── Meta File Types ────────────────────────────────────

interface SchemaMetaContent {
  schemaVersion: string;
  effectiveDate: string;
  noteTypes: string[];
  migrationNotes: string[];
  deprecatedFields: string[];
}

interface IndexMetaContent {
  vaultName: string;
  createdAt: string;
  noteTypeIndex: Record<string, number>;  // type -> count
}

// ─── Vault Structure ────────────────────────────────────

const VAULT_DIRS = [
  'wiki',
  'wiki/00-meta',
  'wiki/01-sources',
  'wiki/02-systems',
  'wiki/03-features',
  'wiki/04-changes',
  'wiki/05-decisions',
  'wiki/06-queries',
  'wiki/99-archive',
] as const;

const META_FILES = [
  'wiki/00-meta/index.md',
  'wiki/00-meta/log.md',
  'wiki/00-meta/schema.md',
  'wiki/00-meta/conventions.md',
] as const;

// ─── Status Types ───────────────────────────────────────

interface StatusResult {
  /** The change being inspected */
  changeId: string;
  /** Current status */
  status: string;
  /** Linked feature(s) */
  features: string[];
  /** Section completeness for planned transition */
  sectionCompleteness: {
    why: boolean;
    deltaSummary: boolean;
    tasks: boolean;
    validation: boolean;
    designApproach?: boolean;  // omitted if not applicable (simple changes)
  };
  /** Task progress */
  taskProgress: {
    total: number;
    completed: number;
  };
  /** Next action from nextAction() algorithm */
  nextAction: NextAction;
  /** Active depends_on blocks */
  blockedBy: string[];
}

// NextAction uses the unified types from 00-unified-types.md:
// action: NextActionType ('fill_section' | 'transition' | 'start_implementation' |
//         'continue_task' | 'blocked' | 'verify_then_archive')
// target?: string       -- section name or task text
// to?: ChangeStatus     -- target status for transition
// reason?: string       -- for blocked
// blockers?: string[]   -- for blocked
interface NextAction {
  action: NextActionType;
  target?: string;
  to?: ChangeStatus;
  reason?: string;
  blockers?: string[];
}

// ─── List Types ─────────────────────────────────────────

interface ListResult {
  type: 'changes' | 'features' | 'all';
  items: ListItem[];
}

interface ListItem {
  id: string;
  type: NoteType;
  title: string;
  status: string;
  path: string;
  linkedFeature?: string;
  taskProgress?: { total: number; completed: number };
}

// ─── Skill Generation Types ─────────────────────────────

interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
}

const WORKFLOW_SKILLS: Record<string, SkillDefinition> = {
  propose: {
    name: 'ows-propose',
    description: 'Propose a new change to the codebase wiki. Runs similarity scan preflight, creates or updates Feature and Change notes.',
    instructions: [
      'Run `ows propose "<description>" --json` to execute preflight scan.',
      'Parse the JSON classification: existing_change, existing_feature, new_feature, needs_confirmation.',
      'If needs_confirmation: show candidates and reasons, ask user to choose.',
      'If automatic classification: show decision, confirm with user before proceeding.',
      'The CLI creates/updates notes. Show the user what was created/updated.',
    ].join('\n'),
  },
  continue: {
    name: 'ows-continue',
    description: 'Continue work on an existing Change. Reads current state and determines the next action.',
    instructions: [
      'Run `ows status <changeId> --json` to see current state and next action.',
      'Follow the nextAction recommendation: fill_section, transition, start_implementation, continue_task, or blocked.',
      'If fill_section: help the user write the missing section content.',
      'If transition: run `ows continue <changeId> --json` to advance the status.',
      'If blocked: show the blocking dependencies and help resolve them.',
    ].join('\n'),
  },
  apply: {
    name: 'ows-apply',
    description: 'Apply a Change to canonical Feature notes. Checks for stale base and applies delta operations.',
    instructions: [
      'Run `ows apply <changeId> --json` to apply the change.',
      'If stale_base is reported: show the conflict details and ask user how to resolve.',
      'If successful: show which Features were updated and what changed.',
      'The Change status transitions to applied.',
    ].join('\n'),
  },
  verify: {
    name: 'ows-verify',
    description: 'Verify vault consistency across Completeness, Correctness, Coherence, and Vault Integrity.',
    instructions: [
      'Run `ows verify --json` for full vault verification, or `ows verify <changeId> --json` for a specific change.',
      'Parse the VerifyReport: check pass/fail, review issues by dimension.',
      'Present errors first, then warnings. Group by dimension for clarity.',
      'If issues found: suggest fixes for each issue using the suggestion field.',
    ].join('\n'),
  },
  query: {
    name: 'ows-query',
    description: 'Search the vault graph and optionally create a Query note to preserve investigation results.',
    instructions: [
      'Run `ows query "<question>" --json` to search the vault.',
      'Read the context document and search results.',
      'Investigate by reading relevant vault notes identified in results.',
      'Synthesize findings into an answer.',
      'If the heuristics recommend note creation: ask user if they want to save as a Query note.',
    ].join('\n'),
  },
  status: {
    name: 'ows-status',
    description: 'Show the current state of a Change: section completeness, task progress, and next recommended action.',
    instructions: [
      'Run `ows status <changeId> --json` to get structured state.',
      'Show: current status, section completeness, task progress (N/M done), next action.',
      'If blocked: show what is blocking and suggest resolution.',
    ].join('\n'),
  },
};
```

### Core Algorithm

#### `ows init`

```
function init(options: InitOptions): InitResult
  1. Resolve target path
     projectPath = path.resolve(options.path || '.')

  2. Detect mode
     wikiPath = path.join(projectPath, 'wiki')
     mode = existsSync(wikiPath) ? 'extend' : 'fresh'

  3. Handle extend mode:
     if mode == 'extend':
       if options.force:
         // Force re-initialization: recreate meta files, regenerate skills
         // Existing note files in 01-sources/ through 06-queries/ are preserved.
         goto step 4  // recreate structure
       else:
         // Smart extend: add missing directories, regenerate skill files,
         // update schema.md if version changed, but preserve existing notes.
         extendResult = extendVault(wikiPath, projectPath)
         return extendResult

     // extendVault does:
     //   a) Create any missing vault directories from VAULT_DIRS
     //   b) Regenerate Claude Code skill files (always, in case CLI version changed)
     //   c) Check schema.md version -- if different from current CLI version, warn
     //   d) Do NOT overwrite existing meta files (index.md, log.md, conventions.md)
     //   e) Return InitResult with mode='extend' and list of changes made

  4. Create vault directory structure
     for dir in VAULT_DIRS:
       mkdirSync(path.join(projectPath, dir), { recursive: true })

  5. Create 00-meta files (only if fresh or --force)
     createSchemaFile(wikiPath)
     createIndexFile(wikiPath)
     createLogFile(wikiPath)
     createConventionsFile(wikiPath)

  6. Generate Claude Code skill files
     claudeDir = path.join(projectPath, '.claude', 'commands')
     for [workflowName, skillDef] in WORKFLOW_SKILLS:
       skillPath = path.join(claudeDir, `ows-${workflowName}.md`)
       writeSkillFile(skillPath, skillDef)

  7. Display success or return JSON result
     if options.json:
       output InitResult as JSON
     else:
       display human-readable summary
```

#### 00-meta File Templates

**`wiki/00-meta/schema.md`:**
```markdown
---
schema_version: "2026-04-06-v1"
effective_date: "2026-04-06"
---

# Vault Schema

## Current Version

`2026-04-06-v1`

## Note Types

| Type | Folder | Required Frontmatter |
|------|--------|---------------------|
| Feature | 03-features/ | type, id, status, systems |
| Change | 04-changes/ | type, id, status, feature/features, touches |
| System | 02-systems/ | type, id, status |
| Decision | 05-decisions/ | type, id, status |
| Source | 01-sources/ | type, id |
| Query | 06-queries/ | type, id, status |

## Migration Notes

- Initial schema. No migrations required.

## Deprecated Fields

- None.
```

**`wiki/00-meta/index.md`:**
```markdown
---
type: meta
---

# Vault Index

This file is the entry point for navigating the vault.

## Quick Links

- [[schema]] -- Vault schema version and note type contracts
- [[log]] -- Vault operation log
- [[conventions]] -- Naming and structural conventions

## Note Types

### Features
<!-- Auto-populated by ows or manually maintained -->

### Systems
<!-- Auto-populated by ows or manually maintained -->

### Active Changes
<!-- Auto-populated by ows or manually maintained -->

### Decisions
<!-- Auto-populated by ows or manually maintained -->

### Sources
<!-- Auto-populated by ows or manually maintained -->

### Queries
<!-- Auto-populated by ows or manually maintained -->
```

**`wiki/00-meta/log.md`:**
```markdown
---
type: meta
---

# Vault Operation Log

Chronological log of vault operations performed by `ows`.

| Date | Operation | Target | Agent |
|------|-----------|--------|-------|
| {init_date} | init | vault | ows |
```

**`wiki/00-meta/conventions.md`:**
```markdown
---
type: meta
---

# Vault Conventions

## File Naming

- Use kebab-case for all filenames: `auth-login.md`, not `Auth Login.md`.
- Prefix is not required in filenames (the folder provides context).
- Note title (H1) should include the type prefix: `# Feature: Auth Login`.

## Frontmatter Rules

- `id` is immutable after creation. Never change it.
- `status` must follow the allowed lifecycle transitions.
- Wikilinks in frontmatter use the format: `"[[Note Title]]"`.

## Wikilink Conventions

- Use note titles for wikilinks: `[[Feature: Auth Login]]`.
- Do not use file paths in wikilinks.
- If a note has aliases, any alias can be used as a wikilink target.

## Section Conventions

- Each note type has minimum required sections (see [[schema]]).
- Additional sections can be added freely.
- Section names must match the expected names exactly (case-sensitive).

## Requirement Conventions

- Requirements live inside Feature notes under `## Requirements`.
- Each requirement: `### Requirement: <name>` with `<name>` unique within the Feature.
- Normative statement must contain `SHALL` or `MUST`.
- Each requirement needs at least one `#### Scenario:` with `WHEN`/`THEN` format.

## Delta Summary Conventions

- Delta Summary lives inside Change notes under `## Delta Summary`.
- Operations: `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED`.
- Apply order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
- MODIFIED/REMOVED/RENAMED entries include `[base: <content_hash>]`.
```

#### `ows status`

```
function status(changeId: string, options: CliOptions): StatusResult
  1. Discover vault path via discoverVaultPath()
  2. Build fresh vault index
  3. Find change record by id
  4. Calculate section completeness (hard prerequisites from section 15)
     - why: 'Why' heading exists and non-empty
     - deltaSummary: delta_summary.length > 0
     - tasks: tasks.length > 0
     - validation: 'Validation' heading exists and non-empty
     - designApproach: 'Design Approach' heading exists (null if not applicable)
  5. Calculate task progress
     - total: tasks.length
     - completed: tasks.filter(t => t.done).length
  6. Run nextAction() algorithm (from overview section 15)
  7. Check depends_on for blocks
  8. Format output:
     if options.json:
       return JSON.stringify(statusResult)
     else:
       formatStatusHuman(statusResult)  // table format with section checklist
```

#### `ows list`

```
function list(options: ListOptions): ListResult
  1. Build fresh vault index
  2. Filter by type if specified (--changes, --features, or all)
  3. For each matching note:
     - Extract id, type, title, status, path
     - If change: add linked feature and task progress
  4. Sort by status priority, then by created_at
  5. Return structured list or format as table
```

#### Vault Path Discovery

All commands except `init` need to locate the vault. The discovery mechanism walks up the directory tree, similar to how git finds `.git/`.

```
function discoverVaultPath(startDir?: string): string
  dir = startDir || process.cwd()

  while true:
    candidate = path.join(dir, 'wiki')
    if existsSync(candidate) and isDirectory(candidate):
      // Verify it looks like an ows vault (has 00-meta/ with schema.md)
      if existsSync(path.join(candidate, '00-meta', 'schema.md')):
        return candidate
    parent = path.dirname(dir)
    if parent == dir:
      // Reached filesystem root without finding wiki/
      throw new Error(
        'No wiki/ vault found. Run `ows init` to create one, or run from within a project that has a wiki/ directory.'
      )
    dir = parent
```

This is used by every command handler to resolve `vaultPath` before calling workflow functions.

#### `ows archive`

Per overview.md section 15, `archive` moves an `applied` Change from `04-changes/` to `99-archive/`.

```
function archive(changeId: string, options: CliOptions): ArchiveResult
  1. Discover vault path via discoverVaultPath()
  2. Build fresh vault index
  3. Find change record by id
  4. Validate preconditions:
     - Change status must be 'applied'
     - If status != 'applied': error "Only applied changes can be archived"
  5. Run verify on the change to confirm it is cleanly applied:
     // Per plan 10's public API: verify(index: VaultIndex, options?: VerifyOptions): VerifyReport
     // The index was already built in step 2. Pass it as the first argument.
     verifyResult = verify(index, { changeId })
     if verifyResult.pass == false:
       warning "Verify found issues. Archive anyway? (use --force to skip)"
       if not options.force: return with warning
  6. Move the file:
     oldPath = change.path  // e.g., 'wiki/04-changes/add-passkey.md'
     newPath = 'wiki/99-archive/' + path.basename(oldPath)
     renameSync(path.join(vaultRoot, oldPath), path.join(vaultRoot, newPath))
  7. Append to log.md:
     appendLogEntry(vaultPath, 'archive', changeId)
  8. Return result or format for display

interface ArchiveResult {
  changeId: string;
  oldPath: string;
  newPath: string;
  verifyPassed: boolean;
  warnings: string[];
}
```

**Key properties per overview.md:**
- `id` is preserved, so all wikilink references remain valid after index rebuild.
- Archived changes remain searchable in the vault but are excluded from active `touches`/`depends_on` sequencing.
- Archive is user-initiated, not automatic. No fixed retention window default.

#### `log.md` Lifecycle

`log.md` is an operational log that records vault operations performed by `ows`. It is NOT a human-edited file.

```
function appendLogEntry(
  vaultPath: string,
  operation: string,   // 'init' | 'propose' | 'apply' | 'archive' | 'verify'
  target: string,      // change id, note id, or 'vault'
  agent?: string       // default: 'ows'
): void
  logPath = path.join(vaultPath, '00-meta', 'log.md')
  date = new Date().toISOString().split('T')[0]
  entry = `| ${date} | ${operation} | ${target} | ${agent || 'ows'} |`
  appendFileSync(logPath, '\n' + entry)
```

**Which operations append to log.md:**
- `ows init` -- initial entry (already implemented)
- `ows propose` -- when a new Change is created
- `ows apply` -- when a Change is applied to Features
- `ows archive` -- when a Change is moved to archive
- `ows verify` -- when verify is run (records that verification happened)

Other commands (`continue`, `query`, `status`, `list`) do NOT write to log.md because they are read-only or incremental editing operations.

#### `ows propose`, `ows continue`, `ows apply`, `ows verify`, `ows query`

These commands are thin CLI wrappers that:
1. Discover the vault path via `discoverVaultPath()`.
2. Parse CLI arguments (changeId, options).
3. Build fresh vault index (section 10.2).
4. Delegate to the corresponding workflow module (`src/workflow/{name}.ts`).
5. Format and output the result (human or JSON).
6. For mutating operations, append to `log.md`.

```
function proposeCommand(description: string, options: CliOptions)
  vaultPath = discoverVaultPath()
  index = await buildIndex(vaultPath)
  result = await proposeWorkflow(description, index, vaultPath)
  if result.createdChangeId:
    appendLogEntry(vaultPath, 'propose', result.createdChangeId)
  output(result, options.json)

function continueCommand(changeId: string, options: CliOptions)
  vaultPath = discoverVaultPath()
  index = await buildIndex(vaultPath)
  result = await continueWorkflow(changeId, index, vaultPath)
  output(result, options.json)

function applyCommand(changeId: string, options: CliOptions)
  vaultPath = discoverVaultPath()
  index = await buildIndex(vaultPath)
  result = await applyWorkflow(changeId, index, vaultPath)
  if result.applied:
    appendLogEntry(vaultPath, 'apply', changeId)
  output(result, options.json)

function verifyCommand(changeId: string | undefined, options: CliOptions)
  vaultPath = discoverVaultPath()
  index = await buildIndex(vaultPath)
  // Per plan 10's public API: verify(index, options?) -- index is required.
  result = verify(index, { changeId })
  appendLogEntry(vaultPath, 'verify', changeId || 'vault')
  output(result, options.json)

function queryCommand(question: string, options: CliOptions)
  vaultPath = discoverVaultPath()
  result = await queryWorkflow({ question }, vaultPath)
  output(result, options.json)

function archiveCommand(changeId: string, options: CliOptions)
  vaultPath = discoverVaultPath()
  result = await archive(changeId, options)
  output(result, options.json)
```

#### Claude Code Skill Generation

Each workflow gets a Claude Code slash command file generated during `ows init`:

```
function generateSkillFile(workflow: string, skillDef: SkillDefinition): string
  return `---
name: ${skillDef.name}
description: ${skillDef.description}
---

${skillDef.instructions}
`
```

Skill files are placed in `.claude/commands/` so they appear as `/ows-propose`, `/ows-continue`, etc.

The skill instructions tell the Claude Code agent how to invoke the `ows` CLI and interpret its JSON output. For example:

```markdown
---
name: ows-propose
description: Propose a new change to the codebase wiki. Runs similarity scan preflight, creates or updates Feature and Change notes.
---

Run the open-wiki-spec propose workflow.

**Steps:**

1. Run `ows propose "<user's description>" --json` to execute the preflight scan and get classification results.
2. Parse the JSON output to understand the classification (existing_change, existing_feature, new_feature, needs_confirmation).
3. If `needs_confirmation`: show the candidates and conflict reasons to the user and ask for their choice.
4. If automatic classification: show what was decided and confirm with the user before proceeding.
5. The CLI will create/update the appropriate notes in the vault.
6. Show the user what was created/updated.
```

### File Structure

| File | Responsibility |
|------|----------------|
| `bin/ows.js` | Entry shim: `#!/usr/bin/env node` + `import '../dist/cli/index.js'` |
| `src/cli/index.ts` | Commander program with all command registrations |
| `src/cli/commands/init.ts` | `initCommand()` handler: parses options, calls init-engine |
| `src/cli/commands/propose.ts` | `proposeCommand()`: thin wrapper around propose workflow |
| `src/cli/commands/continue.ts` | `continueCommand()`: thin wrapper around continue workflow |
| `src/cli/commands/apply.ts` | `applyCommand()`: thin wrapper around apply workflow |
| `src/cli/commands/verify.ts` | `verifyCommand()`: thin wrapper around verify engine |
| `src/cli/commands/query.ts` | `queryCommand()`: thin wrapper around query workflow |
| `src/cli/commands/status.ts` | `statusCommand()`: reads index, runs nextAction, formats result |
| `src/cli/commands/list.ts` | `listCommand()`: reads index, filters/sorts, formats table or JSON |
| `src/cli/commands/archive.ts` | `archiveCommand()`: validates preconditions, runs verify, moves file, updates log |
| `src/cli/vault-discovery.ts` | `discoverVaultPath()`: walks up directory tree to find `wiki/` with `00-meta/schema.md` |
| `src/init/init-engine.ts` | `initVault()`: core init logic -- creates dirs, meta files, skills |
| `src/init/meta-files.ts` | Template functions for each 00-meta file |
| `src/init/skill-generator.ts` | Generates Claude Code skill markdown files |
| `src/init/types.ts` | Init-specific types |

### Public API / Interface

```typescript
// ─── Vault Discovery ────────────────────────────────────

function discoverVaultPath(startDir?: string): string;

// ─── Init ───────────────────────────────────────────────

async function initVault(options: InitOptions): Promise<InitResult>;

// ─── Archive ────────────────────────────────────────────

async function archiveChange(
  changeId: string,
  index: VaultIndex,
  vaultPath: string,
  options?: { force?: boolean },
): Promise<ArchiveResult>;

// ─── Log ────────────────────────────────────────────────

function appendLogEntry(
  vaultPath: string,
  operation: string,
  target: string,
  agent?: string,
): void;

// ─── Status ─────────────────────────────────────────────

async function getChangeStatus(
  changeId: string,
  index: VaultIndex,
): Promise<StatusResult>;

// ─── List ───────────────────────────────────────────────

async function listNotes(
  index: VaultIndex,
  options?: { type?: NoteType; status?: string },
): Promise<ListResult>;

// ─── Output Formatting ─────────────────────────────────

function formatAsJson(result: unknown): string;
function formatAsTable(items: ListItem[]): string;
function formatStatusHuman(result: StatusResult): string;
```

### Dependencies on Other Modules

| Module | What CLI needs from it |
|--------|------------------------|
| `01-project-structure` | VAULT_DIRS constants, path conventions |
| `04-index-engine` | `buildIndex()` for fresh vault scan, `VaultIndex` interface |
| `07-workflow-propose` | `proposeWorkflow()` function |
| `08-workflow-continue` | `continueWorkflow()` function |
| `09-workflow-apply` | `applyWorkflow()` function |
| `10-workflow-verify` | `verify(index, options?)` function -- caller MUST pass VaultIndex |
| `11-workflow-query` | `queryWorkflow()` function |
| `02-note-templates` | Minimum template contracts (for meta file generation and status checks) |
| `15-section-completeness` (part of workflow-continue) | `checkPlannedPrerequisites()`, `nextAction()` for status command |

---

## 4. Test Strategy

### Unit Tests

**Init engine (`init-engine.ts`):**
- Fresh init on empty directory -> creates all VAULT_DIRS and META_FILES.
- Init on directory with existing `wiki/` and no `--force` -> returns warning, does not overwrite.
- Init with `--force` on existing `wiki/` -> recreates meta files, preserves existing note files.
- Init creates `.claude/commands/` skill files for each workflow.
- Init result JSON contains correct directories, files, and skill paths.

**Meta files (`meta-files.ts`):**
- `schema.md` contains correct schema version string.
- `index.md` contains expected section headings.
- `log.md` contains init entry with current date.
- `conventions.md` contains all expected convention sections.
- Generated files are valid markdown parseable by vault-parser.

**Skill generator (`skill-generator.ts`):**
- Generates valid markdown with YAML frontmatter.
- Each workflow produces a distinct skill file.
- Skill instructions reference `ows` CLI commands correctly.

**Status command:**
- Change with all sections filled -> all completeness fields true, nextAction = `transition to planned`.
- Change missing Why section -> sectionCompleteness.why = false, nextAction = `fill_section`.
- Change in `in_progress` with unchecked tasks -> nextAction = `continue_task`.
- Change in `applied` -> nextAction = `verify_then_archive`.
- Change blocked by depends_on -> nextAction = `blocked`.

**List command:**
- Vault with 3 Features and 2 Changes -> returns 5 items.
- Filter by type `change` -> returns 2 items.
- Items sorted by status priority (in_progress > proposed > applied).
- `--json` output is valid JSON.

**Archive command:**
- Archive an applied Change -> file moved from `04-changes/` to `99-archive/`.
- Archive a non-applied Change -> error "Only applied changes can be archived".
- Archive with verify failure and no `--force` -> blocked with warning.
- Archive with verify failure and `--force` -> proceeds despite issues.
- Archive appends entry to `log.md`.
- Archived change `id` is preserved in frontmatter.

**Vault discovery (`vault-discovery.ts`):**
- CWD is inside project root with `wiki/` -> returns correct path.
- CWD is inside a subdirectory of the project -> walks up and finds `wiki/`.
- CWD has no `wiki/` in any ancestor -> throws descriptive error.
- `wiki/` exists but has no `00-meta/schema.md` -> not recognized, keeps searching.

**Log lifecycle:**
- `ows init` creates log.md with init entry.
- `ows propose` appends propose entry.
- `ows apply` appends apply entry.
- `ows archive` appends archive entry.
- `ows verify` appends verify entry.
- `ows continue`, `ows query`, `ows status`, `ows list` do NOT append to log.md.

### Integration Tests

- Full `ows init` on a temp directory: verify all expected files exist with correct content.
- `ows init` followed by `ows list` on fresh vault: returns empty list (no notes yet).
- `ows init` followed by manual Feature creation followed by `ows list --json`: returns the Feature.
- `ows status` on a Change note: returns correct section completeness and next action.
- All CLI commands return valid JSON when `--json` is passed.
- All CLI commands return non-zero exit code on error.

### Edge Cases

- `ows init` in a directory without write permissions -> clear error message.
- `ows init` in a nested path that doesn't exist -> creates parent directories.
- `ows status` on a non-existent change id -> error with helpful message.
- `ows list` on an empty vault -> empty result (not crash).
- `ows propose` with empty description -> error with usage hint.
- Very long change description -> handled without truncation issues.
- Concurrent `ows` invocations on same vault -> no file corruption (file writes are atomic).

---

## 5. Implementation Order

### Prerequisites
- `01-project-structure` must define VAULT_DIRS and path conventions.
- `02-note-templates` must define minimum template contracts (used in meta file generation).
- `04-index-engine` must be complete (CLI commands depend on `buildIndex()`).
- Workflow modules (07-11) should be at least interface-defined so CLI wrappers can import them.

### Build Sequence

1. **types.ts** -- Define `InitOptions`, `InitResult`, `StatusResult`, `ListResult`, `NextAction`, `ArchiveResult`, etc.
2. **cli/vault-discovery.ts** -- `discoverVaultPath()`. No dependencies on other modules. Can be developed first since all commands need it.
3. **meta-files.ts** -- Template functions for the four 00-meta files. No dependencies on other modules. Includes `appendLogEntry()`.
4. **init-engine.ts** -- Core `initVault()` logic: directory creation + meta file writing + extend mode. Depends on types and meta-files.
5. **skill-generator.ts** -- Claude Code skill file generation with actual instruction content. Can be developed in parallel with init-engine.
6. **cli/commands/init.ts** -- CLI handler that calls init-engine. Depends on init-engine.
7. **cli/commands/status.ts** -- Implements status using index-engine and nextAction algorithm. Depends on index-engine, vault-discovery.
8. **cli/commands/list.ts** -- Implements list using index-engine. Depends on index-engine, vault-discovery.
9. **cli/commands/archive.ts** -- Implements archive with verify precondition check. Depends on verify-engine, vault-discovery, meta-files (for log).
10. **cli/commands/propose.ts, continue.ts, apply.ts, verify.ts, query.ts** -- Thin wrappers around workflow modules. Can be built as each workflow module becomes available. All use vault-discovery and appendLogEntry where applicable.
11. **cli/index.ts** -- Commander program definition that imports all command handlers including archive. Built last to wire everything together.
12. **bin/ows.js** -- Entry shim. Trivial, can be created alongside cli/index.ts.

### Incremental Testing Strategy

- After step 3: run `initVault()` on a temp dir, verify file structure.
- After step 5: run `ows init` from command line, verify end-to-end.
- After step 6-7: run `ows status` and `ows list` against a manually-prepared vault.
- After step 8: run each workflow command with `--json`, verify output shape.
