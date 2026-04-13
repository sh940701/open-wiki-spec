/**
 * Generates Claude Code skill files for ows workflows.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillDefinition } from './types.js';

export const WORKFLOW_SKILLS: Record<string, SkillDefinition> = {
  propose: {
    name: 'ows-propose',
    description: 'Propose a new change to the codebase wiki.',
    instructions: `Run the open-wiki-spec propose workflow.

**Input**: The argument after \`/ows-propose\` is a natural language description of what the user wants to build or change. If omitted, ask what they want to work on.

**Steps**

1. **If no input provided, ask what they want to build**

   Ask the user to describe what they want to build or change in the codebase.

   **IMPORTANT**: Do NOT proceed without understanding what the user wants.

2. **If input is long natural language, refine it first**

   Extract the core from the user's input:
   - **intent**: add / modify / remove / query
   - **keywords**: 3-5 essential keywords (prioritize technical terms, feature names, system names)
   - **summary**: 1-sentence summary

   Example: "우리 앱에서 워치랑 연동해서 수영 기록을 자동으로 가져오는데 HealthKit에서 데이터를 못 가져오는 케이스가 있어서 그걸 Sentry로 추적하고 싶거든"
   → summary: "HealthKit 워치 동기화 실패 Sentry 추적"
   → keywords: "워치 동기화,HealthKit,Sentry,에러 추적"

3. **Run preflight retrieval (dry-run first)**
   \`\`\`bash
   ows propose "<summary>" --keywords "<keyword1>,<keyword2>,..." --dry-run --json
   \`\`\`
   If the user's input is already concise, skip \`--keywords\` and use the input directly:
   \`\`\`bash
   ows propose "<user's description>" --dry-run --json
   \`\`\`
   Parse the JSON output to understand:
   - \`retrieval.classification\`: one of \`existing_change\`, \`existing_feature\`, \`new_feature\`, \`needs_confirmation\`
   - \`retrieval.confidence\`: \`high\`, \`medium\`, or \`low\`
   - \`retrieval.candidates\`: scored candidate list with scores and match reasons
   - \`classification.primary_candidate\`: the top matching note
   - \`sequencing_warnings\`: any parallel work conflicts

4. **Act based on classification**

   ---

   **If \`needs_confirmation\`**: Show the top candidates with their scores and match reasons. Ask the user to choose:
   - Which existing Feature to attach to, OR
   - Which existing Change to continue, OR
   - Create a new Feature + Change

   **If \`existing_feature\`**: Show which Feature matched and why. Confirm with the user before creating a new Change attached to it.

   **If \`existing_change\`**: Show the matching active Change. Suggest continuing it instead of creating a new one. Offer \`/ows-continue\` as next step.

   **If \`new_feature\`**: Confirm with the user that nothing similar exists and proceed.

   ---

5. **Execute the propose (if confirmed)**

   **IMPORTANT**: Use the same \`--keywords\` from the dry-run step to ensure consistent retrieval results.

   For \`new_feature\` or \`existing_feature\` classification, run directly:
   \`\`\`bash
   ows propose "<summary>" --keywords "<keyword1>,<keyword2>,..." --json
   \`\`\`

   For \`needs_confirmation\` (after user chooses), use \`--force-classification\` AND \`--force-target\`:
   \`\`\`bash
   # User chose to create new Feature + Change:
   ows propose "<summary>" --force-classification new_feature --json
   # User chose an existing Feature (use the candidate id from dry-run):
   ows propose "<summary>" --force-classification existing_feature --force-target "<candidate-id>" --json
   # User chose to continue an existing Change (hand off to continue):
   /ows-continue <candidate-change-id>
   \`\`\`
   **IMPORTANT**: When user picks \`existing_feature\` or \`existing_change\`, always include \`--force-target <id>\` with the candidate's actual id from the dry-run results. Without it, the engine uses the top candidate which may not be what the user chose.

6. **Show results**

   Display:
   - Classification decision and reasoning
   - Created/updated Change note path and ID
   - Linked Feature note (if applicable)
   - Next step: "Run \`/ows-continue <changeId>\` to fill in Change sections."

**Output**

After completing, summarize:
- What was created or updated
- Why (classification reasoning from retrieval)
- What to do next

**Retrieval Quality**

The propose workflow automatically enriches the query with system_terms by matching feature/entity terms against System note titles and aliases in the vault index. This means:
- System-related queries like "auth login" will auto-detect System notes titled "Authentication" and use them for scoring
- Partial title matches are supported: a search for "auth" will match "Feature: Auth Login" (partial match, +20 points)
- Title prefix stripping: "auth login" matches "Feature: Auth Login" (prefix-stripped match, +30 points)
- Derived aliases are auto-generated from note titles and IDs, improving alias-based matching even when no explicit aliases are set

**Guardrails**
- Always show dry-run results before creating anything
- If classification is \`needs_confirmation\`, NEVER auto-decide — always ask the user
- If \`sequencing_warnings\` are present, show them prominently before proceeding
- If confidence is \`low\`, warn the user that results may be inaccurate`,
  },
  continue: {
    name: 'ows-continue',
    description: 'Continue work on an existing Change.',
    instructions: `Continue working on an existing Change by filling sections or advancing status.

**Input**: Optionally specify a change ID after \`/ows-continue\` (e.g., \`/ows-continue change-add-auth\`). If omitted and only one active change exists, it is auto-selected. If multiple active changes exist, the CLI returns a list and the agent must ask the user to choose.

**Steps**

1. **If no change ID provided**

   Run \`ows continue --json\`. The CLI will:
   - **If 1 active change**: auto-select it and proceed.
   - **If 2+ active changes**: return an error with the list of active changes. Show them and let the user pick, then re-run with the chosen ID.
   - **If 0 active changes**: return an error. Suggest \`/ows-propose\` to create one.

   **IMPORTANT**: When the CLI returns multiple active changes, NEVER auto-select. Always ask the user.

2. **Check current status**
   \`\`\`bash
   ows status <changeId> --json
   \`\`\`
   Parse the JSON to understand:
   - Current status (proposed, planned, in_progress, applied)
   - Section completeness (which sections are filled vs empty)
   - Task progress (N/M done)
   - \`nextAction\`: what should be done next (see all 7 types below)

3. **Act based on nextAction**

   The nextAction algorithm returns one of 7 deterministic action types based on current status and section/task state:

   ---

   **If \`fill_section\`** (status: proposed): A required section is missing. Help the user write the missing section content. Read the Change note, identify what's missing, and draft content. Required sections for planned transition: Why, Delta Summary, Tasks, Validation.

   **If \`transition\`** (status: proposed -> planned): All required sections are filled. Run \`ows continue <changeId> --json\` to advance the status from proposed to planned.

   **If \`blocked\`** (status: planned): The Change has unresolved \`depends_on\` entries. Show blocking dependencies (change IDs that are not yet applied) and help resolve them.

   **If \`start_implementation\`** (status: planned -> in_progress): Dependencies are resolved and tasks exist. The CLI will auto-transition to in_progress. Show the first unchecked task and help the user begin implementing.

   **If \`continue_task\`** (status: in_progress): Show the next unchecked task and help the user work through it.

   **If \`ready_to_apply\`** (status: in_progress): All tasks are complete. Suggest running \`/ows-apply <changeId>\` to apply the Change to canonical Feature notes. Do NOT attempt to transition status here -- the apply workflow owns the in_progress -> applied transition.

   **If \`verify_then_archive\`** (status: applied): The Change has been applied. Suggest running \`/ows-verify\` and then archiving.

   ---

4. **After each action, show updated status**
   \`\`\`bash
   ows status <changeId>
   \`\`\`

**Output**

After each invocation, show:
- Current status and what changed
- Section/task progress
- What to do next

**Context Enrichment**

The continue result includes a \`context\` object with real content from linked notes (truncated at 500 chars per section):
- \`context.features[]\`: Purpose, Current Behavior, Requirements sections from linked Feature notes
- \`context.decisions[]\`: Summary, Context, Decision sections from linked Decision notes
- \`context.systems[]\`: Purpose, Boundaries sections from linked System notes
- \`context.sources[]\`: Summary, Content sections from linked Source notes

Use this context to inform section writing (especially Why and Delta Summary).

**Guardrails**
- Perform ONE section fill or ONE status transition per invocation
- Always read the Change note before modifying it
- Use the \`context\` from the continue result to inform your writing — do not ignore linked note content
- If context is unclear, ask the user before writing
- Show status after every change
- The continue workflow owns proposed->planned and planned->in_progress transitions ONLY
- The in_progress->applied transition is owned exclusively by the apply workflow`,
  },
  apply: {
    name: 'ows-apply',
    description: 'Apply a Change to canonical Feature notes.',
    instructions: `Apply a completed Change to canonical Feature notes, updating the wiki's current state.

**Input**: Specify a change ID after \`/ows-apply\` (e.g., \`/ows-apply change-add-auth\`). The change ID is **required** by the CLI. If the user does not provide one, run \`ows list --json\` and let them choose from changes with status \`in_progress\`.

**Prerequisites**: The CLI enforces these before applying:
- Change status MUST be \`in_progress\` (use \`/ows-continue\` to advance if needed)
- ALL tasks in the Change note must be checked (\`[x]\`)

**Available flags**:
- \`--json\`: Output structured JSON result
- \`--dry-run\`: Validate without writing any files (use this to preview)
- \`--force-stale\`: Apply even when stale base fingerprints are detected
- \`--no-auto-transition\`: Keep status as \`in_progress\` after writing (use when ADDED/MODIFIED markers need manual content before finalizing)
- \`--no-log\`: Skip appending to \`wiki/00-meta/log.md\`

**Steps**

1. **If no change ID provided, prompt for selection**

   Run \`ows list --json\` to get applicable changes. Show only changes with status \`in_progress\`.

   **IMPORTANT**: Do NOT guess or auto-select. Always let the user choose.

2. **Preview with dry-run first**
   \`\`\`bash
   ows apply <changeId> --dry-run --json
   \`\`\`
   Parse the result to check for stale entries or validation errors before committing.

3. **Handle dry-run results**

   ---

   **If stale_base detected** (\`staleReport.blocked: true\`): Show which Feature requirements have changed since the Change was created (base fingerprint mismatch). Ask the user how to resolve:
   - Re-run with \`--force-stale\` to apply anyway
   - Update the Change's Delta Summary to reflect current state
   - Abort and investigate

   **If validation errors**: Show pre-validation errors (e.g., ADDED requirement already exists, MODIFIED requirement not found). These must be fixed in the Change note.

   **If clean**: Proceed to actual apply.

   ---

4. **Execute the apply (if confirmed)**

   **CRITICAL: If the Change has ADDED or MODIFIED operations, use \`--no-auto-transition\` on the first apply** so the status stays in \`in_progress\` until you've filled in the marker contents. Example:
   \`\`\`bash
   # First apply: insert markers without transitioning to applied
   ows apply <changeId> --no-auto-transition --json
   \`\`\`
   Without this flag, the change will transition to \`applied\` while the Feature note still contains unfilled \`<!-- ADDED ... -->\` marker comments, and \`ows verify\` will then report \`UNFILLED_APPLY_MARKER\` errors.

   For changes with ONLY programmatic ops (RENAMED/REMOVED), a single plain apply is fine:
   \`\`\`bash
   ows apply <changeId> --json
   \`\`\`

   The apply uses a **two-phase commit** pattern:
   - **Phase 1** (validate & compute): Parse Delta Summary, stale-check all entries, pre-validate operations. No files written.
   - **Phase 2** (write): Only if Phase 1 passes. Apply operations in **atomic order**: RENAMED -> REMOVED -> MODIFIED -> ADDED.

   The apply engine programmatically modifies Feature notes:
   - **RENAMED**: Automatically renames the requirement in the Feature note. Fully automated.
   - **REMOVED**: Automatically removes the requirement from the Feature note. Fully automated.
   - **MODIFIED**: Inserts a \`<!-- MODIFIED by change: <changeId> -->\` marker after the requirement heading. The agent must then update the requirement text.
   - **ADDED**: Inserts a \`<!-- ADDED by change: <changeId>. Fill in normative statement (SHALL/MUST) and scenarios (WHEN/THEN). -->\` marker in the Requirements section. The agent must then write the new requirement content.

5. **Fill marker contents (if using --no-auto-transition)**

   Open each Feature note listed in \`result.modifiedFiles\`, find the \`<!-- ADDED ... -->\` and \`<!-- MODIFIED ... -->\` marker comments, and replace them with real requirement text (SHALL/MUST normative + WHEN/THEN scenarios). Then remove the marker comment itself.

6. **Finalize apply**
   \`\`\`bash
   # Second apply: now that markers are filled, transition to applied
   ows apply <changeId> --json
   \`\`\`

7. **Show final state**
   \`\`\`bash
   ows status <changeId>
   \`\`\`

**Output On Success**

\`\`\`
## Apply Complete

**Change:** <changeId>
**Status:** applied

### Updated Features
- Feature: Auth Login — updated Requirements section
- Feature: User Profile — added new requirement

The canonical wiki state now reflects this change.
\`\`\`

**Guardrails**
- The change ID is required -- always ensure one is provided before calling \`ows apply\`
- Always dry-run first to catch stale entries and validation errors
- If stale_base is detected, NEVER auto-resolve -- always ask the user
- Show a clear diff of what will change in each Feature before applying
- After apply, suggest archiving if appropriate
- Only the apply workflow can transition a Change from in_progress to applied`,
  },
  verify: {
    name: 'ows-verify',
    description: 'Verify vault consistency.',
    instructions: `Verify vault consistency across multiple dimensions.

**Input**: Optionally specify a change ID after \`/ows-verify\` to verify a specific change. If omitted, verify the entire vault.

**Available flags**:
- \`--json\`: Output structured JSON result
- \`--strict\`: Treat warnings as errors (both errors and warnings must be zero for pass)

**Steps**

1. **Run verification**
   \`\`\`bash
   ows verify --json
   # or for a specific change:
   ows verify <changeId> --json
   # strict mode:
   ows verify --strict --json
   \`\`\`

2. **Parse the VerifyReport**

   The report includes \`pass\` (boolean), \`total_notes\`, \`issues\` array, and a \`summary\` object with counts per dimension. The four verification dimensions are:

   - **completeness**: Required sections present, feature/change section coverage, minimum headings
   - **correctness**: Status lifecycle validity, stale base detection, operation validation matrix, schema version match, drift detection
   - **coherence**: Parallel change conflict detection (via sequencing engine), description consistency, decision consistency, depends_on integrity
   - **vault_integrity**: Duplicate IDs, missing IDs, unresolved wikilinks, ambiguous aliases, orphan notes, archive placement, invalid frontmatter types

   Each issue in the \`issues\` array has:
   - \`dimension\`: one of the four dimensions above
   - \`severity\`: \`error\`, \`warning\`, or \`info\`
   - \`code\`: machine-readable issue code (e.g., \`DUPLICATE_ID\`, \`STALE_BASE\`)
   - \`message\`: human-readable description
   - \`note_path\`: file path of the affected note (use for navigation)
   - \`note_id\`: ID of the affected note
   - \`suggestion\`: recommended fix

3. **Present results**

   **If pass**:
   \`\`\`
   ## Vault Verification: PASS
   No issues found across N notes.
   \`\`\`

   **If issues found**:
   Show errors first, then warnings, then info. Group by dimension for clarity:

   \`\`\`
   ## Vault Verification: FAIL

   ### Errors (must fix)
   - [vault_integrity] Feature: Auth Login — missing required "id" in frontmatter
   - [vault_integrity] Change: Add Passkey — wikilink [[Feature: Auth]] does not resolve
   - [correctness] Change: Add Auth — stale base detected for Feature: User Profile

   ### Warnings (should fix)
   - [vault_integrity] Ambiguous alias "login" matches 2 notes
   - [coherence] Changes "add-auth" and "fix-login" both touch Feature: Auth Login

   ### Info
   - [coherence] Active Feature "auth" references archived Decision "use-jwt"
   \`\`\`

   For each issue, include the \`suggestion\` field and \`note_path\` from the report.

**Guardrails**
- Always show the full report, don't summarize away issues
- Present errors before warnings before info
- Include file paths (\`note_path\`) so the user can navigate to issues
- If verification fails, suggest specific fixes for each issue
- Use \`--strict\` when preparing for release or archiving`,
  },
  query: {
    name: 'ows-query',
    description: 'Search the vault graph and optionally create a Query note.',
    instructions: `Search the vault knowledge graph to answer questions or find related notes.

**Input**: The argument after \`/ows-query\` is a natural language question (e.g., \`/ows-query "how does authentication work?"\`).

**Steps**

1. **Run the query**
   \`\`\`bash
   ows query "<question>" --json
   \`\`\`

2. **Parse the result**

   The JSON output includes:
   - \`searchResult\`: scored candidates from the vault graph
   - \`contextDocument\`: a synthesized context document built from matching notes
   - \`assessment\`: whether a Query note should be created (\`shouldCreate\`, \`confidence\`, \`reasons\`)

3. **Present findings**

   Show the context document and top matching notes:
   - Note title, type, score, and match reasons
   - Relevant sections from each matching note
   - Links to related notes for further exploration

4. **If assessment recommends note creation**

   Ask the user if they want to save the findings as a Query note:
   > "This query surfaced enough novel findings to be worth saving. Create a Query note?"

   If yes:
   \`\`\`bash
   ows query "<question>" --json --save
   \`\`\`

5. **Offer next steps**

   Based on findings, suggest:
   - Reading specific vault notes for deeper context
   - Running \`/ows-propose\` if the query reveals work to be done
   - Running \`/ows-query\` with a more specific question

**Guardrails**
- Always show match reasons so the user understands WHY notes were surfaced
- Don't auto-save Query notes — always ask the user first
- If no candidates found, suggest refining the question or checking vault content`,
  },
  status: {
    name: 'ows-status',
    description: 'Show the current state of a Change.',
    instructions: `Show the current state and progress of a Change.

**Input**: Optionally specify a change ID after \`/ows-status\` (e.g., \`/ows-status change-add-auth\`). If omitted, show all active changes.

**Steps**

1. **If change ID provided**:
   \`\`\`bash
   ows status <changeId> --json
   \`\`\`

   The JSON output includes:
   - \`changeId\`: the change's ID
   - \`status\`: one of \`proposed\`, \`planned\`, \`in_progress\`, \`applied\`, \`archived\`
   - \`features\`: linked Feature IDs
   - \`sectionCompleteness\`: \`{ why, deltaSummary, tasks, validation, designApproach? }\`
   - \`taskProgress\`: \`{ total, completed }\`
   - \`nextAction\`: the recommended next step (see below)
   - \`blockedBy\`: array of blocking change IDs

   **nextAction types** (deterministic based on status and progress):
   - \`fill_section\` (proposed): A required section is missing. \`target\` names the section.
   - \`transition\` (proposed): All sections filled. \`to\` is the target status (planned).
   - \`start_implementation\` (planned): Ready to begin implementing.
   - \`continue_task\` (in_progress): Tasks remain. \`target\` is the next task description.
   - \`blocked\` (any): \`blockers\` lists the blocking change IDs.
   - \`ready_to_apply\` (in_progress): All tasks complete. Suggest \`/ows-apply\`.
   - \`verify_then_archive\` (applied): Change applied. Suggest \`/ows-verify\` then archiving.

2. **If no change ID (list all)**:
   \`\`\`bash
   ows list --json
   \`\`\`

   Show a summary table of all active changes:
   \`\`\`
   | Change ID           | Status      | Tasks | Next Action         |
   |---------------------|-------------|-------|---------------------|
   | change-add-auth     | in_progress | 3/7   | continue_task       |
   | change-fix-routing  | proposed    | 0/0   | fill_section        |
   | change-add-passkey  | in_progress | 5/5   | ready_to_apply      |
   | change-old-refactor | applied     | 4/4   | verify_then_archive |
   \`\`\`

**Guardrails**
- Show actionable next steps, not just raw status
- If blocked, explain what is blocking and suggest resolution
- For \`ready_to_apply\`, suggest \`/ows-apply <changeId>\`
- For \`verify_then_archive\`, suggest \`/ows-verify\` followed by \`ows archive <changeId>\``,
  },
  retrieve: {
    name: 'ows-retrieve',
    description: 'Run a standalone retrieval scan against the vault graph (retrieval subagent).',
    instructions: `Run the open-wiki-spec retrieval subagent.

This skill is the **retrieval subagent** described in overview.md section 9.3. It delegates vault similarity scan to \`ows propose --dry-run --json\`, which runs the full retrieval pipeline (lexical retrieval, graph expansion, scoring, classification) without creating or modifying any notes.

**Input**: The argument after \`/ows-retrieve\` is a natural language description of what the user wants to find or check against the vault.

**When to use**:
- Before proposing a change, to check what already exists in the vault
- To answer "is there already a Feature/Change for X?" without side effects
- As a preflight check before any vault-modifying workflow
- When you need structured search results for decision-making

**Steps**

1. **Run retrieval (dry-run)**
   \`\`\`bash
   ows propose "<user's description>" --dry-run --json
   \`\`\`

2. **Parse the JSON output**

   The key fields are:
   - \`retrieval.classification\`: one of \`existing_change\`, \`existing_feature\`, \`new_feature\`, \`needs_confirmation\`
   - \`retrieval.confidence\`: \`high\`, \`medium\`, or \`low\`
   - \`retrieval.candidates\`: scored candidate list with \`id\`, \`type\`, \`title\`, \`score\`, \`reasons\`
   - \`retrieval.warnings\`: any index quality warnings
   - \`retrieval.sequencing\`: parallel safety and related change info (\`status\`: \`parallel_safe\`, \`needs_review\`, \`conflict_candidate\`, \`conflict_critical\`, or \`blocked\`)

3. **Present results to user**

   Show a summary table of top candidates:
   \`\`\`
   ## Retrieval Results: "<query>"

   Classification: existing_feature (confidence: high)

   | # | Note                       | Type    | Score | Key Reasons                    |
   |---|----------------------------|---------|-------|--------------------------------|
   | 1 | Feature: Auth Login        | feature | 87    | alias match, same system       |
   | 2 | Change: Improve Auth UX    | change  | 61    | active overlap, shared source  |
   \`\`\`

   Then explain the classification:
   - \`existing_feature\`: A matching Feature already exists. Attach new work to it.
   - \`existing_change\`: An active Change with the same purpose exists. Continue it instead of creating a new one.
   - \`new_feature\`: Nothing similar found. Safe to create new Feature + Change.
   - \`needs_confirmation\`: Ambiguous results. Show candidates and ask for user choice.

4. **Suggest next steps**

   Based on classification:
   - \`existing_feature\` / \`new_feature\`: "Run \`/ows-propose\` to create the Change."
   - \`existing_change\`: "Run \`/ows-continue <changeId>\` to continue the existing Change."
   - \`needs_confirmation\`: "Which of these candidates is the right match?"

**Contract**:
- **Input**: natural language description (same as \`ows propose\`)
- **Output**: structured ProposeResult JSON (in dry-run mode) with \`action\`, \`retrieval\`, \`classification\`, \`target_change\`, \`target_feature\`, \`prerequisites\`, \`transitioned_to_planned\`, \`sequencing_warnings\`
- **Side effects**: NONE (dry-run mode)

**Example**:
\`\`\`bash
ows propose "add passkey login support" --dry-run --json
\`\`\`

Output (abbreviated):
\`\`\`json
{
  "action": "created_change",
  "retrieval": {
    "query": "add passkey login support",
    "classification": "existing_feature",
    "confidence": "high",
    "candidates": [
      { "id": "feature-auth-login", "type": "feature", "title": "Feature: Auth Login", "score": 87, "reasons": ["alias match: login", "same system: authentication"] }
    ],
    "sequencing": { "status": "parallel_safe", "related_changes": [], "reasons": [] },
    "warnings": []
  },
  "classification": {
    "classification": "existing_feature",
    "confidence": "high",
    "primary_candidate": { "id": "feature-auth-login", "type": "feature", "title": "Feature: Auth Login", "score": 87 },
    "secondary_candidate": null,
    "reasons": ["alias match: login", "same system: authentication"]
  },
  "target_change": null,
  "target_feature": null,
  "prerequisites": null,
  "transitioned_to_planned": false,
  "sequencing_warnings": []
}
\`\`\`

**Guardrails**
- This is READ-ONLY — never create or modify vault notes
- Always show match reasons so the user can verify the classification
- If confidence is \`low\`, explicitly warn the user
- If warnings are present, show them prominently
- If \`sequencing.status\` is not \`parallel_safe\`, warn about potential conflicts with active Changes`,
  },
  archive: {
    name: 'ows-archive',
    description: 'Archive an applied Change to 99-archive/.',
    instructions: `Archive a completed Change, moving it from the active changes directory to 99-archive/.

**Input**: Specify a change ID after \`/ows-archive\` (e.g., \`/ows-archive change-add-auth\`). The change ID is **required** by the CLI. If the user does not provide one, run \`ows list --json\` and let them choose from changes with status \`applied\`.

**Prerequisites**: The CLI enforces that only \`applied\` changes can be archived. If the change is not applied, guide the user through \`/ows-apply\` first.

**Available flags**:
- \`--json\`: Output structured JSON result
- \`--force\`: Archive even if verify finds errors

**Steps**

1. **If no change ID provided, prompt for selection**

   Run \`ows list --json\` to get changes. Show only changes with status \`applied\`.

   **IMPORTANT**: Do NOT guess or auto-select. Always let the user choose.

2. **Verify before archiving**

   The archive command automatically runs \`ows verify\` on the change before archiving. If verify finds errors, the archive will fail unless \`--force\` is used.

   Suggest running \`/ows-verify <changeId>\` first so the user can review issues.

3. **Execute the archive**
   \`\`\`bash
   ows archive <changeId> --json
   \`\`\`

4. **Handle results**

   ---

   **If successful**: Show the old and new paths.

   **If verify failed**: Show the verify errors and ask the user:
   - Fix the issues and retry
   - Force archive with \`ows archive <changeId> --force --json\`

   ---

**Output On Success**

\`\`\`
## Archive Complete

**Change:** <changeId>
**From:** wiki/04-changes/<filename>.md
**To:** wiki/99-archive/<filename>.md

The change has been archived. Decision history is preserved.
\`\`\`

**Guardrails**
- Only applied changes can be archived
- Always show verify results before forcing an archive
- If verify fails, explain the issues before offering --force
- After archiving, the change is no longer active in the vault`,
  },
  init: {
    name: 'ows-init',
    description: 'Initialize a new open-wiki-spec vault.',
    instructions: `Initialize a new open-wiki-spec vault in the current project or a specified path.

**Input**: Optionally specify a target path after \`/ows-init\` (e.g., \`/ows-init ./my-project\`). If omitted, initializes in the current working directory.

**Available flags**:
- \`--json\`: Output structured JSON result
- \`--force\`: Force re-initialization, recreating meta files even if they exist
- \`--skip-seed\`: Skip creating seed notes (source and system placeholders)

**Steps**

1. **Run initialization**
   \`\`\`bash
   ows init --json
   # or with a path:
   ows init <path> --json
   # force re-init:
   ows init --force --json
   # skip seed notes:
   ows init --skip-seed --json
   \`\`\`

2. **Parse the result**

   The JSON output includes:
   - \`mode\`: \`fresh\` (new vault) or \`extend\` (existing directory)
   - \`wikiPath\`: path to the created wiki directory
   - \`directoriesCreated\`: list of directories created
   - \`metaFilesCreated\`: list of meta files created (log.md, index, etc.)
   - \`seedFilesCreated\`: list of seed notes created (Source and System placeholders)
   - \`skillFilesGenerated\`: list of Claude Code skill files generated
   - \`warnings\`: any warnings during initialization

3. **Present results**

   **If fresh init**:
   \`\`\`
   ## Vault Initialized

   Created new vault at: <wikiPath>
   - N directories created
   - N meta files created
   - N seed notes created
   - N skill files generated

   Next steps:
   1. Edit \`wiki/01-sources/seed-context.md\` to describe your project (stack, constraints, goals)
   2. Edit \`wiki/02-systems/default-system.md\` to define your primary system boundary
   3. Run \`/ows-propose\` to create your first Change
   \`\`\`

   **If extend** (existing directory):
   \`\`\`
   ## Vault Extended

   Extended existing vault at: <wikiPath>
   - N new directories added
   - N meta files updated

   Your existing notes are preserved. Seed notes are not overwritten.
   \`\`\`

**Seed Notes**

On fresh init, two seed notes are created:
- \`wiki/01-sources/seed-context.md\` — A placeholder Source note for the user to fill with project context (tech stack, goals, constraints)
- \`wiki/02-systems/default-system.md\` — A default System note for the user to define their primary system boundary

In extend mode, existing seed notes are never overwritten. Use \`--skip-seed\` to skip seed creation entirely.

**Guardrails**
- If the vault already exists and --force is not used, the init will extend rather than overwrite
- Never destroy existing vault content
- Encourage the user to edit seed-context.md after init — it improves retrieval quality
- Show warnings if any files were skipped`,
  },
  explore: {
    name: 'ows-explore',
    description: 'Enter exploration mode — investigate the codebase without implementing.',
    instructions: `Enter thinking/exploration mode. Investigate the codebase, architecture, and existing behavior without making any code changes.

**Input**: The argument after \`/ows-explore\` is a topic, question, or area to investigate (e.g., \`/ows-explore "how does the auth flow work?"\`).

**Purpose**: This is a safe space to investigate before committing to any plan. Unlike \`/ows-propose\`, this does NOT create any vault notes or changes. Use this to build understanding before proposing work.

**Steps**

1. **Understand the investigation scope**

   Parse the user's question and identify:
   - What system/feature area is involved
   - What kind of answer is needed (architecture overview, data flow, bug root cause, etc.)
   - What files/modules are likely relevant

2. **Search the vault for existing knowledge**
   \`\`\`bash
   ows query "<topic>" --json
   \`\`\`
   Check if the vault already has relevant Feature, System, Decision, or Query notes.

3. **Explore the codebase**

   Read code, trace call paths, examine data flows. Use whatever tools are available:
   - File reading and search
   - Symbol navigation
   - Dependency tracing
   - Architecture visualization (ASCII diagrams)

4. **Document findings**

   Present findings with:
   - Architecture diagrams (ASCII) where helpful
   - Key files and their roles
   - Data flow descriptions
   - Relevant existing vault notes
   - Questions that remain unanswered

5. **Suggest next steps**

   Based on findings:
   - "This is well-understood. No action needed."
   - "Consider creating a Decision note to record this rationale."
   - "This reveals work to do. Run \`/ows-propose\` to formalize it."
   - "Save these findings as a Query note? Run \`ows query '<topic>' --save\`"

**Rules**
- **NO code changes** — this is read-only investigation
- **NO vault modifications** — don't create notes (suggest it, but don't do it)
- **Be thorough** — read actual code, don't guess from file names
- **Visualize** — use ASCII diagrams for architecture, data flows, component relationships
- **Connect to vault** — reference existing vault notes when relevant
- **Capture for later** — if findings are substantial, suggest saving as a Query note`,
  },
  onboard: {
    name: 'ows-onboard',
    description: 'Guided tutorial for first-time open-wiki-spec users.',
    instructions: `Guide a first-time user through a complete open-wiki-spec cycle using their actual codebase.

**Purpose**: Help new users learn ows by doing — not by reading docs. Walk them through a real (small) cycle from propose to archive.

**Steps**

1. **Check vault state**
   \`\`\`bash
   ows list --json
   ows verify --json
   \`\`\`
   Determine if the vault is freshly initialized or already has content.

2. **Explain the vault structure**

   Give a quick orientation:
   \`\`\`
   wiki/
     00-meta/       — Vault metadata and conventions
     01-sources/    — External references (PRDs, docs)
     02-systems/    — System/component boundaries
     03-features/   — Feature specifications (the "what is")
     04-changes/    — Active work units (the "what's changing")
     05-decisions/  — Design decisions and rationale
     06-queries/    — Investigation notes
     99-archive/    — Completed changes
   \`\`\`

3. **Pick a small real task**

   Help the user identify a small, concrete task from their project:
   - A simple feature addition
   - A bug fix
   - A small refactor

   The task should be completable in ~15 minutes. Ask the user what they'd like to work on.

4. **Walk through the full cycle**

   Guide the user step by step (pausing for confirmation at each stage):

   **a. Propose** (\`/ows-propose\`)
   - Show how retrieval scans for existing work
   - Explain the classification result
   - Create the Feature + Change notes

   **b. Fill sections** (\`/ows-continue\`)
   - Help write the Why section
   - Help write the Delta Summary
   - Help write Tasks
   - Help write Validation
   - Show the proposed → planned transition

   **c. Implement** (\`/ows-continue\`)
   - Work through the tasks
   - Show how tasks are tracked

   **d. Apply** (\`/ows-apply\`)
   - Show how the Feature note gets updated
   - Explain the two-phase commit

   **e. Verify** (\`/ows-verify\`)
   - Run the 4-dimension check
   - Explain what each dimension means

   **f. Archive** (\`/ows-archive\`)
   - Move the completed change
   - Show the clean state

5. **Wrap up**

   Summarize what they learned:
   - 6 note types and their purposes
   - The lifecycle: propose → plan → implement → apply → verify → archive
   - Key commands they'll use daily
   - Where to find help (README, \`/ows-status\`, \`/ows-query\`)

**Guardrails**
- Pause after EACH major step for user confirmation
- Keep explanations concise — show, don't lecture
- Use the user's actual project, not hypothetical examples
- If the user gets confused, simplify — don't add complexity
- The goal is confidence, not completeness`,
  },
  migrate: {
    name: 'ows-migrate',
    description: 'Migrate an existing OpenSpec project to open-wiki-spec format.',
    instructions: `Migrate an existing OpenSpec project to open-wiki-spec format.

This converts an OpenSpec directory structure (\`openspec/changes/\`, \`openspec/specs/\`) to the open-wiki-spec flat wiki format (\`wiki/\`).

**Input**: Optionally specify the OpenSpec directory path after \`/ows-migrate\`. If omitted, the CLI will auto-detect \`openspec/\` in the current directory.

**Available flags**:
- \`--json\`: Output structured JSON result
- \`--dry-run\`: Show what would be migrated without writing files
- \`--skip-archive\`: Skip migrating archived changes

**Steps**

1. **Always dry-run first**
   \`\`\`bash
   ows migrate --dry-run --json
   # or with explicit path:
   ows migrate <openspec-dir> --dry-run --json
   \`\`\`

2. **Parse the migration plan**

   The dry-run returns a plan with:
   - \`openspecPath\`: detected OpenSpec source directory
   - \`wikiPath\`: target wiki directory
   - \`steps\`: list of migration steps, each with:
     - \`name\`: step name
     - \`description\`: what it does
     - \`outputs\`: files to create (with \`targetPath\` and \`sourceDescription\`)
     - \`warnings\`: any issues detected
   - \`totalFiles\`: total files to create
   - \`totalWarnings\`: total warning count

3. **Show the plan to the user**

   Present a summary of what will be migrated:
   \`\`\`
   ## Migration Plan

   **Source:** openspec/
   **Target:** wiki/

   Files to create: N
   Warnings: M

   ### Steps
   1. <step name> - <description> (N files)
   2. ...
   \`\`\`

   If there are warnings, show them prominently.
   Ask the user to confirm before proceeding.

4. **Execute migration (if confirmed)**
   \`\`\`bash
   ows migrate --json
   \`\`\`

5. **Show results**

   Display:
   - Files written
   - Files skipped (already exist)
   - Errors (if any)
   - Warnings

   Suggest running \`/ows-verify\` after migration to check vault consistency.

**Guardrails**
- Always dry-run before migrating
- Never overwrite existing files in the target wiki directory
- Show all warnings before proceeding
- After migration, suggest running \`/ows-verify\` to validate the result`,
  },
};

/**
 * Generate a skill markdown file.
 */
export function generateSkillFile(skillDef: SkillDefinition): string {
  return `---
name: ${skillDef.name}
description: ${skillDef.description}
---

${skillDef.instructions}
`;
}

/**
 * Write all skill files to the Claude Code commands directory.
 * If a user has customized an existing skill file (contents differ from the
 * previously-generated version), back it up before overwriting so users
 * never lose their customizations.
 */
export function writeAllSkillFiles(projectPath: string): string[] {
  const claudeDir = path.join(projectPath, '.claude', 'commands');
  fs.mkdirSync(claudeDir, { recursive: true });

  const generated: string[] = [];
  for (const [workflowName, skillDef] of Object.entries(WORKFLOW_SKILLS)) {
    const skillPath = path.join(claudeDir, `ows-${workflowName}.md`);
    const newContent = generateSkillFile(skillDef);

    // If file exists and differs from what we're about to write, back it up
    if (fs.existsSync(skillPath)) {
      try {
        const existingContent = fs.readFileSync(skillPath, 'utf-8');
        if (existingContent !== newContent) {
          const backupPath = `${skillPath}.bak`;
          fs.writeFileSync(backupPath, existingContent);
        }
      } catch {
        // Best-effort backup — don't block init if read fails
      }
    }

    fs.writeFileSync(skillPath, newContent);
    generated.push(skillPath);
  }

  return generated;
}
