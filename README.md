# open-wiki-spec

### OpenSpec's structured change management × [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — a persistent, agent-maintained knowledge layer for your codebase.

<!-- Badges -->
[![npm version](https://img.shields.io/npm/v/open-wiki-spec)](https://www.npmjs.com/package/open-wiki-spec)
[![license](https://img.shields.io/npm/l/open-wiki-spec)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-805%20passed-brightgreen)](#)

---

> *"The LLM is not a search engine — it's a programmer. Give it a wiki, not a filesystem."*
>
> Inspired by [Karpathy's vision](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): an LLM should maintain a continuously updated wiki rather than re-scanning raw sources every session.

## What is this?

**open-wiki-spec** (`ows`) fuses two powerful ideas into one system:

1. **[Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)** — an LLM maintains a persistent, accumulating wiki as a knowledge layer. The wiki is not a query-time RAG artifact; it's a living document that gets refined over time. Obsidian becomes the IDE where humans inspect what the LLM maintains.

2. **[OpenSpec](https://github.com/Fission-AI/OpenSpec)'s change management** — separate the canonical state from proposed changes. Track work as independent units with evidence, validation, and lifecycle. Never mix "what is" with "what we're changing."

The result: a **typed markdown vault** where your codebase knowledge lives as interconnected notes (Features, Changes, Systems, Decisions, Sources, Queries), managed by an agent workflow engine with **deterministic retrieval** — not LLM guesswork.

```
Obsidian is the IDE.
The LLM is the programmer.
The wiki is the codebase-level knowledge layer.
```

No Obsidian app required at runtime — it's plain markdown. But open the `wiki/` folder in Obsidian and you get a fully navigable knowledge graph with backlinks, graph view, and search for free.

## Why this exists

### The problem

Every agent session starts from zero:

1. Read the filesystem from scratch
2. Find relevant files (maybe miss some)
3. Reconstruct context that existed in a previous session
4. Perform the task, then lose all that context

Knowledge stays trapped in chat history. Past decisions, design rationale, related features, and investigation results vanish between sessions.

### The Karpathy insight

> *An LLM doesn't have to re-search raw sources every time. It can maintain a continuously updated wiki — a persistent artifact that accumulates and gets refined.*

This is the foundation. But a wiki without structure becomes chaos. That's where OpenSpec comes in.

### The OpenSpec discipline

OpenSpec brings rigor to agent-driven development:
- **Separate current state from proposed changes** — know what "is" vs what "will be"
- **Changes are independent, trackable units** — with evidence, impact scope, and validation
- **Lifecycle management** — propose → plan → implement → apply → verify → archive

### What ows combines

| From Karpathy's LLM Wiki | From OpenSpec |
|--------------------------|---------------|
| Persistent, accumulating knowledge | Structured change management |
| Wiki as the primary working surface | Current state vs proposed changes separation |
| LLM maintains the wiki, human reviews | Agent workflows with explicit stages |
| `index.md`, `log.md` for navigation | Verification and validation before apply |
| Obsidian as the human-facing IDE | Evidence-based, traceable work |

**The key innovation**: ows adds a **deterministic retrieval engine** that neither Karpathy's pattern nor OpenSpec had. Before creating anything, the system searches, scores, and classifies — mechanically, not by LLM guesswork.

## How it works

### Plain Vault Mode

open-wiki-spec reads and writes markdown/frontmatter/wikilinks directly from the vault directory. No Obsidian app APIs, no plugins required. It works in CLI, CI, automation, and agent tooling -- even when Obsidian is closed.

### 6 Note Types

```
Feature    ── canonical spec for current behavior (replaces OpenSpec's spec.md)
Change     ── proposed or in-progress work unit
System     ── technical boundary / component context
Decision   ── design decision and its rationale
Source     ── evidence: PRDs, issues, meeting notes, code-reading notes
Query      ── investigation notes and captured analysis
```

### Status Lifecycle

Changes flow through a deterministic lifecycle:

```
proposed ──> planned ──> in_progress ──> applied ──> (archived)
```

- **proposed**: Initial description, retrieval scan completed
- **planned**: Why, Delta Summary, Tasks, and Validation sections filled
- **in_progress**: Implementation underway, tasks being checked off
- **applied**: Canonical Feature notes updated to reflect the change

### Retrieval Subagent Architecture

This is the key differentiator from OpenSpec. Before creating any new work, `ows propose` runs a **mandatory preflight retrieval scan** -- a deterministic pipeline that scores existing vault notes against the new request:

```
User Request
     |
     v
+-------------------------------------+
|       Main Agent (Claude Code)       |
|                                      |
|  1. Interpret user request           |
|  2. Invoke retrieval subagent -------+--> Retrieval Subagent (ows CLI)
|  4. Read classification + candidates |        |
|  5. Make final workflow decision     |        a. Build vault index
|     (create/update/continue/ask)     |        b. Normalize query
+-------------------------------------+        c. Lexical retrieval
                                                d. Graph expansion (1-hop)
                                                e. Score candidates
                                                f. Classify
                                                g. Return structured result
```

The retrieval pipeline uses **weighted scoring signals**, not free-form LLM judgment:

| Signal | Weight |
|--------|--------|
| Exact title match | +40 |
| Alias match | +35 |
| Semantic similarity | +30 |
| Active change overlap | +25 |
| Same system | +20 |
| Same feature link | +20 |
| Partial title match | +20 |
| Full-text match | +15 / +8 |
| Shared source | +10 |
| Shared decision | +10 |
| Backlink proximity | +10 |

Classification is rule-based with thresholds:

| Classification | Meaning |
|---------------|---------|
| `existing_change` | An active Change with the same purpose exists. Continue it. |
| `existing_feature` | A matching Feature exists. Create a new Change attached to it. |
| `new_feature` | Nothing similar found. Create new Feature + Change. |
| `needs_confirmation` | Ambiguous results. Ask the user to choose. |

Results are deterministic, explainable, and debuggable.

**v0.2.0+** also includes **semantic search** via local embeddings (`multilingual-e5-small`). When available, a 10th scoring signal (`semantic_similarity: +30`) catches meaning-based matches that keyword search misses — e.g., "새 사용자를 받고 싶어" finds "회원가입" Feature even without keyword overlap. The embedding model downloads automatically on first use (~113MB, cached locally). Use `--keywords` to let the agent pass refined search terms directly.

## Key differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec |
|--------|---------|----------------|
| Storage | Fixed filesystem directories | Typed markdown vault with frontmatter + wikilinks |
| Canonical spec | `spec.md` file | `Feature` note with `## Requirements` section |
| Identity | Filepath/filename | Immutable `id` in frontmatter (survives rename/move) |
| Similarity detection | Free-form LLM reasoning | Deterministic retrieval + semantic embedding (multilingual) |
| Pre-investigation | Prompt-driven, varies by session | Mandatory preflight scan before `propose` |
| Note relationships | Directory nesting | Typed graph: wikilinks, backlinks, frontmatter links |
| Completion model | Archive-first file movement | Status lifecycle + deferred archive |
| Verification | Spec-level validation | 4-dimension verify: completeness, correctness, coherence, vault integrity |
| Conflict detection | Manual | Automatic sequencing: `depends_on`, `touches`, requirement-level delta |

### What we gained

- `id`-based stability that survives rename and move
- Richer graph signals via wikilinks, backlinks, and typed notes
- `Decision` notes that outlive individual Changes
- Machine-verifiable `Requirements` with `SHALL`/`MUST` and `WHEN`/`THEN` scenarios
- Machine-readable `Delta Summary` with stale-base detection
- Deterministic conflict detection across parallel Changes

### What we intentionally changed

- No fixed directory-centric navigation (graph-first instead)
- No direct `spec.md`/`change.md` file format compatibility
- No archive-first completion (status lifecycle with deferred archive instead)

## Quick start

```bash
# Install
npm install -g open-wiki-spec

# Initialize a vault in your project
cd your-project
ows init

# Propose a change (runs preflight retrieval automatically)
ows propose "Add user authentication"

# Check status of active changes
ows status

# Verify vault consistency
ows verify
```

`ows init` creates the vault structure and generates 12 Claude Code skill files (`.claude/commands/ows-*.md`) so you can invoke workflows directly:

```
/ows-propose    /ows-continue    /ows-apply    /ows-verify
/ows-query      /ows-status      /ows-retrieve /ows-archive
/ows-init       /ows-migrate     /ows-explore  /ows-onboard
```

### Vault structure

```
wiki/
  00-meta/         # Vault metadata (schema, log, conventions)
  01-sources/      # External references and documentation
  02-systems/      # System/component architecture
  03-features/     # Feature specifications with requirements
  04-changes/      # Active changes (proposed -> applied)
  05-decisions/    # Design decisions and rationale
  06-queries/      # Investigation notes
  99-archive/      # Completed changes
```

### CLI commands

| Command | Description |
|---------|-------------|
| `ows init` | Initialize a new vault |
| `ows propose` | Propose a new change (with preflight retrieval) |
| `ows continue` | Continue work on an existing change |
| `ows apply` | Apply a change to canonical Feature notes |
| `ows verify` | Verify vault consistency (4 dimensions) |
| `ows query` | Search the vault graph |
| `ows status` | Show change state and next action |
| `ows list` | List active changes |
| `ows archive` | Archive an applied change |
| `ows retrieve` | Run standalone retrieval scan (read-only) |
| `ows bulk-archive` | Archive all applied changes at once |
| `ows migrate` | Migrate from OpenSpec format |

### Versioning policy

ows uses two independent version numbers:

| Version | What it tracks | Bumped when |
|---------|----------------|-------------|
| `package.json` version (e.g., `0.2.4`) | npm release version | Any code change (follow semver) |
| `CURRENT_SCHEMA_VERSION` in `src/core/index/schema-version.ts` | Vault frontmatter/section schema | Breaking change to required sections, frontmatter fields, or file layout |

When a release bumps the schema version, existing vaults must be migrated. Run `ows --version` to see both numbers. `ows verify` emits `UNSUPPORTED_SCHEMA_VERSION` if a vault's schema version is not in `SUPPORTED_SCHEMA_VERSIONS`, and `BREAKING_CHANGE_WITHOUT_VERSION_BUMP` if the compile-time schema shape drifts from `BASELINE_SCHEMA_FINGERPRINT` without a version bump.

### Global flags

- `--verbose` — Enable verbose logging (sets `OWS_VERBOSE=1` for the child process)
- `--debug` — Enable debug logging (sets `OWS_DEBUG=1`, implies `--verbose`)
- `--json` — Output structured JSON (available on most commands)

### CLI exit codes

ows CLI commands use a consistent exit code policy:

| Code | Meaning |
|------|---------|
| `0` | Success (or `ows verify` reported no errors; warnings allowed unless `--strict`) |
| `1` | Runtime error (validation failure, I/O error, domain error) |
| `2` | Usage error (missing argument, unknown option, invalid flag value — Commander parse error) |

`ows verify` specifics:
- **Without `--strict`**: exit `0` if `error` count is `0`, regardless of warnings.
- **With `--strict`**: exit `0` only if `error` count AND `warning` count are both `0`.
- Any runtime error during verification → exit `1`.

CI integration: use plain `ows verify` to gate merges on errors only; use `ows verify --strict` to also block on warnings like `POTENTIAL_SECRET_LEAK` or `BREAKING_CHANGE_WITHOUT_VERSION_BUMP`.

### Environment variables

| Variable | Effect |
|----------|--------|
| `OWS_NO_LOG=1` | Skip appending to `wiki/00-meta/log.md` (equivalent to `--no-log` on propose/apply/archive) |
| `OWS_VERBOSE=1` | Enable verbose logging (same as `--verbose` flag) |
| `OWS_DEBUG=1` | Enable debug logging (same as `--debug` flag) |
| `OWS_TEST_OPENSPEC_DIR` | Override OpenSpec source directory in E2E tests |

**Precedence**: CLI flags and environment variables are OR'd — either one enables the behavior. Use the CLI flag for per-invocation control and the env var for session-wide defaults.

## Migrating from OpenSpec

Already using OpenSpec? Migrate in 3 steps:

```bash
# 1. Preview what will be converted (no files written)
ows migrate ./openspec --dry-run

# 2. Run the migration
ows migrate ./openspec

# 3. Verify everything converted correctly
ows verify
```

**What gets converted:**

| OpenSpec | ows |
|----------|-----|
| `specs/<capability>/spec.md` | `wiki/03-features/<capability>.md` — Requirements + Scenarios preserved |
| `changes/<name>/` (4 files) | `wiki/04-changes/<name>.md` — single note with all sections |
| `changes/archive/<date>-<name>/` | `wiki/99-archive/<date>-<name>.md` — status: applied |
| `config.yaml` context | `wiki/01-sources/project-context.md` |
| Substantial `design.md` | `wiki/05-decisions/` — promoted to Decision notes |

**Command equivalents:**

| OpenSpec | ows | Key difference |
|----------|-----|----------------|
| `/opsx:propose` | `/ows-propose` | + mandatory preflight similarity scan |
| `/opsx:continue` | `/ows-continue` | section-based, not artifact-based |
| `/opsx:apply` | `/ows-apply` | + stale detection, atomic delta order |
| `/opsx:verify` | `/ows-verify` | 4-dimension verification |
| `/opsx:explore` | `/ows-query` | results saved as Query notes |
| `/opsx:archive` | `/ows-archive` | status-first, then file move |

See the full migration guide (available in `docs/migration.md` when building from source) for detailed steps, conversion rules, and post-migration workflow.

## Documentation

> **Note:** Full documentation is available when building from source. Run `npm run build` to generate the `docs/` directory, or browse the module-level source code directly.

- Installation -- prerequisites, install methods, build from source
- Getting Started -- step-by-step tutorial
- Core Concepts -- note types, requirements, delta summary, lifecycle
- CLI Commands -- all 12 commands + 12 skill files
- Migration Guide -- OpenSpec to ows conversion
- Subagent Architecture -- how retrieval works
- Module Reference:
  - Types | Schemas | Vault Parser
  - Index Engine | Retrieval Engine | Sequencing Engine
  - Propose | Continue | Apply
  - Verify | Query | CLI Init

## Full lifecycle example

```bash
# 1. Initialize
ows init

# 2. Propose a change (preflight retrieval runs automatically)
ows propose "Add user authentication with email/password" --keywords "auth,login,password"

# 3. Fill in the Change sections (Why, Delta Summary, Tasks, Validation)
#    Then advance through the lifecycle:
ows continue <changeId>          # proposed → planned
ows continue <changeId>          # planned → in_progress

# 4. Complete tasks, then apply to canonical Feature
ows apply <changeId>

# 5. Fill in any ADDED/MODIFIED markers in the Feature note
#    Then verify everything is consistent
ows verify

# 6. Archive the completed change
ows archive <changeId>
```

## Requirements

- Node.js >= 20.0.0

## Contributing

**We actively welcome contributions!** Whether it's bug reports, feature ideas, documentation improvements, or code — all forms of participation are appreciated.

- **Issues**: Found a bug or have a suggestion? [Open an issue](https://github.com/sh940701/open-wiki-spec/issues).
- **Pull Requests**: Fork the repo, make your changes, and submit a PR. We review promptly.
- **Discussions**: Questions about architecture, design decisions, or use cases? Start a discussion in Issues.

### Getting started for contributors

```bash
git clone https://github.com/sh940701/open-wiki-spec.git
cd open-wiki-spec
npm install
npm run build
npm test          # 805+ tests should pass
```

### Areas where help is especially welcome

- **Semantic search improvements** — better embedding models, multilingual support
- **Obsidian plugin** — native Obsidian integration for graph view, Dataview queries
- **Additional agent runtime support** — Cursor, Codex, Gemini CLI adapters
- **Documentation** — tutorials, examples, translations
- **Testing** — edge cases, performance benchmarks, real-world usage reports

## License

[MIT](./LICENSE)
