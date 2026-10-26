import { tokenize } from './lexer';
import type { ASTNode, FunctionCallNode, Token } from './types';

const MAX_AST_DEPTH = 64;

export class ParserError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(
      `Formula Parser Error: ${message}${position !== undefined ? ` at position ${position}` : ''}`,
    );
    this.name = 'ParserError';
  }
}

enum Precedence {
  LOWEST = 0,
  OR = 1,
  AND = 2,
  EQUALITY = 3,
  COMPARISON = 4,
  CONCAT = 5,
  SUM = 6,
  PRODUCT = 7,
  POWER = 8,
  PREFIX = 9,
}

const PRECEDENCE_MAP: Record<string, Precedence> = {
  '||': Precedence.OR,
  '&&': Precedence.AND,
  '=': Precedence.EQUALITY,
  '!=': Precedence.EQUALITY,
  '<': Precedence.COMPARISON,
  '<=': Precedence.COMPARISON,
  '>': Precedence.COMPARISON,
  '>=': Precedence.COMPARISON,
  '&': Precedence.CONCAT,
  '+': Precedence.SUM,
  '-': Precedence.SUM,
  '*': Precedence.PRODUCT,
  '/': Precedence.PRODUCT,
  '%': Precedence.PRODUCT,
  '^': Precedence.POWER,
};

export class Parser {
  private tokens: Token[];
  private current = 0;
  private depth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.current] ?? { type: 'EOF', value: '', start: 0, end: 0 };
  }

  private advance(): Token {
    const token = this.peek();
    this.current++;
    return token;
  }

  private check(type: string, value?: string): boolean {
    const token = this.peek();
    if (token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    return true;
  }

  private expect(type: string, value?: string): Token {
    const token = this.peek();
    if (!this.check(type, value)) {
      throw new ParserError(
        `Expected ${type}${value ? ` "${value}"` : ''}, got ${token.type} "${token.value}"`,
        token.start,
      );
    }
    return this.advance();
  }

  private getPrecedence(token: Token): Precedence {
    if (token.type === 'OPERATOR' && PRECEDENCE_MAP[token.value] !== undefined) {
      return PRECEDENCE_MAP[token.value]!;
    }
    return Precedence.LOWEST;
  }

  public parse(): ASTNode {
    if (this.peek().type === 'EOF') {
      return { type: 'literal', value: '', rawType: 'string' };
    }
    const node = this.parseExpression(Precedence.LOWEST);
    if (this.peek().type !== 'EOF') {
      const extra = this.peek();
      throw new ParserError(`Unexpected token "${extra.value}" after expression`, extra.start);
    }
    return node;
  }

  private parseExpression(precedence: Precedence): ASTNode {
    this.depth++;
    if (this.depth > MAX_AST_DEPTH) {
      throw new ParserError(`Expression exceeds maximum nesting depth of ${MAX_AST_DEPTH}`);
    }

    try {
      let left = this.parsePrefix();

      while (precedence < this.getPrecedence(this.peek())) {
        const opToken = this.advance();
        const opPrecedence = this.getPrecedence(opToken);
        // Exponentiation (^) is right-associative
        const rightPrecedence = opToken.value === '^' ? opPrecedence - 1 : opPrecedence;
        const right = this.parseExpression(rightPrecedence);

        left = {
          type: 'binary_op',
          op: opToken.value,
          left,
          right,
        };
      }

      return left;
    } finally {
      this.depth--;
    }
  }

  private parsePrefix(): ASTNode {
    const token = this.peek();

    // Numbers
    if (token.type === 'NUMBER') {
      this.advance();
      return {
        type: 'literal',
        value: Number(token.value),
        rawType: 'number',
      };
    }

    // Strings
    if (token.type === 'STRING') {
      this.advance();
      return {
        type: 'literal',
        value: token.value,
        rawType: 'string',
      };
    }

    // Booleans
    if (token.type === 'BOOLEAN') {
      this.advance();
      return {
        type: 'literal',
        value: token.value === 'TRUE',
        rawType: 'boolean',
      };
    }

    // Column Reference {...}
    if (token.type === 'COLUMN_REF') {
      this.advance();
      return {
        type: 'column_ref',
        columnId: token.value,
      };
    }

    // Unary Operators (+, -, NOT, !)
    if (
      (token.type === 'OPERATOR' &&
        (token.value === '+' || token.value === '-' || token.value === '!')) ||
      (token.type === 'IDENTIFIER' && token.value === 'NOT')
    ) {
      const opToken = this.advance();
      const expr = this.parseExpression(Precedence.PREFIX);
      return {
        type: 'unary_op',
        op: opToken.value,
        expr,
      };
    }

    // Parentheses (Grouping)
    if (token.type === 'LPAREN') {
      this.advance();
      const expr = this.parseExpression(Precedence.LOWEST);
      this.expect('RPAREN');
      return expr;
    }

    // Function Calls or Standalone Identifiers
    if (token.type === 'IDENTIFIER') {
      const identToken = this.advance();
      const fnName = identToken.value;

      if (this.check('LPAREN')) {
        // Function call: NAME(arg1, arg2)
        this.advance(); // Consume '('
        const args: ASTNode[] = [];

        if (!this.check('RPAREN')) {
          args.push(this.parseExpression(Precedence.LOWEST));
          while (this.check('COMMA')) {
            this.advance(); // Consume ','
            args.push(this.parseExpression(Precedence.LOWEST));
          }
        }

        this.expect('RPAREN');
        return {
          type: 'function_call',
          name: fnName,
          args,
        } as FunctionCallNode;
      }

      // Standalone identifier (e.g. NULL, BLANK)
      if (fnName === 'NULL' || fnName === 'BLANK') {
        return { type: 'literal', value: null, rawType: 'null' };
      }

      // Treat identifier without parens as a function call with 0 args or column reference
      return {
        type: 'function_call',
        name: fnName,
        args: [],
      };
    }

    throw new ParserError(`Unexpected token "${token.value}"`, token.start);
  }
}

export function parseFormula(expression: string): ASTNode {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}
