/**
 * Noteworthiness assessment.
 * Simple boolean rules to decide whether a query investigation
 * warrants creating a persistent Query note.
 * 
 * The final decision is ALWAYS confirmed with the user.
 */
import type { QuerySearchResult, NoteworthinessAssessment } from './types.js';

const SIMPLE_LOOKUP_PATTERNS = [
  /^(what is|what's) the status of/i,
  /^(list|show) (all|the)/i,
  /^how many/i,
];

/**
 * Assess whether a query investigation should be saved as a Query note.
 * Uses simple boolean rules -- no score thresholds for v1.
 */
export function assessNoteworthiness(
  question: string,
  searchResult: QuerySearchResult,
): NoteworthinessAssessment {
  const reasons: string[] = [];
  let shouldCreate = false;

  // Rule 1: Multi-note synthesis
  const relevantCount = searchResult.candidates.length;
  if (relevantCount >= 3) {
    shouldCreate = true;
    reasons.push(`Investigation spans ${relevantCount} relevant notes -- synthesis needed`);
  }

  // Rule 2: No existing coverage
  if (searchResult.existingQueries.length === 0) {
    reasons.push('No existing Query note covers this topic');
  } else if (searchResult.existingQueries[0].status === 'archived') {
    shouldCreate = false;
    reasons.push(`Existing resolved Query "${searchResult.existingQueries[0].title}" may already cover this`);
  }

  // Rule 3: Simple lookup detection (negative signal)
  if (SIMPLE_LOOKUP_PATTERNS.some((p) => p.test(question))) {
    shouldCreate = false;
    reasons.push('Simple lookup query -- direct answer likely sufficient');
  }

  // Rule 4: Active change context boosts recommendation
  const activeChangeMatches = searchResult.candidates.filter(
    (c) => c.type === 'change' && ['proposed', 'planned', 'in_progress'].includes(c.status),
  );
  if (activeChangeMatches.length > 0) {
    shouldCreate = true;
    reasons.push(`Related to ${activeChangeMatches.length} active change(s)`);
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (shouldCreate && relevantCount >= 3) {
    confidence = 'high';
  }
  if (!shouldCreate && SIMPLE_LOOKUP_PATTERNS.some((p) => p.test(question))) {
    confidence = 'high';
  }

  return { shouldCreate, confidence, reasons };
}
