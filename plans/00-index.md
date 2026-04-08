# open-wiki-spec v1 Implementation Plans

## Plan Files

| # | File | Scope | Status |
|---|------|-------|--------|
| 01 | [project-structure.md](./01-project-structure.md) | Tech stack, directory layout, build config, dependencies | - |
| 02 | [note-templates.md](./02-note-templates.md) | 6 note types, frontmatter contracts, minimum sections, requirement identity | - |
| 03 | [vault-parser.md](./03-vault-parser.md) | Markdown/frontmatter/wikilink parsing, content hashing | - |
| 04 | [index-engine.md](./04-index-engine.md) | In-memory index, composite keys, reverse index, schema version | - |
| 05 | [retrieval-engine.md](./05-retrieval-engine.md) | Similarity scan, scoring, classification, query object contract | - |
| 06 | [sequencing-engine.md](./06-sequencing-engine.md) | depends_on/touches severity, requirement conflict, deterministic ordering | - |
| 07 | [workflow-propose.md](./07-workflow-propose.md) | Preflight scan, classification, Change/Feature creation, planned transition | - |
| 08 | [workflow-continue.md](./08-workflow-continue.md) | Next-action algorithm, section filling, Decision promotion | - |
| 09 | [workflow-apply.md](./09-workflow-apply.md) | Atomic delta application, stale detection, Feature update | - |
| 10 | [workflow-verify.md](./10-workflow-verify.md) | 3-dimension verification, vault integrity, operation validation matrix | - |
| 11 | [workflow-query.md](./11-workflow-query.md) | Vault graph search, Query note creation/accumulation | - |
| 12 | [cli-init.md](./12-cli-init.md) | CLI interface, vault initialization, onboarding | - |

## Implementation Order

```
Phase 1: Foundation
  01-project-structure → 02-note-templates → 03-vault-parser → 04-index-engine

Phase 2: Intelligence
  05-retrieval-engine → 06-sequencing-engine

Phase 3: Workflows
  07-workflow-propose → 08-workflow-continue → 09-workflow-apply → 10-workflow-verify → 11-workflow-query

Phase 4: Interface
  12-cli-init
```

## Reference
- [overview.md](../overview.md) - Design brief (source of truth for all plans)
- OpenSpec source: `git show HEAD:src/...` (in git history)
