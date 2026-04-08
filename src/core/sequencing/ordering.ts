import type { IndexRecord } from '../../types/index-record.js';
import type { OrderedChange, CycleError } from '../../types/sequencing.js';
import { PriorityQueue } from './priority-queue.js';

/**
 * Find cycles in the dependency graph using DFS with back-edge detection.
 */
function findCycles(
  unvisitedIds: string[],
  adjacency: Map<string, string[]>,
): string[][] {
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const successors = adjacency.get(node) ?? [];
    for (const successor of successors) {
      if (recStack.has(successor)) {
        // Found a back-edge: extract the cycle
        const cycleStart = path.indexOf(successor);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), successor]);
        }
      } else if (!visited.has(successor)) {
        dfs(successor, path);
      }
    }

    path.pop();
    recStack.delete(node);
  }

  for (const nodeId of unvisitedIds) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, []);
    }
  }

  return cycles;
}

/**
 * Compute deterministic ordering of active changes using Kahn's algorithm.
 * Tiebreak: (created_at, change_id) ascending.
 */
export function computeDeterministicOrder(
  activeChanges: IndexRecord[],
  fullIndex?: Map<string, IndexRecord>,
): { ordering: OrderedChange[]; cycles: CycleError[] } {
  const activeIds = new Set(activeChanges.map((c) => c.id));
  const changeMap = new Map(activeChanges.map((c) => [c.id, c]));

  // Build adjacency list: dep -> [successors that depend on dep]
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const change of activeChanges) {
    adjacency.set(change.id, []);
    inDegree.set(change.id, 0);
  }

  for (const change of activeChanges) {
    for (const dep of change.depends_on) {
      if (activeIds.has(dep)) {
        // dep must come before change
        adjacency.get(dep)!.push(change.id);
        inDegree.set(change.id, (inDegree.get(change.id) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm with priority queue
  const queue = new PriorityQueue<IndexRecord>((a, b) => {
    // Compare by (created_at, change_id) ascending
    const aDate = a.created_at ?? '';
    const bDate = b.created_at ?? '';
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  for (const change of activeChanges) {
    if ((inDegree.get(change.id) ?? 0) === 0) {
      queue.push(change);
    }
  }

  const ordering: OrderedChange[] = [];
  let depth = 0;
  let position = 0;

  while (!queue.isEmpty) {
    // Snapshot semantics: process all nodes at current depth
    const currentBatch = queue.drainAll();

    for (const change of currentBatch) {
      const blocked_by: string[] = [];
      for (const dep of change.depends_on) {
        if (!activeIds.has(dep)) {
          // External dependency: only blocking if not found or not applied
          if (fullIndex) {
            const depRecord = fullIndex.get(dep);
            if (!depRecord || depRecord.status !== 'applied') {
              blocked_by.push(dep);
            }
          } else {
            // Without full index, conservatively mark as blocked
            blocked_by.push(dep);
          }
        }
      }

      ordering.push({
        id: change.id,
        depth,
        position: position++,
        blocked_by,
        conflicts_with: [], // filled in later by analyzeSequencing
      });

      // Process successors
      const successors = adjacency.get(change.id) ?? [];
      for (const successorId of successors) {
        const newDegree = (inDegree.get(successorId) ?? 1) - 1;
        inDegree.set(successorId, newDegree);
        if (newDegree === 0) {
          const successorRecord = changeMap.get(successorId);
          if (successorRecord) {
            queue.push(successorRecord);
          }
        }
      }
    }

    depth++;
  }

  // Detect cycles (nodes not visited)
  const visited = new Set(ordering.map((o) => o.id));
  const unvisited = activeChanges.filter((c) => !visited.has(c.id));
  const cycles: CycleError[] = [];

  if (unvisited.length > 0) {
    // Build forward adjacency for cycle detection (change -> its dependencies within active set)
    const forwardAdj = new Map<string, string[]>();
    for (const change of unvisited) {
      forwardAdj.set(
        change.id,
        change.depends_on.filter((dep) => activeIds.has(dep)),
      );
    }

    const cyclePaths = findCycles(
      unvisited.map((c) => c.id),
      forwardAdj,
    );

    for (const cyclePath of cyclePaths) {
      cycles.push({
        cycle: cyclePath,
        message: `Dependency cycle detected: ${cyclePath.join(' -> ')}`,
      });
    }

    // Add unvisited to ordering as blocked
    for (const change of unvisited) {
      ordering.push({
        id: change.id,
        depth: -1, // indicates cycle
        position: position++,
        blocked_by: ['CYCLE'],
        conflicts_with: [],
      });
    }
  }

  return { ordering, cycles };
}
