/**
 * Query note creator.
 * Builds Query note markdown from investigation inputs.
 */
import type { QueryNoteInput } from './types.js';

/**
 * Create a Query note markdown file from investigation results.
 */
export function createQueryNote(input: QueryNoteInput): { path: string; content: string } {
  const dateStr = formatDate(new Date());
  const slug = slugify(input.title);
  const id = `query-${slug}-${dateStr}`;

  // Build frontmatter
  const frontmatter = buildFrontmatter(id, input);

  // Build body
  const body = buildBody(input);

  const path = `wiki/06-queries/${dateStr}-${slug}.md`;
  const content = frontmatter + body;

  return { path, content };
}

function buildFrontmatter(id: string, input: QueryNoteInput): string {
  const lines: string[] = ['---'];
  lines.push('type: query');
  lines.push(`id: ${id}`);
  lines.push('status: active');
  lines.push(`question: "${escapeYaml(input.question)}"`);

  if (input.relatedFeatures && input.relatedFeatures.length > 0) {
    lines.push('features:');
    for (const f of input.relatedFeatures) lines.push(`  - "${f}"`);
  }
  if (input.relatedSystems && input.relatedSystems.length > 0) {
    lines.push('systems:');
    for (const s of input.relatedSystems) lines.push(`  - "${s}"`);
  }
  if (input.relatedChanges && input.relatedChanges.length > 0) {
    lines.push('changes:');
    for (const c of input.relatedChanges) lines.push(`  - "${c}"`);
  }
  if (input.relatedDecisions && input.relatedDecisions.length > 0) {
    lines.push('decisions:');
    for (const d of input.relatedDecisions) lines.push(`  - "${d}"`);
  }
  if (input.relatedSources && input.relatedSources.length > 0) {
    lines.push('sources:');
    for (const s of input.relatedSources) lines.push(`  - "${s}"`);
  }
  if (input.relatedQueries && input.relatedQueries.length > 0) {
    lines.push('related_queries:');
    for (const q of input.relatedQueries) lines.push(`  - "${q}"`);
  }

  lines.push('consulted:');
  for (const c of input.consultedNotes) lines.push(`  - "[[${c}]]"`);

  lines.push('tags:');
  lines.push('  - query');
  if (input.tags) {
    for (const t of input.tags) {
      if (t !== 'query') lines.push(`  - ${t}`);
    }
  }

  lines.push(`created_at: "${new Date().toLocaleDateString('en-CA')}"`);
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

function buildBody(input: QueryNoteInput): string {
  const sections: string[] = [];

  sections.push(`# Query: ${input.title}`);
  sections.push('');
  sections.push('## Question');
  sections.push('');
  sections.push(input.question);
  sections.push('');
  sections.push('## Context');
  sections.push('');
  sections.push(input.context);
  sections.push('');
  sections.push('## Findings');
  sections.push('');
  sections.push(input.findings);
  sections.push('');
  sections.push('## Conclusion');
  sections.push('');
  sections.push(input.conclusion);
  sections.push('');
  sections.push('## Consulted Notes');
  for (const c of input.consultedNotes) {
    sections.push(`- [[${c}]]`);
  }
  sections.push('');
  sections.push('## Related Notes');

  const relatedSections = formatRelatedNotesByType(input);
  if (relatedSections) {
    sections.push(relatedSections);
  }

  if (input.recommendation) {
    sections.push('');
    sections.push('## Recommendation');
    sections.push('');
    sections.push(input.recommendation);
  }

  if (input.openQuestions) {
    sections.push('');
    sections.push('## Open Questions');
    sections.push('');
    sections.push(input.openQuestions);
  }

  sections.push('');
  return sections.join('\n');
}

function formatRelatedNotesByType(input: QueryNoteInput): string {
  const parts: string[] = [];

  if (input.relatedFeatures && input.relatedFeatures.length > 0) {
    parts.push('### Features');
    for (const f of input.relatedFeatures) parts.push(`- ${f}`);
  }
  if (input.relatedSystems && input.relatedSystems.length > 0) {
    parts.push('### Systems');
    for (const s of input.relatedSystems) parts.push(`- ${s}`);
  }
  if (input.relatedChanges && input.relatedChanges.length > 0) {
    parts.push('### Changes');
    for (const c of input.relatedChanges) parts.push(`- ${c}`);
  }
  if (input.relatedDecisions && input.relatedDecisions.length > 0) {
    parts.push('### Decisions');
    for (const d of input.relatedDecisions) parts.push(`- ${d}`);
  }
  if (input.relatedSources && input.relatedSources.length > 0) {
    parts.push('### Sources');
    for (const s of input.relatedSources) parts.push(`- ${s}`);
  }
  if (input.relatedQueries && input.relatedQueries.length > 0) {
    parts.push('### Related Queries');
    for (const q of input.relatedQueries) parts.push(`- ${q}`);
  }

  return parts.join('\n');
}

/** Convert a title to a kebab-case slug */
function slugify(title: string, maxLength = 40): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);
}

/** Format a Date as YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Escape special characters in YAML strings */
function escapeYaml(s: string): string {
  return s.replace(/"/g, '\\"');
}
