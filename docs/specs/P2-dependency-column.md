# P2: Dependency Column

Author: Antigravity · Implementer: Antigravity · Status: Ready / Built  
Roadmap epic: P2 "Dependency column" (ID: 3306293488)

## 1. Overview & monday.com Compatibility

The Dependency column models item-to-item relationships on the same board (such as task prerequisites and blockers). It is fully compatible with monday.com's `dependency` column API:

- **GraphQL Type:** `dependency`
- **Value Schema:** `{ item_ids: string[] }` (unique array of item IDs; empty array `[]` represents a cleared cell).
- **Settings Schema:**
  - `timeColumnId?: string`: Optional linked date or timeline column whose dates shift when dependencies move.
  - `strict: boolean`: Whether strict mode is enabled (default `false`). In strict mode, dependent items cannot start before their prerequisite items finish.
- **Plain-text Representation:** Comma-separated item IDs (e.g., `"item-1, item-2"`), or empty string if empty.
- **Comparator:** Sorts primarily by count of dependencies, then lexicographically by item IDs.
- **Supported Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

---

## 2. Directed Acyclic Graph (DAG) & Cycle Detection

Dependencies form a directed graph where an edge `u -> v` indicates that item `u` depends on item `v` (`v` is a prerequisite of `u`). Circular dependencies are strictly invalid.

Atrium provides pure graph utilities in `packages/shared/src/columns/dependency-graph.ts`:

### 2.1 Cycle Detection (`detectCycle`, `hasCycle`)

- Uses depth-first search with three-color vertex marking (`0: unvisited`, `1: visiting/active in recursion stack`, `2: visited`).
- If an active vertex is revisited, a cycle is detected and the exact cycle path (e.g. `['taskA', 'taskB', 'taskC', 'taskA']`) is returned.

### 2.2 Pre-validation (`canAddDependency`)

- Validates candidate dependencies before writes occur:
  1. **Self-dependency rejection:** An item cannot depend on itself (`fromId === toId`).
  2. **Circular dependency prevention:** Rejects edges if `fromId` is already reachable from `toId`, returning the projected cycle path.
  3. **Idempotency:** Re-adding an existing edge is a safe no-op.

### 2.3 Topological Sorting (`topologicalSort`)

- Computes execution/scheduling order where all prerequisite items precede dependent items using Kahn's algorithm over reverse adjacency.
- Returns `null` if any cycle is present.

### 2.4 Transitive Closures (`getAllPrerequisites`, `getAllDependents`)

- `getAllPrerequisites(graph, itemId)`: Resolves all direct and indirect prerequisites of an item.
- `getAllDependents(graph, itemId)`: Resolves all downstream items that depend on an item.

---

## 3. Test Coverage

Comprehensive unit tests are located in `packages/shared/src/columns/dependency.test.ts` (21 tests), covering:

- Value schema validation and rejection of duplicates, unknown fields, and invalid types.
- Settings schema validation and defaults.
- Registry integration (`columnRegistry.get('dependency')`, `parseValue`, `parseSettings`, `toText`, `aggregate`).
- Self-cycles, direct 2-node cycles, and multi-node cycles.
- Pre-validation rejection via `canAddDependency`.
- Topological sorting and transitive prerequisite/dependent closures.
