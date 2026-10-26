import { describe, expect, it } from 'vitest';
import {
  computeFormula,
  computeFormulaRaw,
  formatFormulaResult,
  formulaColumn,
} from '../columns/formula';
import type { ColumnDef } from '../schemas/board';
import {
  convertFormulaReferences,
  createCellResolver,
  evaluate,
  evaluateRow,
  extractColumnReferences,
  FORMULA_ERRORS,
  getFormulaReferences,
  inferReturnType,
  LexerError,
  parseFormula,
  ParserError,
  resolveCellValue,
  tokenize,
  translateFormula,
  validateFormulaSettings,
} from './index';

describe('Formula Engine', () => {
  describe('Lexer', () => {
    it('tokenizes numbers, strings, and operators', () => {
      const tokens = tokenize('12.5 + "hello" * TRUE');
      expect(tokens.map((t) => t.type)).toEqual([
        'NUMBER',
        'OPERATOR',
        'STRING',
        'OPERATOR',
        'BOOLEAN',
        'EOF',
      ]);
      expect(tokens[0]?.value).toBe('12.5');
      expect(tokens[2]?.value).toBe('hello');
      expect(tokens[4]?.value).toBe('TRUE');
    });

    it('tokenizes column references in curly braces', () => {
      const tokens = tokenize('{col_budget} * (1 + {tax_rate})');
      const refs = tokens.filter((t) => t.type === 'COLUMN_REF');
      expect(refs.map((r) => r.value)).toEqual(['col_budget', 'tax_rate']);
    });

    it('throws LexerError on unclosed column references', () => {
      expect(() => tokenize('{unclosed_column')).toThrow(LexerError);
    });

    it('rejects expressions exceeding maximum length', () => {
      const giant = '1 + '.repeat(3500);
      expect(() => tokenize(giant)).toThrow(LexerError);
    });

    it('rejects unterminated strings (Bug H)', () => {
      expect(() => tokenize('"unterminated string')).toThrow(LexerError);
      expect(() => tokenize("'unterminated single quote")).toThrow(LexerError);
    });
  });

  describe('Pratt Parser & AST', () => {
    it('respects standard operator precedence: multiplication over addition', () => {
      const ast = parseFormula('1 + 2 * 3');
      expect(ast.type).toBe('binary_op');
      if (ast.type === 'binary_op') {
        expect(ast.op).toBe('+');
        expect(ast.left).toEqual({ type: 'literal', value: 1, rawType: 'number' });
        expect(ast.right.type).toBe('binary_op');
        if (ast.right.type === 'binary_op') {
          expect(ast.right.op).toBe('*');
        }
      }
    });

    it('respects parentheses grouping', () => {
      const ast = parseFormula('(1 + 2) * 3');
      expect(ast.type).toBe('binary_op');
      if (ast.type === 'binary_op') {
        expect(ast.op).toBe('*');
        expect(ast.left.type).toBe('binary_op');
      }
    });

    it('parses right-associative exponentiation (^)', () => {
      // 2 ^ 3 ^ 2 == 2 ^ (3 ^ 2) == 512
      expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    });

    it('parses function calls with multiple arguments', () => {
      const ast = parseFormula('IF({status} = "Done", 100, 0)');
      expect(ast.type).toBe('function_call');
      if (ast.type === 'function_call') {
        expect(ast.name).toBe('IF');
        expect(ast.args.length).toBe(3);
      }
    });

    it('throws on expressions exceeding max depth', () => {
      let nested = '1';
      for (let i = 0; i < 70; i++) {
        nested = `(${nested} + 1)`;
      }
      expect(() => parseFormula(nested)).toThrow(ParserError);
    });
  });

  describe('AST Visitors & References', () => {
    it('extractColumnReferences finds all referenced columns', () => {
      const ast = parseFormula('SUM({col_qty} * {col_price}, {discount})');
      const refs = extractColumnReferences(ast);
      expect(refs).toEqual(['col_qty', 'col_price', 'discount']);
      expect(getFormulaReferences('SUM({col_qty} * {col_price}, {discount})')).toEqual([
        'col_qty',
        'col_price',
        'discount',
      ]);
    });

    it('preserves parentheses, quotes, and spacing with token-span rewriting (Bug C)', () => {
      const raw = '10 - (5 - 2)';
      const untouched = convertFormulaReferences(raw, { foo: 'bar' });
      expect(untouched).toBe('10 - (5 - 2)');

      const formulaWithParens = '{col_1} * (10 - {col_2}) + "Hello (World)"';
      const rewritten = convertFormulaReferences(formulaWithParens, {
        col_1: 'Quantity',
        col_2: 'Discount',
      });
      expect(rewritten).toBe('{Quantity} * (10 - {Discount}) + "Hello (World)"');

      const roundTripped = translateFormula(rewritten, {
        Quantity: 'col_1',
        Discount: 'col_2',
      });
      expect(roundTripped).toBe(formulaWithParens);
    });

    it('inferReturnType predicts static types accurately', () => {
      expect(inferReturnType(parseFormula('1 + 2'))).toBe('number');
      expect(inferReturnType(parseFormula('"Hello " & "World"'))).toBe('string');
      expect(inferReturnType(parseFormula('5 > 2'))).toBe('boolean');
      expect(inferReturnType(parseFormula('TODAY()'))).toBe('date');
      expect(inferReturnType(parseFormula('IF(TRUE, 10, 20)'))).toBe('number');
      expect(inferReturnType(parseFormula('ADD(10, 20)'))).toBe('number');
      expect(inferReturnType(parseFormula('WORKDAYS("2026-01-01", "2026-01-05")'))).toBe('number');
      expect(inferReturnType(parseFormula('FORMAT_DATE("2026-01-01")'))).toBe('string');
    });
  });

  describe('Lazy Evaluation (Bug B)', () => {
    it('evaluates IF lazily to prevent division by zero', () => {
      expect(evaluate('IF({q} = 0, 0, 10 / {q})', { q: 0 })).toBe(0);
      expect(evaluate('IF({q} = 0, 0, 10 / {q})', { q: 2 })).toBe(5);
    });

    it('evaluates SWITCH lazily', () => {
      expect(evaluate('SWITCH({mode}, "safe", 100, "boom", 10 / 0, 999)', { mode: 'safe' })).toBe(
        100,
      );
    });

    it('short-circuits AND and OR', () => {
      expect(evaluate('AND(FALSE, 10 / 0)')).toBe(false);
      expect(evaluate('OR(TRUE, 10 / 0)')).toBe(true);
    });
  });

  describe('Equality & Nits (Bug H)', () => {
    it('performs strict and case-insensitive string equality', () => {
      expect(evaluate('"Apple" = "apple"')).toBe(true);
      expect(evaluate('"Apple" = "APPLE"')).toBe(true);
      expect(evaluate('"Apple" = "Orange"')).toBe(false);
      expect(evaluate('"Apple" != "Orange"')).toBe(true);
      expect(evaluate('1 = 1')).toBe(true);
      expect(evaluate('1 = 2')).toBe(false);
      expect(evaluate('1 = "1"')).toBe(false);
    });

    it('SWITCH performs case-insensitive string matching', () => {
      expect(evaluate('SWITCH("done", "DONE", 1, 0)')).toBe(1);
    });

    it('prevents prototype pollution with {constructor}', () => {
      expect(evaluate('{constructor}', {})).toBeNull();
    });

    it('handles POWER overflow with #NUM!', () => {
      expect(evaluate('POWER(10, 500)')).toBe(FORMULA_ERRORS.NUM);
      expect(evaluate('10 ^ 500')).toBe(FORMULA_ERRORS.NUM);
    });
  });

  describe('Date Functions & Timezones (Bug F, Bug D)', () => {
    it('parses date-only strings as UTC', () => {
      expect(evaluate('YEAR("2026-10-24")')).toBe(2026);
      expect(evaluate('MONTH("2026-10-24")')).toBe(10);
      expect(evaluate('DAY("2026-10-24")')).toBe(24);
      expect(evaluate('DAYS("2026-05-10", "2026-05-01")')).toBe(9);
      expect(evaluate('HOURS_DIFF("2026-01-01 15:00:00", "2026-01-01 10:00:00")')).toBe(5);
    });

    it('evaluates WORKDAY with bounds and handles invalid dates gracefully', () => {
      // Friday 2026-01-02 + 1 workday -> Monday 2026-01-05
      expect(evaluate('WORKDAY("2026-01-02", 1)')).toBe('2026-01-05');
      expect(evaluate('WORKDAY("invalid", 1)')).toBe(FORMULA_ERRORS.VALUE);
      expect(evaluate('WORKDAY("2026-01-02", 500000)')).toBe(FORMULA_ERRORS.VALUE);
    });

    it('evaluates WORKDAYS between two dates', () => {
      expect(evaluate('WORKDAYS("2026-01-02", "2026-01-05")')).toBe(1);
      expect(evaluate('WORKDAYS("2026-01-01", "2026-01-08")')).toBe(5);
    });

    it('evaluates ADD_DAYS, SUBTRACT_DAYS, and FORMAT_DATE', () => {
      expect(evaluate('ADD_DAYS("2026-01-01", 5)')).toBe('2026-01-06');
      expect(evaluate('SUBTRACT_DAYS("2026-01-10", 3)')).toBe('2026-01-07');
      expect(evaluate('FORMAT_DATE("2026-10-24", "YYYY/MM/DD")')).toBe('2026/10/24');
    });
  });

  describe('Monday Built-in Functions (Lead review)', () => {
    it('evaluates monday arithmetic function aliases: ADD, MINUS, MULTIPLY, DIVIDE', () => {
      expect(evaluate('ADD(10, 5)')).toBe(15);
      expect(evaluate('MINUS(10, 4)')).toBe(6);
      expect(evaluate('MULTIPLY(3, 4)')).toBe(12);
      expect(evaluate('DIVIDE(20, 4)')).toBe(5);
      expect(evaluate('DIVIDE(10, 0)')).toBe(FORMULA_ERRORS.DIV_ZERO);
    });

    it('evaluates REPT and bounds string output length', () => {
      expect(evaluate('REPT("cat", 3)')).toBe('catcatcat');
      expect(evaluate('REPT("a", 200000)')).toBe(FORMULA_ERRORS.VALUE);
    });

    it('guards SUBSTITUTE on empty oldText', () => {
      expect(evaluate('SUBSTITUTE("hello", "", "world")')).toBe('hello');
      expect(evaluate('SUBSTITUTE("banana", "a", "o")')).toBe('bonono');
    });

    it('workdaysBetween computes closed-form workdays across large spans in O(1)', () => {
      const start = Date.now();
      const count = evaluate('WORKDAYS("2020-01-01", "2030-01-01")');
      const elapsed = Date.now() - start;
      expect(typeof count).toBe('number');
      expect(count).toBe(2609);
      expect(elapsed).toBeLessThan(100);
    });

    it('parseDate and DATE_ADD preserve time and respect offsets', () => {
      expect(evaluate('DATE_ADD("2026-10-25 10:00", 2, "hours")')).toBe('2026-10-25 12:00:00');
      expect(evaluate('DATE_ADD("2026-10-25", 3, "days")')).toBe('2026-10-28');
      expect(evaluate('HOURS_DIFF("2026-10-25T14:30:00+02:00", "2026-10-25T12:30:00Z")')).toBe(0);
    });
  });

  describe('Canonical Cell Values Resolution (Review Items)', () => {
    const mockColumns: ColumnDef[] = [
      {
        id: 'status_1',
        title: 'Status',
        type: 'status',
        position: '100',
        settings: {
          labels: [
            { id: '1', index: 1, label: 'Done', color: '#00c875', isDone: true },
            { id: '2', index: 2, label: 'Working on it', color: '#fdab3d' },
          ],
        },
      },
      {
        id: 'num_1',
        title: 'Budget',
        type: 'numbers',
        position: '200',
        settings: {},
      },
      {
        id: 'date_1',
        title: 'Due Date',
        type: 'date',
        position: '300',
        settings: { hideWeekdays: false },
      },
      {
        id: 'check_1',
        title: 'Verified',
        type: 'checkbox',
        position: '400',
        settings: {},
      },
      {
        id: 'people_1',
        title: 'Assignee',
        type: 'people',
        position: '500',
        settings: {},
      },
      {
        id: 'vote_1',
        title: 'Votes',
        type: 'vote',
        position: '600',
        settings: {},
      },
      {
        id: 'tags_1',
        title: 'Tags',
        type: 'tags',
        position: '700',
        settings: {
          tags: [
            { id: 1, name: 'Urgent', color: '#df2f4a' },
            { id: 2, name: 'Backend', color: '#579bfc' },
          ],
        },
      },
      {
        id: 'drop_1',
        title: 'Category',
        type: 'dropdown',
        position: '800',
        settings: {
          labels: [
            { id: 10, label: 'Feature' },
            { id: 20, label: 'Bug' },
          ],
        },
      },
      {
        id: 'color_1',
        title: 'Theme Color',
        type: 'color_picker',
        position: '900',
        settings: {},
      },
      {
        id: 'clog_1',
        title: 'Created',
        type: 'creation_log',
        position: '1000',
        settings: {},
      },
      {
        id: 'lup_1',
        title: 'Modified',
        type: 'last_updated',
        position: '1100',
        settings: {},
      },
    ];

    it('resolves canonical cell value shapes using registry-backed resolver', () => {
      const rowValues = {
        status_1: { index: 1 },
        num_1: '1500', // canonical numbers stored as string
        date_1: { date: '2026-10-24' },
        check_1: { checked: 'true' }, // canonical checkbox stored as string
        people_1: { personsAndTeams: [{ id: 'user_avery', kind: 'person' }] },
        vote_1: { votersIds: ['u1', 'u2', 'u3'] },
        tags_1: { tag_ids: [1, 2] },
        drop_1: { ids: [10, 20] },
        color_1: { color: { hex: '#579bfc' } },
        clog_1: { created_at: '2026-10-24T12:00:00.000Z', creator_id: 'u1' },
        lup_1: { updated_at: '2026-10-25T08:00:00.000Z', updater_id: 'u2' },
      };

      const resolver = createCellResolver(mockColumns, rowValues);

      expect(evaluate('{status_1}', resolver)).toBe('Done');
      expect(evaluate('{Budget} * 2', resolver)).toBe(3000);
      expect(evaluate('YEAR({Due Date})', resolver)).toBe(2026);
      expect(evaluate('IF({Verified} = TRUE, "Yes", "No")', resolver)).toBe('Yes');
      expect(evaluate('{people_1}', resolver)).toBe('user_avery');
      expect(evaluate('{Votes} + 1', resolver)).toBe(4);
      expect(evaluate('{Tags}', resolver)).toBe('Urgent, Backend');
      expect(evaluate('{Category}', resolver)).toBe('Feature, Bug');
      expect(evaluate('{Theme Color}', resolver)).toBe('#579bfc');
      expect(evaluate('{Created}', resolver)).toBe('2026-10-24T12:00:00.000Z');
      expect(evaluate('{Modified}', resolver)).toBe('2026-10-25T08:00:00.000Z');
    });

    it('resolves individual canonical shapes via resolveCellValue', () => {
      expect(resolveCellValue(mockColumns[0]!, { index: 2 })).toBe('Working on it');
      expect(resolveCellValue(mockColumns[1]!, '42.5')).toBe(42.5);
      expect(resolveCellValue(mockColumns[2]!, { date: '2026-10-24' })).toBe('2026-10-24');
      expect(resolveCellValue(mockColumns[3]!, { checked: 'true' })).toBe(true);
      expect(resolveCellValue(mockColumns[3]!, { checked: 'false' })).toBe(false);
      expect(
        resolveCellValue(mockColumns[4]!, {
          personsAndTeams: [{ id: 'user_1' }, { id: 'team_2' }],
        }),
      ).toBe('user_1, team_2');
      expect(resolveCellValue(mockColumns[5]!, { votersIds: ['u1', 'u2'] })).toBe(2);
      expect(resolveCellValue(mockColumns[6]!, { tag_ids: [1] })).toBe('Urgent');
      expect(resolveCellValue(mockColumns[7]!, { ids: [20] })).toBe('Bug');
      expect(resolveCellValue(mockColumns[8]!, { color: { hex: '#ff5733' } })).toBe('#ff5733');
      expect(resolveCellValue(mockColumns[9]!, { created_at: '2026-10-24T12:00:00.000Z' })).toBe(
        '2026-10-24T12:00:00.000Z',
      );
      expect(resolveCellValue(mockColumns[10]!, { updated_at: '2026-10-25T08:00:00.000Z' })).toBe(
        '2026-10-25T08:00:00.000Z',
      );
    });
  });

  describe('Circular References & Row Evaluation (Bug E)', () => {
    const columnsWithCycle: ColumnDef[] = [
      {
        id: 'f_a',
        title: 'Formula A',
        type: 'formula',
        position: '100',
        settings: { expression: '{Formula B} + 1' },
      },
      {
        id: 'f_b',
        title: 'Formula B',
        type: 'formula',
        position: '200',
        settings: { expression: '{Formula A} + 1' },
      },
      {
        id: 'f_c',
        title: 'Formula C',
        type: 'formula',
        position: '300',
        settings: { expression: '{Formula A} * 2' },
      },
      {
        id: 'f_indep',
        title: 'Independent Formula',
        type: 'formula',
        position: '400',
        settings: { expression: '10 + 20' },
      },
    ];

    it('validateFormulaSettings rejects self-reference and mutual circular references', () => {
      // Self-reference
      const selfCheck = validateFormulaSettings('{Formula A} + 10', columnsWithCycle, 'f_a');
      expect(selfCheck.valid).toBe(false);
      expect(selfCheck.error).toContain('Circular formula reference detected');

      // Mutual circular reference
      const cycleCheck = validateFormulaSettings('{f_b} + 10', columnsWithCycle, 'f_a');
      expect(cycleCheck.valid).toBe(false);
      expect(cycleCheck.error).toContain('Circular formula reference detected');

      // Unknown reference
      const unknownCheck = validateFormulaSettings('{NonExistent}', columnsWithCycle);
      expect(unknownCheck.valid).toBe(false);
      expect(unknownCheck.error).toContain('Unknown column reference');
    });

    it('validateFormulaSettings rejects unknown function names', () => {
      const unknownFuncCheck = validateFormulaSettings('FAKE_FUNCTION(1, 2)', columnsWithCycle);
      expect(unknownFuncCheck.valid).toBe(false);
      expect(unknownFuncCheck.error).toContain('Unknown function "FAKE_FUNCTION"');
    });

    it('evaluateRow emits #CIRCULAR! for circular formulas and evaluates independent formulas', () => {
      const evaluated = evaluateRow(columnsWithCycle, { values: {} });
      expect(evaluated['f_a']).toBe(FORMULA_ERRORS.CIRCULAR);
      expect(evaluated['f_b']).toBe(FORMULA_ERRORS.CIRCULAR);
      expect(evaluated['f_c']).toBe(FORMULA_ERRORS.CIRCULAR);
      expect(evaluated['f_indep']).toBe(30);
    });

    it('evaluateRow detects and marks multiple disjoint cycles as #CIRCULAR!', () => {
      const multipleCyclesColumns: ColumnDef[] = [
        {
          id: 'f_a',
          title: 'A',
          type: 'formula',
          position: '100',
          settings: { expression: '{B} + 1' },
        },
        {
          id: 'f_b',
          title: 'B',
          type: 'formula',
          position: '200',
          settings: { expression: '{A} + 1' },
        },
        {
          id: 'f_c',
          title: 'C',
          type: 'formula',
          position: '300',
          settings: { expression: '{D} * 2' },
        },
        {
          id: 'f_d',
          title: 'D',
          type: 'formula',
          position: '400',
          settings: { expression: '{C} * 2' },
        },
        {
          id: 'f_e',
          title: 'E',
          type: 'formula',
          position: '500',
          settings: { expression: '100' },
        },
      ];
      const res = evaluateRow(multipleCyclesColumns, { values: {} });
      expect(res['f_a']).toBe(FORMULA_ERRORS.CIRCULAR);
      expect(res['f_b']).toBe(FORMULA_ERRORS.CIRCULAR);
      expect(res['f_c']).toBe(FORMULA_ERRORS.CIRCULAR);
      expect(res['f_d']).toBe(FORMULA_ERRORS.CIRCULAR);
      expect(res['f_e']).toBe(100);
    });

    it('evaluateRow evaluates dependent non-circular formulas in topological order', () => {
      const linearColumns: ColumnDef[] = [
        {
          id: 'num',
          title: 'Base',
          type: 'numbers',
          position: '100',
          settings: {},
        },
        {
          id: 'f_1',
          title: 'Doubled',
          type: 'formula',
          position: '200',
          settings: { expression: '{Base} * 2' },
        },
        {
          id: 'f_2',
          title: 'Quadrupled',
          type: 'formula',
          position: '300',
          settings: { expression: '{Doubled} * 2' },
        },
      ];

      const item = { values: { num: 25 } };
      const evaluated = evaluateRow(linearColumns, item);
      expect(evaluated['f_1']).toBe(50);
      expect(evaluated['f_2']).toBe(100);
    });
  });

  describe('Typed Results and Formatter (Bug G)', () => {
    it('computeFormulaRaw returns typed raw value and formatFormulaResult formats it', () => {
      const item = { values: { col_a: 5, col_b: 10 } };
      const settings = {
        expression: '{col_a} * {col_b}',
        outputType: 'number' as const,
        decimalPlaces: 2,
        currencySymbol: '$',
      };

      const raw = computeFormulaRaw(item, settings);
      expect(raw).toBe(50);
      expect(typeof raw).toBe('number');

      const formatted = formatFormulaResult(raw, settings);
      expect(formatted).toBe('$50.00');

      const direct = computeFormula(item, settings);
      expect(direct).toBe('$50.00');
    });

    it('formulaColumn compare compares raw values correctly', () => {
      const defaults = formulaColumn.defaultSettings();
      expect(formulaColumn.compare(10, 2, defaults)).toBeGreaterThan(0);
      expect(formulaColumn.compare(5, 5, defaults)).toBe(0);
      expect(formulaColumn.compare(true, false, defaults)).toBeGreaterThan(0);
      expect(formulaColumn.compare('Apple', 'banana', defaults)).toBeLessThan(0);
    });

    it('formatFormulaResult respects outputType in settings', () => {
      expect(
        formatFormulaResult('123', { expression: '', outputType: 'number', decimalPlaces: 2 }),
      ).toBe('123.00');
      expect(formatFormulaResult(1, { expression: '', outputType: 'boolean' })).toBe('true');
      expect(formatFormulaResult(0, { expression: '', outputType: 'boolean' })).toBe('false');
      expect(formatFormulaResult('hello', { expression: '', outputType: 'text' })).toBe('hello');
    });
  });
});
