import { McpUserError } from '@atrium/mcp-core';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { MinuteLimiter } from '../mcp/limits';
import { ApiError, toApiError } from './errors';
import { secondsUntilNextUtcDay } from './limits';

describe('toApiError', () => {
  it.each([
    ['Board "b" was not found in your workspaces.', 404, 'not_found'],
    ['Board "b" is archived, not active.', 404, 'not_found'],
    ['You can only view this board.', 403, 'forbidden'],
    ['Group must be a plain id.', 400, 'invalid'],
  ])('maps the service message %p', (message, status, code) => {
    expect(toApiError(new McpUserError(message))).toMatchObject({ status, code });
  });

  it.each([
    ['not_found', 404],
    ['forbidden', 403],
    ['invalid', 400],
    ['conflict', 409],
    ['read_only', 403],
  ] as const)('uses the code %s before the wording', (code, status) => {
    // The message would read as a 404 by wording; the code wins.
    expect(toApiError(new McpUserError('Board "b" was not found.', code))).toMatchObject({
      status,
      code,
    });
  });

  it('maps zod issues, body parser errors and unknown errors', () => {
    const zod = z.object({ a: z.number() }).safeParse({ a: 'x' }).error!;
    expect(toApiError(zod)).toMatchObject({ status: 400, code: 'invalid' });
    expect(toApiError(Object.assign(new Error('x'), { type: 'entity.too.large' }))).toMatchObject({
      status: 413,
    });
    expect(toApiError(new Error('boom with a secret'))).toMatchObject({
      status: 500,
      code: 'internal',
      message: 'Unexpected error',
    });
    const own = new ApiError(409, 'conflict', 'changed');
    expect(toApiError(own)).toBe(own);
  });
});

describe('limits', () => {
  it('the per-IP window is an hour and over() records nothing', () => {
    let now = 0;
    const limiter = new MinuteLimiter(2, () => now, 3_600_000);
    expect(limiter.over('ip')).toBe(false);
    expect(limiter.take('ip')).toBe(true);
    expect(limiter.take('ip')).toBe(true);
    expect(limiter.over('ip')).toBe(true);
    now = 3_599_000;
    expect(limiter.over('ip')).toBe(true);
    now = 3_601_000;
    expect(limiter.over('ip')).toBe(false);
  });

  it('counts the seconds to the next UTC midnight', () => {
    expect(secondsUntilNextUtcDay(Date.parse('2026-11-18T23:59:30.000Z'))).toBe(30);
    expect(secondsUntilNextUtcDay(Date.parse('2026-11-18T00:00:00.000Z'))).toBe(86400);
  });
});
