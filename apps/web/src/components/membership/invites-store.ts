import type { MyInvite } from '@atrium/shared';
import { create } from 'zustand';
import { membershipCalls } from '../../lib/callables';

interface InvitesState {
  invites: MyInvite[];
  /** The uid the list was loaded for, so a session loads it once. */
  loadedFor: string | null;
  load: (uid: string) => Promise<void>;
  remove: (workspaceId: string, inviteId: string) => void;
  reset: () => void;
}

/** The signed-in user's pending invitations (from `listMyInvites`), loaded once per session. */
export const useInvitesStore = create<InvitesState>()((set, get) => ({
  invites: [],
  loadedFor: null,
  async load(uid) {
    if (get().loadedFor === uid) return;
    set({ loadedFor: uid });
    try {
      const { invites } = await membershipCalls.listMyInvites({});
      if (get().loadedFor === uid) set({ invites });
    } catch (error) {
      console.warn('Could not load pending invitations', error);
      set({ loadedFor: null });
    }
  },
  remove: (workspaceId, inviteId) =>
    set((s) => ({
      invites: s.invites.filter((i) => !(i.workspaceId === workspaceId && i.inviteId === inviteId)),
    })),
  reset: () => set({ invites: [], loadedFor: null }),
}));
