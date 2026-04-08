import type { IndexRecord } from '../../types/index-record.js';

/**
 * Compute reverse index: for every note, add the note's id to each
 * of its links_out targets' links_in arrays.
 */
export function computeReverseIndex(records: Map<string, IndexRecord>): void {
  // Clear all links_in first
  for (const record of records.values()) {
    record.links_in = [];
  }

  // Build reverse links
  for (const record of records.values()) {
    for (const targetId of record.links_out) {
      const targetRecord = records.get(targetId);
      if (targetRecord && !targetRecord.links_in.includes(record.id)) {
        targetRecord.links_in.push(record.id);
      }
    }
  }

  // Sort for determinism
  for (const record of records.values()) {
    record.links_in.sort();
  }
}
