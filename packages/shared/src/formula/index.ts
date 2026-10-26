import { parseFormula } from './parser';
import { type ASTNode, FORMULA_ERRORS } from './types';
import {
  type CellResolver,
  convertFormulaReferences,
  evaluateAST,
  extractColumnReferences,
} from './visitors';

export * from './functions';
export * from './lexer';
export * from './parser';
export * from './types';
export * from './visitors';

/**
 * Top-level convenience evaluation function.
 */
export function evaluate(
  expression: string | ASTNode,
  rowOrResolver: CellResolver = {},
  columnNameMap?: Record<string, string>,
): unknown {
  try {
    const ast = typeof expression === 'string' ? parseFormula(expression) : expression;
    return evaluateAST(ast, rowOrResolver, columnNameMap);
  } catch {
    return FORMULA_ERRORS.ERROR;
  }
}

/**
 * Extracts referenced column IDs from a string expression or parsed AST.
 */
export function getFormulaReferences(expression: string | ASTNode): string[] {
  try {
    const ast = typeof expression === 'string' ? parseFormula(expression) : expression;
    return extractColumnReferences(ast);
  } catch {
    return [];
  }
}

/**
 * Translates formula column references between IDs and Titles.
 */
export function translateFormula(expression: string, mapping: Record<string, string>): string {
  try {
    return convertFormulaReferences(expression, mapping);
  } catch {
    return expression;
  }
}
