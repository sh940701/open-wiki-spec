---
name: ows-archive
description: Archive an applied Change to 99-archive/.
---

Archive a completed Change, moving it from the active changes directory to 99-archive/.

**Input**: Specify a change ID after `/ows-archive` (e.g., `/ows-archive change-add-auth`). The change ID is **required** by the CLI. If the user does not provide one, run `ows list --json` and let them choose from changes with status `applied`.

**Prerequisites**: The CLI enforces that only `applied` changes can be archived. If the change is not applied, guide the user through `/ows-apply` first.

**Available flags**:
- `--json`: Output structured JSON result
- `--force`: Archive even if verify finds errors

**Steps**

1. **If no change ID provided, prompt for selection**

   Run `ows list --json` to get changes. Show only changes with status `applied`.

   **IMPORTANT**: Do NOT guess or auto-select. Always let the user choose.

2. **Verify before archiving**

   The archive command automatically runs `ows verify` on the change before archiving. If verify finds errors, the archive will fail unless `--force` is used.

   Suggest running `/ows-verify <changeId>` first so the user can review issues.

3. **Execute the archive**
   ```bash
   ows archive <changeId> --json
   ```

4. **Handle results**

   ---

   **If successful**: Show the old and new paths.

   **If verify failed**: Show the verify errors and ask the user:
   - Fix the issues and retry
   - Force archive with `ows archive <changeId> --force --json`

   ---

**Output On Success**

```
## Archive Complete

**Change:** <changeId>
**From:** wiki/04-changes/<filename>.md
**To:** wiki/99-archive/<filename>.md

The change has been archived. Decision history is preserved.
```

**Guardrails**
- Only applied changes can be archived
- Always show verify results before forcing an archive
- If verify fails, explain the issues before offering --force
- After archiving, the change is no longer active in the vault
