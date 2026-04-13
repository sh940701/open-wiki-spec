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
  // English
  { pattern: /\b(fix|bug|broken|error|crash)\b/i, intent: 'fix' },
  { pattern: /\b(change|update|modify|refactor|improve)\b/i, intent: 'modify' },
  { pattern: /\b(remove|delete|deprecate|drop)\b/i, intent: 'remove' },
  { pattern: /\b(investigate|research|explore|analyze|query)\b/i, intent: 'investigate' },
  // Korean — `\b` doesn't work at CJK boundaries so we match the word
  // directly. These cover the most common natural-language patterns that
  // Korean developers use when describing proposed changes.
  { pattern: /(수정|버그|오류|에러|고장|깨진|크래시)/, intent: 'fix' },
  { pattern: /(변경|업데이트|개선|리팩토링|개편)/, intent: 'modify' },
  { pattern: /(삭제|제거|폐기|드롭)/, intent: 'remove' },
  { pattern: /(조사|연구|탐색|분석|질의)/, intent: 'investigate' },
];

// Matches camelCase or snake_case tokens
const ENTITY_PATTERN = /^(?:[a-z]+[A-Z][a-zA-Z]*|[a-z]+_[a-z_]+)$/;

const MAX_SUMMARY_LENGTH = 500;

/**
 * Maximum number of unique feature_terms a query may produce. Pathological
 * 10k-char user inputs would otherwise produce hundreds of search terms,
 * each triggering an O(notes × raw_text.length) lexical scan. Cap keeps
 * retrieval bounded at `MAX_QUERY_TERMS × index_size` work per query.
 */
const MAX_QUERY_TERMS = 64;

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

  // Cap term extraction to the trimmed summary. Users can paste entire
  // design docs into `ows propose` and we don't want each word to become
  // its own lexical search term (which would be O(n_terms × n_notes)).
  // The summary cap is already MAX_SUMMARY_LENGTH chars, so term counts
  // stay bounded; MAX_QUERY_TERMS is a second line of defense against
  // dense token streams (e.g., no whitespace non-English text).
  const words = extractWords(summary);
  const significantWords = words.filter(
    (w) => !STOP_WORDS.has(w.toLowerCase()) && w.length > 1,
  );

  const entity_terms: string[] = [];
  const feature_terms: string[] = [];
  const seenFeature = new Set<string>();
  const seenEntity = new Set<string>();

  for (const word of significantWords) {
    // Skip intent keywords from feature_terms
    if (isIntentKeyword(word)) continue;

    if (ENTITY_PATTERN.test(word)) {
      if (!seenEntity.has(word)) {
        seenEntity.add(word);
        entity_terms.push(word);
      }
    } else {
      const lowered = word.toLowerCase();
      if (!seenFeature.has(lowered)) {
        seenFeature.add(lowered);
        feature_terms.push(lowered);
      }
    }
    if (feature_terms.length + entity_terms.length >= MAX_QUERY_TERMS) break;
  }

  return {
    intent,
    summary,
    feature_terms,
    system_terms: [],
    entity_terms,
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
