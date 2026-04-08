---
name: ows-retrieve
description: Run a standalone retrieval scan against the vault graph (retrieval subagent).
---

Run the open-wiki-spec retrieval subagent.

This skill is the **retrieval subagent** described in overview.md section 9.3. It delegates vault similarity scan to `ows propose --dry-run --json`, which runs the full retrieval pipeline (lexical retrieval, graph expansion, scoring, classification) without creating or modifying any notes.

**Input**: The argument after `/ows-retrieve` is a natural language description of what the user wants to find or check against the vault.

**When to use**:
- Before proposing a change, to check what already exists in the vault
- To answer "is there already a Feature/Change for X?" without side effects
- As a preflight check before any vault-modifying workflow
- When you need structured search results for decision-making

**Steps**

1. **Run retrieval (dry-run)**
   ```bash
   ows propose "<user's description>" --dry-run --json
   ```

2. **Parse the JSON output**

   The key fields are:
   - `retrieval.classification`: one of `existing_change`, `existing_feature`, `new_feature`, `needs_confirmation`
   - `retrieval.confidence`: `high`, `medium`, or `low`
   - `retrieval.candidates`: scored candidate list with `id`, `type`, `title`, `score`, `reasons`
   - `retrieval.warnings`: any index quality warnings
   - `retrieval.sequencing`: parallel safety and related change info (`status`: `parallel_safe`, `needs_review`, `conflict_candidate`, `conflict_critical`, or `blocked`)

3. **Present results to user**

   Show a summary table of top candidates:
   ```
   ## Retrieval Results: "<query>"

   Classification: existing_feature (confidence: high)

   | # | Note                       | Type    | Score | Key Reasons                    |
   |---|----------------------------|---------|-------|--------------------------------|
   | 1 | Feature: Auth Login        | feature | 87    | alias match, same system       |
   | 2 | Change: Improve Auth UX    | change  | 61    | active overlap, shared source  |
   ```

   Then explain the classification:
   - `existing_feature`: A matching Feature already exists. Attach new work to it.
   - `existing_change`: An active Change with the same purpose exists. Continue it instead of creating a new one.
   - `new_feature`: Nothing similar found. Safe to create new Feature + Change.
   - `needs_confirmation`: Ambiguous results. Show candidates and ask for user choice.

4. **Suggest next steps**

   Based on classification:
   - `existing_feature` / `new_feature`: "Run `/ows-propose` to create the Change."
   - `existing_change`: "Run `/ows-continue <changeId>` to continue the existing Change."
   - `needs_confirmation`: "Which of these candidates is the right match?"

**Contract**:
- **Input**: natural language description (same as `ows propose`)
- **Output**: structured ProposeResult JSON (in dry-run mode) with `action`, `retrieval`, `classification`, `target_change`, `target_feature`, `prerequisites`, `transitioned_to_planned`, `sequencing_warnings`
- **Side effects**: NONE (dry-run mode)

**Example**:
```bash
ows propose "add passkey login support" --dry-run --json
```

Output (abbreviated):
```json
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
```

**Guardrails**
- This is READ-ONLY — never create or modify vault notes
- Always show match reasons so the user can verify the classification
- If confidence is `low`, explicitly warn the user
- If warnings are present, show them prominently
- If `sequencing.status` is not `parallel_safe`, warn about potential conflicts with active Changes
