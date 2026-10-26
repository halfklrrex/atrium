import type { Token } from './types';

const MAX_EXPRESSION_LENGTH = 10_000;
const MAX_TOKENS = 4_096;

export class LexerError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`Formula Lexer Error: ${message} at position ${position}`);
    this.name = 'LexerError';
  }
}

export function tokenize(input: string): Token[] {
  if (input.length > MAX_EXPRESSION_LENGTH) {
    throw new LexerError(
      `Expression exceeds maximum allowed length of ${MAX_EXPRESSION_LENGTH} characters`,
      0,
    );
  }

  const tokens: Token[] = [];
  let pos = 0;
  const len = input.length;

  while (pos < len) {
    if (tokens.length >= MAX_TOKENS) {
      throw new LexerError(`Expression exceeds maximum allowed token count of ${MAX_TOKENS}`, pos);
    }

    const ch = input[pos];
    if (ch === undefined) break;

    // Whitespace
    if (/\s/.test(ch)) {
      pos++;
      continue;
    }

    // Column Reference: {...}
    if (ch === '{') {
      const start = pos;
      pos++;
      let refText = '';
      while (pos < len && input[pos] !== '}') {
        refText += input[pos] ?? '';
        pos++;
      }
      if (pos >= len || input[pos] !== '}') {
        throw new LexerError('Unclosed column reference "{"', start);
      }
      pos++; // Consume '}'
      tokens.push({
        type: 'COLUMN_REF',
        value: refText.trim(),
        start,
        end: pos,
      });
      continue;
    }

    // Numbers: digits with optional decimal point
    if (/\d/.test(ch) || (ch === '.' && pos + 1 < len && /\d/.test(input[pos + 1] ?? ''))) {
      const start = pos;
      let numStr = '';
      let hasDot = false;

      while (pos < len) {
        const c = input[pos];
        if (c !== undefined && /\d/.test(c)) {
          numStr += c;
          pos++;
        } else if (c === '.' && !hasDot) {
          hasDot = true;
          numStr += c;
          pos++;
        } else {
          break;
        }
      }

      tokens.push({
        type: 'NUMBER',
        value: numStr,
        start,
        end: pos,
      });
      continue;
    }

    // Strings: single or double quotes
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = pos;
      pos++; // Skip opening quote
      let strVal = '';
      let closed = false;

      while (pos < len) {
        const c = input[pos];
        if (c === '\\' && pos + 1 < len) {
          // Escape sequence
          pos++;
          strVal += input[pos];
          pos++;
        } else if (c === quote) {
          pos++; // Skip closing quote
          closed = true;
          break;
        } else {
          strVal += c;
          pos++;
        }
      }

      if (!closed) {
        throw new LexerError('Unterminated string literal', start);
      }

      tokens.push({
        type: 'STRING',
        value: strVal,
        start,
        end: pos,
      });
      continue;
    }

    // Parentheses and Punctuation
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', start: pos, end: pos + 1 });
      pos++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', start: pos, end: pos + 1 });
      pos++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', start: pos, end: pos + 1 });
      pos++;
      continue;
    }

    // Two-character operators
    const next2 = input.slice(pos, pos + 2);
    if (['<=', '>=', '<>', '!=', '==', '&&', '||'].includes(next2)) {
      tokens.push({
        type: 'OPERATOR',
        value: next2 === '<>' ? '!=' : next2 === '==' ? '=' : next2,
        start: pos,
        end: pos + 2,
      });
      pos += 2;
      continue;
    }

    // Single-character operators
    if (['+', '-', '*', '/', '%', '^', '&', '=', '<', '>', '!'].includes(ch)) {
      tokens.push({ type: 'OPERATOR', value: ch, start: pos, end: pos + 1 });
      pos++;
      continue;
    }

    // Identifiers and Keywords (Letters, underscores, digits)
    if (/[a-zA-Z_]/.test(ch)) {
      const start = pos;
      let ident = '';
      while (pos < len && /[a-zA-Z0-9_]/.test(input[pos] ?? '')) {
        ident += input[pos] ?? '';
        pos++;
      }

      const upper = ident.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({
          type: 'BOOLEAN',
          value: upper,
          start,
          end: pos,
        });
      } else if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
        // Can act as operator or function
        tokens.push({
          type: 'IDENTIFIER',
          value: upper,
          start,
          end: pos,
        });
      } else {
        tokens.push({
          type: 'IDENTIFIER',
          value: upper,
          start,
          end: pos,
        });
      }
      continue;
    }

    throw new LexerError(`Unexpected character "${ch}"`, pos);
  }

  tokens.push({ type: 'EOF', value: '', start: pos, end: pos });
  return tokens;
}
