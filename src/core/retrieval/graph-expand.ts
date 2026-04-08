import type { VaultIndex } from '../../types/index-record.js';

/**
 * One-hop graph expansion from first-pass candidates.
 * Follows both links_out and links_in to find adjacent notes.
 */
export function graphExpand(
  firstPass: Set<string>,
  index: VaultIndex,
): Set<string> {
  const expanded = new Set<string>(firstPass);

  for (const id of firstPass) {
    const record = index.records.get(id);
    if (!record) continue;

    for (const linkedId of record.links_out) {
      expanded.add(linkedId);
    }
    for (const linkedId of record.links_in) {
      expanded.add(linkedId);
    }
  }

  return expanded;
}
