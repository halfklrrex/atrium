import { createHash, randomBytes } from 'node:crypto';
import {
  INCOMING_HOOK_BASE_URL,
  INCOMING_HOOK_MAX_PER_BOARD,
  type CreateIncomingHookRequest,
  type CreateIncomingHookResult,
  type DeleteIncomingHookRequest,
  type DeleteIncomingHookResult,
  type RotateIncomingHookSecretRequest,
  type RotateIncomingHookSecretResult,
  type UpdateIncomingHookRequest,
  type UpdateIncomingHookResult,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import type { IncomingHookStore } from './incoming-store';
import { assertEnabled, requireBoardOwner as requireOwner } from './manage';

/**
 * The four board-owner callables for incoming webhooks (P8 PR 7a, spec section 5.2), as plain
 * functions over the store so they are unit tested without Firebase. Every one checks the kill switch
 * first (`WEBHOOKS_ENABLED`), then that the caller owns the board. The URL (`.../api/hooks/{hookId}.{secret}`)
 * is returned by create and rotate only; just its SHA-256 hash is stored, never the secret.
 */

export interface IncomingManageDeps {
  store: IncomingHookStore;
  now: () => number;
  /** The `WEBHOOKS_ENABLED` flag. */
  enabled: () => boolean;
}

/** A fresh secret: 32 random bytes, base64url (43 characters, no `.`). Never log it. */
export const newIncomingHookSecret = (): string => randomBytes(32).toString('base64url');

/** The token in the URL path. */
export const incomingHookToken = (hookId: string, secret: string): string => `${hookId}.${secret}`;

/** SHA-256 hex of the whole token: the document id in `incomingHookIndex`. */
export const hashIncomingHookToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const incomingHookUrl = (hookId: string, secret: string): string =>
  `${INCOMING_HOOK_BASE_URL}${incomingHookToken(hookId, secret)}`;

const requireBoardOwner = (store: IncomingHookStore, boardId: string, uid: string) =>
  requireOwner({ getBoardAccess: (id) => store.getBoard(id) }, boardId, uid);

async function requireHook(deps: IncomingManageDeps, boardId: string, hookId: string) {
  const hook = await deps.store.getHook(boardId, hookId);
  if (!hook) throw new HttpsError('not-found', 'No such incoming webhook.');
  return hook;
}

async function assertGroupExists(
  store: IncomingHookStore,
  boardId: string,
  groupId: string,
): Promise<void> {
  const board = await store.getBoard(boardId);
  if (!board?.groupIds.includes(groupId)) {
    throw new HttpsError('invalid-argument', 'That group is not on this board.');
  }
}

export async function createIncomingHook(
  deps: IncomingManageDeps,
  uid: string,
  input: CreateIncomingHookRequest,
): Promise<CreateIncomingHookResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  if (input.defaultGroupId)
    await assertGroupExists(deps.store, input.boardId, input.defaultGroupId);
  const now = deps.now();
  const hookId = deps.store.newId();
  const secret = newIncomingHookSecret();
  const created = await deps.store.createHookIfRoom({
    boardId: input.boardId,
    hookId,
    doc: {
      name: input.name,
      enabled: true,
      createdBy: uid,
      createdAt: now,
      lastUsedAt: null,
      defaultGroupId: input.defaultGroupId ?? null,
    },
    hash: hashIncomingHookToken(incomingHookToken(hookId, secret)),
    now,
    max: INCOMING_HOOK_MAX_PER_BOARD,
  });
  if (!created) {
    throw new HttpsError(
      'resource-exhausted',
      `A board can have at most ${INCOMING_HOOK_MAX_PER_BOARD} incoming webhooks. Delete one first.`,
    );
  }
  return { hookId, url: incomingHookUrl(hookId, secret) };
}

export async function updateIncomingHook(
  deps: IncomingManageDeps,
  uid: string,
  input: UpdateIncomingHookRequest,
): Promise<UpdateIncomingHookResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  const current = await requireHook(deps, input.boardId, input.hookId);
  if (input.defaultGroupId)
    await assertGroupExists(deps.store, input.boardId, input.defaultGroupId);
  const patch: Parameters<IncomingHookStore['updateHook']>[2] = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.defaultGroupId !== undefined) patch.defaultGroupId = input.defaultGroupId;
  await deps.store.updateHook(input.boardId, input.hookId, patch);
  return { hookId: input.hookId, enabled: patch.enabled ?? current.enabled };
}

/** A new secret. The old URL stops working at once; the hook's name, state and group stay. */
export async function rotateIncomingHookSecret(
  deps: IncomingManageDeps,
  uid: string,
  input: RotateIncomingHookSecretRequest,
): Promise<RotateIncomingHookSecretResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  await requireHook(deps, input.boardId, input.hookId);
  const secret = newIncomingHookSecret();
  await deps.store.replaceHash(
    input.boardId,
    input.hookId,
    hashIncomingHookToken(incomingHookToken(input.hookId, secret)),
    deps.now(),
  );
  return { hookId: input.hookId, url: incomingHookUrl(input.hookId, secret) };
}

export async function deleteIncomingHook(
  deps: IncomingManageDeps,
  uid: string,
  input: DeleteIncomingHookRequest,
): Promise<DeleteIncomingHookResult> {
  assertEnabled(deps);
  await requireBoardOwner(deps.store, input.boardId, uid);
  const deleted = await deps.store.deleteHook(input.boardId, input.hookId);
  return { hookId: input.hookId, deleted };
}
