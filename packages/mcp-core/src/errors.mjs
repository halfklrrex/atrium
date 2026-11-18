/** A problem the caller can fix (bad input, wrong board, no permission). Shown as a plain message. */
export class McpUserError extends Error {
  /**
   * @param {string} message
   * @param {'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'read_only'} [code] an optional machine
   *   code (the HTTP API maps it to a status); the message and the MCP behavior are unchanged.
   */
  constructor(message, code) {
    super(message);
    this.name = 'McpUserError';
    if (code !== undefined) this.code = code;
  }
}

/** Ids that tools accept: the same shape the seeder allows, so a path can never be smuggled in. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function assertId(value, what) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new McpUserError(`${what} must be a plain id (letters, digits, "-" or "_").`);
  }
  return value;
}
