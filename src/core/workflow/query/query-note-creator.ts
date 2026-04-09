/**
 * Query note creator.
 * Builds Query note markdown from investigation inputs.
 */
import { stringify as yamlStringify } from 'yaml';
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
  const data: Record<string, unknown> = {
    type: 'query',
    id,
    status: 'active',
    question: input.question,
  };

  if (input.relatedFeatures && input.relatedFeatures.length > 0) {
    data.features = input.relatedFeatures;
  }
  if (input.relatedSystems && input.relatedSystems.length > 0) {
    data.systems = input.relatedSystems;
  }
  if (input.relatedChanges && input.relatedChanges.length > 0) {
    data.changes = input.relatedChanges;
  }
  if (input.relatedDecisions && input.relatedDecisions.length > 0) {
    data.decisions = input.relatedDecisions;
  }
  if (input.relatedSources && input.relatedSources.length > 0) {
    data.sources = input.relatedSources;
  }
  if (input.relatedQueries && input.relatedQueries.length > 0) {
    data.related_queries = input.relatedQueries;
  }

  data.consulted = input.consultedNotes.map(c => `[[${c}]]`);

  const tags = ['query'];
  if (input.tags) {
    for (const t of input.tags) {
      if (t !== 'query') tags.push(t);
    }
  }
  data.tags = tags;

  data.created_at = new Date().toLocaleDateString('en-CA');

  return `---\n${yamlStringify(data).trimEnd()}\n---\n\n`;
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

