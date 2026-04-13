---
name: ows-propose
description: Propose a new change to the codebase wiki.
---

Run the open-wiki-spec propose workflow.

**Input**: The argument after `/ows-propose` is a natural language description of what the user wants to build or change. If omitted, ask what they want to work on.

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
   ```bash
   ows propose "<summary>" --keywords "<keyword1>,<keyword2>,..." --dry-run --json
   ```
   If the user's input is already concise, skip `--keywords` and use the input directly:
   ```bash
   ows propose "<user's description>" --dry-run --json
   ```
   Parse the JSON output to understand:
   - `retrieval.classification`: one of `existing_change`, `existing_feature`, `new_feature`, `needs_confirmation`
   - `retrieval.confidence`: `high`, `medium`, or `low`
   - `retrieval.candidates`: scored candidate list with scores and match reasons
   - `classification.primary_candidate`: the top matching note
   - `sequencing_warnings`: any parallel work conflicts

4. **Act based on classification**

   ---

   **If `needs_confirmation`**: Show the top candidates with their scores and match reasons. Ask the user to choose:
   - Which existing Feature to attach to, OR
   - Which existing Change to continue, OR
   - Create a new Feature + Change

   **If `existing_feature`**: Show which Feature matched and why. Confirm with the user before creating a new Change attached to it.

   **If `existing_change`**: Show the matching active Change. Suggest continuing it instead of creating a new one. Offer `/ows-continue` as next step.

   **If `new_feature`**: Confirm with the user that nothing similar exists and proceed.

   ---

5. **Execute the propose (if confirmed)**

   **IMPORTANT**: Use the same `--keywords` from the dry-run step to ensure consistent retrieval results.

   For `new_feature` or `existing_feature` classification, run directly:
   ```bash
   ows propose "<summary>" --keywords "<keyword1>,<keyword2>,..." --json
   ```

   For `needs_confirmation` (after user chooses), use `--force-classification` AND `--force-target`:
   ```bash
   # User chose to create new Feature + Change:
   ows propose "<summary>" --force-classification new_feature --json
   # User chose an existing Feature (use the candidate id from dry-run):
   ows propose "<summary>" --force-classification existing_feature --force-target "<candidate-id>" --json
   # User chose to continue an existing Change (hand off to continue):
   /ows-continue <candidate-change-id>
   ```
   **IMPORTANT**: When user picks `existing_feature` or `existing_change`, always include `--force-target <id>` with the candidate's actual id from the dry-run results. Without it, the engine uses the top candidate which may not be what the user chose.

6. **Show results**

   Display:
   - Classification decision and reasoning
   - Created/updated Change note path and ID
   - Linked Feature note (if applicable)
   - Next step: "Run `/ows-continue <changeId>` to fill in Change sections."

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
- If classification is `needs_confirmation`, NEVER auto-decide — always ask the user
- If `sequencing_warnings` are present, show them prominently before proceeding
- If confidence is `low`, warn the user that results may be inaccurate
