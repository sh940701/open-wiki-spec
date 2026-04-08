---
name: ows-continue
description: Continue work on an existing Change.
---

Continue working on an existing Change by filling sections or advancing status.

**Input**: Optionally specify a change ID after `/ows-continue` (e.g., `/ows-continue change-add-auth`). If omitted and only one active change exists, it is auto-selected. If multiple active changes exist, the CLI returns a list and the agent must ask the user to choose.

**Steps**

1. **If no change ID provided**

   Run `ows continue --json`. The CLI will:
   - **If 1 active change**: auto-select it and proceed.
   - **If 2+ active changes**: return an error with the list of active changes. Show them and let the user pick, then re-run with the chosen ID.
   - **If 0 active changes**: return an error. Suggest `/ows-propose` to create one.

   **IMPORTANT**: When the CLI returns multiple active changes, NEVER auto-select. Always ask the user.

2. **Check current status**
   ```bash
   ows status <changeId> --json
   ```
   Parse the JSON to understand:
   - Current status (proposed, planned, in_progress, applied)
   - Section completeness (which sections are filled vs empty)
   - Task progress (N/M done)
   - `nextAction`: what should be done next (see all 7 types below)

3. **Act based on nextAction**

   The nextAction algorithm returns one of 7 deterministic action types based on current status and section/task state:

   ---

   **If `fill_section`** (status: proposed): A required section is missing. Help the user write the missing section content. Read the Change note, identify what's missing, and draft content. Required sections for planned transition: Why, Delta Summary, Tasks, Validation.

   **If `transition`** (status: proposed -> planned): All required sections are filled. Run `ows continue <changeId> --json` to advance the status from proposed to planned.

   **If `blocked`** (status: planned): The Change has unresolved `depends_on` entries. Show blocking dependencies (change IDs that are not yet applied) and help resolve them.

   **If `start_implementation`** (status: planned -> in_progress): Dependencies are resolved and tasks exist. The CLI will auto-transition to in_progress. Show the first unchecked task and help the user begin implementing.

   **If `continue_task`** (status: in_progress): Show the next unchecked task and help the user work through it.

   **If `ready_to_apply`** (status: in_progress): All tasks are complete. Suggest running `/ows-apply <changeId>` to apply the Change to canonical Feature notes. Do NOT attempt to transition status here -- the apply workflow owns the in_progress -> applied transition.

   **If `verify_then_archive`** (status: applied): The Change has been applied. Suggest running `/ows-verify` and then archiving.

   ---

4. **After each action, show updated status**
   ```bash
   ows status <changeId>
   ```

**Output**

After each invocation, show:
- Current status and what changed
- Section/task progress
- What to do next

**Context Enrichment**

The continue result includes a `context` object with real content from linked notes (truncated at 500 chars per section):
- `context.features[]`: Purpose, Current Behavior, Requirements sections from linked Feature notes
- `context.decisions[]`: Summary, Context, Decision sections from linked Decision notes
- `context.systems[]`: Purpose, Boundaries sections from linked System notes
- `context.sources[]`: Summary, Content sections from linked Source notes

Use this context to inform section writing (especially Why and Delta Summary).

**Guardrails**
- Perform ONE section fill or ONE status transition per invocation
- Always read the Change note before modifying it
- Use the `context` from the continue result to inform your writing — do not ignore linked note content
- If context is unclear, ask the user before writing
- Show status after every change
- The continue workflow owns proposed->planned and planned->in_progress transitions ONLY
- The in_progress->applied transition is owned exclusively by the apply workflow
