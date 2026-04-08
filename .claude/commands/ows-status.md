---
name: ows-status
description: Show the current state of a Change.
---

Show the current state and progress of a Change.

**Input**: Optionally specify a change ID after `/ows-status` (e.g., `/ows-status change-add-auth`). If omitted, show all active changes.

**Steps**

1. **If change ID provided**:
   ```bash
   ows status <changeId> --json
   ```

   The JSON output includes:
   - `changeId`: the change's ID
   - `status`: one of `proposed`, `planned`, `in_progress`, `applied`, `archived`
   - `features`: linked Feature IDs
   - `sectionCompleteness`: `{ why, deltaSummary, tasks, validation, designApproach? }`
   - `taskProgress`: `{ total, completed }`
   - `nextAction`: the recommended next step (see below)
   - `blockedBy`: array of blocking change IDs

   **nextAction types** (deterministic based on status and progress):
   - `fill_section` (proposed): A required section is missing. `target` names the section.
   - `transition` (proposed): All sections filled. `to` is the target status (planned).
   - `start_implementation` (planned): Ready to begin implementing.
   - `continue_task` (in_progress): Tasks remain. `target` is the next task description.
   - `blocked` (any): `blockers` lists the blocking change IDs.
   - `ready_to_apply` (in_progress): All tasks complete. Suggest `/ows-apply`.
   - `verify_then_archive` (applied): Change applied. Suggest `/ows-verify` then archiving.

2. **If no change ID (list all)**:
   ```bash
   ows list --json
   ```

   Show a summary table of all active changes:
   ```
   | Change ID           | Status      | Tasks | Next Action         |
   |---------------------|-------------|-------|---------------------|
   | change-add-auth     | in_progress | 3/7   | continue_task       |
   | change-fix-routing  | proposed    | 0/0   | fill_section        |
   | change-add-passkey  | in_progress | 5/5   | ready_to_apply      |
   | change-old-refactor | applied     | 4/4   | verify_then_archive |
   ```

**Guardrails**
- Show actionable next steps, not just raw status
- If blocked, explain what is blocking and suggest resolution
- For `ready_to_apply`, suggest `/ows-apply <changeId>`
- For `verify_then_archive`, suggest `/ows-verify` followed by `ows archive <changeId>`
