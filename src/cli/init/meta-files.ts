/**
 * Templates for 00-meta files.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCHEMA_VERSION = '2026-04-06-v1';

export function createSchemaFile(wikiPath: string): void {
  const content = `---
type: meta
schema_version: "${SCHEMA_VERSION}"
effective_date: "${formatDate(new Date())}"
---

# Vault Schema

## Current Version

\`${SCHEMA_VERSION}\`

## Note Types

| Type | Folder | Required Frontmatter |
|------|--------|---------------------|
| Feature | 03-features/ | type, id, status, systems |
| Change | 04-changes/ | type, id, status, feature/features, touches |
| System | 02-systems/ | type, id, status |
| Decision | 05-decisions/ | type, id, status |
| Source | 01-sources/ | type, id |
| Query | 06-queries/ | type, id, status |

## Migration Notes

- Initial schema. No migrations required.

## Deprecated Fields

- None.
`;
  fs.writeFileSync(path.join(wikiPath, '00-meta', 'schema.md'), content);
}

export function createIndexFile(wikiPath: string): void {
  const content = `---
type: meta
---

# Vault Index

This file is the entry point for navigating the vault.

## Quick Links

- [[schema]] -- Vault schema version and note type contracts
- [[log]] -- Vault operation log
- [[conventions]] -- Naming and structural conventions

## Note Types

This file is a manual entry point. Use \`ows list\` for the current vault contents.

### Features

### Systems

### Active Changes

### Decisions

### Sources

### Queries
`;
  fs.writeFileSync(path.join(wikiPath, '00-meta', 'index.md'), content);
}

export function createLogFile(wikiPath: string): void {
  const date = formatDate(new Date());
  const content = `---
type: meta
---

# Vault Operation Log

Chronological log of vault operations performed by \`ows\`.

| Date | Operation | Target | Agent |
|------|-----------|--------|-------|
| ${date} | init | vault | ows |
`;
  fs.writeFileSync(path.join(wikiPath, '00-meta', 'log.md'), content);
}

export function createConventionsFile(wikiPath: string): void {
  const content = `---
type: meta
---

# Vault Conventions

## File Naming

- Use kebab-case for all filenames: \`auth-login.md\`, not \`Auth Login.md\`.
- Prefix is not required in filenames (the folder provides context).
- Note title (H1) should include the type prefix: \`# Feature: Auth Login\`.

## Frontmatter Rules

- \`id\` is immutable after creation. Never change it.
- \`status\` should follow the allowed lifecycle transitions.
- Wikilinks in frontmatter use the format: \`"[[Note Title]]"\`.

## Wikilink Conventions

- Use note titles for wikilinks: \`[[Feature: Auth Login]]\`.
- Do not use file paths in wikilinks.
- If a note has aliases, any alias can be used as a wikilink target.

## Section Conventions

- Each note type has recommended sections (see [[schema]]).
- Additional sections can be added freely.
- Section names should match the expected names exactly (case-sensitive).

## Requirement Conventions

- Requirements live inside Feature notes under \`## Requirements\`.
- Each requirement: \`### Requirement: <name>\` with \`<name>\` unique within the Feature.
- Normative statement should contain \`SHALL\` or \`MUST\`.
- Each requirement should have at least one \`#### Scenario:\` with \`WHEN\`/\`THEN\` format.

## Delta Summary Conventions

- Delta Summary lives inside Change notes under \`## Delta Summary\`.
- Operations: \`ADDED\`, \`MODIFIED\`, \`REMOVED\`, \`RENAMED\`.
- Apply order: RENAMED -> REMOVED -> MODIFIED -> ADDED.
- MODIFIED/REMOVED/RENAMED entries should include \`[base: <content_hash>]\`.
`;
  fs.writeFileSync(path.join(wikiPath, '00-meta', 'conventions.md'), content);
}

/**
 * Append an entry to the vault operation log.
 */
export function appendLogEntry(
  vaultPath: string,
  operation: string,
  target: string,
  agent: string = 'ows',
): void {
  const logPath = path.join(vaultPath, '00-meta', 'log.md');
  const date = formatDate(new Date());
  const entry = `| ${date} | ${operation} | ${target} | ${agent} |`;
  fs.appendFileSync(logPath, '\n' + entry);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
