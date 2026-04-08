---
name: ows-migrate
description: Migrate an existing OpenSpec project to open-wiki-spec format.
---

Migrate an existing OpenSpec project to open-wiki-spec format.

This converts an OpenSpec directory structure (`openspec/changes/`, `openspec/specs/`) to the open-wiki-spec flat wiki format (`wiki/`).

**Input**: Optionally specify the OpenSpec directory path after `/ows-migrate`. If omitted, the CLI will auto-detect `openspec/` in the current directory.

**Available flags**:
- `--json`: Output structured JSON result
- `--dry-run`: Show what would be migrated without writing files
- `--skip-archive`: Skip migrating archived changes

**Steps**

1. **Always dry-run first**
   ```bash
   ows migrate --dry-run --json
   # or with explicit path:
   ows migrate <openspec-dir> --dry-run --json
   ```

2. **Parse the migration plan**

   The dry-run returns a plan with:
   - `openspecPath`: detected OpenSpec source directory
   - `wikiPath`: target wiki directory
   - `steps`: list of migration steps, each with:
     - `name`: step name
     - `description`: what it does
     - `outputs`: files to create (with `targetPath` and `sourceDescription`)
     - `warnings`: any issues detected
   - `totalFiles`: total files to create
   - `totalWarnings`: total warning count

3. **Show the plan to the user**

   Present a summary of what will be migrated:
   ```
   ## Migration Plan

   **Source:** openspec/
   **Target:** wiki/

   Files to create: N
   Warnings: M

   ### Steps
   1. <step name> - <description> (N files)
   2. ...
   ```

   If there are warnings, show them prominently.
   Ask the user to confirm before proceeding.

4. **Execute migration (if confirmed)**
   ```bash
   ows migrate --json
   ```

5. **Show results**

   Display:
   - Files written
   - Files skipped (already exist)
   - Errors (if any)
   - Warnings

   Suggest running `/ows-verify` after migration to check vault consistency.

**Guardrails**
- Always dry-run before migrating
- Never overwrite existing files in the target wiki directory
- Show all warnings before proceeding
- After migration, suggest running `/ows-verify` to validate the result
