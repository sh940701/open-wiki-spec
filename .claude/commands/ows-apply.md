---
name: ows-apply
description: Apply a Change to canonical Feature notes.
---

Apply a completed Change to canonical Feature notes, updating the wiki's current state.

**Input**: Specify a change ID after `/ows-apply` (e.g., `/ows-apply change-add-auth`). The change ID is **required** by the CLI. If the user does not provide one, run `ows list --json` and let them choose from changes with status `in_progress`.

**Prerequisites**: The CLI enforces these before applying:
- Change status MUST be `in_progress` (use `/ows-continue` to advance if needed)
- ALL tasks in the Change note must be checked (`[x]`)

**Available flags**:
- `--json`: Output structured JSON result
- `--dry-run`: Validate without writing any files (use this to preview)
- `--force-stale`: Apply even when stale base fingerprints are detected

**Steps**

1. **If no change ID provided, prompt for selection**

   Run `ows list --json` to get applicable changes. Show only changes with status `in_progress`.

   **IMPORTANT**: Do NOT guess or auto-select. Always let the user choose.

2. **Preview with dry-run first**
   ```bash
   ows apply <changeId> --dry-run --json
   ```
   Parse the result to check for stale entries or validation errors before committing.

3. **Handle dry-run results**

   ---

   **If stale_base detected** (`staleReport.blocked: true`): Show which Feature requirements have changed since the Change was created (base fingerprint mismatch). Ask the user how to resolve:
   - Re-run with `--force-stale` to apply anyway
   - Update the Change's Delta Summary to reflect current state
   - Abort and investigate

   **If validation errors**: Show pre-validation errors (e.g., ADDED requirement already exists, MODIFIED requirement not found). These must be fixed in the Change note.

   **If clean**: Proceed to actual apply.

   ---

4. **Execute the apply (if confirmed)**
   ```bash
   ows apply <changeId> --json
   ```

   The apply uses a **two-phase commit** pattern:
   - **Phase 1** (validate & compute): Parse Delta Summary, stale-check all entries, pre-validate operations. No files written.
   - **Phase 2** (write): Only if Phase 1 passes. Apply operations in **atomic order**: RENAMED -> REMOVED -> MODIFIED -> ADDED.

   The apply engine programmatically modifies Feature notes:
   - **RENAMED**: Automatically renames the requirement in the Feature note. Fully automated.
   - **REMOVED**: Automatically removes the requirement from the Feature note. Fully automated.
   - **MODIFIED**: Inserts a `<!-- MODIFIED by change: <changeId> -->` marker after the requirement heading. The agent must then update the requirement text.
   - **ADDED**: Inserts a `<!-- ADDED by change: <changeId>. Fill in normative statement (SHALL/MUST) and scenarios (WHEN/THEN). -->` marker in the Requirements section. The agent must then write the new requirement content.

5. **Show final state**
   ```bash
   ows status <changeId>
   ```

**Output On Success**

```
## Apply Complete

**Change:** <changeId>
**Status:** applied

### Updated Features
- Feature: Auth Login — updated Requirements section
- Feature: User Profile — added new requirement

The canonical wiki state now reflects this change.
```

**Guardrails**
- The change ID is required -- always ensure one is provided before calling `ows apply`
- Always dry-run first to catch stale entries and validation errors
- If stale_base is detected, NEVER auto-resolve -- always ask the user
- Show a clear diff of what will change in each Feature before applying
- After apply, suggest archiving if appropriate
- Only the apply workflow can transition a Change from in_progress to applied
