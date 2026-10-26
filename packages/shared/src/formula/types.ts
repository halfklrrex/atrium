export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'IDENTIFIER'
  | 'COLUMN_REF'
  | 'OPERATOR'
  | 'COMMA'
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export type ASTNodeType = 'literal' | 'column_ref' | 'unary_op' | 'binary_op' | 'function_call';

export interface BaseNode {
  type: ASTNodeType;
}

export interface LiteralNode extends BaseNode {
  type: 'literal';
  value: number | string | boolean | null;
  rawType: 'number' | 'string' | 'boolean' | 'null';
}

export interface ColumnRefNode extends BaseNode {
  type: 'column_ref';
  columnId: string;
}

export interface UnaryOpNode extends BaseNode {
  type: 'unary_op';
  op: string;
  expr: ASTNode;
}

export interface BinaryOpNode extends BaseNode {
  type: 'binary_op';
  op: string;
  left: ASTNode;
  right: ASTNode;
}

export interface FunctionCallNode extends BaseNode {
  type: 'function_call';
  name: string;
  args: ASTNode[];
}

export type ASTNode = LiteralNode | ColumnRefNode | UnaryOpNode | BinaryOpNode | FunctionCallNode;

export type CellValueType = 'number' | 'string' | 'boolean' | 'date' | 'unknown';

export const FORMULA_ERRORS = {
  ERROR: '#ERROR!',
  DIV_ZERO: '#DIV/0!',
  VALUE: '#VALUE!',
  REF: '#REF!',
  NAME: '#NAME?',
  CIRCULAR: '#CIRCULAR!',
  NUM: '#NUM!',
} as const;

export type FormulaError = (typeof FORMULA_ERRORS)[keyof typeof FORMULA_ERRORS];

export function isFormulaError(val: unknown): val is FormulaError {
  return typeof val === 'string' && Object.values(FORMULA_ERRORS).includes(val as FormulaError);
}
