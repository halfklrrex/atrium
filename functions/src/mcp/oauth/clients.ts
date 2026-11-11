import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { MCP_CLIENT_NAME_MAX, MCP_CLIENT_TTL_MS } from './constants';
import type { McpClientDoc, McpStore } from './store';

/**
 * Dynamic Client Registration (OPS4 decision D3): every client is public (no secret, PKCE only) and
 * may only redirect to the four callbacks Claude uses. Anything else is refused at registration,
 * so `/authorize` never sees an unknown redirect.
 */

const CLAUDE_HOSTS: ReadonlySet<string> = new Set(['claude.ai', 'claude.com']);
const CLAUDE_CALLBACK_PATH = '/api/mcp/auth_callback';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);
const LOOPBACK_CALLBACK_PATH = '/callback';

export const MCP_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
export const MCP_RESPONSE_TYPES = ['code'] as const;

/**
 * `https://claude.ai/api/mcp/auth_callback`, the same on `claude.com`, or `http://localhost:<any
 * port>/callback` / `http://127.0.0.1:<any port>/callback` (Claude Code picks a free port). No
 * credentials, query or fragment in any of them.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === 'https:' && CLAUDE_HOSTS.has(url.hostname)) {
    return url.port === '' && url.pathname === CLAUDE_CALLBACK_PATH;
  }
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    return url.pathname === LOOPBACK_CALLBACK_PATH;
  }
  return false;
}

/** A client name fit to store and show: one line, no control characters, at most 100 characters. */
export function cleanClientName(name: unknown): string {
  const text = typeof name === 'string' ? name : '';
  // eslint-disable-next-line no-control-regex -- strip C0 and C1 control characters
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return (cleaned || 'Unnamed app').slice(0, MCP_CLIENT_NAME_MAX);
}

/** What the SDK handlers get back for a stored client. */
export function toClientInformation(doc: McpClientDoc): OAuthClientInformationFull {
  return {
    client_id: doc.clientId,
    client_id_issued_at: Math.floor(doc.createdAt / 1000),
    client_name: doc.clientName,
    redirect_uris: doc.redirectUris,
    token_endpoint_auth_method: doc.tokenEndpointAuthMethod,
    grant_types: doc.grantTypes,
    response_types: doc.responseTypes,
  };
}

export class McpClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private readonly store: McpStore,
    private readonly now: () => number = Date.now,
  ) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const doc = await this.store.getClient(clientId);
    if (!doc || doc.expiresAt <= this.now()) return undefined;
    return toClientInformation(doc);
  }

  /**
   * The SDK generates `client_id` (and a secret, which is dropped: public clients only). Only the
   * fields in OPS4 section 4.2 are stored; the rest of the metadata is ignored. Any requested
   * `token_endpoint_auth_method` (Claude sends `client_secret_post`) is accepted but forced to
   * `none`: no secret is ever stored or returned, and PKCE is the client authentication.
   */
  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> & {
      client_id?: string;
    },
  ): Promise<OAuthClientInformationFull> {
    const redirectUris = client.redirect_uris ?? [];
    if (redirectUris.length === 0) {
      throw new InvalidClientMetadataError('redirect_uris is required');
    }
    for (const uri of redirectUris) {
      if (!isAllowedRedirectUri(uri)) {
        throw new InvalidClientMetadataError('redirect_uri is not allowed for this server');
      }
    }
    const clientId = client.client_id || this.store.newId();
    const now = this.now();
    const doc: McpClientDoc = {
      clientId,
      clientName: cleanClientName(client.client_name),
      redirectUris: [...new Set(redirectUris)],
      tokenEndpointAuthMethod: 'none',
      grantTypes: [...MCP_GRANT_TYPES],
      responseTypes: [...MCP_RESPONSE_TYPES],
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + MCP_CLIENT_TTL_MS,
    };
    await this.store.setClient(doc);
    return toClientInformation(doc);
  }
}
