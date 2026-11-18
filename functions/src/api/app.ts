import type { McpService } from '@atrium/mcp-core';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from 'express';
import { logger } from 'firebase-functions/v2';
import { stripControlChars } from '../mcp/server';
import { usageDay, type MinuteLimiter, type UsageStore } from '../mcp/limits';
import { writeApiAudit, type ApiAuditEntry, type ApiAuditStore } from './audit';
import { ApiAuthError, type ApiAuthInfo } from './auth';
import { ApiError, errorBody, toApiError } from './errors';
import { API_MINUTE_RETRY_SECONDS, secondsUntilNextUtcDay } from './limits';
import {
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_MISMATCH_MESSAGE,
  IDEMPOTENCY_RUNNING_MESSAGE,
  idempotencyId,
  requestHash,
  type IdempotencyStore,
} from './idempotency';
import { HOOKS_BASE_PATH } from './hooks';
import { accountRoutes } from './routes/account';
import { boardRoutes } from './routes/boards';
import { itemRoutes } from './routes/items';
import { openApiHandler } from './routes/openapi';
import { writeRoutes } from './routes/writes';
import type { RouteDef } from './routes/types';

/**
 * The Express app behind the `api` function (P8 sections 4 and 6). Order of the pipeline, per request:
 * kill switch, JSON body (256 KB), per-IP failure window, authentication, scope, per-token minute
 * window, daily counters, then the route. Every answer is `Cache-Control: no-store`. Errors are
 * `{ error: { code, message } }`. Nothing here logs a token, an Authorization header or a body.
 */

export const API_BASE_PATH = '/api/v1';
export const API_BODY_LIMIT = '256kb';
export const API_BODY_LIMIT_BYTES = 256 * 1024;
export const API_DISABLED_MESSAGE = 'The Atrium API is not enabled.';
export const RATE_LIMIT_MESSAGE = 'Too many requests. Wait a minute and try again.';
export const DAILY_LIMIT_MESSAGE = 'Daily limit reached. Try again tomorrow.';
export const IP_LIMIT_MESSAGE = 'Too many failed attempts. Try again later.';

export interface ApiAppDeps {
  /** The kill switch, read on every request: `API_ENABLED === 'true'`. */
  isEnabled(): boolean;
  /** `verifyApiToken(header, deps)` over one shared deps object (so its caches work). */
  verify(authorizationHeader: string | undefined): Promise<ApiAuthInfo>;
  /** The service for one caller, restricted to the token's workspaces. */
  createService(auth: ApiAuthInfo): McpService;
  usage: UsageStore;
  /** Per token (or per user for OAuth), calls a minute. */
  limiter: MinuteLimiter;
  /** Per client IP, failed authentications an hour. */
  ipFailures: MinuteLimiter;
  audit: ApiAuditStore;
  /** `Idempotency-Key` records for `POST` (`apiIdempotency`). */
  idempotency: IdempotencyStore;
  /** The incoming-webhook router (`createHooksRouter`); absent means `/api/hooks` is a plain 404. */
  hooks?: Router;
  now: () => number;
}

export const apiEnabled = (): boolean => process.env.API_ENABLED === 'true';

const routes: RouteDef[] = [...accountRoutes, ...boardRoutes, ...itemRoutes, ...writeRoutes];

const isWrite = (method: string): boolean => !['GET', 'HEAD', 'OPTIONS'].includes(method);

export function createApiApp(deps: ApiAppDeps): Express {
  const app = express();
  // Two proxies in front of the container (Firebase Hosting, the Google front end), as for `mcp`:
  // trust exactly those, or the per-IP limit could be bypassed by a spoofed X-Forwarded-For.
  app.set('trust proxy', 2);
  app.disable('x-powered-by');

  const send = (res: Response, error: ApiError): void => {
    for (const [name, value] of Object.entries(error.headers)) res.set(name, value);
    res.status(error.status).json(errorBody(error.code, error.message));
  };

  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // The kill switch comes first: while off, nothing below runs and no Firestore read happens.
  app.use((_req, res, next) => {
    if (deps.isEnabled()) return next();
    send(res, new ApiError(503, 'api_disabled', API_DISABLED_MESSAGE));
  });

  // Incoming webhooks (P8 PR 7a): the secret in the path is the credential, so this router sits before
  // the 256 KB body check and the bearer auth below (it has its own 64 KB cap and kill switch).
  if (deps.hooks) app.use(HOOKS_BASE_PATH, deps.hooks);

  // The Functions Framework may already have parsed the body (up to 32 MB, kept in `rawBody`), in which
  // case `express.json` never runs its own limit. So check the announced and the buffered size first.
  app.use((req, res, next) => {
    const announced = Number(req.headers['content-length'] ?? 0);
    const raw = (req as Request & { rawBody?: Buffer | string }).rawBody;
    if (announced > API_BODY_LIMIT_BYTES || (raw?.length ?? 0) > API_BODY_LIMIT_BYTES) {
      return send(
        res,
        new ApiError(413, 'invalid', 'The request body is too large (256 KB at most).'),
      );
    }
    next();
  });
  app.use(express.json({ limit: API_BODY_LIMIT }));

  const audit = (entry: Omit<ApiAuditEntry, 'at' | 'expiresAt'>) =>
    writeApiAudit(deps.audit, deps.now(), entry);

  // The per-IP failure window is a best-effort brake on guessing, not a security boundary: behind
  // Hosting `req.ip` is the real client, but a direct call to the run.app URL can spoof
  // X-Forwarded-For. So it is consulted only after a token FAILED verification and never turns a valid
  // token away.
  const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.auth = await deps.verify(req.headers.authorization);
    } catch (error) {
      // Anything but a refused credential (a Firestore outage, a bug) is a 5xx, not an auth failure.
      if (!(error instanceof ApiAuthError)) throw error;
      const ip = req.ip ?? 'unknown';
      if (deps.ipFailures.over(ip)) {
        return send(
          res,
          new ApiError(429, 'rate_limited', IP_LIMIT_MESSAGE, { 'Retry-After': '3600' }),
        );
      }
      deps.ipFailures.take(ip);
      await audit({
        kind: 'auth_failed',
        method: req.method,
        ok: false,
        status: 401,
        error: error.reason,
      });
      return send(
        res,
        new ApiError(401, 'unauthorized', error.message, {
          'WWW-Authenticate': 'Bearer realm="atrium"',
        }),
      );
    }
    next();
  };

  // Every guard answer below is audited like a call, so a runaway client shows up in the log.
  // Rejections must stay cheap: at most one audit entry per key per minute for rate-limit rejections,
  // and a reached daily cap is remembered until the next UTC day (no Firestore work per rejection).
  const rejectedAuditAt = new Map<string, number>();
  const dailyBlocked = new Map<string, { day: string; scope: 'calls' | 'writes' }>();
  const MAX_TRACKED = 5000;
  const trim = <V>(map: Map<string, V>) => {
    if (map.size > MAX_TRACKED) map.delete(map.keys().next().value as string);
  };

  const guard = async (req: Request, res: Response, next: NextFunction) => {
    const auth = res.locals.auth as ApiAuthInfo;
    const key = auth.tokenId ?? auth.uid;
    const reject = async (error: ApiError) => {
      const quiet = error.code === 'rate_limited';
      const last = rejectedAuditAt.get(key);
      if (!quiet || last === undefined || deps.now() - last >= 60_000) {
        if (quiet) {
          rejectedAuditAt.set(key, deps.now());
          trim(rejectedAuditAt);
        }
        await audit({
          kind: 'call',
          method: req.method,
          ok: false,
          status: error.status,
          error: error.code,
          uid: auth.uid,
          ...(auth.tokenId ? { tokenId: auth.tokenId } : {}),
        });
      }
      send(res, error);
    };
    const write = isWrite(req.method);
    const needed = write ? 'write' : 'read';
    if (!auth.scopes.includes(needed)) {
      return reject(
        write
          ? new ApiError(403, 'read_only', 'This token is read-only. Create one that allows Write.')
          : new ApiError(403, 'forbidden', 'This token does not allow Read.'),
      );
    }
    const dailyLimit = () =>
      reject(
        new ApiError(429, 'rate_limited', DAILY_LIMIT_MESSAGE, {
          'Retry-After': String(secondsUntilNextUtcDay(deps.now())),
        }),
      );
    const today = usageDay(deps.now());
    const blocked = dailyBlocked.get(key);
    if (blocked && blocked.day === today && (blocked.scope === 'calls' || write)) {
      return dailyLimit();
    }
    if (!deps.limiter.take(key)) {
      return reject(
        new ApiError(429, 'rate_limited', RATE_LIMIT_MESSAGE, {
          'Retry-After': String(API_MINUTE_RETRY_SECONDS),
        }),
      );
    }
    const verdict = await deps.usage.consume(key, today, write);
    if (verdict !== 'ok') {
      dailyBlocked.set(key, { day: today, scope: verdict });
      trim(dailyBlocked);
      return dailyLimit();
    }
    next();
  };

  const router = express.Router();
  router.use(authenticate, guard);
  for (const route of routes) {
    router[route.method](route.path, async (req: Request, res: Response) => {
      const auth = res.locals.auth as ApiAuthInfo;
      const started = deps.now();
      let status = 200;
      let body: unknown;
      let failure: ApiError | undefined;
      let replayed = false;
      try {
        const key = req.method === 'POST' ? req.headers['idempotency-key'] : undefined;
        if (key === undefined) {
          body = await route.handler({ req, res, auth, service: deps.createService(auth) });
          status = res.statusCode;
        } else {
          if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
            throw new ApiError(
              400,
              'invalid',
              'Idempotency-Key must be 1 to 64 characters: letters, digits, "-" or "_".',
            );
          }
          const id = idempotencyId(auth.uid, key);
          const hash = requestHash(req.method, `${req.baseUrl}${req.path}`, req.query, req.body);
          const begun = await deps.idempotency.begin(id, hash, deps.now());
          if (begun.kind === 'mismatch') {
            throw new ApiError(422, 'invalid', IDEMPOTENCY_MISMATCH_MESSAGE);
          }
          if (begun.kind === 'running') {
            throw new ApiError(409, 'conflict', IDEMPOTENCY_RUNNING_MESSAGE);
          }
          if (begun.kind === 'replay') {
            replayed = true;
            status = begun.status;
            body = JSON.parse(begun.body) as unknown;
          } else {
            try {
              body = stripControlChars(
                await route.handler({ req, res, auth, service: deps.createService(auth) }),
              );
              status = res.statusCode;
            } catch (error) {
              // Errors are not stored: free the key so the client may retry.
              await deps.idempotency.release(id).catch(() => undefined);
              throw error;
            }
            await deps.idempotency
              .complete(id, hash, status, JSON.stringify(body ?? null), deps.now())
              .catch((error: unknown) =>
                logger.error('Could not store an idempotent response', { error }),
              );
          }
        }
      } catch (error) {
        failure = toApiError(error);
        // The error object only: no request, no headers, no token.
        if (failure.status === 500) {
          logger.error('API request failed', { route: `${API_BASE_PATH}${route.path}`, error });
        }
      }
      if (failure) status = failure.status;
      const boardId = res.locals.boardId;
      await audit({
        kind: 'call',
        method: req.method,
        route: `${API_BASE_PATH}${route.path}`,
        ...(typeof boardId === 'string' ? { boardId: boardId.slice(0, 64) } : {}),
        ok: status < 400,
        status,
        ...(failure ? { error: failure.code } : {}),
        ms: deps.now() - started,
        uid: auth.uid,
        ...(auth.tokenId ? { tokenId: auth.tokenId } : {}),
      });
      if (failure) return send(res, failure);
      if (replayed) res.set('Idempotency-Replayed', 'true');
      res.status(status).json(stripControlChars(body));
    });
  }
  app.get(`${API_BASE_PATH}/openapi.json`, openApiHandler); // public: before the authenticated router
  app.use(API_BASE_PATH, router);

  app.use((_req, res) => {
    send(res, new ApiError(404, 'not_found', 'No such route.'));
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    const mapped = toApiError(error);
    if (mapped.status === 500) logger.error('API request failed', { error });
    send(res, mapped);
  });

  return app;
}
