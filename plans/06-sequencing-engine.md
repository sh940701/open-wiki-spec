# Sequencing Engine Implementation Plan

## 1. OpenSpec Reference

### How OpenSpec Does It

OpenSpec's change stacking and parallel handling evolved in response to a concrete failure: when two changes touch the same requirement and are archived in sequence, the second archive silently overwrites the first's scenarios because `buildUpdatedSpec()` performs hash-map substitution of entire requirement blocks without any base-version comparison. The `openspec-parallel-merge-plan.md` documents this as the "Parallel Delta Remediation Plan."

OpenSpec's response was layered:
- **Phase 0**: Persist requirement fingerprints (SHA-256 of requirement body) alongside each change. Validate fingerprints during archive to block stale overwrites.
- **Phase 1**: Introduce `openspec change sync` (rebase workflow) with 3-way merge per requirement.
- **Phase 2**: Extend delta language with scenario-level directives.
- **Phase 3**: Long-term structured spec graph with operational transforms.

Separately, the `add-change-stacking-awareness` change introduced metadata fields for explicit sequencing:
- `dependsOn`: explicit ordering edges (string arrays of change IDs)
- `provides` / `requires`: capability markers as validation contracts
- `touches`: advisory overlap signals (non-blocking)
- `parent`: parent-child split structure for decomposed changes

The stacking spec requires:
- Deterministic topological ordering with lexicographic tiebreaking by change ID
- Cycle detection before archive or sequencing actions
- `requires` markers demand explicit `dependsOn` edges (no implicit dependency inference)
- `touches` overlap emits warnings but does not fail validation
- Archived providers satisfy `requires` markers without warnings

### Key Source Files

| File | Description |
|------|-------------|
| `openspec-parallel-merge-plan.md` | Root-cause analysis of parallel delta corruption; layered remediation plan |
| `openspec/changes/add-change-stacking-awareness/specs/change-stacking-workflow/spec.md` | Stacking metadata model, dependency graph, capability markers, overlap semantics |
| `openspec/changes/add-change-stacking-awareness/specs/change-creation/spec.md` | Stack metadata scaffolding during change creation and split workflows |
| `openspec/changes/add-change-stacking-awareness/specs/openspec-conventions/spec.md` | Conventions for declaring dependencies, touches, and parent-child splits |
| `openspec/changes/add-change-stacking-awareness/specs/cli-change/spec.md` | CLI commands: `change graph`, `change next`, `change split` |
| `src/core/specs-apply.ts` | `buildUpdatedSpec()`: RENAMED -> REMOVED -> MODIFIED -> ADDED apply order; no base fingerprint checks |
| `src/core/templates/workflows/bulk-archive-change.ts` | Bulk archive with conflict detection by shared capability (not requirement-level) |

### Core Algorithm / Flow

OpenSpec's current stacking flow:

1. Each change optionally declares `dependsOn`, `provides`, `requires`, `touches` in `.openspec.yaml`.
2. `change graph` computes a dependency graph across active changes and returns a topological order.
3. `change next` returns unblocked changes (all `dependsOn` targets resolved).
4. Tiebreaking is lexicographic by change ID at the same dependency depth.
5. `touches` overlap emits a warning listing overlapping changes and touched areas.
6. `requires` without a corresponding `provides` in any active change checks archived history; missing in full history emits a non-blocking warning.
7. Cycle detection fails validation with actionable guidance.

**Critical gap in current OpenSpec**: `buildUpdatedSpec()` in `specs-apply.ts` has no fingerprint validation. It reads the delta spec, applies RENAMED/REMOVED/MODIFIED/ADDED operations to the target spec, but never checks whether the target spec has changed since the change was authored. This is the exact gap that `openspec-parallel-merge-plan.md` Phase 0 aims to fix.

---

## 2. open-wiki-spec Design Intent

### What overview.md Specifies

Relevant sections: **10.5.1** (Parallel Change Sequencing Contract), **10.6** (Retrieval Subagent Output Contract - `sequencing` field), **10.8** (Verify Dimensions - stale-change detection, vault integrity), **14.2** (Change note structure - `depends_on`, `touches`, `Delta Summary` with `base_fingerprint`), **15** (Workflow - apply step base_fingerprint check).

Key contracts:

1. **Touches Severity Model** - Four severity levels:
   - `parallel_safe`: no touch overlap
   - `needs_review`: same System touched but different Features
   - `conflict_candidate`: same Feature touched
   - `blocked`: depends_on target incomplete

2. **Requirement-Level Conflict Model** - `conflict_critical` for:
   - Two active Changes both MODIFY the same requirement
   - One MODIFY + one REMOVE on same requirement
   - RENAME + MODIFY on same requirement (old name)
   - Both ADD the same requirement name

3. **Deterministic Ordering**:
   - Topological sort on `depends_on`
   - `(created_at, change_id)` tuple ascending as tiebreak (FIFO + deterministic)
   - User-assigned priority overrides everything
   - Conflicts require user choice

4. **Base Fingerprint / Stale Detection**:
   - Each MODIFIED/REMOVED/RENAMED delta entry records `base_fingerprint` = target requirement's `content_hash` at authoring time
   - At apply time, current `content_hash` is compared to `base_fingerprint`
   - Mismatch = `stale_base` warning; auto-apply blocked

5. **Sequencing in Retrieval Output**:
   - `sequencing.status`: one of the four severity levels
   - `sequencing.related_changes`: list of change IDs with overlap
   - `sequencing.reasons`: human-readable explanation strings

### Differences from OpenSpec

| Aspect | OpenSpec | open-wiki-spec |
|--------|----------|----------------|
| Metadata location | `.openspec.yaml` per change directory | YAML frontmatter in Change `.md` note |
| Conflict granularity | Capability-level (specs directory) | Feature/System surface (`touches`) + requirement-level (`Delta Summary`) |
| Fingerprint storage | Not yet implemented (Phase 0 plan) | First-class in Delta Summary `[base: sha256:...]` syntax |
| Ordering tiebreak | Lexicographic by change ID | `(created_at, change_id)` tuple (FIFO preferred) |
| Overlap semantics | `touches` = pure advisory | `touches` = severity-classified (parallel_safe through blocked) |
| `provides`/`requires` | Capability contract markers | Not adopted in v1 (replaced by `touches` severity + requirement-level conflict) |
| `parent`/split | Supported for decomposition | Not in v1 scope (can be added later) |
| Integration | Standalone CLI commands | Embedded in retrieval output and verify dimensions |

### Contracts to Satisfy

1. `computeTouchesSeverity(changeA, changeB)` must return one of `parallel_safe | needs_review | conflict_candidate | blocked`.
2. `detectRequirementConflicts(activeChanges)` must detect `conflict_critical` pairs from Delta Summary cross-analysis.
3. `computeDeterministicOrder(activeChanges)` must produce a topological sort with `(created_at, change_id)` tiebreak, detect cycles, and flag conflict pairs.
4. `checkBaseFingerprints(change, currentIndex)` must compare each Delta Summary entry's `base_fingerprint` against the current requirement `content_hash` and return stale entries.
5. The retrieval subagent output must include a `sequencing` field with status, related changes, and reasons.
6. `verify` must report stale bases, requirement-level conflicts, broken depends_on, and overlapping touches as part of its Coherence and Vault Integrity dimensions.

---

## 3. Implementation Plan

### Architecture Overview

The sequencing engine is a pure-function module that takes the index (from plan 04) as input and produces sequencing analysis results. It has no side effects and does not modify any files.

```
┌────────────────┐
│  Index Engine   │  (plan 04: provides IndexRecord[])
│  (04)           │
└───────┬────────┘
        │ IndexRecord[]
        v
┌────────────────────────────────┐
│     Sequencing Engine (06)     │
│                                │
│  computeTouchesSeverity()      │
│  detectRequirementConflicts()  │
│  computeDeterministicOrder()   │
│  checkBaseFingerprints()       │
│  analyzeSequencing()           │  <-- main entry point
└───────┬────────────────────────┘
        │ SequencingResult
        v
┌────────────────┐    ┌──────────────┐
│ Retrieval (05) │    │ Verify (10)  │
│ embeds in      │    │ uses for     │
│ output         │    │ coherence    │
└────────────────┘    └──────────────┘
```

Module file: `src/sequencing/index.ts`

### Data Structures

```typescript
// ── Input types (from index engine, plan 04; canonical definition in 00-unified-types.md) ──
// Only fields relevant to sequencing are listed here. Full definition in 00-unified-types.md.

interface IndexRecord {
  id: string;
  type: NoteType;               // 'feature' | 'change' | 'system' | 'decision' | 'source' | 'query'
  title: string;
  status: string;
  depends_on: string[];         // resolved IDs of dependency targets
  touches: string[];            // resolved IDs of touched Feature/System notes
  delta_summary: DeltaSummaryEntry[];
  requirements: Requirement[];  // only meaningful for Feature; includes content_hash per requirement
  created_at?: string;          // ISO 8601 date from frontmatter (only for Change)
  content_hash: string;         // SHA-256 of entire note body
  // ... other IndexRecord fields from plan 04 / 00-unified-types.md
}

// DeltaSummaryEntry matches 00-unified-types.md exactly.
// Field `target_note_id` is used (not `feature`) to match the canonical type definition.
interface DeltaSummaryEntry {
  op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  target_type: 'requirement' | 'section';
  target_name: string;
  new_name?: string;            // only for RENAMED
  target_note_id: string;       // wikilink-resolved feature/note id
  base_fingerprint: string | null;  // null for ADDED
  description?: string;
}

/**
 * Internal pseudo-op used only during conflict detection.
 * RENAMED_TO represents the "new name" side of a RENAMED entry.
 * It does NOT appear in DeltaSummaryEntry.op or in note content.
 */
type ConflictOp = DeltaSummaryEntry['op'] | 'RENAMED_TO';

// ── Severity types ──

type TouchesSeverity =
  | 'parallel_safe'
  | 'needs_review'
  | 'conflict_candidate'
  | 'blocked';

type RequirementConflictLevel = 'conflict_critical';

// ── Output types ──

interface TouchesSeverityResult {
  severity: TouchesSeverity;
  change_a: string;             // change ID
  change_b: string;             // change ID
  overlapping_features: string[];
  overlapping_systems: string[];
  reasons: string[];
}

// RequirementConflict matches 00-unified-types.md.
// The unified type is per-change (keyed by other_change_id), but the
// sequencing engine produces pairs during pairwise analysis.
// When emitting results, each pair (A, B) produces TWO RequirementConflict
// entries: one for A (other_change_id=B) and one for B (other_change_id=A).
// The internal algorithm uses the pairwise form below, then expands.
interface RequirementConflictPair {
  change_a: string;
  change_b: string;
  feature_id: string;            // Feature ID where conflict occurs
  requirement_name: string;      // requirement name
  this_op: ConflictOp;           // can be DeltaOp or 'RENAMED_TO' (pseudo-op for new-name side)
  other_op: ConflictOp;          // can be DeltaOp or 'RENAMED_TO' (pseudo-op for new-name side)
  reason: string;
}

interface OrderedChange {
  id: string;
  depth: number;                // topological depth (0 = no dependencies)
  position: number;             // global position in order
  blocked_by: string[];         // IDs of incomplete dependencies
  conflicts_with: string[];     // IDs of conflicting changes
}

interface CycleError {
  cycle: string[];              // IDs forming the cycle
  message: string;
}

interface StaleBaseEntry {
  change_id: string;
  delta_entry: DeltaSummaryEntry;
  expected_hash: string;        // base_fingerprint from delta
  actual_hash: string;          // current content_hash from index
  feature_id: string;
  requirement_key: string;      // composite key: feature_id::requirement_name
}

interface OutOfOrderError {
  change_id: string;          // the change that jumped ahead
  change_status: string;      // current status (in_progress | applied)
  dependency_id: string;      // the dependency that is behind
  dependency_status: string;  // current status of the dependency
  message: string;
}

interface SequencingResult {
  /** Overall severity: worst severity across all pairs */
  status: TouchesSeverity | 'conflict_critical';

  /** Pairwise severity for all active change pairs with overlap */
  pairwise_severities: TouchesSeverityResult[];

  /** Requirement-level conflicts across active changes (pairwise form) */
  requirement_conflicts: RequirementConflictPair[];

  /** Deterministic ordering of all active changes */
  ordering: OrderedChange[];

  /** Cycle errors, if any */
  cycles: CycleError[];

  /** Stale base fingerprint entries */
  stale_bases: StaleBaseEntry[];

  /** Out-of-order errors: changes that jumped ahead of their dependencies */
  out_of_order_errors: OutOfOrderError[];

  /** Human-readable summary reasons */
  reasons: string[];

  /** Related change IDs (all active changes with any overlap) */
  related_changes: string[];
}

// ── For retrieval output integration ──

interface SequencingSummary {
  status: TouchesSeverity | 'conflict_critical';
  related_changes: string[];
  reasons: string[];
}
```

### Core Algorithm

#### Algorithm 1: computeTouchesSeverity(changeA, changeB, index)

```
function computeTouchesSeverity(changeA: IndexRecord, changeB: IndexRecord, index: Map<string, IndexRecord>): TouchesSeverityResult:
  // Step 1: Check blocked status first (takes priority)
  if changeA.depends_on includes changeB.id AND changeB.status not in ['applied']:
    return { severity: 'blocked', ... }
  if changeB.depends_on includes changeA.id AND changeA.status not in ['applied']:
    return { severity: 'blocked', ... }

  // Step 2: Compute touch surface overlap
  touchesA = Set(changeA.touches)
  touchesB = Set(changeB.touches)
  overlap = touchesA ∩ touchesB

  if overlap is empty:
    return { severity: 'parallel_safe', overlapping_features: [], overlapping_systems: [], reasons: ['no touch overlap'] }

  // Step 3: Classify overlap by type
  overlapping_features = []
  overlapping_systems = []
  for id in overlap:
    record = index.get(id)
    if record is null:
      continue  // broken reference, reported separately by verify
    if record.type == 'feature':
      overlapping_features.push(id)
    else if record.type == 'system':
      overlapping_systems.push(id)

  // Step 4: Determine severity
  if overlapping_features.length > 0:
    return {
      severity: 'conflict_candidate',
      overlapping_features,
      overlapping_systems,
      reasons: [`both touch Feature(s): ${overlapping_features.join(', ')}`]
    }
  else if overlapping_systems.length > 0:
    return {
      severity: 'needs_review',
      overlapping_features: [],
      overlapping_systems,
      reasons: [`both touch System(s): ${overlapping_systems.join(', ')} but different Features`]
    }

  // Fallback (overlap exists but targets are neither feature nor system)
  return { severity: 'parallel_safe', overlapping_features: [], overlapping_systems: [], reasons: ['overlap on non-feature/system targets'] }
```

#### Algorithm 2: detectRequirementConflicts(activeChanges)

```
function detectRequirementConflicts(activeChanges: IndexRecord[]): RequirementConflictPair[]:
  conflicts = []

  // Build a map: (feature_id, requirement_name) -> list of (change_id, op)
  reqMap: Map<string, Array<{ change_id, op, entry }>> = new Map()

  for change in activeChanges:
    for entry in change.delta_summary:
      if entry.target_type != 'requirement':
        continue

      key = `${entry.target_note_id}::${entry.target_name}`

      // For RENAMED, also register the old name
      if entry.op == 'RENAMED':
        old_key = `${entry.target_note_id}::${entry.target_name}`
        reqMap.getOrCreate(old_key).push({ change_id: change.id, op: 'RENAMED', entry })
        new_key = `${entry.target_note_id}::${entry.new_name}`
        reqMap.getOrCreate(new_key).push({ change_id: change.id, op: 'RENAMED_TO', entry })
      else:
        reqMap.getOrCreate(key).push({ change_id: change.id, op: entry.op, entry })

  // Check for conflicts: any key with 2+ entries from different changes
  for [key, entries] of reqMap:
    // Group by change_id
    changeGroups = groupBy(entries, e => e.change_id)
    changeIds = Object.keys(changeGroups)

    if changeIds.length < 2:
      continue

    // Check all pairs
    for i in 0..changeIds.length-1:
      for j in i+1..changeIds.length-1:
        opA = changeGroups[changeIds[i]][0].op
        opB = changeGroups[changeIds[j]][0].op

        if isConflictingPair(opA, opB):
          [feature_id, req_name] = key.split('::')
          conflicts.push({
            change_a: changeIds[i],
            change_b: changeIds[j],
            feature_id,
            requirement_name: req_name,
            this_op: opA,
            other_op: opB,
            reason: `both changes operate on ${key}: ${opA} vs ${opB}`
          })

  return conflicts

function isConflictingPair(opA, opB): boolean:
  conflictMatrix = {
    ('MODIFIED', 'MODIFIED'): true,
    ('MODIFIED', 'REMOVED'): true,
    ('REMOVED', 'MODIFIED'): true,
    ('RENAMED', 'MODIFIED'): true,
    ('MODIFIED', 'RENAMED'): true,
    ('ADDED', 'ADDED'): true,
    ('RENAMED', 'REMOVED'): true,
    ('REMOVED', 'RENAMED'): true,
    ('RENAMED_TO', 'ADDED'): true,
    ('ADDED', 'RENAMED_TO'): true,
  }
  return conflictMatrix.get((opA, opB)) ?? false
```

#### Algorithm 3: computeDeterministicOrder(activeChanges)

```
function computeDeterministicOrder(activeChanges: IndexRecord[]): { ordering: OrderedChange[], cycles: CycleError[] }:
  // Step 1: Build adjacency list
  graph: Map<string, string[]> = new Map()  // id -> depends_on IDs
  inDegree: Map<string, number> = new Map()
  activeIds = new Set(activeChanges.map(c => c.id))

  for change in activeChanges:
    graph.set(change.id, [])
    inDegree.set(change.id, 0)

  for change in activeChanges:
    for dep in change.depends_on:
      if activeIds.has(dep):
        // dep must come before change
        graph.get(dep).push(change.id)  // dep -> change (edge means "dep before change")
        inDegree.set(change.id, inDegree.get(change.id) + 1)
      else:
        // dep is outside active set: check if it exists and is applied
        // If dep does not exist or is not applied, mark as blocked
        // (this is tracked in blocked_by for the OrderedChange)

  // Step 2: Kahn's algorithm with priority queue for tiebreaking
  queue: PriorityQueue = new PriorityQueue(compareFn: (a, b) => {
    // Compare by (created_at, change_id) ascending
    if a.created_at != b.created_at:
      return a.created_at < b.created_at ? -1 : 1
    return a.id < b.id ? -1 : 1
  })

  for change in activeChanges:
    if inDegree.get(change.id) == 0:
      queue.push(change)

  ordering: OrderedChange[] = []
  depth = 0
  position = 0

  while queue is not empty:
    // Process all nodes at current depth.
    // drainAll() uses SNAPSHOT SEMANTICS: it removes and returns all items
    // currently in the queue at the time of the call. Items added to the queue
    // during successor processing (in the loop below) are NOT included in this
    // batch — they will be picked up in the next iteration of the outer while loop.
    // This ensures correct depth tracking: all nodes at topological depth N are
    // processed together before any depth N+1 nodes.
    currentBatch = queue.drainAll()  // snapshot: returns current contents, empties queue

    for change in currentBatch:
      blocked_by = []
      for dep in change.depends_on:
        if not activeIds.has(dep):
          // External dependency: check if it's resolved
          // (delegated to index lookup; if not found or not applied, it's blocking)
          blocked_by.push(dep)

      ordering.push({
        id: change.id,
        depth,
        position: position++,
        blocked_by,
        conflicts_with: []  // filled in later by cross-referencing requirement conflicts
      })

      // Process successors
      for successor in graph.get(change.id):
        inDegree.set(successor, inDegree.get(successor) - 1)
        if inDegree.get(successor) == 0:
          queue.push(activeChanges.find(c => c.id == successor))

    depth++

  // Step 3: Detect cycles (nodes not visited)
  cycles: CycleError[] = []
  visited = new Set(ordering.map(o => o.id))
  unvisited = activeChanges.filter(c => !visited.has(c.id))

  if unvisited.length > 0:
    // Find actual cycles using DFS with back-edge detection (Tarjan-style).
    // Algorithm: for each unvisited node, run DFS maintaining a recursion stack.
    // When a back-edge is found (successor is already in the recursion stack),
    // extract the cycle path from the stack. Each strongly connected component
    // of size > 1 is reported as a cycle.
    //
    // function findCycles(unvisited, graph):
    //   visited = Set(), recStack = Set(), cycles = []
    //   for node in unvisited:
    //     if node not in visited:
    //       dfs(node, [], visited, recStack, graph, cycles)
    //   return cycles
    //
    // function dfs(node, path, visited, recStack, graph, cycles):
    //   visited.add(node), recStack.add(node), path.push(node)
    //   for successor in graph.get(node):
    //     if successor in recStack:
    //       cycleStart = path.indexOf(successor)
    //       cycles.push(path.slice(cycleStart).concat(successor))
    //     else if successor not in visited:
    //       dfs(successor, path, visited, recStack, graph, cycles)
    //   path.pop(), recStack.delete(node)
    cyclePaths = findCycles(unvisited, graph)
    for cyclePath in cyclePaths:
      cycles.push({
        cycle: cyclePath,
        message: `Dependency cycle detected: ${cyclePath.join(' -> ')}`
      })

    // Still add unvisited to ordering as blocked
    for change in unvisited:
      ordering.push({
        id: change.id,
        depth: -1,  // indicates cycle
        position: position++,
        blocked_by: ['CYCLE'],
        conflicts_with: []
      })

  return { ordering, cycles }
```

**Note on tiebreaking**: OpenSpec uses lexicographic tiebreaking by change ID. open-wiki-spec uses `(created_at, change_id)` to prefer FIFO ordering. This is a deliberate design choice from overview.md section 10.5.1: changes created earlier are processed first, with the deterministic `change_id` string comparison only needed when `created_at` values are identical.

**Deferred v1 contract gap — User-assigned priority override**: Overview.md section 10.5.1 rule 4 states "사용자가 명시적으로 priority를 부여하면 그것이 최우선이다." This means a user-assigned `priority` field in Change frontmatter should override topological + FIFO ordering. In v1, this is NOT implemented: `computeDeterministicOrder()` uses only `depends_on` topology and `(created_at, change_id)` tiebreaking. The `priority` field is not yet part of `ChangeFrontmatter` or `IndexRecord`. This is explicitly deferred to v2, where `priority: number` (lower = higher priority) would be added to Change frontmatter and the priority queue comparator would check `priority` before `(created_at, change_id)`. The overview.md contract is not fully satisfied in v1 for this rule.

#### Algorithm 4: checkBaseFingerprints(change, index)

```
function checkBaseFingerprints(change: IndexRecord, index: Map<string, IndexRecord>): StaleBaseEntry[]:
  staleEntries: StaleBaseEntry[] = []

  for entry in change.delta_summary:
    if entry.op == 'ADDED':
      continue  // ADDED has no base to compare

    if entry.base_fingerprint is null:
      continue  // missing fingerprint; verify will report separately

    featureRecord = index.get(entry.target_note_id)
    if featureRecord is null:
      continue  // broken reference; reported by verify

    // Find the requirement in the feature's requirements array
    reqKey = `${entry.target_note_id}::${entry.target_name}`
    currentReq = featureRecord.requirements.find(r => r.key == reqKey)

    if currentReq is null:
      // Requirement doesn't exist in feature
      if entry.op == 'MODIFIED' or entry.op == 'RENAMED':
        // Expected to exist but missing: this is a correctness error, not just staleness
        staleEntries.push({
          change_id: change.id,
          delta_entry: entry,
          expected_hash: entry.base_fingerprint,
          actual_hash: 'MISSING',
          feature_id: entry.target_note_id,
          requirement_key: reqKey
        })
      continue

    if currentReq.content_hash != entry.base_fingerprint:
      staleEntries.push({
        change_id: change.id,
        delta_entry: entry,
        expected_hash: entry.base_fingerprint,
        actual_hash: currentReq.content_hash,
        feature_id: entry.target_note_id,
        requirement_key: reqKey
      })

  return staleEntries
```

#### Algorithm 5: detectOutOfOrderErrors(activeChanges, index)

Overview.md 10.5.1 requires: "depends_on target이 존재하지 않거나, 아직 완료되지 않은 선행 작업을 필요로 하는데 현재 Change가 in_progress 또는 applied로 앞서 나가 있으면 sequencing error로 보고해야 한다."

This detects the reverse of `blocked`: when a Change has jumped ahead of its dependency (e.g., Change X depends on Change Y, but X is already `in_progress` or `applied` while Y is still `proposed`).

```
interface OutOfOrderError {
  change_id: string;          // the change that jumped ahead
  change_status: string;      // current status of the change (in_progress | applied)
  dependency_id: string;      // the dependency that is behind
  dependency_status: string;  // current status of the dependency
  message: string;
}

function detectOutOfOrderErrors(allChanges: IndexRecord[], index: Map<string, IndexRecord>): OutOfOrderError[]:
  errors: OutOfOrderError[] = []

  // Status progression order: proposed(0) < planned(1) < in_progress(2) < applied(3)
  statusRank = { 'proposed': 0, 'planned': 1, 'in_progress': 2, 'applied': 3 }

  for change in allChanges:
    if change.type != 'change':
      continue

    changeRank = statusRank[change.status] ?? -1
    if changeRank < 2:
      continue  // only in_progress or applied can be "ahead"

    for depId in change.depends_on:
      dep = index.get(depId)
      if dep is null:
        // Missing dependency: already reported by blocked_by in ordering
        continue

      depRank = statusRank[dep.status] ?? -1
      if depRank < changeRank && depRank < 3:
        // Dependency is behind AND not yet applied -> out-of-order
        errors.push({
          change_id: change.id,
          change_status: change.status,
          dependency_id: depId,
          dependency_status: dep.status,
          message: `${change.id} (${change.status}) jumped ahead of dependency ${depId} (${dep.status})`
        })

  return errors
```

#### Algorithm 6: analyzeSequencing(index) - Main Entry Point

```
function analyzeSequencing(index: Map<string, IndexRecord>): SequencingResult:
  activeChanges = Array.from(index.values())
    .filter(r => r.type == 'change' && r.status in ['proposed', 'planned', 'in_progress'])

  // 1. Compute pairwise touches severity
  pairwise_severities: TouchesSeverityResult[] = []
  for i in 0..activeChanges.length-1:
    for j in i+1..activeChanges.length-1:
      result = computeTouchesSeverity(activeChanges[i], activeChanges[j], index)
      if result.severity != 'parallel_safe':
        pairwise_severities.push(result)

  // 2. Detect requirement-level conflicts
  requirement_conflicts = detectRequirementConflicts(activeChanges)

  // 3. Compute deterministic ordering
  { ordering, cycles } = computeDeterministicOrder(activeChanges)

  // 4. Check base fingerprints for all active changes
  stale_bases: StaleBaseEntry[] = []
  for change in activeChanges:
    stale_bases.push(...checkBaseFingerprints(change, index))

  // 4b. Detect out-of-order status errors (overview.md 10.5.1)
  // Check ALL changes (including applied) since applied changes can also be out-of-order
  allChanges = Array.from(index.values()).filter(r => r.type == 'change')
  out_of_order_errors = detectOutOfOrderErrors(allChanges, index)

  // 5. Annotate ordering with conflict info
  for entry in ordering:
    conflicting = requirement_conflicts
      .filter(c => c.change_a == entry.id || c.change_b == entry.id)
      .map(c => c.change_a == entry.id ? c.change_b : c.change_a)
    entry.conflicts_with = [...new Set(conflicting)]

  // 6. Compute overall status (worst severity)
  //
  // Precedence decision (plan-level, not specified by overview.md):
  //   conflict_critical > blocked > conflict_candidate > needs_review > parallel_safe
  //
  // Rationale: `conflict_critical` means two changes operate on the same
  // requirement in incompatible ways — resolution requires user choice
  // between the conflicting operations. `blocked` means a dependency is
  // not yet met — it is a hard ordering constraint but resolves automatically
  // once the dependency completes. Therefore `conflict_critical` is ranked
  // higher because it requires active human intervention, while `blocked`
  // resolves through natural workflow progression.
  //
  // Both `conflict_critical` and `blocked` prevent auto-apply, but
  // `conflict_critical` additionally requires the user to decide which
  // operation wins, making it the more urgent escalation.
  overallStatus = 'parallel_safe'
  if requirement_conflicts.length > 0:
    overallStatus = 'conflict_critical'
  else if pairwise_severities.some(s => s.severity == 'blocked'):
    overallStatus = 'blocked'
  else if pairwise_severities.some(s => s.severity == 'conflict_candidate'):
    overallStatus = 'conflict_candidate'
  else if pairwise_severities.some(s => s.severity == 'needs_review'):
    overallStatus = 'needs_review'

  // 7. Collect related changes (any that appear in overlap or conflict)
  relatedSet = new Set<string>()
  for s in pairwise_severities:
    relatedSet.add(s.change_a)
    relatedSet.add(s.change_b)
  for c in requirement_conflicts:
    relatedSet.add(c.change_a)
    relatedSet.add(c.change_b)

  // 8. Build reasons
  reasons: string[] = []
  if cycles.length > 0:
    reasons.push(`${cycles.length} dependency cycle(s) detected`)
  if stale_bases.length > 0:
    reasons.push(`${stale_bases.length} stale base fingerprint(s) found`)
  if out_of_order_errors.length > 0:
    reasons.push(`${out_of_order_errors.length} out-of-order sequencing error(s): change(s) jumped ahead of dependencies`)
  for s in pairwise_severities:
    reasons.push(...s.reasons)
  for c in requirement_conflicts:
    reasons.push(c.reason)

  return {
    status: overallStatus,
    pairwise_severities,
    requirement_conflicts,
    ordering,
    cycles,
    stale_bases,
    out_of_order_errors,
    reasons,
    related_changes: Array.from(relatedSet)
  }
```

### File Structure

```
src/
  sequencing/
    index.ts              # Re-exports public API
    types.ts              # All TypeScript interfaces defined above
    touches-severity.ts   # computeTouchesSeverity()
    requirement-conflict.ts  # detectRequirementConflicts(), isConflictingPair()
    deterministic-order.ts   # computeDeterministicOrder(), findCycles()
    stale-detection.ts    # checkBaseFingerprints()
    out-of-order.ts       # detectOutOfOrderErrors()
    analyze.ts            # analyzeSequencing() main entry point
    priority-queue.ts     # Simple priority queue for tiebreak ordering
```

### Public API / Interface

```typescript
// src/sequencing/index.ts

export {
  // Types
  type TouchesSeverity,
  type RequirementConflictLevel,
  type TouchesSeverityResult,
  type RequirementConflictPair,
  type OrderedChange,
  type CycleError,
  type StaleBaseEntry,
  type OutOfOrderError,
  type SequencingResult,
  type SequencingSummary,
} from './types.js';

/**
 * Main entry point: analyze all active changes for sequencing.
 * Returns severity, conflicts, ordering, stale bases, and reasons.
 */
export { analyzeSequencing } from './analyze.js';

/**
 * Compute touches severity between two specific changes.
 * Used by retrieval engine to assess a new proposal against existing changes.
 */
export { computeTouchesSeverity } from './touches-severity.js';

/**
 * Check base fingerprints for a single change.
 * Used by apply workflow to gate auto-apply.
 */
export { checkBaseFingerprints } from './stale-detection.js';

/**
 * Detect requirement-level conflicts across active changes.
 * Used by verify to report coherence issues.
 */
export { detectRequirementConflicts } from './requirement-conflict.js';

/**
 * Compute deterministic ordering of active changes.
 * Used by verify and by any UI that displays recommended order.
 */
export { computeDeterministicOrder } from './deterministic-order.js';

/**
 * Detect out-of-order sequencing errors.
 * Reports changes that have jumped ahead of their dependencies
 * (e.g., in_progress while dependency is still proposed).
 * Used by verify for coherence checks.
 */
export { detectOutOfOrderErrors } from './out-of-order.js';

/**
 * Produce a compact summary for embedding in retrieval output.
 */
export function summarizeForRetrieval(result: SequencingResult): SequencingSummary {
  return {
    status: result.status,
    related_changes: result.related_changes,
    reasons: result.reasons,
  };
}
```

### Dependencies on Other Modules

| Module | What is needed | How it is used |
|--------|---------------|----------------|
| **04-index-engine** | `IndexRecord`, `buildIndex()` | Provides the full index map that sequencing reads from |
| **03-vault-parser** | `DeltaSummaryEntry` parsing, `content_hash` computation | Parser must produce `delta_summary` and `requirements` with `content_hash` on IndexRecord |
| **05-retrieval-engine** | (downstream consumer) | Retrieval calls `analyzeSequencing()` or `computeTouchesSeverity()` to embed `sequencing` in output |
| **10-workflow-verify** | (downstream consumer) | Verify calls `analyzeSequencing()` for coherence checks and `checkBaseFingerprints()` for stale detection |
| **09-workflow-apply** | (downstream consumer) | Apply calls `checkBaseFingerprints()` to gate auto-apply |

### Integration with Retrieval Engine (Plan 05)

The retrieval subagent output contract (overview.md section 10.6) requires a `sequencing` field:

```json
{
  "query": "add passkey login",
  "classification": "existing_feature",
  "confidence": "high",
  "sequencing": {
    "status": "parallel_safe",
    "related_changes": ["change-improve-auth-copy"],
    "reasons": ["shared system but non-overlapping touches", "no blocking depends_on edge"]
  },
  "candidates": [...],
  "warnings": [...]
}
```

The retrieval engine should:
1. After scoring candidates, call `analyzeSequencing(index)` to get the full result.
2. Call `summarizeForRetrieval(result)` to produce the compact `SequencingSummary`.
3. If the query is about proposing a new change, also compute hypothetical severity between the proposed change's likely touches and existing active changes. This requires the retrieval engine to infer the proposed touches from the query's `system_terms` and `feature_terms`.
4. Include relevant `warnings` when conflicts or stale bases are detected:
   - `"active change touch-surface collision without explicit dependency"` when `conflict_candidate` exists
   - `"requirement-level conflict across active changes"` when `conflict_critical` exists
   - `"stale base fingerprint in active change"` when stale bases exist

### Integration with Verify (Plan 10)

Verify uses sequencing in three dimensions:

**Coherence dimension**:
- Call `analyzeSequencing(index)` at verify time.
- Report `conflict_candidate` pairwise severities as warnings.
- Report `conflict_critical` requirement conflicts as errors.
- Report cycles as errors.
- Report broken `depends_on` targets (target ID not in index or target not applied when expected) as errors.

**Vault integrity dimension**:
- Report stale `base_fingerprint` in active Change notes.
- Report requirement-level conflict across active Changes.

**Correctness dimension** (for `applied` Changes):
- Use `checkBaseFingerprints()` result: if any stale entries exist for an `applied` change, report as error (the apply should not have proceeded).

---

## 4. Test Strategy

### Unit Tests

**touches-severity.ts**:
- Two changes with no overlap -> `parallel_safe`
- Two changes touching the same System but different Features -> `needs_review`
- Two changes touching the same Feature -> `conflict_candidate`
- Change A depends_on Change B (not applied) -> `blocked`
- Change A depends_on Change B (applied) -> not blocked, proceed to touch analysis
- One change has no touches at all -> `parallel_safe`
- Touch target ID does not exist in index -> graceful handling (no crash)

**requirement-conflict.ts**:
- Two changes MODIFY same requirement in same Feature -> `conflict_critical`
- One MODIFY + one REMOVE on same requirement -> `conflict_critical`
- RENAME + MODIFY on same requirement (old name) -> `conflict_critical`
- Two changes ADD same requirement name in same Feature -> `conflict_critical`
- Two changes MODIFY different requirements in same Feature -> no conflict
- Two changes MODIFY same requirement name in different Features -> no conflict
- One change ADDED + another MODIFIED different requirement -> no conflict
- Only one change touches a requirement -> no conflict

**deterministic-order.ts**:
- Linear chain: A -> B -> C -> correct order
- Diamond: A -> B, A -> C, B -> D, C -> D -> A before B,C; B,C tiebroken by `(created_at, id)`; D last
- Cycle detection: A -> B -> A -> cycle error reported, both included in ordering as blocked
- No dependencies at all: sorted by `(created_at, id)`
- Single change: trivially ordered
- User priority: not implemented in v1 (manual override is a user-facing workflow concern, not engine logic)
- External dependency (depends_on target not in active set): if target exists and is `applied`, OK; if not, `blocked_by` populated

**stale-detection.ts**:
- MODIFIED entry with matching base_fingerprint -> no stale
- MODIFIED entry with non-matching base_fingerprint -> stale entry returned
- REMOVED entry with matching base_fingerprint -> no stale
- REMOVED entry with non-matching base_fingerprint -> stale entry returned
- ADDED entry -> always skipped (no base)
- RENAMED entry with matching base_fingerprint -> no stale
- Requirement missing from Feature for MODIFIED -> stale entry with `actual_hash: 'MISSING'`
- Feature not in index -> skipped (broken reference)
- Entry with null base_fingerprint -> skipped

**out-of-order.ts**:
- Change X (in_progress) depends on Change Y (proposed) -> out-of-order error reported
- Change X (applied) depends on Change Y (planned) -> out-of-order error reported
- Change X (in_progress) depends on Change Y (applied) -> no error (dependency satisfied)
- Change X (proposed) depends on Change Y (proposed) -> no error (neither has jumped ahead)
- Change X (in_progress) depends on Change Y (in_progress) -> no error (same rank, both progressing)
- Change X (applied) depends on non-existent Change Y -> no error here (reported as blocked_by in ordering)
- Change X (in_progress) depends on Change Y (in_progress) and Change Z (proposed) -> one error for Z, none for Y

**analyze.ts (integration)**:
- Empty active change set -> all fields empty, status `parallel_safe`
- Multiple overlapping changes -> correct aggregation of severities, conflicts, ordering
- Mixed scenario: some blocked, some in conflict, some safe -> worst severity propagated to `status`

### Edge Cases

- Change with `depends_on` referencing itself -> treated as cycle
- Two changes with circular `depends_on` -> cycle detected
- Change with `touches` containing IDs that are not Feature or System type -> handled gracefully
- Delta Summary with `RENAMED` where old name equals new name -> no conflict with itself
- Very large number of active changes (50+) -> algorithm must remain O(n^2) at worst for pairwise comparison, O(V+E) for topological sort

---

## 5. Implementation Order

### Prerequisites
- **Plan 03** (vault-parser): Must parse `depends_on`, `touches`, `delta_summary` (with `base_fingerprint`), `created_at`, and `requirements` (with `content_hash`) from markdown.
- **Plan 04** (index-engine): Must produce `IndexRecord` with all fields the sequencing engine reads.

### Build Order

1. **types.ts** - Define all interfaces and type aliases (including `OutOfOrderError`).
2. **priority-queue.ts** - Simple min-heap with custom comparator for `(created_at, change_id)` tiebreaking. `drainAll()` uses snapshot semantics.
3. **touches-severity.ts** - Implement `computeTouchesSeverity()` with unit tests.
4. **requirement-conflict.ts** - Implement `detectRequirementConflicts()` and `isConflictingPair()` with unit tests.
5. **deterministic-order.ts** - Implement `computeDeterministicOrder()` and `findCycles()` (DFS with back-edge detection) with unit tests.
6. **stale-detection.ts** - Implement `checkBaseFingerprints()` with unit tests.
7. **out-of-order.ts** - Implement `detectOutOfOrderErrors()` with unit tests. Detects when a Change has jumped ahead of its dependencies in status progression.
8. **analyze.ts** - Implement `analyzeSequencing()` and `summarizeForRetrieval()` as integration over the above.
9. **index.ts** - Wire up re-exports.

### After This Plan

- **Plan 05** (retrieval-engine) will import `analyzeSequencing` and `summarizeForRetrieval` to include in its output.
- **Plan 07** (workflow-propose) will use sequencing results during preflight to warn about conflicts before creating a new Change.
- **Plan 09** (workflow-apply) will call `checkBaseFingerprints()` to gate auto-apply.
- **Plan 10** (workflow-verify) will call `analyzeSequencing()` for coherence and vault integrity checks.
