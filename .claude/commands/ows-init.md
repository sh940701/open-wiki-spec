---
name: ows-init
description: Initialize a new open-wiki-spec vault.
---

Initialize a new open-wiki-spec vault in the current project or a specified path.

**Input**: Optionally specify a target path after `/ows-init` (e.g., `/ows-init ./my-project`). If omitted, initializes in the current working directory.

**Available flags**:
- `--json`: Output structured JSON result
- `--force`: Force re-initialization, recreating meta files even if they exist
- `--skip-seed`: Skip creating seed notes (source and system placeholders)

**Steps**

1. **Run initialization**
   ```bash
   ows init --json
   # or with a path:
   ows init <path> --json
   # force re-init:
   ows init --force --json
   # skip seed notes:
   ows init --skip-seed --json
   ```

2. **Parse the result**

   The JSON output includes:
   - `mode`: `fresh` (new vault) or `extend` (existing directory)
   - `wikiPath`: path to the created wiki directory
   - `directoriesCreated`: list of directories created
   - `metaFilesCreated`: list of meta files created (log.md, index, etc.)
   - `seedFilesCreated`: list of seed notes created (Source and System placeholders)
   - `skillFilesGenerated`: list of Claude Code skill files generated
   - `warnings`: any warnings during initialization

3. **Present results**

   **If fresh init**:
   ```
   ## Vault Initialized

   Created new vault at: <wikiPath>
   - N directories created
   - N meta files created
   - N seed notes created
   - N skill files generated

   Next steps:
   1. Edit `wiki/01-sources/seed-context.md` to describe your project (stack, constraints, goals)
   2. Edit `wiki/02-systems/default-system.md` to define your primary system boundary
   3. Run `/ows-propose` to create your first Change
   ```

   **If extend** (existing directory):
   ```
   ## Vault Extended

   Extended existing vault at: <wikiPath>
   - N new directories added
   - N meta files updated

   Your existing notes are preserved. Seed notes are not overwritten.
   ```

**Seed Notes**

On fresh init, two seed notes are created:
- `wiki/01-sources/seed-context.md` — A placeholder Source note for the user to fill with project context (tech stack, goals, constraints)
- `wiki/02-systems/default-system.md` — A default System note for the user to define their primary system boundary

In extend mode, existing seed notes are never overwritten. Use `--skip-seed` to skip seed creation entirely.

**Guardrails**
- If the vault already exists and --force is not used, the init will extend rather than overwrite
- Never destroy existing vault content
- Encourage the user to edit seed-context.md after init — it improves retrieval quality
- Show warnings if any files were skipped
