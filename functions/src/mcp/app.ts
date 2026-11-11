import { MCP_SCOPES } from '@atrium/shared';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { logger } from 'firebase-functions/v2';
import { ATRIUM_ORIGIN, MCP_RESOURCE_URL } from './oauth/constants';
import { AtriumOAuthProvider } from './oauth/provider';
import type { McpStore } from './oauth/store';
import { buildServerFor, type ServerDeps } from './server';

/**
 * The Express app behind the `mcp` function (OPS4 section 3): the SDK's OAuth 2.1 router over
 * `AtriumOAuthProvider`, and the stateless Streamable HTTP endpoint `POST /mcp`. Firebase Hosting
 * rewrites send `/mcp`, the OAuth endpoints and the two well-known documents here.
 *
 * Nothing in here logs a token, a code or an Authorization header.
 */

export const MCP_RESOURCE_METADATA_URL = `${ATRIUM_ORIGIN}/.well-known/oauth-protected-resource/mcp`;

export interface McpAppDeps {
  store: McpStore;
  server: ServerDeps;
  /** The kill switch, read on every request: `MCP_CONNECTOR_ENABLED === 'true'`. */
  isEnabled(): boolean;
}

export const connectorEnabled = (): boolean => process.env.MCP_CONNECTOR_ENABLED === 'true';

export function createMcpApp(deps: McpAppDeps): Express {
  const app = express();
  // The SDK's rate limiters key on X-Forwarded-For, which Hosting and Cloud Run set.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // The kill switch comes first: while off, nothing below runs and no Firestore read happens.
  app.use((_req, res, next) => {
    if (deps.isEnabled()) return next();
    res.set('Cache-Control', 'no-store');
    res.status(503).json({ error: 'connector_disabled' });
  });

  const provider = new AtriumOAuthProvider(deps.store, { now: deps.server.now });
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(ATRIUM_ORIGIN),
      resourceServerUrl: new URL(MCP_RESOURCE_URL),
      scopesSupported: [...MCP_SCOPES],
      resourceName: 'Atrium',
    }),
  );

  const bearerRead = requireBearerAuth({
    verifier: provider,
    requiredScopes: ['atrium:read'],
    resourceMetadataUrl: MCP_RESOURCE_METADATA_URL,
    expectedResource: new URL(MCP_RESOURCE_URL),
  });

  // `requiredScopes` drives both enforcement (atrium:read) and the `scope` hint of the challenge.
  // Claude requests the scopes named in that hint, so the hint must offer Write too (spec 3.2).
  const bearer: RequestHandler = (req, res, next) => {
    const setHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: unknown) =>
      setHeader(
        name,
        name.toLowerCase() === 'www-authenticate' && typeof value === 'string'
          ? value.replace('scope="atrium:read"', `scope="${MCP_SCOPES.join(' ')}"`)
          : (value as string),
      )) as typeof res.setHeader;
    return bearerRead(req, res, next);
  };

  app.post('/mcp', bearer, express.json({ limit: '1mb' }), async (req, res) => {
    // A new server and transport per request: stateless, so any instance can answer.
    const server = buildServerFor(req.auth!, deps.server);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 500
        ? error.status
        : 500;
    if (status === 500) logger.error('MCP request failed', { error });
    res.status(status).json({ error: status === 500 ? 'server_error' : 'invalid_request' });
  };
  app.use(onError);

  return app;
}
