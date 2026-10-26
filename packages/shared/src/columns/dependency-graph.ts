export type DependencyGraph = Map<string, readonly string[]> | Record<string, readonly string[]>;

function normalizeGraph(graph: DependencyGraph): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (graph instanceof Map) {
    for (const [key, edges] of graph.entries()) {
      map.set(key, [...edges]);
    }
  } else {
    for (const [key, edges] of Object.entries(graph)) {
      map.set(key, [...edges]);
    }
  }
  return map;
}

/**
 * Detects whether the dependency graph contains any cycle.
 * Returns the cycle path (e.g. `['item-1', 'item-2', 'item-1']`) if found, or `null` if DAG.
 */
export function detectCycle(graph: DependencyGraph): string[] | null {
  const adj = normalizeGraph(graph);
  const state = new Map<string, 0 | 1 | 2>(); // 0: unvisited, 1: visiting, 2: visited
  const parent = new Map<string, string>();

  for (const node of adj.keys()) {
    state.set(node, 0);
  }

  // Also register targets that might not be source keys
  for (const targets of adj.values()) {
    for (const target of targets) {
      if (!state.has(target)) state.set(target, 0);
    }
  }

  let cycleFound: string[] | null = null;

  function dfs(u: string, stack: string[]): boolean {
    state.set(u, 1);
    stack.push(u);

    const neighbors = adj.get(u) ?? [];
    for (const v of neighbors) {
      const vState = state.get(v) ?? 0;
      if (vState === 1) {
        // Cycle detected!
        const cycleStartIndex = stack.indexOf(v);
        cycleFound = [...stack.slice(cycleStartIndex), v];
        return true;
      }
      if (vState === 0) {
        parent.set(v, u);
        if (dfs(v, stack)) return true;
      }
    }

    state.set(u, 2);
    stack.pop();
    return false;
  }

  for (const node of state.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      if (dfs(node, [])) {
        return cycleFound;
      }
    }
  }

  return null;
}

/**
 * Checks if the dependency graph contains any cycles.
 */
export function hasCycle(graph: DependencyGraph): boolean {
  return detectCycle(graph) !== null;
}

export interface CanAddDependencyResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly cycle?: readonly string[];
}

/**
 * Checks whether adding a dependency edge `fromId` -> `toId` (meaning `fromId` depends on `toId`)
 * is valid without creating self-loops or circular dependencies.
 */
export function canAddDependency(
  graph: DependencyGraph,
  fromId: string,
  toId: string,
): CanAddDependencyResult {
  if (fromId === toId) {
    return {
      allowed: false,
      reason: `Self-dependency: item "${fromId}" cannot depend on itself`,
    };
  }

  const adj = normalizeGraph(graph);
  const existing = adj.get(fromId) ?? [];
  if (existing.includes(toId)) {
    return { allowed: true };
  }

  // Fast reachability check: if `fromId` is already reachable from `toId`,
  // then adding `fromId -> toId` creates a cycle.
  const visited = new Set<string>();
  const path: string[] = [];

  function isReachable(curr: string, target: string): boolean {
    visited.add(curr);
    path.push(curr);
    if (curr === target) return true;

    for (const next of adj.get(curr) ?? []) {
      if (!visited.has(next)) {
        if (isReachable(next, target)) return true;
      }
    }

    path.pop();
    return false;
  }

  if (isReachable(toId, fromId)) {
    const fullCycle = [fromId, ...path];
    return {
      allowed: false,
      reason: `Circular dependency detected: ${fullCycle.join(' -> ')}`,
      cycle: fullCycle,
    };
  }

  return { allowed: true };
}

/**
 * Returns the items ordered in dependency order (prerequisites before dependents),
 * or `null` if the graph contains a circular dependency.
 */
export function topologicalSort(graph: DependencyGraph): string[] | null {
  const adj = normalizeGraph(graph);
  const inDegree = new Map<string, number>();

  // Collect all vertices
  const allNodes = new Set<string>(adj.keys());
  for (const targets of adj.values()) {
    for (const target of targets) {
      allNodes.add(target);
    }
  }

  for (const node of allNodes) {
    inDegree.set(node, 0);
  }

  // In this graph, an edge `u -> v` means `u` depends on `v` (v is prerequisite of u).
  // For topological execution order (prerequisites first):
  // Edge direction for execution is `v -> u` (v must happen before u).
  // So indegree of `u` increases for each prerequisite `v`.
  for (const [u, prerequisites] of adj.entries()) {
    inDegree.set(u, (inDegree.get(u) ?? 0) + prerequisites.length);
  }

  // Build reverse adjacency list: prereq -> list of dependents
  const dependentsMap = new Map<string, string[]>();
  for (const [u, prerequisites] of adj.entries()) {
    for (const p of prerequisites) {
      const list = dependentsMap.get(p) ?? [];
      list.push(u);
      dependentsMap.set(p, list);
    }
  }

  // Nodes with 0 prerequisites can run first
  const queue: string[] = [];
  for (const [node, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(node);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    for (const dep of dependentsMap.get(node) ?? []) {
      const newDeg = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) {
        queue.push(dep);
      }
    }
  }

  if (result.length !== allNodes.size) {
    // Cycle detected, not all nodes could be resolved
    return null;
  }

  return result;
}

/**
 * Returns all transitive prerequisites for a given item.
 */
export function getAllPrerequisites(graph: DependencyGraph, itemId: string): Set<string> {
  const adj = normalizeGraph(graph);
  const prereqs = new Set<string>();

  function dfs(curr: string): void {
    for (const p of adj.get(curr) ?? []) {
      if (!prereqs.has(p)) {
        prereqs.add(p);
        dfs(p);
      }
    }
  }

  dfs(itemId);
  return prereqs;
}

/**
 * Returns all transitive dependents that depend on a given item.
 */
export function getAllDependents(graph: DependencyGraph, itemId: string): Set<string> {
  const adj = normalizeGraph(graph);
  // Build reverse adjacency
  const dependentsMap = new Map<string, string[]>();
  for (const [u, prerequisites] of adj.entries()) {
    for (const p of prerequisites) {
      const list = dependentsMap.get(p) ?? [];
      list.push(u);
      dependentsMap.set(p, list);
    }
  }

  const dependents = new Set<string>();
  function dfs(curr: string): void {
    for (const d of dependentsMap.get(curr) ?? []) {
      if (!dependents.has(d)) {
        dependents.add(d);
        dfs(d);
      }
    }
  }

  dfs(itemId);
  return dependents;
}
