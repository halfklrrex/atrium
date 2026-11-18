import type { HttpsError } from 'firebase-functions/v2/https';
import { INCOMING_HOOK_BASE_URL, INCOMING_HOOK_MAX_PER_BOARD } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  createIncomingHook,
  deleteIncomingHook,
  hashIncomingHookToken,
  rotateIncomingHookSecret,
  updateIncomingHook,
  type IncomingManageDeps,
} from './incoming';
import { BOARD, OWNER, seededIncomingStore } from './incoming-testkit';

const make = (over: Partial<IncomingManageDeps> = {}) => {
  const store = seededIncomingStore();
  const deps: IncomingManageDeps = {
    store,
    now: () => 1_700_000_000_000,
    enabled: () => true,
    ...over,
  };
  return { store, deps };
};
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    return (error as HttpsError).code;
  }
  return 'none';
};
const tokenOf = (url: string) => url.slice(INCOMING_HOOK_BASE_URL.length);

describe('createIncomingHook', () => {
  it('lets a board owner create one: URL once, only the hash stored', async () => {
    const { store, deps } = make();
    const result = await createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'Form' });
    expect(result.url).toMatch(
      new RegExp(`^${INCOMING_HOOK_BASE_URL}${result.hookId}\\.[A-Za-z0-9_-]{43}$`),
    );
    const token = tokenOf(result.url);
    expect(store.index.get(hashIncomingHookToken(token))).toEqual({
      boardId: BOARD,
      hookId: result.hookId,
    });
    const doc = store.hooks.get(`${BOARD}/${result.hookId}`)!;
    expect(doc).toMatchObject({
      name: 'Form',
      enabled: true,
      createdBy: OWNER,
      lastUsedAt: null,
      defaultGroupId: null,
    });
    // Neither the secret nor the token is anywhere in what is stored.
    const secret = token.split('.')[1]!;
    expect(JSON.stringify([...store.hooks.values()])).not.toContain(secret);
    expect(JSON.stringify([...store.index.entries()])).not.toContain(secret);
  });

  it('keeps a default group that exists and refuses one that does not', async () => {
    const { store, deps } = make();
    const ok = await createIncomingHook(deps, OWNER, {
      boardId: BOARD,
      name: 'A',
      defaultGroupId: 'g2',
    });
    expect(store.hooks.get(`${BOARD}/${ok.hookId}`)!.defaultGroupId).toBe('g2');
    expect(
      await code(
        createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'B', defaultGroupId: 'nope' }),
      ),
    ).toBe('invalid-argument');
  });

  it.each([
    ['an editor', 'ed', 'permission-denied'],
    ['a viewer', 'vw', 'permission-denied'],
    ['a workspace member without board access', 'other', 'not-found'],
    ['a stranger', 'stranger', 'not-found'],
  ])('refuses %s', async (_label, uid, expected) => {
    const { store, deps } = make();
    expect(await code(createIncomingHook(deps, uid, { boardId: BOARD, name: 'X' }))).toBe(expected);
    expect(store.hooks.size).toBe(0);
    expect(store.index.size).toBe(0);
  });

  it('answers not-found for a missing board', async () => {
    const { deps } = make();
    expect(await code(createIncomingHook(deps, OWNER, { boardId: 'nope', name: 'X' }))).toBe(
      'not-found',
    );
  });

  it('allows at most five per board', async () => {
    const { store, deps } = make();
    for (let i = 0; i < INCOMING_HOOK_MAX_PER_BOARD; i++) {
      await createIncomingHook(deps, OWNER, { boardId: BOARD, name: `H${i}` });
    }
    expect(await code(createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'Six' }))).toBe(
      'resource-exhausted',
    );
    expect(store.hooks.size).toBe(INCOMING_HOOK_MAX_PER_BOARD);
  });

  it('is switched off by the flag', async () => {
    const { store, deps } = make({ enabled: () => false });
    expect(await code(createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'X' }))).toBe(
      'failed-precondition',
    );
    expect(store.hooks.size).toBe(0);
  });
});

describe('updateIncomingHook', () => {
  const setup = async () => {
    const ctx = make();
    const { hookId } = await createIncomingHook(ctx.deps, OWNER, { boardId: BOARD, name: 'Form' });
    return { ...ctx, hookId };
  };

  it('changes the name, the state and the default group (and clears it with null)', async () => {
    const { store, deps, hookId } = await setup();
    const r = await updateIncomingHook(deps, OWNER, {
      boardId: BOARD,
      hookId,
      name: 'Renamed',
      enabled: false,
      defaultGroupId: 'g1',
    });
    expect(r).toEqual({ hookId, enabled: false });
    expect(store.hooks.get(`${BOARD}/${hookId}`)).toMatchObject({
      name: 'Renamed',
      enabled: false,
      defaultGroupId: 'g1',
    });
    await updateIncomingHook(deps, OWNER, { boardId: BOARD, hookId, defaultGroupId: null });
    expect(store.hooks.get(`${BOARD}/${hookId}`)!.defaultGroupId).toBeNull();
  });

  it('refuses non-owners, an unknown hook and an unknown group', async () => {
    const { deps, hookId } = await setup();
    for (const uid of ['ed', 'vw']) {
      expect(
        await code(updateIncomingHook(deps, uid, { boardId: BOARD, hookId, enabled: false })),
      ).toBe('permission-denied');
    }
    expect(
      await code(updateIncomingHook(deps, 'stranger', { boardId: BOARD, hookId, enabled: false })),
    ).toBe('not-found');
    expect(
      await code(
        updateIncomingHook(deps, OWNER, { boardId: BOARD, hookId: 'zzz', enabled: false }),
      ),
    ).toBe('not-found');
    expect(
      await code(
        updateIncomingHook(deps, OWNER, { boardId: BOARD, hookId, defaultGroupId: 'nope' }),
      ),
    ).toBe('invalid-argument');
  });

  it('cannot reach a hook of another board', async () => {
    const { store, deps, hookId } = await setup();
    store.boards.set('b2', { ...store.boards.get(BOARD)! });
    expect(
      await code(updateIncomingHook(deps, OWNER, { boardId: 'b2', hookId, enabled: false })),
    ).toBe('not-found');
  });
});

describe('rotateIncomingHookSecret', () => {
  it('returns a new URL once, drops the old hash and keeps one index entry', async () => {
    const { store, deps } = make();
    const created = await createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'Form' });
    const oldHash = hashIncomingHookToken(tokenOf(created.url));
    const rotated = await rotateIncomingHookSecret(deps, OWNER, {
      boardId: BOARD,
      hookId: created.hookId,
    });
    expect(rotated.hookId).toBe(created.hookId);
    expect(rotated.url).not.toBe(created.url);
    expect(store.index.has(oldHash)).toBe(false);
    expect(store.index.size).toBe(1);
    expect(store.index.get(hashIncomingHookToken(tokenOf(rotated.url)))).toEqual({
      boardId: BOARD,
      hookId: created.hookId,
    });
  });

  it('is owners only', async () => {
    const { deps } = make();
    const { hookId } = await createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'Form' });
    for (const [uid, expected] of [
      ['ed', 'permission-denied'],
      ['vw', 'permission-denied'],
      ['stranger', 'not-found'],
    ] as const) {
      expect(await code(rotateIncomingHookSecret(deps, uid, { boardId: BOARD, hookId }))).toBe(
        expected,
      );
    }
    expect(
      await code(rotateIncomingHookSecret(deps, OWNER, { boardId: BOARD, hookId: 'zzz' })),
    ).toBe('not-found');
  });
});

describe('deleteIncomingHook', () => {
  it('removes the hook and its index entry', async () => {
    const { store, deps } = make();
    const { hookId } = await createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'Form' });
    expect(await deleteIncomingHook(deps, OWNER, { boardId: BOARD, hookId })).toEqual({
      hookId,
      deleted: true,
    });
    expect(store.hooks.size).toBe(0);
    expect(store.index.size).toBe(0);
    expect(await deleteIncomingHook(deps, OWNER, { boardId: BOARD, hookId })).toEqual({
      hookId,
      deleted: false,
    });
  });

  it('is owners only and flag gated', async () => {
    const { store, deps } = make();
    const { hookId } = await createIncomingHook(deps, OWNER, { boardId: BOARD, name: 'Form' });
    expect(await code(deleteIncomingHook(deps, 'ed', { boardId: BOARD, hookId }))).toBe(
      'permission-denied',
    );
    expect(
      await code(
        deleteIncomingHook({ ...deps, enabled: () => false }, OWNER, { boardId: BOARD, hookId }),
      ),
    ).toBe('failed-precondition');
    expect(store.hooks.size).toBe(1);
  });
});
