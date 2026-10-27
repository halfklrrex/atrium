import { isChecked, type CheckboxValue } from '../columns/checkbox';
import type { ColorValue } from '../columns/color';
import type { CreationLogValue } from '../columns/creation-log';
import type { DateValue } from '../columns/date';
import { detectCycle, topologicalSort } from '../columns/dependency-graph';
import type { DropdownSettings, DropdownValue } from '../columns/dropdown';
import type { LastUpdatedValue } from '../columns/last-updated';
import { numericOf, type NumbersValue } from '../columns/numbers';
import type { PeopleValue } from '../columns/people';
import { findStatusLabel, type StatusSettings, type StatusValue } from '../columns/status';
import type { TagsSettings, TagsValue } from '../columns/tags';
import type { VoteValue } from '../columns/vote';
import type { ColumnDef } from '../schemas/board';
import { areEqual, assertStringLength, FUNCTIONS, toBool, toNum } from './functions';
import { tokenize } from './lexer';
import { parseFormula } from './parser';
import {
  type ASTNode,
  type CellValueType,
  FORMULA_ERRORS,
  isFormulaError,
  type Token,
} from './types';

/**
 * Collects all referenced column identifiers from an AST.
 */
export function extractColumnReferences(ast: ASTNode): string[] {
  const refs = new Set<string>();

  function walk(node: ASTNode) {
    if (node.type === 'column_ref') {
      refs.add(node.columnId);
    } else if (node.type === 'unary_op') {
      walk(node.expr);
    } else if (node.type === 'binary_op') {
      walk(node.left);
      walk(node.right);
    } else if (node.type === 'function_call') {
      for (const arg of node.args) {
        walk(arg);
      }
    }
  }

  walk(ast);
  return [...refs];
}

/**
 * Rewrites column references in a formula expression using token spans,
 * leaving all other characters (including parentheses and string quotes) untouched.
 */
export function convertFormulaReferences(
  expression: string,
  mapping: Record<string, string>,
): string {
  let tokens: Token[];
  try {
    tokens = tokenize(expression);
  } catch {
    return expression;
  }

  const colTokens = tokens.filter((t) => t.type === 'COLUMN_REF');
  if (colTokens.length === 0) {
    return expression;
  }

  let result = '';
  let lastIndex = 0;

  for (const token of colTokens) {
    result += expression.slice(lastIndex, token.start);
    const key = token.value;
    const mapped = Object.hasOwn(mapping, key) ? mapping[key] : key;
    result += `{${mapped}}`;
    lastIndex = token.end;
  }

  result += expression.slice(lastIndex);
  return result;
}

/**
 * Infers the static return type of an expression.
 */
export function inferReturnType(
  ast: ASTNode,
  columnTypes: Record<string, CellValueType> = {},
): CellValueType {
  switch (ast.type) {
    case 'literal':
      if (ast.rawType === 'number') return 'number';
      if (ast.rawType === 'string') return 'string';
      if (ast.rawType === 'boolean') return 'boolean';
      return 'unknown';
    case 'column_ref':
      return columnTypes[ast.columnId] ?? 'unknown';
    case 'unary_op':
      if (ast.op === '!' || ast.op === 'NOT') return 'boolean';
      return 'number';
    case 'binary_op':
      if (['=', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(ast.op)) {
        return 'boolean';
      }
      if (ast.op === '&') return 'string';
      return 'number';
    case 'function_call': {
      const name = ast.name.toUpperCase();
      if (['IF', 'SWITCH'].includes(name)) {
        const branch = ast.args[1];
        if (branch) {
          return inferReturnType(branch, columnTypes);
        }
        return 'unknown';
      }
      if (['AND', 'OR', 'NOT', 'XOR', 'ISERROR'].includes(name)) {
        return 'boolean';
      }
      if (
        [
          'SUM',
          'AVERAGE',
          'ROUND',
          'ROUNDUP',
          'ROUNDDOWN',
          'INT',
          'ABS',
          'SQRT',
          'POWER',
          'MOD',
          'MAX',
          'MIN',
          'CEILING',
          'FLOOR',
          'ADD',
          'MINUS',
          'MULTIPLY',
          'DIVIDE',
          'LEN',
          'YEAR',
          'MONTH',
          'DAY',
          'HOUR',
          'MINUTE',
          'SECOND',
          'DAYS',
          'HOURS_DIFF',
          'WORKDAYS',
          'DATETIME_DIFF',
        ].includes(name)
      ) {
        return 'number';
      }
      if (['TODAY', 'NOW', 'WORKDAY', 'DATE_ADD', 'ADD_DAYS', 'SUBTRACT_DAYS'].includes(name)) {
        return 'date';
      }
      return 'string';
    }
  }
}

/**
 * Unpacks canonical Atrium/monday cell shapes when accessed without a ColumnDef.
 */
export function unpackGenericCellValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
    return val;
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // Date shape: { date: 'YYYY-MM-DD', time?: 'HH:MM:SS' }
    if (typeof obj.date === 'string') {
      return obj.time ? `${obj.date} ${obj.time}` : obj.date;
    }
    // Checkbox shape: { checked: boolean }
    if (typeof obj.checked === 'boolean') {
      return obj.checked;
    }
    // Numbers shape: { value: number }
    if (typeof obj.value === 'number') {
      return obj.value;
    }
    // Status shape: { index: number, label?: string }
    if (typeof obj.label === 'string') {
      return obj.label;
    }
    if (typeof obj.index === 'number') {
      return obj.index;
    }
    // People shape: { personsAndTeams: [...] }
    if (Array.isArray(obj.personsAndTeams)) {
      return (obj.personsAndTeams as Array<{ id: string }>).map((p) => p.id).join(', ');
    }
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.rating === 'number') return obj.rating;
    if (typeof obj.progress === 'number') return obj.progress;
    if (typeof obj.auto_number === 'number') return obj.auto_number;
    if (typeof obj.count === 'number') return obj.count;
    if (typeof obj.email === 'string') return obj.email;
    if (typeof obj.phone === 'string') return obj.phone;
    if (typeof obj.address === 'string') return obj.address;
    if (typeof obj.countryName === 'string') return obj.countryName;
    if (typeof obj.countryCode === 'string') return obj.countryCode;
    if (Array.isArray(obj.labels)) return obj.labels.join(', ');
    if (Array.isArray(obj.tagIds)) return obj.tagIds.join(', ');
    if (typeof obj.createdAt === 'string') return obj.createdAt;
    if (typeof obj.updatedAt === 'string') return obj.updatedAt;
  }
  return val;
}

/**
 * Resolves a cell value against its canonical ColumnDef schema.
 */
export function resolveCellValue(column: ColumnDef, rawValue: unknown): unknown {
  if (rawValue === null || rawValue === undefined) return null;

  switch (column.type) {
    case 'status': {
      const statusSettings = column.settings as StatusSettings | undefined;
      if (statusSettings && Array.isArray(statusSettings.labels)) {
        const label = findStatusLabel(rawValue as StatusValue, statusSettings);
        return label?.label ?? (rawValue as StatusValue)?.label ?? null;
      }
      if (typeof rawValue === 'object') {
        return (rawValue as StatusValue)?.label ?? (rawValue as StatusValue)?.index ?? null;
      }
      return rawValue;
    }
    case 'numbers': {
      if (typeof rawValue === 'number') return rawValue;
      if (typeof rawValue === 'string') {
        const n = Number(rawValue);
        return isNaN(n) ? null : n;
      }
      if (typeof rawValue === 'object' && rawValue !== null) {
        const val = (rawValue as { value?: unknown }).value;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const n = Number(val);
          return isNaN(n) ? null : n;
        }
      }
      try {
        const n = numericOf(rawValue as NumbersValue);
        return isNaN(n) ? null : n;
      } catch {
        return null;
      }
    }
    case 'date': {
      if (typeof rawValue === 'string') return rawValue;
      const dv = rawValue as DateValue;
      if (dv && typeof dv.date === 'string') {
        return dv.time ? `${dv.date} ${dv.time}` : dv.date;
      }
      return null;
    }
    case 'checkbox': {
      if (typeof rawValue === 'boolean') return rawValue;
      if (typeof rawValue === 'object' && rawValue !== null) {
        return isChecked(rawValue as CheckboxValue);
      }
      return false;
    }
    case 'people': {
      const pv = rawValue as PeopleValue;
      if (Array.isArray(pv?.personsAndTeams)) {
        return pv.personsAndTeams.map((p) => p.id).join(', ');
      }
      return '';
    }
    case 'rating': {
      if (typeof rawValue === 'number') return rawValue;
      return (rawValue as { rating?: number })?.rating ?? 0;
    }
    case 'progress': {
      if (typeof rawValue === 'number') return rawValue;
      return (rawValue as { progress?: number })?.progress ?? 0;
    }
    case 'auto_number': {
      if (typeof rawValue === 'number') return rawValue;
      return (rawValue as { auto_number?: number })?.auto_number ?? 0;
    }
    case 'item_id': {
      if (typeof rawValue === 'string') return rawValue;
      return (rawValue as { item_id?: string })?.item_id ?? '';
    }
    case 'dropdown': {
      const settings = column.settings as DropdownSettings | undefined;
      const labelMap = new Map((settings?.labels ?? []).map((l) => [l.id, l.label]));
      if (typeof rawValue === 'object' && rawValue !== null && 'ids' in rawValue) {
        const dv = rawValue as DropdownValue;
        return (dv.ids ?? [])
          .map((id) => labelMap.get(id))
          .filter(Boolean)
          .join(', ');
      }
      const dv = rawValue as { labels?: string[] };
      return Array.isArray(dv?.labels) ? dv.labels.join(', ') : '';
    }
    case 'tags': {
      const settings = column.settings as TagsSettings | undefined;
      const tagMap = new Map((settings?.tags ?? []).map((t) => [t.id, t.name]));
      if (typeof rawValue === 'object' && rawValue !== null && 'tag_ids' in rawValue) {
        const tv = rawValue as TagsValue;
        return (tv.tag_ids ?? []).map((id) => tagMap.get(id) ?? String(id)).join(', ');
      }
      const tv = rawValue as { tagIds?: string[] };
      return Array.isArray(tv?.tagIds) ? tv.tagIds.join(', ') : '';
    }
    case 'country': {
      const cv = rawValue as { countryName?: string; countryCode?: string };
      return cv?.countryName ?? cv?.countryCode ?? '';
    }
    case 'email': {
      const ev = rawValue as { email?: string };
      return ev?.email ?? '';
    }
    case 'phone': {
      const pv = rawValue as { phone?: string };
      return pv?.phone ?? '';
    }
    case 'location': {
      const lv = rawValue as { address?: string };
      return lv?.address ?? '';
    }
    case 'vote': {
      if (typeof rawValue === 'object' && rawValue !== null && 'votersIds' in rawValue) {
        const vv = rawValue as VoteValue;
        return Array.isArray(vv.votersIds) ? vv.votersIds.length : 0;
      }
      if (typeof rawValue === 'number') return rawValue;
      return (rawValue as { count?: number })?.count ?? 0;
    }
    case 'link': {
      const lv = rawValue as { text?: string; url?: string };
      return lv?.text || lv?.url || '';
    }
    case 'color_picker': {
      if (typeof rawValue === 'object' && rawValue !== null) {
        const cv = rawValue as ColorValue;
        if (cv.color && typeof cv.color.hex === 'string') {
          return cv.color.hex;
        }
      }
      return (rawValue as { color?: string })?.color ?? '';
    }
    case 'creation_log': {
      if (typeof rawValue === 'object' && rawValue !== null) {
        const cl = rawValue as CreationLogValue;
        if (cl.created_at) return cl.created_at;
      }
      return (rawValue as { createdAt?: string })?.createdAt ?? '';
    }
    case 'last_updated': {
      if (typeof rawValue === 'object' && rawValue !== null) {
        const lu = rawValue as LastUpdatedValue;
        if (lu.updated_at) return lu.updated_at;
      }
      return (rawValue as { updatedAt?: string })?.updatedAt ?? '';
    }
    case 'text':
    case 'long_text': {
      return typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
    }
    default:
      return unpackGenericCellValue(rawValue);
  }
}

/**
 * Creates a registry-backed cell resolver for a set of columns and row values.
 */
export function createCellResolver(
  columns: ColumnDef[],
  values: Record<string, unknown> = {},
): (ref: string) => unknown {
  const colById = new Map<string, ColumnDef>();
  const colByTitle = new Map<string, ColumnDef>();

  for (const col of columns) {
    colById.set(col.id, col);
    colByTitle.set(col.title.trim().toLowerCase(), col);
  }

  return (ref: string): unknown => {
    const trimmed = ref.trim();
    let col = colById.get(trimmed);
    if (!col) {
      col = colByTitle.get(trimmed.toLowerCase());
    }

    if (col) {
      const raw = Object.hasOwn(values, col.id)
        ? values[col.id]
        : Object.hasOwn(values, col.title)
          ? values[col.title]
          : undefined;
      return resolveCellValue(col, raw);
    }

    if (Object.hasOwn(values, trimmed)) {
      return unpackGenericCellValue(values[trimmed]);
    }

    return null;
  };
}

export type CellResolver = ((ref: string) => unknown) | Record<string, unknown>;

/**
 * Evaluates an AST node against row values or a resolver function.
 */
export function evaluateAST(
  node: ASTNode,
  resolver: CellResolver = {},
  columnNameMap?: Record<string, string>,
): unknown {
  const resolveRef: (ref: string) => unknown =
    typeof resolver === 'function'
      ? resolver
      : (ref: string) => {
          const trimmed = ref.trim();
          if (Object.hasOwn(resolver, trimmed)) {
            return unpackGenericCellValue(resolver[trimmed]);
          }
          if (columnNameMap && Object.hasOwn(columnNameMap, trimmed)) {
            const id = columnNameMap[trimmed];
            if (id !== undefined && Object.hasOwn(resolver, id)) {
              return unpackGenericCellValue(resolver[id]);
            }
          }
          return null;
        };

  switch (node.type) {
    case 'literal':
      return node.value;

    case 'column_ref': {
      const val = resolveRef(node.columnId);
      return val;
    }

    case 'unary_op': {
      const val = evaluateAST(node.expr, resolveRef, columnNameMap);
      if (isFormulaError(val)) {
        return val;
      }
      if (node.op === '-' || node.op === '+') {
        let num: number;
        try {
          num = toNum(val ?? 0);
        } catch {
          return FORMULA_ERRORS.VALUE;
        }
        return node.op === '-' ? -num : num;
      }
      if (node.op === '!' || node.op === 'NOT') {
        return !toBool(val);
      }
      return FORMULA_ERRORS.ERROR;
    }

    case 'binary_op': {
      const left = evaluateAST(node.left, resolveRef, columnNameMap);
      const right = evaluateAST(node.right, resolveRef, columnNameMap);

      // Error propagation
      if (isFormulaError(left)) return left;
      if (isFormulaError(right)) return right;

      // String concatenation
      if (node.op === '&') {
        try {
          return assertStringLength(`${left ?? ''}${right ?? ''}`);
        } catch {
          return FORMULA_ERRORS.VALUE;
        }
      }

      // Equality: strict types, case-insensitive strings (Excel-like)
      if (node.op === '=') {
        return areEqual(left, right);
      }
      if (node.op === '!=') {
        return !areEqual(left, right);
      }

      // Logical
      if (node.op === '&&') return Boolean(toBool(left) && toBool(right));
      if (node.op === '||') return Boolean(toBool(left) || toBool(right));

      // Comparisons
      if (['<', '<=', '>', '>='].includes(node.op)) {
        const numL = Number(left);
        const numR = Number(right);
        if (!isNaN(numL) && !isNaN(numR) && left !== '' && right !== '') {
          if (node.op === '<') return numL < numR;
          if (node.op === '<=') return numL <= numR;
          if (node.op === '>') return numL > numR;
          if (node.op === '>=') return numL >= numR;
        }
        const strL = String(left ?? '').toLowerCase();
        const strR = String(right ?? '').toLowerCase();
        if (node.op === '<') return strL < strR;
        if (node.op === '<=') return strL <= strR;
        if (node.op === '>') return strL > strR;
        if (node.op === '>=') return strL >= strR;
      }

      // Arithmetic
      let numL: number;
      let numR: number;
      try {
        numL = toNum(left ?? 0);
        numR = toNum(right ?? 0);
      } catch {
        return FORMULA_ERRORS.VALUE;
      }

      if (node.op === '+') return numL + numR;
      if (node.op === '-') return numL - numR;
      if (node.op === '*') return numL * numR;
      if (node.op === '/') {
        if (numR === 0) return FORMULA_ERRORS.DIV_ZERO;
        return numL / numR;
      }
      if (node.op === '%') {
        if (numR === 0) return FORMULA_ERRORS.DIV_ZERO;
        return numL % numR;
      }
      if (node.op === '^') {
        const res = Math.pow(numL, numR);
        if (!isFinite(res) || isNaN(res)) return FORMULA_ERRORS.NUM;
        return res;
      }

      return FORMULA_ERRORS.ERROR;
    }

    case 'function_call': {
      const fnName = node.name.toUpperCase();

      // Lazy evaluation for IF: evaluate condition, then only evaluate the active branch
      if (fnName === 'IF') {
        if (node.args.length < 2) return FORMULA_ERRORS.ERROR;
        const condVal = evaluateAST(node.args[0]!, resolveRef, columnNameMap);
        if (isFormulaError(condVal)) return condVal;
        if (toBool(condVal)) {
          return evaluateAST(node.args[1]!, resolveRef, columnNameMap);
        } else {
          return node.args[2] !== undefined
            ? evaluateAST(node.args[2]!, resolveRef, columnNameMap)
            : null;
        }
      }

      // Lazy evaluation for SWITCH: evaluate target, then evaluate cases lazily
      if (fnName === 'SWITCH') {
        if (node.args.length < 2) return FORMULA_ERRORS.ERROR;
        const targetVal = evaluateAST(node.args[0]!, resolveRef, columnNameMap);
        if (isFormulaError(targetVal)) return targetVal;

        const count = node.args.length;
        for (let i = 1; i < count; i += 2) {
          if (i + 1 < count) {
            const caseVal = evaluateAST(node.args[i]!, resolveRef, columnNameMap);
            if (isFormulaError(caseVal)) return caseVal;
            if (areEqual(caseVal, targetVal)) {
              return evaluateAST(node.args[i + 1]!, resolveRef, columnNameMap);
            }
          } else {
            // Trailing default branch
            return evaluateAST(node.args[i]!, resolveRef, columnNameMap);
          }
        }
        return null;
      }

      // Short-circuiting logical functions
      if (fnName === 'AND') {
        if (node.args.length === 0) return true;
        for (const arg of node.args) {
          const val = evaluateAST(arg, resolveRef, columnNameMap);
          if (isFormulaError(val)) return val;
          if (!toBool(val)) return false;
        }
        return true;
      }

      if (fnName === 'OR') {
        if (node.args.length === 0) return false;
        for (const arg of node.args) {
          const val = evaluateAST(arg, resolveRef, columnNameMap);
          if (isFormulaError(val)) return val;
          if (toBool(val)) return true;
        }
        return false;
      }

      const fn = FUNCTIONS[fnName];
      if (!fn) return FORMULA_ERRORS.NAME;

      // Evaluate arguments eagerly for standard functions
      const evaluatedArgs: unknown[] = [];
      for (const argNode of node.args) {
        const evaluated = evaluateAST(argNode, resolveRef, columnNameMap);
        if (fnName !== 'ISERROR' && isFormulaError(evaluated)) {
          return evaluated;
        }
        evaluatedArgs.push(evaluated);
      }

      try {
        return fn(...evaluatedArgs);
      } catch (err) {
        if (err instanceof Error && isFormulaError(err.message)) {
          return err.message;
        }
        return FORMULA_ERRORS.ERROR;
      }
    }
  }
}

/**
 * Validates formula expression syntax and detects circular references or unknown column references at save time.
 */
export function validateFormulaSettings(
  expression: string,
  columns: ColumnDef[],
  currentColumnId?: string,
): { valid: boolean; error?: string } {
  if (!expression.trim()) {
    return { valid: true };
  }

  let ast: ASTNode;
  try {
    ast = parseFormula(expression);
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid formula syntax' };
  }

  const refs = extractColumnReferences(ast);
  const colById = new Map<string, ColumnDef>();
  const colByTitle = new Map<string, ColumnDef>();

  for (const col of columns) {
    colById.set(col.id, col);
    colByTitle.set(col.title.trim().toLowerCase(), col);
  }

  // Validate that all referenced columns exist
  for (const ref of refs) {
    const trimmed = ref.trim();
    const exists = colById.has(trimmed) || colByTitle.has(trimmed.toLowerCase());
    if (!exists) {
      return { valid: false, error: `Unknown column reference "${ref}"` };
    }
  }

  // Validate that all called functions are known and supported
  let unknownFunction: string | undefined;
  function checkFunctions(node: ASTNode) {
    if (unknownFunction) return;
    if (node.type === 'function_call') {
      if (!Object.hasOwn(FUNCTIONS, node.name.toUpperCase())) {
        unknownFunction = node.name;
        return;
      }
      for (const arg of node.args) {
        checkFunctions(arg);
      }
    } else if (node.type === 'unary_op') {
      checkFunctions(node.expr);
    } else if (node.type === 'binary_op') {
      checkFunctions(node.left);
      checkFunctions(node.right);
    }
  }
  checkFunctions(ast);
  if (unknownFunction) {
    return { valid: false, error: `Unknown function "${unknownFunction}"` };
  }

  // Check self-dependency
  if (currentColumnId) {
    const currentCol = colById.get(currentColumnId);
    for (const ref of refs) {
      const trimmed = ref.trim();
      if (
        trimmed === currentColumnId ||
        (currentCol && trimmed.toLowerCase() === currentCol.title.trim().toLowerCase())
      ) {
        return {
          valid: false,
          error: 'Circular formula reference detected: column cannot depend on itself',
        };
      }
    }
  }

  // Build dependency graph of formula columns to detect cycles
  const formulaCols = columns.filter((c) => c.type === 'formula');
  const graph = new Map<string, string[]>();

  for (const fCol of formulaCols) {
    if (fCol.id === currentColumnId) continue;
    const fExpr = (fCol.settings as { expression?: string })?.expression ?? '';
    let fRefs: string[] = [];
    try {
      fRefs = extractColumnReferences(parseFormula(fExpr));
    } catch {
      // Ignore syntax errors in other formulas
    }
    const targetIds: string[] = [];
    for (const r of fRefs) {
      const trimmed = r.trim();
      const target = colById.get(trimmed) ?? colByTitle.get(trimmed.toLowerCase());
      if (target && target.type === 'formula') {
        targetIds.push(target.id);
      }
    }
    graph.set(fCol.id, targetIds);
  }

  if (currentColumnId) {
    const targetIds: string[] = [];
    for (const r of refs) {
      const trimmed = r.trim();
      const target = colById.get(trimmed) ?? colByTitle.get(trimmed.toLowerCase());
      if (target && target.type === 'formula') {
        targetIds.push(target.id);
      }
    }
    graph.set(currentColumnId, targetIds);
  }

  const cycle = detectCycle(graph);
  if (cycle) {
    return {
      valid: false,
      error: `Circular formula reference detected: ${cycle.join(' -> ')}`,
    };
  }

  return { valid: true };
}

/**
 * Evaluates all formula columns for an item in dependency order, emitting `#CIRCULAR!`
 * for circular references.
 */
export function evaluateRow(
  columns: ColumnDef[],
  item: { id?: string; values?: Record<string, unknown>; seq?: number; boardSeq?: number },
): Record<string, unknown> {
  const formulaCols = columns.filter((c) => c.type === 'formula');
  const results: Record<string, unknown> = {};
  if (formulaCols.length === 0) return results;

  const colById = new Map(columns.map((c) => [c.id, c]));
  const colByTitle = new Map(columns.map((c) => [c.title.trim().toLowerCase(), c]));

  // Build formula dependency graph
  const graph = new Map<string, string[]>();
  const formulaExpressions = new Map<string, string>();

  for (const fCol of formulaCols) {
    const expr = (fCol.settings as { expression?: string })?.expression ?? '';
    formulaExpressions.set(fCol.id, expr);
    let refs: string[] = [];
    try {
      refs = extractColumnReferences(parseFormula(expr));
    } catch {
      // Syntax error will evaluate to error
    }
    const targetFormulaIds: string[] = [];
    for (const r of refs) {
      const trimmed = r.trim();
      const target = colById.get(trimmed) ?? colByTitle.get(trimmed.toLowerCase());
      if (target && target.type === 'formula') {
        targetFormulaIds.push(target.id);
      }
    }
    graph.set(fCol.id, targetFormulaIds);
  }

  // Detect all cycles iteratively
  const circularNodes = new Set<string>();
  let currentCycle = detectCycle(graph);
  while (currentCycle) {
    for (const node of currentCycle) {
      circularNodes.add(node);
    }
    // Propagate circularity to all nodes that reach any circular node
    let changed = true;
    while (changed) {
      changed = false;
      for (const [node, targets] of graph.entries()) {
        if (!circularNodes.has(node)) {
          if (targets.some((t) => circularNodes.has(t))) {
            circularNodes.add(node);
            changed = true;
          }
        }
      }
    }
    // Subgraph of remaining nodes
    const remainingGraph = new Map<string, string[]>();
    for (const [node, targets] of graph.entries()) {
      if (!circularNodes.has(node)) {
        remainingGraph.set(
          node,
          targets.filter((t) => !circularNodes.has(t)),
        );
      }
    }
    currentCycle = detectCycle(remainingGraph);
  }

  // Subgraph of non-circular formula columns
  const nonCircularGraph = new Map<string, string[]>();
  for (const [node, targets] of graph.entries()) {
    if (!circularNodes.has(node)) {
      nonCircularGraph.set(
        node,
        targets.filter((t) => !circularNodes.has(t)),
      );
    }
  }

  const sortedOrder = topologicalSort(nonCircularGraph);
  if (!sortedOrder) {
    for (const node of nonCircularGraph.keys()) {
      circularNodes.add(node);
    }
  }
  const evalOrder = sortedOrder ?? [];

  // Memoized values for row evaluation
  const memoizedValues: Record<string, unknown> = { ...(item.values ?? {}) };
  // Item ID and Auto number are derived from the server-assigned numbers, not stored in `values`.
  for (const col of columns) {
    if (col.type === 'item_id' && typeof item.seq === 'number') {
      memoizedValues[col.id] = String(item.seq);
    } else if (col.type === 'auto_number' && typeof item.boardSeq === 'number') {
      memoizedValues[col.id] = { auto_number: item.boardSeq };
    }
  }

  for (const fColId of evalOrder) {
    const expr = formulaExpressions.get(fColId) ?? '';
    if (!expr.trim()) {
      results[fColId] = null;
      memoizedValues[fColId] = null;
      continue;
    }
    const resolver = createCellResolver(columns, memoizedValues);
    let val: unknown;
    try {
      const ast = parseFormula(expr);
      val = evaluateAST(ast, resolver);
    } catch {
      val = FORMULA_ERRORS.ERROR;
    }
    results[fColId] = val;
    memoizedValues[fColId] = val;
  }

  // Any formula column that was circular gets #CIRCULAR!
  for (const fColId of circularNodes) {
    results[fColId] = FORMULA_ERRORS.CIRCULAR;
  }

  return results;
}
