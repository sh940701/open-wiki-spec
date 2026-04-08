---
name: ows-query
description: Search the vault graph and optionally create a Query note.
---

Search the vault knowledge graph to answer questions or find related notes.

**Input**: The argument after `/ows-query` is a natural language question (e.g., `/ows-query "how does authentication work?"`).

**Steps**

1. **Run the query**
   ```bash
   ows query "<question>" --json
   ```

2. **Parse the result**

   The JSON output includes:
   - `searchResult`: scored candidates from the vault graph
   - `contextDocument`: a synthesized context document built from matching notes
   - `assessment`: whether a Query note should be created (`shouldCreate`, `confidence`, `reasons`)

3. **Present findings**

   Show the context document and top matching notes:
   - Note title, type, score, and match reasons
   - Relevant sections from each matching note
   - Links to related notes for further exploration

4. **If assessment recommends note creation**

   Ask the user if they want to save the findings as a Query note:
   > "This query surfaced enough novel findings to be worth saving. Create a Query note?"

   If yes:
   ```bash
   ows query "<question>" --json --save
   ```

5. **Offer next steps**

   Based on findings, suggest:
   - Reading specific vault notes for deeper context
   - Running `/ows-propose` if the query reveals work to be done
   - Running `/ows-query` with a more specific question

**Guardrails**
- Always show match reasons so the user understands WHY notes were surfaced
- Don't auto-save Query notes — always ask the user first
- If no candidates found, suggest refining the question or checking vault content
