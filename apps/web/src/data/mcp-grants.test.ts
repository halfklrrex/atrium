import { describe, expect, it } from 'vitest';
import { sortMcpGrants } from './mcp-grants';
import type { McpGrantDoc } from './model';

const grant = (id: string, ms: number) =>
  ({ id, createdAt: { toMillis: () => ms } }) as unknown as McpGrantDoc;

describe('sortMcpGrants', () => {
  it('puts the newest connection first without mutating the input', () => {
    const input = [grant('a', 1), grant('b', 3), grant('c', 2)];
    expect(sortMcpGrants(input).map((g) => g.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });
});
