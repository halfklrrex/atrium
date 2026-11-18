import { timingSafeEqual } from 'node:crypto';
import {
  INCOMING_HOOK_BODY_MAX_BYTES,
  INCOMING_HOOK_CALLS_PER_MINUTE,
  INCOMING_HOOK_DAILY_CALLS,
  INCOMING_HOOK_SECRET_LENGTH,
  canManageBoard,
  incomingHookBodySchema,
  resolveBoardRole,
} from '@atrium/shared';
import { McpUserError, type McpService } from '@atrium/mcp-core';
import express, { Router, type Request, type Response } from 'express';
import { logger } from 'firebase-functions/v2';
import { stripControlChars } from '../mcp/server';
import { MinuteLimiter, usageDay, type UsageStore } from '../mcp/limits';
import { hashIncomingHookToken } from '../webhooks/incoming';
import type { IncomingHookStore } from '../webhooks/incoming-store';
import { writeApiAudit, type ApiAuditEntry, type ApiAuditStore } from './audit';
import { ApiError, errorBody } from './errors';
import {
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_MISMATCH_MESSAGE,
  IDEMPOTENCY_RUNNING_MESSAGE,
  idempotencyId,
  requestHash,
  type IdempotencyStore,
} from './idempotency';
import { secondsUntilNextUtcDay } from './limits';
import { ZodError } from 'zod';

/**
 * The incoming-webhook route, `POST /api/hooks/{hookId}.{secret}` (P8 PR 7a, spec section 5.2). It is
 * mounted by `createApiApp` before the bearer-auth router: the secret in the path is the credential.
 *
 * - Off unless `WEBHOOKS_ENABLED=true` (503), on top of the API kill switch the app already applies.
 * - The token is looked up by the SHA-256 of the whole string in `incomingHookIndex`. Anything that is
 *   not a good, enabled hook whose creator still owns an active board answers the same `404` (no oracle).
 * - Creates one item through the same service as the API's write route, as the hook's creator, with
 *   `updatedVia: 'webhook:<hookId>'` (the activity log then reads "Webhook: <name>").
 * - 64 KB body, 60 calls a minute (per instance) and 1,000 a day per hook, `Idempotency-Key` like the API.
 * - Never logs or audits the token, the path or the body: a failed request logs the hook id and the
 *   error name only; the audit entry has the hook id, board id, status and time.
 */

export const HOOKS_BASE_PATH = '/api/hooks';
export const HOOKS_AUDIT_ROUTE = '/api/hooks/:token';
export const HOOK_DISABLED_MESSAGE = 'Incoming webhooks are not enabled.';
export const HOOK_NOT_FOUND_MESSAGE = 'Not found.';
export const HOOK_RATE_LIMIT_MESSAGE = 'Too many requests. Wait a minute and try again.';
export const HOOK_DAILY_LIMIT_MESSAGE = 'Daily limit reached. Try again tomorrow.';
/** `lastUsedAt` is written at most this often per hook. */
export const HOOK_LAST_USED_INTERVAL_MS = 60 * 1000;

/** `{hookId}.{secret}`: ids are letters and digits, the secret is 43 base64url characters. */
const TOKEN_PATTERN = new RegExp(
  `^([A-Za-z0-9]{8,40})\\.([A-Za-z0-9_-]{${INCOMING_HOOK_SECRET_LENGTH}})$`,
);

export interface HooksDeps {
  /** `WEBHOOKS_ENABLED === 'true'`, read on every request. */
  isEnabled(): boolean;
  store: IncomingHookStore;
  /** The service for the hook's creator, stamping `via` on what it creates. */
  createService(uid: string, via: string): McpService;
  /** Per hook, calls a minute. */
  limiter: MinuteLimiter;
  /** Daily counters, key `hook_<hookId>`. */
  usage: UsageStore;
  audit: ApiAuditStore;
  idempotency: IdempotencyStore;
  now: () => number;
}

/** Calls a hook may make a minute, per instance. */
export const newHookLimiter = (now: () => number = Date.now): MinuteLimiter =>
  new MinuteLimiter(INCOMING_HOOK_CALLS_PER_MINUTE, now);
export { INCOMING_HOOK_DAILY_CALLS };

const sameHash = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createHooksRouter(deps: HooksDeps): Router {
  const router = Router();

  const send = (res: Response, error: ApiError): void => {
    for (const [name, value] of Object.entries(error.headers)) res.set(name, value);
    res.status(error.status).json(errorBody(error.code, error.message));
  };
  const notFound = () => new ApiError(404, 'not_found', HOOK_NOT_FOUND_MESSAGE);

  // Kill switch for this feature.
  router.use((_req, res, next) => {
    if (deps.isEnabled()) return next();
    send(res, new ApiError(503, 'api_disabled', HOOK_DISABLED_MESSAGE));
  });

  // The announced and the buffered size first (the Functions Framework may have parsed the body already),
  // then the JSON parser with the same cap.
  const tooLarge = () =>
    new ApiError(413, 'invalid', 'The request body is too large (64 KB at most).');
  router.use((req, res, next) => {
    const announced = Number(req.headers['content-length'] ?? 0);
    const raw = (req as Request & { rawBody?: Buffer | string }).rawBody;
    if (
      announced > INCOMING_HOOK_BODY_MAX_BYTES ||
      (raw?.length ?? 0) > INCOMING_HOOK_BODY_MAX_BYTES
    ) {
      return send(res, tooLarge());
    }
    next();
  });
  router.use(express.json({ limit: INCOMING_HOOK_BODY_MAX_BYTES }));

  const lastTouch = new Map<string, number>();
  const touchLastUsed = async (boardId: string, hookId: string, lastUsedAt: number | null) => {
    const now = deps.now();
    const last = Math.max(lastUsedAt ?? 0, lastTouch.get(hookId) ?? 0);
    if (last !== 0 && now - last < HOOK_LAST_USED_INTERVAL_MS) return;
    lastTouch.set(hookId, now);
    if (lastTouch.size > 5000) lastTouch.delete(lastTouch.keys().next().value as string);
    try {
      await deps.store.touchLastUsed(boardId, hookId, now);
    } catch (error) {
      logger.error('Could not record the use of an incoming webhook', {
        hookId,
        errorName: (error as Error | undefined)?.name,
      });
    }
  };

  const audit = (entry: Omit<ApiAuditEntry, 'at' | 'expiresAt'>) =>
    writeApiAudit(deps.audit, deps.now(), entry);

  router.post('/:token', async (req: Request, res: Response) => {
    const started = deps.now();
    let hookId: string | undefined;
    let boardId: string | undefined;
    let status = 201;
    let body: unknown;
    let failure: ApiError | undefined;
    let replayed = false;
    try {
      // 1. Whose token? Every way of failing here is the same 404.
      const match = TOKEN_PATTERN.exec(String(req.params.token ?? ''));
      if (!match) throw notFound();
      const token = match[0];
      const hash = hashIncomingHookToken(token);
      const index = await deps.store.getIndex(hash);
      if (!index || !sameHash(match[1]!, index.hookId)) throw notFound();
      hookId = index.hookId;
      boardId = index.boardId;
      const hook = await deps.store.getHook(index.boardId, index.hookId);
      if (!hook?.enabled) throw notFound();

      // 2. The creator must still be an approved owner of an active board.
      if ((await deps.store.getAccountStatus(hook.createdBy)) !== 'approved') throw notFound();
      const record = await deps.store.getBoard(index.boardId);
      if (!record?.roles || record.state !== 'active') throw notFound();
      const role = resolveBoardRole(record.board, hook.createdBy, record.roles[hook.createdBy]);
      if (!role || !canManageBoard(role)) throw notFound();

      // 3. Limits: they count only for a valid, live hook.
      const limitKey = `hook_${index.hookId}`;
      if (!deps.limiter.take(limitKey)) {
        throw new ApiError(429, 'rate_limited', HOOK_RATE_LIMIT_MESSAGE, { 'Retry-After': '60' });
      }
      const verdict = await deps.usage.consume(limitKey, usageDay(deps.now()), true);
      if (verdict !== 'ok') {
        throw new ApiError(429, 'rate_limited', HOOK_DAILY_LIMIT_MESSAGE, {
          'Retry-After': String(secondsUntilNextUtcDay(deps.now())),
        });
      }

      // 4. The body.
      const parsed = incomingHookBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) throw parsed.error;
      const input = parsed.data;
      const group = input.group ?? hook.defaultGroupId ?? undefined;

      const create = async (): Promise<unknown> => {
        const service = deps.createService(hook.createdBy, `webhook:${index.hookId}`);
        const { created } = await service.createItems({
          boardId: index.boardId,
          items: [
            {
              name: input.name,
              ...(group ? { group } : {}),
              ...(input.values ? { values: input.values } : {}),
            },
          ],
        });
        return { id: created[0]!.id, boardId: index.boardId };
      };

      const key = req.headers['idempotency-key'];
      if (key === undefined) {
        body = await create();
      } else {
        if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
          throw new ApiError(
            400,
            'invalid',
            'Idempotency-Key must be 1 to 64 characters: letters, digits, "-" or "_".',
          );
        }
        // Namespaced by hook id, so two hooks (or a hook and a person) never share a key.
        const id = idempotencyId(`hook_${index.hookId}`, key);
        const reqHash = requestHash('POST', HOOKS_AUDIT_ROUTE, {}, req.body ?? {});
        const begun = await deps.idempotency.begin(id, reqHash, deps.now());
        if (begun.kind === 'mismatch')
          throw new ApiError(422, 'invalid', IDEMPOTENCY_MISMATCH_MESSAGE);
        if (begun.kind === 'running')
          throw new ApiError(409, 'conflict', IDEMPOTENCY_RUNNING_MESSAGE);
        if (begun.kind === 'replay') {
          replayed = true;
          status = begun.status;
          body = JSON.parse(begun.body) as unknown;
        } else {
          try {
            body = await create();
          } catch (error) {
            await deps.idempotency.release(id).catch(() => undefined);
            throw error;
          }
          await deps.idempotency
            .complete(id, reqHash, 201, JSON.stringify(body), deps.now())
            .catch((error: unknown) =>
              logger.error('Could not store an idempotent hook response', {
                hookId,
                errorName: (error as Error | undefined)?.name,
              }),
            );
        }
      }
      void touchLastUsed(index.boardId, index.hookId, hook.lastUsedAt);
    } catch (error) {
      failure = toHookError(error);
      if (failure.status === 500) {
        logger.error('Incoming webhook failed', {
          ...(hookId ? { hookId } : {}),
          errorName: (error as Error | undefined)?.name,
        });
      }
    }
    if (failure) status = failure.status;
    // Only a request that found a live hook is audited. The uniform 404 (a guess, a disabled hook, a
    // creator who lost the board) is not: nobody can fill the log by guessing or replaying a dead URL.
    if (hookId && status !== 404) {
      await audit({
        kind: 'call',
        method: 'POST',
        route: HOOKS_AUDIT_ROUTE,
        hookId,
        ...(boardId ? { boardId: boardId.slice(0, 64) } : {}),
        ok: status < 400,
        status,
        ...(failure ? { error: failure.code } : {}),
        ms: deps.now() - started,
      });
    }
    if (failure) return send(res, failure);
    if (replayed) res.set('Idempotency-Replayed', 'true');
    res.status(status).json(stripControlChars(body));
  });

  // Anything else under /api/hooks is a plain 404 (no echo of the path).
  router.use((_req, res) => send(res, notFound()));
  router.use((error: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (res.headersSent) return next(error);
    send(res, toHookError(error));
  });

  return router;
}

/**
 * Errors of this route: a bad body, a bad column or value and a missing group are the caller's `400`
 * (the service words them; a column that "was not found" is still a 400 here, unlike the API's 404, since
 * the board itself was checked first). Anything else is a generic 500.
 */
function toHookError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return new ApiError(400, 'invalid', `${where}${issue?.message ?? 'Invalid request'}`);
  }
  if (error instanceof McpUserError) return new ApiError(400, 'invalid', error.message);
  const type = (error as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') {
    return new ApiError(413, 'invalid', 'The request body is too large (64 KB at most).');
  }
  if (type === 'entity.parse.failed') {
    return new ApiError(400, 'invalid', 'The request body is not valid JSON.');
  }
  if ((error as { status?: unknown } | null)?.status === 409) {
    return new ApiError(409, 'conflict', 'The data changed while the request ran. Try again.');
  }
  return new ApiError(500, 'internal', 'Unexpected error');
}
