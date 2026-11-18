import { fakeIncomingHookStore, type FakeIncomingHookStore } from './incoming-fake-store';

/** Shared fixtures for the incoming-hook unit tests. */
export const BOARD = 'b1';
export const OWNER = 'owner1';

/** A board `b1` where `owner1` owns, `ed` edits, `vw` views; `other` is only a workspace member. */
export function seededIncomingStore(): FakeIncomingHookStore {
  const store = fakeIncomingHookStore();
  store.boards.set(BOARD, {
    board: {
      workspaceId: 'ws1',
      kind: 'private',
      access: { [OWNER]: 'owner', ed: 'editor', vw: 'viewer' },
    },
    roles: { [OWNER]: 'member', ed: 'member', vw: 'viewer', other: 'member' },
    state: 'active',
    groupIds: ['g1', 'g2'],
  });
  store.accounts.set(OWNER, 'approved');
  return store;
}
