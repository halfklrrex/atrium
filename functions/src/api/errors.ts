import { McpUserError } from '@atrium/mcp-core';
import { ZodError } from 'zod';

/** The error codes of the API (P8 section 4), plus `api_disabled` (kill switch) and `internal`. */
export type ApiErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'invalid'
  | 'conflict'
  | 'rate_limited'
  | 'read_only'
  | 'unauthorized'
  | 'api_disabled'
  | 'internal';

export const UNEXPECTED_MESSAGE = 'Unexpected error';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorBody = (code: ApiErrorCode, message: string) => ({ error: { code, message } });

/**
 * Maps whatever a route threw to the API's error model. The service signals every caller-fixable
 * problem with `McpUserError` (one class, the message says which), so the class is told apart by its
 * `code` (set at the throw sites) and, for a site without one, by its wording: a missing board or item (and one outside the token's workspaces, which reads the same) is
 * 404, a missing role is 403, anything else the caller can fix is 400. Everything unknown is a
 * generic 500 whose message never carries the cause.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return new ApiError(400, 'invalid', `${where}${issue?.message ?? 'Invalid request'}`);
  }
  if (error instanceof McpUserError) {
    const text = error.message;
    switch (error.code) {
      case 'not_found':
        return new ApiError(404, 'not_found', text);
      case 'forbidden':
        return new ApiError(403, 'forbidden', text);
      case 'conflict':
        return new ApiError(409, 'conflict', text);
      case 'read_only':
        return new ApiError(403, 'read_only', text);
      case 'invalid':
        return new ApiError(400, 'invalid', text);
      default:
        break;
    }
    // Fallback for a throw site that has no code yet: the wording.
    if (/was not found|, not active\.$|is (archived|deleted)\.$/.test(text)) {
      return new ApiError(404, 'not_found', text);
    }
    if (/can only view|needs the .* role|is locked to/.test(text)) {
      return new ApiError(403, 'forbidden', text);
    }
    return new ApiError(400, 'invalid', text);
  }
  const status = (error as { status?: unknown } | null)?.status;
  const type = (error as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') {
    return new ApiError(400, 'invalid', 'The request body is not valid JSON.');
  }
  if (type === 'entity.too.large') {
    return new ApiError(413, 'invalid', 'The request body is too large (256 KB at most).');
  }
  if (status === 400 || status === 415) {
    return new ApiError(400, 'invalid', 'The request is invalid.');
  }
  return new ApiError(500, 'internal', UNEXPECTED_MESSAGE);
}
