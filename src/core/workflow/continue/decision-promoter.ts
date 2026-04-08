import type { SectionAnalysis } from './types.js';
import type { IndexRecord } from '../../../types/index-record.js';

export interface DecisionPromotionCandidate {
  content: string;
  reasons: {
    affectsMultiple: boolean;
    hardToReverse: boolean;
    needsConsensus: boolean;
    durableRationale: boolean;
    alreadyLinked: boolean;
  };
}

/**
 * Check if Design Approach content should be promoted to a Decision note.
 * Implements the duplication prevention rule from overview.md section 14.2.
 *
 * Any ONE criterion is sufficient to suggest promotion.
 */
export function checkDecisionPromotion(
  changeRecord: IndexRecord,
  analysis: SectionAnalysis,
): DecisionPromotionCandidate | null {
  const designSection = analysis.sections.get('Design Approach');
  if (!designSection || designSection.isEmpty) return null;

  const content = designSection.content;

  const reasons = {
    affectsMultiple:
      (changeRecord.touches?.length ?? 0) > 1 ||
      countWikilinkPrefix(content, 'Feature:') > 1 ||
      countWikilinkPrefix(content, 'System:') > 1,

    hardToReverse:
      /\b(migration|irreversible|cannot revert|breaking change|data loss|schema change|backward compatibility)\b/i.test(content),

    needsConsensus:
      /\b(adr|team decision|consensus|architectural decision|tech lead|design review)\b/i.test(content),

    durableRationale:
      /\b(chose|decided|rationale|trade-?off|alternative considered|versus|vs\.?|long-term|future-proof)\b/i.test(content),

    alreadyLinked: countWikilinkPrefix(content, 'Decision:') > 0,
  };

  // Already linked to a Decision: no promotion needed
  if (reasons.alreadyLinked) return null;

  if (
    reasons.affectsMultiple ||
    reasons.hardToReverse ||
    reasons.needsConsensus ||
    reasons.durableRationale
  ) {
    return { content, reasons };
  }

  return null;
}

function countWikilinkPrefix(content: string, prefix: string): number {
  const regex = new RegExp(`\\[\\[${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
  return (content.match(regex) ?? []).length;
}
