---
name: ows-verify
description: Verify vault consistency.
---

Verify vault consistency across multiple dimensions.

**Input**: Optionally specify a change ID after `/ows-verify` to verify a specific change. If omitted, verify the entire vault.

**Available flags**:
- `--json`: Output structured JSON result
- `--strict`: Treat warnings as errors (both errors and warnings must be zero for pass)

**Steps**

1. **Run verification**
   ```bash
   ows verify --json
   # or for a specific change:
   ows verify <changeId> --json
   # strict mode:
   ows verify --strict --json
   ```

2. **Parse the VerifyReport**

   The report includes `pass` (boolean), `total_notes`, `issues` array, and a `summary` object with counts per dimension. The four verification dimensions are:

   - **completeness**: Required sections present, feature/change section coverage, minimum headings
   - **correctness**: Status lifecycle validity, stale base detection, operation validation matrix, schema version match, drift detection
   - **coherence**: Parallel change conflict detection (via sequencing engine), description consistency, decision consistency, depends_on integrity
   - **vault_integrity**: Duplicate IDs, missing IDs, unresolved wikilinks, ambiguous aliases, orphan notes, archive placement, invalid frontmatter types

   Each issue in the `issues` array has:
   - `dimension`: one of the four dimensions above
   - `severity`: `error`, `warning`, or `info`
   - `code`: machine-readable issue code (e.g., `DUPLICATE_ID`, `STALE_BASE`)
   - `message`: human-readable description
   - `note_path`: file path of the affected note (use for navigation)
   - `note_id`: ID of the affected note
   - `suggestion`: recommended fix

3. **Present results**

   **If pass**:
   ```
   ## Vault Verification: PASS
   No issues found across N notes.
   ```

   **If issues found**:
   Show errors first, then warnings, then info. Group by dimension for clarity:

   ```
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
   ```

   For each issue, include the `suggestion` field and `note_path` from the report.

**Guardrails**
- Always show the full report, don't summarize away issues
- Present errors before warnings before info
- Include file paths (`note_path`) so the user can navigate to issues
- If verification fails, suggest specific fixes for each issue
- Use `--strict` when preparing for release or archiving
