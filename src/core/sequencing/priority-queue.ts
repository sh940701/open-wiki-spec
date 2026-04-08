/**
 * Simple priority queue using a sorted array with a custom comparator.
 * Used for deterministic tiebreaking in topological sort: (created_at, change_id).
 */
export class PriorityQueue<T> {
  private items: T[] = [];
  private compareFn: (a: T, b: T) => number;

  constructor(compareFn: (a: T, b: T) => number) {
    this.compareFn = compareFn;
  }

  push(item: T): void {
    this.items.push(item);
    this.items.sort(this.compareFn);
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * Snapshot semantics: removes and returns ALL items currently in the queue.
   * Items added after this call are NOT included.
   */
  drainAll(): T[] {
    const snapshot = this.items;
    this.items = [];
    return snapshot;
  }
}
