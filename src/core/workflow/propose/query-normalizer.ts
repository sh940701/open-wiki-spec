import type { QueryObject, LocalIntent } from './types.js';
import type { VaultIndex } from '../../../types/index-record.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'and', 'but',
  'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
  'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'it',
  'its', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'he',
  'she', 'they', 'me', 'us', 'him', 'her', 'them', 'my', 'our',
  'your', 'his', 'their', 'what', 'which', 'who', 'whom', 'when',
  'where', 'why', 'how', 'new',
]);

const INTENT_KEYWORDS: Array<{ pattern: RegExp; intent: LocalIntent }> = [
  { pattern: /\b(fix|bug|broken|error|crash)\b/i, intent: 'fix' },
  { pattern: /\b(change|update|modify|refactor|improve)\b/i, intent: 'modify' },
  { pattern: /\b(remove|delete|deprecate|drop)\b/i, intent: 'remove' },
  { pattern: /\b(investigate|research|explore|analyze|query)\b/i, intent: 'investigate' },
];

// Matches camelCase or snake_case tokens
const ENTITY_PATTERN = /^(?:[a-z]+[A-Z][a-zA-Z]*|[a-z]+_[a-z_]+)$/;

const MAX_SUMMARY_LENGTH = 500;

/**
 * Normalize a natural language user request into a structured QueryObject.
 * Intent detection + term extraction.
 */
export function normalizeQuery(userRequest: string, overrideKeywords?: string[]): QueryObject {
  const trimmed = userRequest.trim();
  if (!trimmed) {
    throw new Error('User request cannot be empty');
  }

  const summary = trimmed.length > MAX_SUMMARY_LENGTH
    ? trimmed.slice(0, MAX_SUMMARY_LENGTH)
    : trimmed;

  const intent = detectIntent(trimmed);

  // When override keywords are provided and non-empty, use them instead of self-parsing
  if (overrideKeywords && overrideKeywords.length > 0) {
    const entity_terms: string[] = [];
    const feature_terms: string[] = [];

    for (const kw of overrideKeywords) {
      if (ENTITY_PATTERN.test(kw)) {
        entity_terms.push(kw);
      } else {
        feature_terms.push(kw.toLowerCase());
      }
    }

    return {
      intent,
      summary,
      feature_terms: [...new Set(feature_terms)],
      system_terms: [],
      entity_terms: [...new Set(entity_terms)],
      status_bias: ['active', 'proposed', 'planned', 'in_progress'],
      override_keywords: overrideKeywords,
    };
  }

  const words = extractWords(trimmed);
  const significantWords = words.filter(
    (w) => !STOP_WORDS.has(w.toLowerCase()) && w.length > 1,
  );

  const entity_terms: string[] = [];
  const feature_terms: string[] = [];

  for (const word of significantWords) {
    // Skip intent keywords from feature_terms
    if (isIntentKeyword(word)) continue;

    if (ENTITY_PATTERN.test(word)) {
      entity_terms.push(word);
    } else {
      feature_terms.push(word.toLowerCase());
    }
  }

  return {
    intent,
    summary,
    feature_terms: [...new Set(feature_terms)],
    system_terms: [],
    entity_terms: [...new Set(entity_terms)],
    status_bias: ['active', 'proposed', 'planned', 'in_progress'],
  };
}

function detectIntent(text: string): LocalIntent {
  for (const { pattern, intent } of INTENT_KEYWORDS) {
    if (pattern.test(text)) {
      return intent;
    }
  }
  return 'add';
}

function extractWords(text: string): string[] {
  // Split on whitespace/punctuation but keep camelCase and snake_case intact
  return text.split(/[\s,;:!?()\[\]{}]+/).filter(Boolean);
}

function isIntentKeyword(word: string): boolean {
  const lower = word.toLowerCase();
  return INTENT_KEYWORDS.some(({ pattern }) => pattern.test(lower));
}

/**
 * Enrich a QueryObject with system_terms by matching feature_terms and entity_terms
 * against System note titles and aliases in the index.
 */
export function enrichSystemTerms(query: QueryObject, index: VaultIndex): QueryObject {
  const allTerms = [...query.feature_terms, ...query.entity_terms];
  if (allTerms.length === 0) return query;

  const matchedSystemTerms: string[] = [];

  for (const record of index.records.values()) {
    if (record.type !== 'system') continue;
    const titleLower = record.title.toLowerCase();
    const aliasesLower = record.aliases.map((a) => a.toLowerCase());

    for (const term of allTerms) {
      const termLower = term.toLowerCase();
      if (
        titleLower.includes(termLower) ||
        aliasesLower.some((a) => a.includes(termLower))
      ) {
        matchedSystemTerms.push(term.toLowerCase());
        break;
      }
    }
  }

  return {
    ...query,
    system_terms: [...new Set(matchedSystemTerms)],
  };
}
