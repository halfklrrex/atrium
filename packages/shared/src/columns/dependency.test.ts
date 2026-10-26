import { describe, expect, it } from 'vitest';
import {
  canAddDependency,
  columnRegistry,
  dependencyColumn,
  dependencySettingsSchema,
  dependencyValueSchema,
  detectCycle,
  getAllDependents,
  getAllPrerequisites,
  hasCycle,
  topologicalSort,
} from './index';

describe('Dependency Column', () => {
  describe('Value schema', () => {
    it('accepts valid item_ids arrays', () => {
      const parsed = dependencyValueSchema.safeParse({ item_ids: ['item-1', 'item-2', 'item-3'] });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.item_ids).toEqual(['item-1', 'item-2', 'item-3']);
      }
    });

    it('accepts an empty item_ids array', () => {
      const parsed = dependencyValueSchema.safeParse({ item_ids: [] });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.item_ids).toEqual([]);
      }
    });

    it('rejects duplicate item_ids', () => {
      const parsed = dependencyValueSchema.safeParse({ item_ids: ['item-1', 'item-1'] });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain('item_ids must be unique');
      }
    });

    it('rejects unknown properties (strict object)', () => {
      const parsed = dependencyValueSchema.safeParse({
        item_ids: ['item-1'],
        extraProp: 'forbidden',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects non-string items or empty strings', () => {
      expect(dependencyValueSchema.safeParse({ item_ids: [123] }).success).toBe(false);
      expect(dependencyValueSchema.safeParse({ item_ids: [''] }).success).toBe(false);
    });
  });

  describe('Settings schema', () => {
    it('provides default settings with strict: false', () => {
      const defaults = dependencyColumn.defaultSettings();
      expect(defaults).toEqual({ strict: false });
      expect(dependencySettingsSchema.safeParse(defaults).success).toBe(true);
    });

    it('validates settings with optional timeColumnId and strict mode', () => {
      const parsed = dependencySettingsSchema.safeParse({
        timeColumnId: 'timeline_1',
        strict: true,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual({ timeColumnId: 'timeline_1', strict: true });
      }
    });

    it('rejects unknown properties in settings (strict object)', () => {
      const parsed = dependencySettingsSchema.safeParse({
        strict: false,
        invalidField: true,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('Serialization and Comparison', () => {
    it('toText renders comma-separated item IDs', () => {
      expect(dependencyColumn.toText({ item_ids: ['task-A', 'task-B'] }, { strict: false })).toBe(
        'task-A, task-B',
      );
      expect(dependencyColumn.toText({ item_ids: [] }, { strict: false })).toBe('');
    });

    it('compare sorts primarily by dependency count, then lexicographically', () => {
      const empty = { item_ids: [] };
      const oneA = { item_ids: ['task-1'] };
      const oneB = { item_ids: ['task-2'] };
      const two = { item_ids: ['task-1', 'task-2'] };

      expect(dependencyColumn.compare(empty, oneA, { strict: false })).toBeLessThan(0);
      expect(dependencyColumn.compare(two, oneA, { strict: false })).toBeGreaterThan(0);
      expect(dependencyColumn.compare(oneA, oneB, { strict: false })).toBeLessThan(0);
      expect(dependencyColumn.compare(oneA, oneA, { strict: false })).toBe(0);
    });
  });

  describe('Registry integration', () => {
    it('is registered in columnRegistry', () => {
      expect(columnRegistry.has('dependency')).toBe(true);
      const col = columnRegistry.get('dependency');
      expect(col.type).toBe('dependency');
      expect(col.label).toBe('Dependency');
    });

    it('parses values and settings via registry', () => {
      const parseVal = columnRegistry.parseValue('dependency', { item_ids: ['id-1'] });
      expect(parseVal).toEqual({ success: true, data: { item_ids: ['id-1'] } });

      const parseEmpty = columnRegistry.parseValue('dependency', null);
      expect(parseEmpty).toEqual({ success: true, data: null });

      const parseSet = columnRegistry.parseSettings('dependency', { strict: true });
      expect(parseSet).toEqual({ success: true, data: { strict: true } });
    });

    it('aggregates footer summaries', () => {
      const settings = columnRegistry.defaultSettings('dependency');
      const cells = [{ item_ids: ['t1', 't2'] }, null, { item_ids: [] }, { item_ids: ['t3'] }];
      // dependency does not define a custom footer battery/sum, so aggregate returns null
      expect(columnRegistry.aggregate('dependency', cells, settings)).toBeNull();
    });
  });

  describe('DAG and Cycle Detection (dependency-graph)', () => {
    it('detects no cycle in an empty or acyclic graph', () => {
      expect(detectCycle({})).toBeNull();
      expect(hasCycle({})).toBe(false);

      const dag = {
        taskA: ['taskB'],
        taskB: ['taskC'],
        taskC: [],
      };
      expect(detectCycle(dag)).toBeNull();
      expect(hasCycle(dag)).toBe(false);
    });

    it('detects self-cycles', () => {
      const selfCycle = {
        taskA: ['taskA'],
      };
      const cycle = detectCycle(selfCycle);
      expect(cycle).toEqual(['taskA', 'taskA']);
      expect(hasCycle(selfCycle)).toBe(true);
    });

    it('detects direct 2-node cycles', () => {
      const directLoop = {
        taskA: ['taskB'],
        taskB: ['taskA'],
      };
      const cycle = detectCycle(directLoop);
      expect(cycle).not.toBeNull();
      expect(hasCycle(directLoop)).toBe(true);
    });

    it('detects indirect multi-node cycles', () => {
      const indirect = {
        taskA: ['taskB'],
        taskB: ['taskC'],
        taskC: ['taskD'],
        taskD: ['taskA'],
      };
      const cycle = detectCycle(indirect);
      expect(cycle).not.toBeNull();
      expect(hasCycle(indirect)).toBe(true);
      expect(cycle).toContain('taskA');
      expect(cycle).toContain('taskD');
    });

    it('canAddDependency prevents self-dependency and circular dependencies', () => {
      const graph = {
        taskA: ['taskB'],
        taskB: ['taskC'],
        taskC: [],
      };

      // Disallow self dependency
      const selfRes = canAddDependency(graph, 'taskA', 'taskA');
      expect(selfRes.allowed).toBe(false);
      expect(selfRes.reason).toContain('Self-dependency');

      // Allow adding a valid new prerequisite
      const validRes = canAddDependency(graph, 'taskC', 'taskD');
      expect(validRes.allowed).toBe(true);

      // Disallow circular dependency (taskC -> taskA would create taskA -> taskB -> taskC -> taskA)
      const cycleRes = canAddDependency(graph, 'taskC', 'taskA');
      expect(cycleRes.allowed).toBe(false);
      expect(cycleRes.reason).toContain('Circular dependency detected');
      expect(cycleRes.cycle).toBeDefined();

      // Idempotent: adding an already existing dependency is allowed
      expect(canAddDependency(graph, 'taskA', 'taskB').allowed).toBe(true);
    });

    it('topologicalSort orders tasks in prerequisite execution order', () => {
      // taskA depends on taskB, taskB depends on taskC
      // Prerequisite order: taskC -> taskB -> taskA
      const graph = {
        taskA: ['taskB'],
        taskB: ['taskC'],
        taskC: [],
      };
      const sorted = topologicalSort(graph);
      expect(sorted).not.toBeNull();
      expect(sorted!.indexOf('taskC')).toBeLessThan(sorted!.indexOf('taskB'));
      expect(sorted!.indexOf('taskB')).toBeLessThan(sorted!.indexOf('taskA'));
    });

    it('topologicalSort returns null when graph has a cycle', () => {
      const cyclic = {
        taskA: ['taskB'],
        taskB: ['taskA'],
      };
      expect(topologicalSort(cyclic)).toBeNull();
    });

    it('getAllPrerequisites and getAllDependents compute transitive closures', () => {
      // taskA depends on taskB, taskB depends on taskC and taskD
      const graph = {
        taskA: ['taskB'],
        taskB: ['taskC', 'taskD'],
        taskC: [],
        taskD: [],
      };

      const prereqsOfA = getAllPrerequisites(graph, 'taskA');
      expect(prereqsOfA).toEqual(new Set(['taskB', 'taskC', 'taskD']));

      const dependentsOfC = getAllDependents(graph, 'taskC');
      expect(dependentsOfC).toEqual(new Set(['taskB', 'taskA']));
    });
  });
});
