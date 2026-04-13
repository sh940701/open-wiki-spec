/**
 * Simple priority queue using a deferred-sort array with a custom comparator.
 * Used for deterministic tiebreaking in topological sort: (created_at, change_id).
 *
 * Sort is deferred until `drainAll()` because the only consumer uses
 * snapshot semantics — it drains everything at the current depth before
 * calling push() again. Sorting on every push would make the whole topo
 * sort O(V² log V) per depth level, blowing up on large (1000+) change
 * graphs. Deferring collapses it to O(V log V) amortized.
 */
export class PriorityQueue<T> {
  private items: T[] = [];
  private compareFn: (a: T, b: T) => number;

  constructor(compareFn: (a: T, b: T) => number) {
    this.compareFn = compareFn;
  }

  push(item: T): void {
    this.items.push(item);
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * Snapshot semantics: removes and returns ALL items currently in the queue,
   * sorted by the comparator. Items added after this call are NOT included.
   */
  drainAll(): T[] {
    const snapshot = this.items;
    this.items = [];
    snapshot.sort(this.compareFn);
    return snapshot;
  }
}
